import test from "node:test";
import assert from "node:assert/strict";
import {
  originAllowed,
  frontendReturnOrigin,
  isVercelPreviewOrigin
} from "../src/index.js";

const env = {
  APP_ORIGIN: "https://barbervip-309dc.web.app",
  COMMERCIAL_ORIGIN: "https://barber-vip-comercial-309dc.web.app",
  VERCEL_APP_ORIGIN: "https://barber-vip-three.vercel.app",
  VERCEL_PREVIEW_ORIGIN: "https://barber-vip-git-hybrid-cloudflare-im565991-4576.vercel.app"
};

function requestFrom(origin) {
  return new Request("https://barber-vip.barbervip.workers.dev/health", {
    headers: origin ? { origin } : {}
  });
}

test("allows the Firebase and Vercel production origins", () => {
  assert.equal(originAllowed(requestFrom(env.APP_ORIGIN), env), true);
  assert.equal(originAllowed(requestFrom(env.COMMERCIAL_ORIGIN), env), true);
  assert.equal(originAllowed(requestFrom(env.VERCEL_APP_ORIGIN), env), true);
});

test("allows the configured Vercel branch preview and this project's generated previews", () => {
  assert.equal(originAllowed(requestFrom(env.VERCEL_PREVIEW_ORIGIN), env), true);
  assert.equal(
    originAllowed(requestFrom("https://barber-vip-git-worker-vercel-preview-integration-im565991-4576.vercel.app"), env),
    true
  );
});

test("does not allow unrelated Vercel projects or non-HTTPS preview origins", () => {
  assert.equal(originAllowed(requestFrom("https://another-project-im565991-4576.vercel.app"), env), false);
  assert.equal(originAllowed(requestFrom("http://barber-vip-git-branch-im565991-4576.vercel.app"), env), false);
});

test("checkout returns to the authorized frontend that initiated it", () => {
  assert.equal(frontendReturnOrigin(requestFrom(env.VERCEL_PREVIEW_ORIGIN), env), env.VERCEL_PREVIEW_ORIGIN);
  assert.equal(frontendReturnOrigin(requestFrom(env.VERCEL_APP_ORIGIN), env), env.VERCEL_APP_ORIGIN);
});

test("checkout without a browser origin falls back to Firebase Hosting", () => {
  assert.equal(frontendReturnOrigin(requestFrom(""), env), env.APP_ORIGIN);
});

test("identifies Vercel previews so live checkout can be kept disabled there", () => {
  assert.equal(isVercelPreviewOrigin(env.VERCEL_PREVIEW_ORIGIN, env), true);
  assert.equal(isVercelPreviewOrigin(env.VERCEL_APP_ORIGIN, env), false);
});
