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
  if (customer.lastRewardAppliedOnFinalMilestone === true || customer.cyclePausedAtMax === true) return length;

  const version = hasNumber(customer.cycleVersion) ? Number(customer.cycleVersion) : 0;
  const savedCycle = hasNumber(customer.cycleCuts) ? Math.max(0, Number(customer.cycleCuts)) : null;
  if (version >= 2) {
    if (savedCycle !== null) return Math.min(length, savedCycle);
    const credits = nonNegative(customer.referralCreditsReceived);
    const actual = hasNumber(customer.actualCutsRegistered)
      ? nonNegative(customer.actualCutsRegistered)
      : Math.max(0, nonNegative(customer.totalCuts) - credits);
    return actual % length;
  }

  // Legacy records derive progress from real visits. A stale historical
  // availableRewards array is display metadata, not a cycle counter.
  const credits = nonNegative(customer.referralCreditsReceived);
  const actual = hasNumber(customer.actualCutsRegistered)
    ? nonNegative(customer.actualCutsRegistered)
    : Math.max(0, nonNegative(customer.totalCuts) - credits);
  return actual % length;
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

  const version = hasNumber(customer.cycleVersion) ? Number(customer.cycleVersion) : 0;
  const hasSavedCycle = hasNumber(customer.cycleCuts);
  const cycleBefore = version >= 2 && hasSavedCycle
    ? Math.max(0, Math.min(max, Number(customer.cycleCuts)))
    : actualBefore % max;
  const shouldRestart = customer.cyclePausedAtMax === true || cycleBefore >= max;
  const cycleForVisit = shouldRestart ? 1 : Math.min(max, cycleBefore + 1);
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
