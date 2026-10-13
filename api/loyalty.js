const { admin } = require('../lib/admin');
const { send, method, body, text } = require('../lib/http');
const { requireBarber } = require('../lib/security');

const DEFAULT_PROGRAM = { id:'program-246', name:'Ciclo clásico', audience:'all', customerIds:[], rewards:[{cut:2,discount:30,label:'30% OFF'},{cut:4,discount:50,label:'50% OFF'},{cut:6,discount:70,label:'70% OFF'}] };
function normalizeProgram(raw, index) {
  const id = text(raw.id, 80).replace(/[^a-zA-Z0-9_-]/g, '');
  const name = text(raw.name, 60);
  const audience = raw.audience === 'selected' ? 'selected' : 'all';
  const customerIds = audience === 'selected' && Array.isArray(raw.customerIds) ? [...new Set(raw.customerIds.map(v=>text(v,100)).filter(Boolean))].slice(0,500) : [];
  if (!id || !name) throw new Error(`La variante ${index + 1} necesita un identificador y un nombre.`);
  if (audience === 'selected' && !customerIds.length) throw new Error(`Seleccioná al menos un cliente para «${name}».`);
  if (!Array.isArray(raw.rewards) || raw.rewards.length < 1 || raw.rewards.length > 10) throw new Error(`«${name}» debe tener entre 1 y 10 premios.`);
  const rewards = raw.rewards.map(r=>({cut:Number(r.cut),discount:Number(r.discount)})).sort((a,b)=>a.cut-b.cut);
  let previous = 0;
  for (const reward of rewards) {
    if (!Number.isInteger(reward.cut) || reward.cut < 1 || reward.cut > 50 || reward.cut <= previous) throw new Error(`En «${name}», los números de corte deben ser enteros, únicos y estar ordenados entre 1 y 50.`);
    if (!Number.isInteger(reward.discount) || reward.discount < 1 || reward.discount > 100) throw new Error(`En «${name}», cada descuento debe estar entre 1% y 100%.`);
    reward.label = `${reward.discount}% OFF`;
    previous = reward.cut;
  }
  return { id, name, audience, customerIds, rewards };
}
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET','PUT'])) return;
  try {
    const ctx = await requireBarber(req, res); if (!ctx) return;
    const barberRef = ctx.db.collection('barbers').doc(ctx.uid);
    const barberSnap = await barberRef.get();
    if (!barberSnap.exists) return send(res,404,{ok:false,error:'No se encontró el perfil del barbero.'});
    const existingData = barberSnap.data();
    const storedPrograms = Array.isArray(existingData.loyaltyPrograms)&&existingData.loyaltyPrograms.length?existingData.loyaltyPrograms:[DEFAULT_PROGRAM];
    // Private assignment lists live on each customer's profile, not on the barber document
    // (customers are allowed to read that document to see public barber details).
    if (req.method === 'GET') {
      const customersRef = barberRef.collection('customers');
      const programs = [];
      for (const p of storedPrograms) {
        let customerIds = [];
        if (p.audience === 'selected') {
          const assignedSnap = await customersRef.where('loyaltyProgramId', '==', p.id).get();
          customerIds = assignedSnap.docs.map(doc => doc.id);
        }
        programs.push({ ...p, customerIds });
      }
      return send(res,200,{ok:true,programs,defaultLoyaltyProgramId:existingData.defaultLoyaltyProgramId||programs.find(p=>p.audience==='all')?.id||programs[0].id});
    }
    const data = body(req);
    if (!Array.isArray(data.programs)||!data.programs.length||data.programs.length>10) return send(res,400,{ok:false,error:'Configurá entre 1 y 10 programas de fidelización.'});
    const programs = data.programs.map(normalizeProgram);
    if (new Set(programs.map(p=>p.id)).size!==programs.length) return send(res,400,{ok:false,error:'Hay dos programas con el mismo identificador. Recargá Configuración y probá de nuevo.'});
    const allPrograms=programs.filter(p=>p.audience==='all');
    if(allPrograms.length!==1) return send(res,400,{ok:false,error:'Debe existir exactamente un programa general para todos los clientes. Las demás variantes se asignan a clientes seleccionados.'});
    const selectedOwners = new Map();
    for (const p of programs.filter(p=>p.audience==='selected')) for (const id of p.customerIds) {
      if(selectedOwners.has(id)) return send(res,400,{ok:false,error:'Un cliente no puede pertenecer a dos variantes a la vez. Revisá las selecciones.'});
      selectedOwners.set(id,p.id);
    }
    const customersRef=barberRef.collection('customers');
    const selectedCustomerDocs = new Map();
    if(selectedOwners.size){
      const ids=[...selectedOwners.keys()];
      for(let i=0;i<ids.length;i+=100){
        const snaps=await Promise.all(ids.slice(i,i+100).map(id=>customersRef.doc(id).get()));
        if(snaps.some(s=>!s.exists)) return send(res,400,{ok:false,error:'Una variante contiene un cliente que ya no existe. Volvé a Configuración y actualizá la selección.'});
        for (const snap of snaps) selectedCustomerDocs.set(snap.id, snap);
      }
    }
    const defaultId=allPrograms[0].id;
    // Read only customers currently assigned to targeted variants, plus newly selected IDs.
    // No need to scan every customer whenever the barber saves settings.
    const affectedDocs = new Map(selectedCustomerDocs);
    const oldSelectedIds = storedPrograms.filter(p => p.audience === 'selected').map(p => p.id);
    for (const oldProgramId of oldSelectedIds) {
      const oldSnap = await customersRef.where('loyaltyProgramId', '==', oldProgramId).get();
      for (const doc of oldSnap.docs) affectedDocs.set(doc.id, doc);
    }
    // Never expose target customer UIDs in barbers/{uid}, which customers can read.
    const publicPrograms=programs.map(({customerIds, ...p})=>({...p,customerIds:[]}));
    await barberRef.update({loyaltyPrograms:publicPrograms,defaultLoyaltyProgramId:defaultId,updatedAt:admin().firestore.FieldValue.serverTimestamp()});
    let updatedCustomers=0;
    let batch=ctx.db.batch(), ops=0;
    for(const doc of affectedDocs.values()){
      const targetId=selectedOwners.get(doc.id)||defaultId;
      if(doc.data().loyaltyProgramId===targetId) continue;
      batch.update(doc.ref,{loyaltyProgramId:targetId,updatedAt:admin().firestore.FieldValue.serverTimestamp()});ops++;updatedCustomers++;
      if(ops>=450){await batch.commit();batch=ctx.db.batch();ops=0;}
    }
    if(ops) await batch.commit();
    return send(res,200,{ok:true,programs,defaultLoyaltyProgramId:defaultId,updatedCustomers});
  } catch(error){
    console.error('loyalty error',error);
    return send(res,400,{ok:false,error:error.message||'No se pudo guardar la fidelización. Revisá los números de corte y descuentos.'});
  }
};
