import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCustomerSignupName,
  normalizeCustomerWhatsapp,
  planCanOperate,
  subscriptionStatus
} from "../src/index.js";

test("normalizes customer names consistently with account lookup", () => {
  assert.equal(normalizeCustomerSignupName("  José   Pérez  "), "jose perez");
  assert.equal(normalizeCustomerSignupName("MARTÍN    GÓMEZ"), "martin gomez");
});

test("normalizes Argentine WhatsApp numbers", () => {
  assert.equal(normalizeCustomerWhatsapp("261 752-9885"), "5492617529885");
  assert.equal(normalizeCustomerWhatsapp("+54 9 261 752 9885"), "5492617529885");
  assert.equal(normalizeCustomerWhatsapp("0261 15 752 9885"), "5492617529885");
});

test("free trial expires without a grace period, while a paid plan retains its grace", () => {
  const expiry = "2026-11-01T00:00:00.000Z";
  const trial = {
    subscriptionExpiresAt: expiry,
    trialStartedAt: "2026-10-25T00:00:00.000Z",
    hasPaidSubscription: false
  };
  const paid = { ...trial, hasPaidSubscription: true };
  const afterExpiry = Date.parse("2026-11-03T00:00:00.000Z");
  assert.equal(planCanOperate(trial, afterExpiry), false);
  assert.equal(subscriptionStatus(trial, afterExpiry), "suspended");
  assert.equal(planCanOperate(paid, afterExpiry), true);
  assert.equal(subscriptionStatus(paid, afterExpiry), "grace");
});
