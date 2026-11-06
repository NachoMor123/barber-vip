import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const [html, api] = await Promise.all([
  readFile(join(root, "index.html"), "utf8"),
  readFile(join(root, "spark-api.js"), "utf8")
]);

function functionBody(source, name, nextName) {
  const start = source.indexOf(name);
  assert.notEqual(start, -1, `Missing function: ${name}`);
  const end = source.indexOf(nextName, start + name.length);
  assert.notEqual(end, -1, `Missing boundary after: ${name}`);
  return source.slice(start, end);
}

test("administrator customer cache is isolated by authenticated user and barber", () => {
  assert.match(html, /const ADMIN_CUSTOMERS_CACHE_TTL_MS=24\*60\*60\*1000/);
  const key = functionBody(html, "function adminCustomersCacheKey()", "function saveAdminCustomersCache()");
  assert.match(key, /state\.user\?\.uid/);
  assert.match(key, /state\.barberUid/);

  const restore = functionBody(html, "function restoreAdminCustomersCache()", "function clearAdminCustomersCache()");
  assert.match(restore, /state\.role!=='barber'/);
  assert.match(restore, /state\.user\|\|!state\.barberUid/);
  assert.match(restore, /Array\.isArray\(cached\?\.customers\)/);
  assert.match(restore, /c\.barberUid===state\.barberUid/);
  assert.match(restore, /ADMIN_CUSTOMERS_CACHE_TTL_MS/);
});

test("customer collection is fetched on demand, with in-flight request deduplication", () => {
  const loader = functionBody(html, "async function ensureAdminCustomersLoaded", "function sectionPreferenceKey");
  assert.match(loader, /document\.visibilityState!=='visible'/);
  assert.match(loader, /state\.customersLoadPromise/);
  assert.match(loader, /getDocs\(clientsRef\)/);
  assert.match(loader, /saveAdminCustomersCache\(\)/);
  assert.match(loader, /state\.barberUid!==barberUid/);
  assert.doesNotMatch(loader, /onSnapshot\s*\(/);
});

test("customer sessions always resolve their own profile, barber and customer document", () => {
  const load = functionBody(html, "async function loadContext(me)", "function resumeSession");
  assert.match(load, /state\.user=state\.auth\.currentUser/);
  assert.match(load, /state\.barberUid=me\.barberUid/);
  assert.match(load, /doc\(state\.db,'barbers',me\.barberUid,'customers',state\.user\.uid\)/);
  assert.match(load, /clearListeners\(\); state\.customers=\[\]/);

  const getMe = functionBody(api, "async function getMe()", "async function ensureBarberProfile");
  assert.match(getMe, /const uid = currentUid\(\)/);
  assert.match(getMe, /cachedUid === uid/);
  assert.match(getMe, /doc\(db\(\), 'barbers', barberUid, 'customers', uid\)/);
});

test("Firebase identity changes invalidate the API cache and clear the previous account context", () => {
  assert.match(api, /apiRequest\.resetSessionCache = invalidate/);
  assert.match(html, /nextUid!==observedAuthUid/);
  assert.match(html, /api\.resetSessionCache\(\)/);
  assert.match(html, /if\(state\.user\?\.uid!==nextUid\)cleanupContext\(\)/);
});

test("client sorting includes chronological visit order and has no redundant recent-reward filter", () => {
  assert.match(html, /Ordenar por orden de visitas/);
  assert.match(html, /\.mobile-nav\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(html, /\.mobile-nav\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(html, /case 'visit-order-desc'/);
  assert.doesNotMatch(html, /customerRewardFilter/);
  assert.doesNotMatch(html, /Premio aplicado recientemente/);
});
