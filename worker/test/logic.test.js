import test from "node:test";
import assert from "node:assert/strict";
import { renewalExpiry, planCanOperate, subscriptionStatus, safeEqual, decodeValue, encodeValue } from "../src/index.js";

test("paid renewal extends from a future expiry", () => {
  const paidAt = new Date("2026-10-01T10:00:00.000Z");
  const current = new Date("2026-10-20T10:00:00.000Z");
  assert.equal(renewalExpiry(current, paidAt, "renew").toISOString(), "2026-11-19T10:00:00.000Z");
});

test("paid period starts at approval when skip-trial is selected", () => {
  const paidAt = new Date("2026-10-01T10:00:00.000Z");
  const current = new Date("2026-10-07T10:00:00.000Z");
  assert.equal(renewalExpiry(current, paidAt, "skip-trial").toISOString(), "2026-10-31T10:00:00.000Z");
});

test("paid account gets five grace days; free trial does not", () => {
  const now = new Date("2026-10-10T00:00:00.000Z").getTime();
  assert.equal(planCanOperate({ subscriptionExpiresAt: "2026-10-08T00:00:00.000Z", hasPaidSubscription: true }, now), true);
  assert.equal(planCanOperate({ subscriptionExpiresAt: "2026-10-08T00:00:00.000Z", hasPaidSubscription: false, trialStartedAt: "2026-10-01T00:00:00.000Z" }, now), false);
  assert.equal(subscriptionStatus({ subscriptionExpiresAt: "2026-10-08T00:00:00.000Z", hasPaidSubscription: true }, now), "grace");
});

test("signature compare is constant-time shaped and exact", () => {
  assert.equal(safeEqual("abcdef", "abcdef"), true);
  assert.equal(safeEqual("abcdef", "abcdeg"), false);
  assert.equal(safeEqual("abcdef", "abc"), false);
});

test("Firestore typed values preserve the fields used by Barber VIP", () => {
  assert.equal(decodeValue({ stringValue: "ok" }), "ok");
  assert.deepEqual(decodeValue(encodeValue({ ok: true, count: 3 })), { ok: true, count: 3 });
});
