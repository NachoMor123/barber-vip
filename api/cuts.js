const { admin } = require('../lib/admin');
const { send, method, body, text } = require('../lib/http');
const { requireBarber, subscription } = require('../lib/security');

const RETENTION_DAYS = 60;
const HISTORY_LIMIT = 100;
const ARGENTINA_OFFSET = '-03:00';

async function getCount(query) {
  const result = await query.count().get();
  return result.data().count || 0;
}
function validDateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const d = new Date(`${value}T00:00:00${ARGENTINA_OFFSET}`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function startOfDay(value) { return new Date(`${value}T00:00:00${ARGENTINA_OFFSET}`); }
function nextDay(date) { return new Date(date.getTime() + 86400000); }
function argentinaDateParts(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Mendoza', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
}
function argentinaDateString(now = new Date()) {
  const parts = argentinaDateParts(now);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}
function argentinaMonthStart(now = new Date()) {
  const parts = argentinaDateParts(now);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  return new Date(`${year}-${month}-01T00:00:00${ARGENTINA_OFFSET}`);
}
function nextMonthStart(d) {
  const date = new Date(d.getTime());
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 1, 3, 0, 0));
}
function iso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function defaultProgram(barber) {
  const programs=Array.isArray(barber.loyaltyPrograms)?barber.loyaltyPrograms:[];
  const selected=programs.find(p=>p.id===barber.defaultLoyaltyProgramId)||programs.find(p=>p.audience==='all')||programs[0];
  return selected||{id:'program-246',name:'Ciclo clásico',rewards:[{cut:2,discount:10,label:'10% OFF'},{cut:4,discount:20,label:'20% OFF'},{cut:6,discount:30,label:'30% OFF'}]};
}
function programForCustomer(customer,barber){const programs=Array.isArray(barber.loyaltyPrograms)?barber.loyaltyPrograms:[];return programs.find(p=>p.id===customer.loyaltyProgramId)||defaultProgram(barber);}
function normalizeRewards(program){
  const raw=Array.isArray(program.rewards)?program.rewards:[];
  const legacyDefault=raw.length===3&&Number(raw[0]?.cut)===2&&Number(raw[0]?.discount)===30&&Number(raw[1]?.cut)===4&&Number(raw[1]?.discount)===50&&Number(raw[2]?.cut)===6&&Number(raw[2]?.discount)===70;
  const source=legacyDefault?[{cut:2,discount:10},{cut:4,discount:20},{cut:6,discount:30}]:raw;
  const normalized=source.map(r=>({cut:Number(r.cut),discount:Math.min(100,Math.max(1,Number(r.discount)||1)),label:`${Math.min(100,Math.max(1,Number(r.discount)||1))}% OFF`})).filter(r=>Number.isInteger(r.cut)&&r.cut>=1&&r.cut<=50).sort((a,b)=>a.cut-b.cut);
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
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;
    const barberRef = ctx.db.collection('barbers').doc(ctx.uid);
    const cutCollection = barberRef.collection('cuts');
    if (req.method === 'GET') {
      const from = text(req.query && req.query.from, 10);
      const to = text(req.query && req.query.to, 10);
      if ((from && !validDateInput(from)) || (to && !validDateInput(to))) {
        return send(res, 400, { ok: false, error: 'Una de las fechas seleccionadas no es válida.' });
      }
      if (from && to && from > to) return send(res, 400, { ok: false, error: 'La fecha «Desde» no puede ser posterior a «Hasta».' });

      const fallbackTo = argentinaDateString();
      const fallbackFromDate = new Date(`${fallbackTo}T00:00:00${ARGENTINA_OFFSET}`);
      fallbackFromDate.setTime(fallbackFromDate.getTime() - (RETENTION_DAYS - 1) * 86400000);
      const rangeFrom = startOfDay(from || fallbackFromDate.toISOString().slice(0,10));
      const rangeTo = nextDay(startOfDay(to || fallbackTo));
      const rangeTsFrom = admin().firestore.Timestamp.fromDate(rangeFrom);
      const rangeTsTo = admin().firestore.Timestamp.fromDate(rangeTo);
      const rangeQuery = cutCollection.where('createdAt', '>=', rangeTsFrom).where('createdAt', '<', rangeTsTo);
      const countRange = await getCount(rangeQuery);

      const monthStart = argentinaMonthStart();
      const monthEnd = nextMonthStart(monthStart);
      const countMonth = await getCount(cutCollection
        .where('createdAt', '>=', admin().firestore.Timestamp.fromDate(monthStart))
        .where('createdAt', '<', admin().firestore.Timestamp.fromDate(monthEnd)));
      const countTotal = await getCount(cutCollection);
      let history = [];
      if (String(req.query && req.query.history || '1') !== '0') {
        const snap = await rangeQuery.orderBy('createdAt', 'desc').limit(HISTORY_LIMIT).get();
        history = snap.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            type: data.type || 'cut',
            customerId: data.customerId || null,
            customerName: text(data.customerName || data.label || '', 70),
            cycleCut: Number.isFinite(Number(data.cycleCut)) ? Number(data.cycleCut) : null,
            cycleLength: Number(data.cycleLength||6), rewardLabel: text(data.rewardLabel||'',50), unlockedRewardLabel: text(data.unlockedRewardLabel||'',50), rewardAction: text(data.rewardAction||'',20), programName: text(data.programName||'',60),
            createdAt: iso(data.createdAt)
          };
        });
      }
      return send(res, 200, { ok: true, countRange, countMonth, countTotal, from: from || rangeFrom.toISOString().slice(0,10), to: to || fallbackTo, history, historyLimit: HISTORY_LIMIT });
    }

    const data = body(req);
    const action = text(data.action, 30);

    // A barbero can manually clear only the retained 60-day window. This never deletes customers,
    // rewards or customer profiles. Large ranges are processed in bounded batches for Hobby deployments.
    if (req.method === 'DELETE' || action === 'delete-history') {
      const from = text(data.from, 10), to = text(data.to, 10);
      if (!validDateInput(from) || !validDateInput(to)) return send(res, 400, { ok: false, error: 'Elegí fechas válidas para borrar el historial.' });
      if (from > to) return send(res, 400, { ok: false, error: 'La fecha «Desde» no puede ser posterior a «Hasta».' });
      const today = argentinaDateString();
      const oldest = argentinaDateString(new Date(Date.now() - (RETENTION_DAYS - 1) * 86400000));
      if (from < oldest || to > today) return send(res, 400, { ok: false, error: `Solo podés borrar registros del período conservado: desde ${oldest} hasta ${today}. El historial más antiguo se elimina automáticamente.` });
      const rangeQuery = cutCollection
        .where('createdAt', '>=', admin().firestore.Timestamp.fromDate(startOfDay(from)))
        .where('createdAt', '<', admin().firestore.Timestamp.fromDate(nextDay(startOfDay(to))))
        .orderBy('createdAt', 'asc');
      let deleted = 0;
      const maxDeletePerRequest = 2000;
      while (deleted < maxDeletePerRequest) {
        const snap = await rangeQuery.limit(Math.min(400, maxDeletePerRequest - deleted)).get();
        if (snap.empty) break;
        const batch = ctx.db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < 400) break;
      }
      const remaining = await rangeQuery.limit(1).get();
      return send(res, 200, { ok: true, deleted, hasMore: !remaining.empty, from, to, message: !remaining.empty ? 'Se borró un lote del historial. Quedan más registros en ese rango; podés continuar.' : 'Historial eliminado para el rango seleccionado.' });
    }

    const currentBarber = (await barberRef.get()).data() || {};
    const subscriptionState = subscription(currentBarber);
    if (action === 'walk-in') {
      if (subscriptionState.status === 'suspended') return send(res, 402, { ok: false, error: 'La cuenta está vencida. Para sumar cortes, primero renová Barber VIP desde Configuración.' });
      const customerName = text(data.customerName, 70) || 'Cliente de paso';
      const cutRef = cutCollection.doc();
      const now = admin().firestore.FieldValue.serverTimestamp();
      await cutRef.set({ id: cutRef.id, type: 'walk-in', customerId: null, customerName, cycleCut: null, createdAt: now });
      return send(res, 200, { ok: true, id: cutRef.id, customerName, message: 'Corte rápido registrado.' });
    }

    const customerId = text(data.customerId, 100);
    if (!customerId) return send(res, 400, { ok: false, error: 'Elegí un cliente.' });
    const customerRef = barberRef.collection('customers').doc(customerId);

    if (action === 'add') {
      if (subscriptionState.status === 'suspended') return send(res, 402, { ok: false, error: 'La cuenta está vencida. Para sumar cortes, primero renová Barber VIP desde Configuración.' });
      let resultCustomer = null;
      const cutRef = cutCollection.doc();
      let outcome = { appliedReward: null, cycleCut: 0, cyclePausedAtMax: false, cycleReset: false };
      await ctx.db.runTransaction(async transaction => {
        const [customerSnap, barberSnap] = await Promise.all([transaction.get(customerRef), transaction.get(barberRef)]);
        if (!customerSnap.exists || customerSnap.data().active === false) throw new Error('El cliente no existe o fue dado de baja.');
        const customer = customerSnap.data();
        const freshBarber = barberSnap.exists ? barberSnap.data() : currentBarber;
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
        const updates = {
          totalCuts, actualCutsRegistered, cycleCuts: cycleNext, cycleVersion: 2, cyclePausedAtMax,
          availableRewards, rewardReady,
          lastCutAt: now,
          lastRewardAppliedLabel: appliedReward ? text(appliedReward.label || `${Number(appliedReward.discount)||0}% OFF`, 50) : null,
          lastRewardAppliedAt: appliedReward ? now : null,
          lastRewardAppliedCut: appliedReward ? Number(appliedReward.cut || 0) : null,
          lastRewardAppliedOnFinalMilestone: appliedReward ? appliedOnFinalMilestone : null,
          reminderCount: 0, reminderStatus: null, reminderFollowUpUntil: null, reminderLastContactAt: null,
          remindersPaused: false, remindersPausedAt: null, updatedAt: now
        };
        transaction.update(customerRef, updates);
        transaction.set(cutRef, {
          id: cutRef.id,
          customerId,
          customerName: text(customer.fullName || '', 100),
          createdAt: now,
          type: 'cut',
          cycleCut: cycleForVisit,
          cycleLength: cycleMax,
          rewardLabel: appliedReward ? text(appliedReward.label || `${appliedReward.discount}% OFF`, 50) : '',
          rewardAction: appliedReward ? 'applied' : '',
          unlockedRewardLabel: '',
          cyclePausedAtMax,
          actualCutNumber: actualCutsRegistered,
          programId: program.id,
          programName: program.name || ''
        });
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
          lastCutAt: new Date().toISOString()
        };
        outcome = { appliedReward, cycleCut: cycleForVisit, cyclePausedAtMax, cycleReset: appliedOnFinalMilestone };
      });
      let message = 'Corte registrado correctamente.';
      if (outcome.appliedReward) { const label = outcome.appliedReward.label || String(outcome.appliedReward.discount) + '% OFF'; message = 'Corte registrado. ' + label + ' se aplicó en este corte.'; }
      if (outcome.cycleReset) message += ' El siguiente ciclo comienza desde cero.';
      return send(res, 200, { ok: true, customer: resultCustomer, appliedReward: outcome.appliedReward, message });
    }

    return send(res, 400, { ok: false, error: 'Acción de corte desconocida.' });
  } catch (error) {
    console.error('cuts error', error);
    if (error.message && /cliente|descuento|premio|fecha|corte|cuenta|programa|fidelización/.test(error.message)) return send(res, 400, { ok: false, error: error.message });
    return send(res, 500, { ok: false, error: 'No se pudo registrar el corte. Probá de nuevo.' });
  }
};

