const { admin } = require('../lib/admin');
const { send, method, body, text } = require('../lib/http');
const { requireBarber, subscription } = require('../lib/security');
const { sendPushToCustomer } = require('../lib/push');

function defaultProgram(barber) {
  const programs=Array.isArray(barber.loyaltyPrograms)?barber.loyaltyPrograms:[];
  const selected=programs.find(p=>p.id===barber.defaultLoyaltyProgramId)||programs.find(p=>p.audience==='all')||programs[0];
  return selected||{id:'program-246',name:'Ciclo clásico',rewards:[{cut:2,discount:10,label:'10% OFF'},{cut:4,discount:20,label:'20% OFF'},{cut:6,discount:30,label:'30% OFF'}]};
}
function programForCustomer(customer,barber){const programs=Array.isArray(barber.loyaltyPrograms)?barber.loyaltyPrograms:[];return programs.find(p=>p.id===customer.loyaltyProgramId)||defaultProgram(barber);}
function normalizeRewards(program){
  const raw=Array.isArray(program.rewards)?program.rewards:[];
  const normalized=raw.map(r=>({cut:Number(r.cut),discount:Math.min(100,Math.max(1,Number(r.discount)||1)),label:`${Math.min(100,Math.max(1,Number(r.discount)||1))}% OFF`})).filter(r=>Number.isInteger(r.cut)&&r.cut>=1&&r.cut<=50).sort((a,b)=>a.cut-b.cut);
  return normalized.length?normalized:[{cut:2,discount:10,label:'10% OFF'},{cut:4,discount:20,label:'20% OFF'},{cut:6,discount:30,label:'30% OFF'}];
}
function activeReward(customer,rewards){
  const current=Array.isArray(customer.availableRewards)?customer.availableRewards:[];
  if(current.length)return current.slice().sort((a,b)=>Number(b.cut||0)-Number(a.cut||0))[0];
  if(customer.rewardReady){const n=Number(customer.cycleCuts||0);return [...rewards].filter(r=>Number(r.cut)<=n).pop()||rewards[0];}
  return null;
}
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;
  if (req.method === 'GET') return send(res, 200, {ok:true, history:[], historyNextCursor:null, historyHasMore:false});
  if (req.method === 'DELETE') return send(res, 200, {ok:true, deleted:0, hasMore:false, message:'El historial está desactivado.'});
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;
    const barberRef = ctx.db.collection('barbers').doc(ctx.uid);
    const data = body(req);
    const action = text(data.action, 30);

    if(action!=='add')return send(res,400,{ok:false,error:'La acción solicitada no está disponible. Seleccioná un cliente registrado.'});
    const customerId = text(data.customerId, 100);
    if (!customerId) return send(res, 400, { ok: false, error: 'Elegí un cliente.' });
    const customerRef = barberRef.collection('customers').doc(customerId);

    if (action === 'add') {
      let resultCustomer = null;
      let outcome = { appliedReward: null, cycleCut: 0, cycleMax: 0, cyclePausedAtMax: false, cycleReset: false };
      await ctx.db.runTransaction(async transaction => {
        const [customerSnap, barberSnap] = await Promise.all([transaction.get(customerRef), transaction.get(barberRef)]);
        if (!customerSnap.exists || customerSnap.data().active === false) throw new Error('El cliente no existe o fue dado de baja.');
        const customer = customerSnap.data();
        if(!barberSnap.exists)throw new Error('No se encontró el perfil profesional.');
        const freshBarber = barberSnap.data();
        if(subscription(freshBarber).status==='suspended')throw new Error('La cuenta está vencida. Para registrar nuevas visitas, primero renová tu plan desde Configuración.');
        const program = programForCustomer(customer, freshBarber);
        const rewards = normalizeRewards(program);
        const cycleMax = Math.max(1,...rewards.map(r=>Number(r.cut)||1));
        const legacyNonVisitCredits = Math.max(0, Number(customer.referralCreditsReceived || 0));
        const ownCutsBefore = Number.isFinite(Number(customer.actualCutsRegistered))
          ? Math.max(0, Number(customer.actualCutsRegistered))
          : Math.max(0, Number(customer.totalCuts || 0) - legacyNonVisitCredits);
        const totalCuts = ownCutsBefore + 1;
        const actualCutsRegistered = ownCutsBefore + 1;
        const pendingReward = activeReward(customer, rewards);
        let cycleBefore = customer.cycleVersion === 2
          ? Math.max(0, Math.min(cycleMax, Number(customer.cycleCuts || 0)))
          : (ownCutsBefore % cycleMax);
        // The discount belongs to the visit that reaches the milestone, not an extra visit afterward.
        if (legacyNonVisitCredits > 0 && !pendingReward) cycleBefore = ownCutsBefore % cycleMax;
        const shouldRestart = Boolean(customer.cyclePausedAtMax) || cycleBefore >= cycleMax || Boolean(pendingReward && Number(pendingReward.cut) >= cycleMax);
        const cycleForVisit = shouldRestart ? 1 : Math.min(cycleMax, cycleBefore + 1);
        const milestoneReward = rewards.find(r => Number(r.cut) === cycleForVisit) || null;
        const appliedReward = pendingReward || milestoneReward || null;
        const appliedOnFinalMilestone = Boolean(!pendingReward && milestoneReward && Number(milestoneReward.cut) >= cycleMax && appliedReward === milestoneReward);
        // Once the final reward is used, the next cycle begins at zero; history keeps the actual visit at 6/6.
        const cycleNext = appliedOnFinalMilestone ? 0 : cycleForVisit;
        const availableRewards = [];
        const cyclePausedAtMax = false;
        const rewardReady = false;
        const now = admin().firestore.FieldValue.serverTimestamp();
        const previousAppliedReward = !appliedReward && !shouldRestart
          && customer.lastRewardAppliedOnFinalMilestone !== true
          && String(customer.lastRewardAppliedLabel || '').trim()
          && Number(customer.lastRewardAppliedCut || 0) > 0
          ? {
              label: text(customer.lastRewardAppliedLabel, 50),
              cut: Number(customer.lastRewardAppliedCut),
              at: customer.lastRewardAppliedAt || null,
              finalMilestone: false
            }
          : null;
        const storedReward = appliedReward
          ? {
              label: text(appliedReward.label || `${Number(appliedReward.discount)||0}% OFF`, 50),
              cut: Number(appliedReward.cut || 0),
              at: now,
              finalMilestone: appliedOnFinalMilestone
            }
          : previousAppliedReward;
        const updates = {
          totalCuts, actualCutsRegistered, cycleCuts: cycleNext, cycleVersion: 2, cyclePausedAtMax,
          availableRewards, rewardReady,
          lastCutAt: now,
          lastRewardAppliedLabel: storedReward ? storedReward.label : null,
          lastRewardAppliedAt: storedReward ? storedReward.at : null,
          lastRewardAppliedCut: storedReward ? storedReward.cut : null,
          lastRewardAppliedOnFinalMilestone: storedReward ? Boolean(storedReward.finalMilestone) : null,
          updatedAt: now
        };
        transaction.update(customerRef, updates);
        resultCustomer = {
          ...customer,
          ...updates,
          totalCuts,
          actualCutsRegistered,
          cycleCuts: cycleNext,
          cycleVersion: 2,
          cyclePausedAtMax,
          loyaltyProgramId: customer.loyaltyProgramId || program.id,
          availableRewards,
          rewardReady,
          lastCutAt: new Date().toISOString(),
          lastRewardAppliedLabel: storedReward ? storedReward.label : null,
          lastRewardAppliedAt: appliedReward ? new Date().toISOString() : (previousAppliedReward ? (previousAppliedReward.at && typeof previousAppliedReward.at.toDate === 'function' ? previousAppliedReward.at.toDate().toISOString() : previousAppliedReward.at || null) : null),
          lastRewardAppliedCut: storedReward ? storedReward.cut : null,
          lastRewardAppliedOnFinalMilestone: storedReward ? Boolean(storedReward.finalMilestone) : null
        };
        outcome = { appliedReward, cycleCut: cycleForVisit, cycleMax, cyclePausedAtMax, cycleReset: appliedOnFinalMilestone };
      });
      let message = 'Visita registrada correctamente.';
      if (outcome.appliedReward) { const label = outcome.appliedReward.label || String(outcome.appliedReward.discount) + '% OFF'; message = 'Visita registrada. ' + label + ' se aplicó en esta visita.'; }
      if (outcome.cycleReset) message += ' El siguiente ciclo comienza desde cero.';
      const rewardLabel = outcome.appliedReward && String(outcome.appliedReward.label || (Number(outcome.appliedReward.discount)||0)+'% OFF');
      const pushTitle = outcome.cycleReset ? '¡Ciclo completado!' : outcome.appliedReward ? '¡Premio alcanzado!' : 'Tu tarjeta se actualizó';
      const pushBody = outcome.cycleReset
        ? 'Completaste '+outcome.cycleMax+' de '+outcome.cycleMax+' visitas. '+(rewardLabel||'Tu beneficio')+' se aplicó en esta visita. El próximo corte inicia otro ciclo.'
        : outcome.appliedReward
          ? 'Alcanzaste el hito '+outcome.cycleCut+'. '+(rewardLabel||'Tu beneficio')+' se aplicó en esta visita.'
          : 'Tu ciclo va '+outcome.cycleCut+' de '+outcome.cycleMax+' visitas.';
      await sendPushToCustomer({barberUid:ctx.uid,customerId,title:pushTitle,body:pushBody,tag:'barber-vip-visits-'+customerId+'-'+String(resultCustomer.totalCuts||Date.now()),url:'/'});
      return send(res, 200, { ok: true, customer: resultCustomer, appliedReward: outcome.appliedReward, message });
    }

    return send(res, 400, { ok: false, error: 'Acción de visita desconocida.' });
  } catch (error) {
    console.error('cuts error', error);
    if (error.message && /cliente|descuento|premio|fecha|corte|cuenta|programa|fidelización/.test(error.message)) return send(res, 400, { ok: false, error: error.message });
    return send(res, 500, { ok: false, error: 'No se pudo registrar la visita. Probá de nuevo.' });
  }
};

