export const DEFAULT_LOYALTY_REWARDS = Object.freeze([
  Object.freeze({ cut: 2, discount: 10, label: "10% OFF" }),
  Object.freeze({ cut: 4, discount: 20, label: "20% OFF" }),
  Object.freeze({ cut: 6, discount: 30, label: "30% OFF" })
]);

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}
function nonNegative(value) {
  return hasNumber(value) ? Math.max(0, Number(value)) : 0;
}
function labelForDiscount(discount) {
  return discount === 100 ? "Servicio gratis" : discount + "% OFF";
}
function actualVisitCount(customer = {}) {
  const credits = nonNegative(customer.referralCreditsReceived);
  const recorded = hasNumber(customer.actualCutsRegistered)
    ? nonNegative(customer.actualCutsRegistered)
    : 0;
  const inferredFromTotal = Math.max(0, nonNegative(customer.totalCuts) - credits);
  // Recover an auxiliary counter that fell behind the cumulative visit total.
  return Math.max(recorded, inferredFromTotal);
}

/**
 * Normalizes every program to the fixed 2/4/6 milestones.
 * Canonical programs are matched by cut, not array position. Older programs
 * with different thresholds retain their sorted reward order during migration.
 */
export function normalizeLoyaltyRewards(input, fallback = DEFAULT_LOYALTY_REWARDS) {
  const source = Array.isArray(input) ? input.slice().filter(Boolean) : [];
  const backup = Array.isArray(fallback) && fallback.length ? fallback.slice().filter(Boolean) : DEFAULT_LOYALTY_REWARDS.slice();
  const byCut = list => list.slice().sort((a, b) => Number(a.cut) - Number(b.cut));
  const ordered = byCut(source);
  const fallbackOrdered = byCut(backup);
  const canonical = ordered.length === 3 && [2, 4, 6].every((cut, index) => Number(ordered[index]?.cut) === cut);
  return [2, 4, 6].map((cut, index) => {
    const item = canonical ? ordered.find(reward => Number(reward.cut) === cut) : ordered[index];
    const fallbackItem = fallbackOrdered.find(reward => Number(reward.cut) === cut) || fallbackOrdered[index] || DEFAULT_LOYALTY_REWARDS[index];
    const value = hasNumber(item?.discount) ? Number(item.discount) : Number(fallbackItem?.discount);
    const discount = Number.isInteger(value) && value >= 0 && value <= 100
      ? value
      : Number(DEFAULT_LOYALTY_REWARDS[index].discount);
    return { cut, discount, label: labelForDiscount(discount) };
  });
}

export function loyaltyCycleLength(rewards = DEFAULT_LOYALTY_REWARDS) {
  const normalized = normalizeLoyaltyRewards(rewards);
  return Math.max(1, ...normalized.map(reward => Number(reward.cut) || 1));
}

/**
 * cycleCuts is the source of truth for version-2 records. Historical
 * availableRewards must never override a valid current cursor.
 */
export function loyaltyCycleCount(customer = {}, rewards = DEFAULT_LOYALTY_REWARDS) {
  const length = loyaltyCycleLength(rewards);
  const actual = actualVisitCount(customer);
  const remainder = actual % length;
  const version = hasNumber(customer.cycleVersion) ? Number(customer.cycleVersion) : 0;
  const savedCycle = hasNumber(customer.cycleCuts) ? Math.max(0, Math.min(length, Number(customer.cycleCuts))) : null;

  // The cumulative count of real visits is the reliable cycle position.
  // Old cycle cursors/flags may disagree after earlier buggy releases.
  if (actual > 0) {
    if (remainder === 0 && (
      customer.lastRewardAppliedOnFinalMilestone === true
      || customer.cyclePausedAtMax === true
      || Number(customer.lastRewardAppliedCut || 0) >= length
      || (version >= 2 && savedCycle === 0)
      || (version >= 2 && savedCycle === length)
    )) return length;
    return remainder;
  }

  // Preserve a saved position only when there is no cumulative visit count
  // from which to safely recover it (e.g. a partial legacy import).
  if (version >= 2 && savedCycle !== null) {
    if (savedCycle === 0 && (
      customer.lastRewardAppliedOnFinalMilestone === true || customer.cyclePausedAtMax === true
    )) return length;
    return savedCycle;
  }
  if (customer.lastRewardAppliedOnFinalMilestone === true || customer.cyclePausedAtMax === true) return length;
  return 0;
}

/**
 * Pure visit transition shared by the write path and regression tests.
 * The caller performs the Firestore transaction and writes the returned fields.
 */
export function calculateLoyaltyVisit(customer = {}, standardRewards = DEFAULT_LOYALTY_REWARDS) {
  const standard = normalizeLoyaltyRewards(standardRewards);
  const override = customer.loyaltyOverride;
  const hasCustomRewards = override?.mode === "custom"
    && Array.isArray(override.rewards) && override.rewards.length > 0;
  const rewards = hasCustomRewards
    ? normalizeLoyaltyRewards(override.rewards, standard)
    : standard;
  const max = loyaltyCycleLength(rewards);

  const totalBefore = nonNegative(customer.totalCuts);
  const credits = nonNegative(customer.referralCreditsReceived);
  const inferredActual = Math.max(0, totalBefore - credits);
  const actualBefore = Math.max(
    hasNumber(customer.actualCutsRegistered) ? nonNegative(customer.actualCutsRegistered) : 0,
    inferredActual
  );
  const nextActual = actualBefore + 1;
  // Keep the public total monotonic even when the auxiliary actual-visits
  // field is behind due to records written by older versions.
  const nextTotal = Math.max(totalBefore, actualBefore + credits) + 1;

  // Always derive the next cycle visit from cumulative real visits.
  // This repairs cycleCuts values left incorrect by earlier releases.
  const cycleBefore = actualBefore % max;
  const cycleForVisit = cycleBefore + 1;
  const appliedReward = rewards.find(reward => Number(reward.cut) === cycleForVisit) || null;
  const appliedOnFinalMilestone = Boolean(appliedReward && Number(appliedReward.cut) >= max);
  const cycleNext = appliedOnFinalMilestone ? 0 : cycleForVisit;

  return {
    fields: {
      totalCuts: nextTotal,
      actualCutsRegistered: nextActual,
      cycleCuts: cycleNext,
      cycleVersion: 2,
      cyclePausedAtMax: false,
      availableRewards: [],
      rewardReady: false,
      lastRewardAppliedLabel: appliedReward ? appliedReward.label : null,
      lastRewardAppliedCut: appliedReward ? Number(appliedReward.cut) : null,
      lastRewardAppliedOnFinalMilestone: appliedReward ? appliedOnFinalMilestone : null
    },
    appliedReward,
    cycleReset: appliedOnFinalMilestone,
    cycleForVisit,
    cycleLength: max
  };
}
