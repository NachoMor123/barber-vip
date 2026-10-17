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
async function purgeOldCuts(cutCollection, cutoff, max = 350) {
  const old = await cutCollection.where('createdAt', '<', admin().firestore.Timestamp.fromDate(cutoff)).orderBy('createdAt', 'asc').limit(max).get();
  if (old.empty) return 0;
  const batch = admin().firestore().batch();
  old.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  return old.size;
}
function iso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function defaultProgram(barber) {
  const programs=Array.isArray(barber.loyaltyPrograms)?barber.loyaltyPrograms:[];
  return programs.find(p=>p.id===barber.defaultLoyaltyProgramId)||programs.find(p=>p.audience==='all')||programs[0]||{id:'program-246',name:'Ciclo clásico',rewards:[{cut:2,discount:30,label:'30% OFF'},{cut:4,discount:50,label:'50% OFF'},{cut:6,discount:70,label:'70% OFF'}]};
}
function programForCustomer(customer,barber){const programs=Array.isArray(barber.loyaltyPrograms)?barber.loyaltyPrograms:[];return programs.find(p=>p.id===customer.loyaltyProgramId)||defaultProgram(barber);}
function normalizeRewards(program){return [...(Array.isArray(program.rewards)?program.rewards:[])].map(r=>({cut:Number(r.cut),discount:Number(r.discount),label:text(r.label,50)||`${Number(r.discount)}% OFF`})).filter(r=>Number.isInteger(r.cut)&&r.cut>0&&Number.isInteger(r.discount)&&r.discount>0).sort((a,b)=>a.cut-b.cut);}
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;
  try {
    const ctx = await requireBarber(req, res);
    if (!ctx) return;
    const barberRef = ctx.db.collection('barbers').doc(ctx.uid);
    const cutCollection = barberRef.collection('cuts');
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
    // Opportunistic cleanup keeps this barber's history tidy even if the daily cron misses a run.
    try { await purgeOldCuts(cutCollection, cutoff); } catch (cleanupError) { console.warn('cut retention cleanup:', cleanupError.message); }

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
            cycleLength: Number(data.cycleLength||6), rewardLabel: text(data.rewardLabel||'',50), programName: text(data.programName||'',60),
            createdAt: iso(data.createdAt)
          };
        });
      }
      return send(res, 200, { ok: true, countRange, countMonth, countTotal, from: from || rangeFrom.toISOString().slice(0,10), to: to || fallbackTo, history, historyLimit: HISTORY_LIMIT });
    }

    const data = body(req);
    const action = text(data.action, 30);

    // A barbero can manually clear only the retained 60-day window. This never deletes customers,
    // rewards or referral records. Large ranges are processed in bounded batches for Hobby deployments.
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
      await ctx.db.runTransaction(async transaction => {
        const [customerSnap, barberSnap] = await Promise.all([transaction.get(customerRef), transaction.get(barberRef)]);
        if (!customerSnap.exists || customerSnap.data().active === false) throw new Error('El cliente no existe o fue dado de baja.');
        const customer = customerSnap.data();
        const freshBarber = barberSnap.exists ? barberSnap.data() : currentBarber;
        const hasReferral = Boolean(customer.referredByCustomerId) && customer.referredByCustomerId !== customerId;
        const totalCuts = Number(customer.totalCuts || 0) + 1;
        // Qualifying referral milestones count real registered visits, not credits the customer
        // may have earned by inviting other people. Legacy profiles infer a base from known credits.
        const knownCreditsReceived = Math.max(0, Number(customer.referralCreditsReceived || 0));
        const actualCutsBefore = Number.isFinite(Number(customer.actualCutsRegistered))
          ? Math.max(0, Number(customer.actualCutsRegistered))
          : Math.max(0, Number(customer.totalCuts || 0) - knownCreditsReceived);
        const actualCutsRegistered = actualCutsBefore + 1;
        const referralMilestones = [...new Set((Array.isArray(freshBarber.referralRewardMilestones) ? freshBarber.referralRewardMilestones : [1, 4, 6])
          .map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 100))].sort((a, b) => a - b);
        const previouslyGranted = [...new Set((Array.isArray(customer.referralMilestonesGranted) ? customer.referralMilestonesGranted : []).map(Number).filter(Number.isInteger))];
        // Compatibility with the old one-time first-cut program: never award milestone 1 twice.
        if ((customer.referralFirstCutAt || customer.referralBonusGrantedAt) && actualCutsBefore >= 1 && !previouslyGranted.includes(1)) previouslyGranted.push(1);
        // Referral milestones repeat continuously: with [1,4,6], qualifying cuts are 1,4,6,7,10,12…
        // Store absolute visit numbers so each individual milestone remains idempotent across retries.
        const referralCycleLength = referralMilestones.length ? Math.max(...referralMilestones) : 6;
        const referralCyclePosition = ((Math.max(1, actualCutsRegistered) - 1) % referralCycleLength) + 1;
        const milestonesHit = hasReferral && referralMilestones.includes(referralCyclePosition) && !previouslyGranted.includes(actualCutsRegistered) ? [actualCutsRegistered] : [];
        let referrerRef = null;
        let referrerSnap = null;
        if (milestonesHit.length) {
          referrerRef = barberRef.collection('customers').doc(String(customer.referredByCustomerId));
          referrerSnap = await transaction.get(referrerRef);
        }

        const program = programForCustomer(customer, freshBarber);
        const rewards = normalizeRewards(program);
        if (!rewards.length) throw new Error('Este cliente no tiene un programa de premios válido. Revisá Configuración.');
        const cycleMax = Math.max(...rewards.map(r => r.cut));
        const legacyCount = Math.max(0, Number(customer.totalCuts || 0)) % cycleMax;
        const cycleBefore = customer.cycleVersion === 2 ? Math.min(cycleMax - 1, Math.max(0, Number(customer.cycleCuts || 0))) : legacyCount;
        const cycleNext = cycleBefore + 1;
        const earned = rewards.find(r => r.cut === cycleNext);
        const availableRewards = Array.isArray(customer.availableRewards) ? [...customer.availableRewards] : [];
        if (earned) availableRewards.push({ ...earned, programId: program.id, programName: program.name || 'Programa de premios', earnedAt: new Date().toISOString(), rewardId: `${cutRefId(customerId)}-${cutRef.id}` });
        const cycleCuts = cycleNext >= cycleMax ? 0 : cycleNext;
        const rewardReady = availableRewards.length > 0;
        const now = admin().firestore.FieldValue.serverTimestamp();
        const customerUpdates = {
          totalCuts, actualCutsRegistered, cycleCuts, cycleVersion: 2, availableRewards, rewardReady, lastCutAt: now,
          reminderCount: 0, reminderStatus: null, reminderFollowUpUntil: null, reminderLastContactAt: null,
          remindersPaused: false, remindersPausedAt: null, updatedAt: now
        };
        if (hasReferral) {
          const nextGranted = [...new Set([...previouslyGranted, ...milestonesHit])].sort((a, b) => a - b);
          customerUpdates.referralMilestonesGranted = nextGranted;
          if (!customer.referralFirstCutAt) customerUpdates.referralFirstCutAt = now;
          if (milestonesHit.length) {
            customerUpdates.referralLastMilestoneAt = now;
            customerUpdates.referralLastMilestone = actualCutsRegistered;
          }
        }

        let referralCreditsGrantedNow = 0;
        let referralBonus = null;
        if (milestonesHit.length) {
          if (referrerSnap && referrerSnap.exists && referrerSnap.data().active !== false) {
            const referrer = referrerSnap.data();
            const refProgram = programForCustomer(referrer, freshBarber);
            const refRewards = normalizeRewards(refProgram);
            if (refRewards.length) {
              let refTotalCuts = Math.max(0, Number(referrer.totalCuts || 0));
              let refCycle = referrer.cycleVersion === 2 ? Math.min(Math.max(...refRewards.map(r => r.cut)) - 1, Math.max(0, Number(referrer.cycleCuts || 0))) : refTotalCuts % Math.max(...refRewards.map(r => r.cut));
              let refAvailableRewards = Array.isArray(referrer.availableRewards) ? [...referrer.availableRewards] : [];
              let lastReward = null;
              for (const milestone of milestonesHit) {
                refTotalCuts += 1;
                const refCycleMax = Math.max(...refRewards.map(r => r.cut));
                const refCycleNext = refCycle + 1;
                const refEarned = refRewards.find(r => r.cut === refCycleNext);
                if (refEarned) {
                  lastReward = refEarned;
                  refAvailableRewards.push({ ...refEarned, programId: refProgram.id, programName: refProgram.name || 'Programa de premios', earnedAt: new Date().toISOString(), rewardId: `referral-${cutRef.id}-${milestone}` });
                }
                refCycle = refCycleNext >= refCycleMax ? 0 : refCycleNext;
              }
              transaction.update(referrerRef, {
                totalCuts: refTotalCuts,
                cycleCuts: refCycle,
                cycleVersion: 2,
                availableRewards: refAvailableRewards,
                rewardReady: refAvailableRewards.length > 0,
                referralCreditsReceived: Math.max(0, Number(referrer.referralCreditsReceived || 0)) + milestonesHit.length,
                updatedAt: now
              });
              referralCreditsGrantedNow = milestonesHit.length;
              customerUpdates.referralCreditsAwarded = Math.max(0, Number(customer.referralCreditsAwarded || 0)) + milestonesHit.length;
              const oldCreditedMilestones = Array.isArray(customer.referralCreditedMilestones) ? customer.referralCreditedMilestones.map(Number).filter(Number.isInteger) : [];
              customerUpdates.referralCreditedMilestones = [...new Set([...oldCreditedMilestones, ...milestonesHit])].sort((a, b) => a - b);
              if (milestonesHit.includes(1)) customerUpdates.referralBonusGrantedAt = now; // legacy field retained for old UI/data
              customerUpdates.referralBonusStatus = 'credited';
              referralBonus = { granted: true, count: milestonesHit.length, milestone: actualCutsRegistered, rewardEarned: lastReward ? lastReward.label || `${lastReward.discount}% OFF` : null };
            } else {
              customerUpdates.referralBonusStatus = 'invalid-program';
            }
          } else {
            customerUpdates.referralBonusStatus = referrerSnap && referrerSnap.exists ? 'referrer-inactive' : 'referrer-unavailable';
          }
        }

        transaction.update(customerRef, customerUpdates);
        transaction.set(cutRef, {
          id: cutRef.id, customerId, customerName: text(customer.fullName || '', 100), createdAt: now,
          type: 'cut', cycleCut: cycleNext, cycleLength: cycleMax, rewardLabel: earned?.label || '',
          actualCutNumber: actualCutsRegistered,
          programId: program.id, programName: program.name || '',
          referralMilestonesHit: milestonesHit, referralCreditsGranted: referralCreditsGrantedNow
        });
        resultCustomer = {
          ...customer, ...customerUpdates, totalCuts, actualCutsRegistered, cycleCuts, cycleVersion: 2,
          loyaltyProgramId: customer.loyaltyProgramId || program.id, availableRewards, rewardReady,
          lastCutAt: new Date().toISOString(), referralBonus: referralBonus ? { granted: true, count: referralBonus.count, milestone: referralBonus.milestone } : null
        };
      });
      const message = resultCustomer?.referralBonus?.granted
        ? `Corte registrado. Se acreditó ${resultCustomer.referralBonus.count} crédito${resultCustomer.referralBonus.count === 1 ? '' : 's'} a quien te invitó por alcanzar el hito de ${resultCustomer.referralBonus.milestone} corte${resultCustomer.referralBonus.milestone === 1 ? '' : 's'}.`
        : 'Corte registrado correctamente.';
      return send(res, 200, { ok: true, customer: resultCustomer, message });
    }

    if (action === 'redeem') {
      let resultCustomer = null;
      await ctx.db.runTransaction(async transaction => {
        const customerSnap = await transaction.get(customerRef);
        if (!customerSnap.exists || customerSnap.data().active === false) throw new Error('El cliente no existe o fue dado de baja.');
        const customer = customerSnap.data();
        const availableRewards = Array.isArray(customer.availableRewards) ? [...customer.availableRewards] : [];
        if (!availableRewards.length && customer.rewardReady) availableRewards.push({ cut: 2, discount: 30, label: '30% OFF' });
        if (!availableRewards.length) throw new Error('Este cliente todavía no tiene un descuento listo para canjear.');
        const now = admin().firestore.FieldValue.serverTimestamp();
        const redeemed = availableRewards.shift();
        transaction.update(customerRef, { availableRewards, rewardReady: availableRewards.length > 0, updatedAt: now });
        const redemptionRef = barberRef.collection('redemptions').doc();
        transaction.set(redemptionRef, { customerId, reward: redeemed.label || `${redeemed.discount}% OFF`, discount: redeemed.discount || null, cycleCut: redeemed.cut || null, createdAt: now });
        resultCustomer = { ...customer, availableRewards, rewardReady: availableRewards.length > 0 };
      });
      return send(res, 200, { ok: true, customer: resultCustomer });
    }
    return send(res, 400, { ok: false, error: 'Acción de corte desconocida.' });
  } catch (error) {
    console.error('cuts error', error);
    if (error.message && /cliente|descuento|premio|fecha|corte|cuenta|programa|fidelización/.test(error.message)) return send(res, 400, { ok: false, error: error.message });
    return send(res, 500, { ok: false, error: 'No se pudo registrar el corte. Probá de nuevo.' });
  }
};

function cutRefId(customerId) {
  return String(customerId || 'client').slice(0, 12);
}
