import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCustomerSignupName,
  normalizeCustomerWhatsapp
} from "../src/index.js";

test("normalizes customer names the same way as the account lookup", () => {
  assert.equal(normalizeCustomerSignupName("  José   Pérez  "), "jose perez");
});

test("normalizes Argentine customer WhatsApp numbers", () => {
  assert.equal(normalizeCustomerWhatsapp("261 752-9885"), "5492617529885");
  assert.equal(normalizeCustomerWhatsapp("+54 9 261 752 9885"), "5492617529885");
  assert.equal(normalizeCustomerWhatsapp("0261 15 752 9885"), "5492617529885");
});

