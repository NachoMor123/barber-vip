import test from "node:test";
import assert from "node:assert/strict";
import {
  originAllowed,
  frontendReturnOrigin
} from "../src/index.js";

const env = {
  APP_ORIGIN: "https://barbervip-309dc.web.app",
  COMMERCIAL_ORIGIN: "https://barber-vip-comercial-309dc.web.app"
};

function requestFrom(origin) {
  return new Request("https://barber-vip.barbervip.workers.dev/health", {
    headers: origin ? { origin } : {}
  });
}

test("allows only the Firebase app and commercial production origins", () => {
  assert.equal(originAllowed(requestFrom(env.APP_ORIGIN), env), true);
  assert.equal(originAllowed(requestFrom(env.COMMERCIAL_ORIGIN), env), true);
});

test("rejects Vercel, unknown, and non-HTTPS external origins", () => {
  assert.equal(originAllowed(requestFrom("https://barber-vip-three.vercel.app"), env), false);
  assert.equal(originAllowed(requestFrom("https://barber-vip-git-branch-im565991-4576.vercel.app"), env), false);
  assert.equal(originAllowed(requestFrom("https://another-project.example"), env), false);
  assert.equal(originAllowed(requestFrom("http://barbervip-309dc.web.app"), env), false);
});

test("allows local development without adding any hosted preview domain", () => {
  assert.equal(originAllowed(requestFrom("http://localhost:5000"), env), true);
  assert.equal(originAllowed(requestFrom("http://127.0.0.1:5000"), env), true);
});

test("checkout returns only to the authorized frontend that initiated it", () => {
  assert.equal(frontendReturnOrigin(requestFrom(env.APP_ORIGIN), env), env.APP_ORIGIN);
  assert.equal(frontendReturnOrigin(requestFrom(env.COMMERCIAL_ORIGIN), env), env.COMMERCIAL_ORIGIN);
  assert.equal(frontendReturnOrigin(requestFrom("https://barber-vip-three.vercel.app"), env), env.APP_ORIGIN);
});

test("checkout without a browser origin falls back to Firebase Hosting", () => {
  assert.equal(frontendReturnOrigin(requestFrom(""), env), env.APP_ORIGIN);
});
