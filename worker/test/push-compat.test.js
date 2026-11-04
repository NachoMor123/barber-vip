import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { buildPushPayload } from "@block65/webcrypto-web-push";

function makeP256Keys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url")
  };
}

test("Cloudflare-compatible Web Push builds an RFC 8291 aes128gcm payload", async () => {
  const vapidKeys = makeP256Keys();
  const userKeys = makeP256Keys();
  const subscription = {
    endpoint: "https://push.example.test/send/fixture",
    expirationTime: null,
    keys: {
      p256dh: userKeys.publicKey,
      auth: randomBytes(16).toString("base64url")
    }
  };

  const init = await buildPushPayload(
    {
      data: {
        title: "Visita registrada",
        body: "Tu tarjeta tiene una visita nueva.",
        url: "/"
      },
      options: { ttl: 3600, urgency: "normal" }
    },
    subscription,
    {
      subject: "https://barbervip-309dc.web.app",
      publicKey: vapidKeys.publicKey,
      privateKey: vapidKeys.privateKey
    }
  );

  assert.equal(init.method, "post");
  assert.equal(init.headers["content-encoding"], "aes128gcm");
  assert.match(init.headers.authorization, /^vapid t=/);
  assert.equal(init.headers.ttl, "3600");
  assert.equal(init.body.byteLength, 4096);
  assert.ok(init.body instanceof Uint8Array);
});

test("Web Push rejects malformed/non-HTTPS subscriptions", async () => {
  const vapidKeys = makeP256Keys();
  const userKeys = makeP256Keys();
  await assert.rejects(
    buildPushPayload(
      {
        data: { title: "test" },
        options: { ttl: 3600 }
      },
      {
        endpoint: "http://push.example.test/send/fixture",
        expirationTime: null,
        keys: {
          p256dh: userKeys.publicKey,
          auth: randomBytes(16).toString("base64url")
        }
      },
      {
        subject: "https://barbervip-309dc.web.app",
        publicKey: vapidKeys.publicKey,
        privateKey: vapidKeys.privateKey
      }
    ),
    /https/i
  );
});
