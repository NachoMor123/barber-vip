import test from "node:test";
import assert from "node:assert/strict";
import worker from "./src/index.js";

const APP_ORIGIN = "https://barbervip-309dc.web.app";
const ENV = {
  APP_ORIGIN,
  COMMERCIAL_ORIGIN: "https://barber-vip-comercial-309dc.web.app",
  FIREBASE_WEB_API_KEY: "test-web-key",
  TELEGRAM_BOT_TOKEN: "test-bot-token",
  TELEGRAM_CHAT_ID: "6415411876"
};

function makeRequest() {
  return new Request("https://barber-vip.barbervip.workers.dev/api/new-barber-notification", {
    method: "POST",
    headers: {
      origin: APP_ORIGIN,
      authorization: "Bearer test-firebase-id-token",
      "content-type": "application/json"
    },
    body: "{}"
  });
}

function mockExternalServices({ email, uid = "test-barber-" + crypto.randomUUID(), displayName = "Juan Pérez" }) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup")) {
      return new Response(JSON.stringify({
        users: [{
          localId: uid,
          email,
          displayName,
          createdAt: String(Date.now() - 20_000),
          disabled: false
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://api.telegram.org/bot")) {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    throw new Error("Unexpected external request: " + url);
  };
  return {
    calls,
    restore() { globalThis.fetch = originalFetch; }
  };
}

test("new barber signup sends a private Telegram alert without Firestore requests", async () => {
  const mock = mockExternalServices({ email: "juan@example.com" });
  try {
    const response = await worker.fetch(makeRequest(), ENV);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.sent, true);
    assert.equal(mock.calls.length, 2);
    assert.ok(mock.calls.some(call => call.url.startsWith("https://identitytoolkit.googleapis.com/")));
    const telegramCall = mock.calls.find(call => call.url.startsWith("https://api.telegram.org/"));
    assert.ok(telegramCall);
    const payload = JSON.parse(telegramCall.init.body);
    assert.equal(payload.chat_id, ENV.TELEGRAM_CHAT_ID);
    assert.match(payload.text, /Juan Pérez/);
    assert.match(payload.text, /juan@example\.com/);
    assert.match(payload.text, /Prueba gratuita/);
    assert.equal(mock.calls.some(call => call.url.includes("firestore.googleapis.com")), false);
  } finally {
    mock.restore();
  }
});

test("internal customer accounts do not trigger Telegram alerts", async () => {
  const mock = mockExternalServices({ email: "cliente-demo@accounts.barbervip.app" });
  try {
    const response = await worker.fetch(makeRequest(), ENV);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.sent, false);
    assert.equal(body.ignored, true);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls.some(call => call.url.startsWith("https://api.telegram.org/")), false);
  } finally {
    mock.restore();
  }
});

test("repeated notification requests for the same new account are deduplicated", async () => {
  const mock = mockExternalServices({ email: "repeated@example.com", uid: "test-deduplicated-" + crypto.randomUUID() });
  try {
    const first = await worker.fetch(makeRequest(), ENV);
    const second = await worker.fetch(makeRequest(), ENV);
    const firstBody = await first.json();
    const secondBody = await second.json();
    assert.equal(firstBody.sent, true);
    assert.equal(secondBody.duplicate, true);
    assert.equal(mock.calls.filter(call => call.url.startsWith("https://api.telegram.org/")).length, 1);
  } finally {
    mock.restore();
  }
});
