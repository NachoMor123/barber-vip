import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCustomerSignupName,
  normalizeCustomerWhatsapp,
  customerDirectoryUpsertFields
} from "../src/index.js";

test("normalizes customer names the same way as the account lookup", () => {
  assert.equal(normalizeCustomerSignupName("  José   Pérez  "), "jose perez");
});

test("normalizes Argentine customer WhatsApp numbers", () => {
  assert.equal(normalizeCustomerWhatsapp("261 752-9885"), "5492617529885");
  assert.equal(normalizeCustomerWhatsapp("+54 9 261 752 9885"), "5492617529885");
  assert.equal(normalizeCustomerWhatsapp("0261 15 752 9885"), "5492617529885");
});


test("direct customer registration writes the Auth UID into directory metadata", () => {
  const customerUid = "firebase-auth-customer-uid";
  const metadata = customerDirectoryUpsertFields(7, customerUid, new Date("2026-11-09T12:00:00.000Z"));
  assert.equal(metadata.version, 7);
  assert.equal(metadata.changeType, "upsert");
  assert.equal(metadata.customerId, customerUid);
  assert.ok(metadata.updatedAt instanceof Date);
  assert.throws(() => customerDirectoryUpsertFields(8, "", new Date()), /Falta identificar al cliente nuevo/);
});
