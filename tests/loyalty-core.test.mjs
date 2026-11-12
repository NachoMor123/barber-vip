import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOYALTY_REWARDS,
  normalizeLoyaltyRewards,
  loyaltyCycleCount,
  calculateLoyaltyVisit
} from "../loyalty-core.mjs";

test("standard reward percentages stay attached to fixed milestones even when stored out of order", () => {
  const rewards = normalizeLoyaltyRewards([
    { cut: 6, discount: 37 }, { cut: 2, discount: 11 }, { cut: 4, discount: 23 }
  ]);
  assert.deepEqual(rewards.map(item => [item.cut, item.discount]), [[2, 11], [4, 23], [6, 37]]);
});

test("custom percentages override the standard program, while an empty custom record safely inherits it", () => {
  const standard = [{ cut: 2, discount: 12 }, { cut: 4, discount: 24 }, { cut: 6, discount: 36 }];
  const customCustomer = { loyaltyOverride: { mode: "custom", rewards: [
    { cut: 2, discount: 5 }, { cut: 4, discount: 15 }, { cut: 6, discount: 25 }
  ] } };
  assert.deepEqual(calculateLoyaltyVisit(customCustomer, standard).appliedReward, null);
  let customer = { ...customCustomer, totalCuts: 1, actualCutsRegistered: 1, cycleCuts: 1, cycleVersion: 2 };
  const second = calculateLoyaltyVisit(customer, standard);
  assert.equal(second.appliedReward.discount, 5);

  const emptyCustom = { loyaltyOverride: { mode: "custom", rewards: [] }, totalCuts: 1, actualCutsRegistered: 1, cycleCuts: 1, cycleVersion: 2 };
  assert.equal(calculateLoyaltyVisit(emptyCustom, standard).appliedReward.discount, 12);
});

test("cycle advances 1 to 6, completes at 6, then starts at 1 without rolling back totals", () => {
  let customer = {
    totalCuts: 0, actualCutsRegistered: 0, cycleCuts: 0, cycleVersion: 2,
    cyclePausedAtMax: false, availableRewards: [], rewardReady: false
  };
  const seen = [];
  for (let visit = 1; visit <= 7; visit++) {
    const transition = calculateLoyaltyVisit(customer, DEFAULT_LOYALTY_REWARDS);
    customer = { ...customer, ...transition.fields };
    seen.push({
      visit,
      total: customer.totalCuts,
      cycle: loyaltyCycleCount(customer),
      reward: transition.appliedReward?.discount ?? null,
      completed: transition.cycleReset
    });
  }
  assert.deepEqual(seen.map(row => row.cycle), [1, 2, 3, 4, 5, 6, 1]);
  assert.deepEqual(seen.map(row => row.reward), [null, 10, null, 20, null, 30, null]);
  assert.deepEqual(seen.map(row => row.total), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(seen[5].completed, true);
});

test("stale historical availableRewards cannot pin a version-2 customer at the final milestone", () => {
  const customer = {
    cycleVersion: 2, cycleCuts: 3, cyclePausedAtMax: false,
    lastRewardAppliedOnFinalMilestone: false,
    availableRewards: [{ cut: 6, discount: 30 }], rewardReady: false,
    totalCuts: 9, actualCutsRegistered: 9
  };
  assert.equal(loyaltyCycleCount(customer), 3);
  const next = calculateLoyaltyVisit(customer);
  assert.equal(next.cycleForVisit, 4);
  assert.equal(next.fields.cycleCuts, 4);
});

test("a stale final-reward marker cannot override a newer version-2 cycle cursor", () => {
  assert.equal(loyaltyCycleCount({
    cycleVersion: 2, cycleCuts: 3, lastRewardAppliedOnFinalMilestone: true,
    cyclePausedAtMax: true, totalCuts: 9, actualCutsRegistered: 9
  }), 3);
  assert.equal(loyaltyCycleCount({
    cycleVersion: 2, cycleCuts: 0, lastRewardAppliedOnFinalMilestone: true,
    cyclePausedAtMax: false
  }), 6);
});

test("referral credits do not overwrite a valid version-2 cycle cursor", () => {
  const customer = {
    cycleVersion: 2, cycleCuts: 3, totalCuts: 17, actualCutsRegistered: 15,
    referralCreditsReceived: 2, cyclePausedAtMax: false
  };
  assert.equal(loyaltyCycleCount(customer), 3);
  const next = calculateLoyaltyVisit(customer);
  assert.equal(next.cycleForVisit, 4);
});

test("lagging auxiliary visit counter cannot reduce total visits or cycle progress", () => {
  const customer = {
    cycleVersion: 2, cycleCuts: 3, totalCuts: 10, actualCutsRegistered: 3,
    referralCreditsReceived: 0, cyclePausedAtMax: false
  };
  const next = calculateLoyaltyVisit(customer);
  assert.equal(next.fields.totalCuts, 11);
  assert.equal(next.fields.actualCutsRegistered, 11);
  assert.equal(next.fields.cycleCuts, 4);
});

test("legacy progress ignores stale availableRewards and uses actual visits", () => {
  const customer = {
    totalCuts: 9, actualCutsRegistered: 3, cycleVersion: 1,
    availableRewards: [{ cut: 6, discount: 30 }], rewardReady: false
  };
  assert.equal(loyaltyCycleCount(customer), 3);
  const next = calculateLoyaltyVisit(customer);
  assert.equal(next.cycleForVisit, 4);
});
