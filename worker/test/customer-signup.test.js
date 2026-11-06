import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCustomerSignupName,
  normalizeCustomerWhatsapp,
  cleanPushPayload
} from "../src/index.js";

test("normalizes customer names the same way as the account lookup", () => {
  assert.equal(normalizeCustomerSignupName("  José   Pérez  "), "jose perez");
});

test("normalizes Argentine customer WhatsApp numbers", () => {
  assert.equal(normalizeCustomerWhatsapp("261 752-9885"), "5492617529885");
  assert.equal(normalizeCustomerWhatsapp("+54 9 261 752 9885"), "5492617529885");
  assert.equal(normalizeCustomerWhatsapp("0261 15 752 9885"), "5492617529885");
});

test("push notification payload does not contain a custom app URL", () => {
  const payload = cleanPushPayload({
    title: "Visita registrada",
    body: "Tu tarjeta tiene una visita nueva.",
    tag: "visit-customer-1",
    url: "https://barbervip-309dc.web.app/?secret=private"
  });
  assert.equal(payload.title, "Visita registrada");
  assert.equal(payload.body, "Tu tarjeta tiene una visita nueva.");
  assert.equal("url" in payload, false);
});
