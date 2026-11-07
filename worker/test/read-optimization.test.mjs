import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const [html, api, cutsApi, customersApi, profileApi, worker, serviceWorker, rules, wrangler, envExample] = await Promise.all([
  readFile(join(root, "index.html"), "utf8"),
  readFile(join(root, "spark-api.js"), "utf8"),
  readFile(join(root, "api", "cuts.js"), "utf8"),
  readFile(join(root, "api", "customers.js"), "utf8"),
  readFile(join(root, "api", "me.js"), "utf8"),
  readFile(join(root, "worker", "src", "index.js"), "utf8"),
  readFile(join(root, "sw.js"), "utf8"),
  readFile(join(root, "firestore.rules"), "utf8"),
  readFile(join(root, "worker", "wrangler.jsonc"), "utf8"),
  readFile(join(root, "env.example"), "utf8")
]);

function functionBody(source, name, nextName) {
  const start = source.indexOf(name);
  assert.notEqual(start, -1, `Missing function: ${name}`);
  const end = source.indexOf(nextName, start + name.length);
  assert.notEqual(end, -1, `Missing boundary after: ${name}`);
  return source.slice(start, end);
}

test("legacy promotions and Push backends are removed from the repository", async () => {
  for (const path of [
    join(root, "api", "promotions.js"),
    join(root, "api", "push.js"),
    join(root, "lib", "push.js")
  ]) {
    await assert.rejects(access(path), error => error && error.code === "ENOENT");
  }

  for (const source of [cutsApi, customersApi, profileApi, worker, serviceWorker]) {
    assert.doesNotMatch(source, /sendPushToCustomer|sendPushToBarberCustomers|removeCustomerPushSubscriptions/);
    assert.doesNotMatch(source, /pushSubscriptions|PushManager|showNotification|notificationclick|VAPID_(PUBLIC|PRIVATE|SUBJECT)_KEY/i);
  }
  assert.doesNotMatch(profileApi, /promotionsUpdatedAt|collection\(['"]promotions['"]\)/);
  assert.doesNotMatch(worker, /path === ["']\/api\/(push|promotions)/);
  assert.doesNotMatch(serviceWorker, /addEventListener\(["']push|addEventListener\(["']notificationclick/i);
  assert.doesNotMatch(rules, /pushSubscriptions|match \/promotions\b/i);
  assert.doesNotMatch(wrangler, /VAPID_|durable_objects\s*:/i);
  assert.doesNotMatch(envExample, /VAPID_|APP_URL=https:\/\/barber-vip-three\.vercel\.app/i);
});

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

test("customer directory loads one bounded page on demand and deduplicates requests", () => {
  const loader = functionBody(html, "async function ensureAdminCustomersLoaded", "async function loadMoreAdminCustomers");
  assert.match(loader, /document\.visibilityState!=='visible'/);
  assert.match(loader, /state\.customersLoadPromise/);
  assert.match(loader, /\/api\/customers\/list/);
  assert.match(loader, /pageSize:ADMIN_CUSTOMERS_PAGE_SIZE/);
  assert.match(loader, /saveAdminCustomersCache\(\)/);
  assert.match(loader, /state\.barberUid!==barberUid/);
  assert.doesNotMatch(loader, /getDocs\s*\(/);

  const apiList = functionBody(api, "async function listCustomers", "async function searchCustomers");
  assert.match(apiList, /limit\(pageSize\)/);
  assert.match(apiList, /startAfter\(/);
  assert.match(apiList, /getCountFromServer/);

  const cutModal = functionBody(html, "function openCutModal()", "async function saveCustomerForm");
  assert.doesNotMatch(cutModal, /ensureAdminCustomersLoaded|collection\(state\.db/);
  assert.match(cutModal, /runCustomerSearch\(term,'cut'\)/);
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
  assert.doesNotMatch(html, /Última visita: más reciente/);
  assert.doesNotMatch(html, /customerRewardFilter/);
  assert.doesNotMatch(html, /reminder/i);
  assert.doesNotMatch(html, /PushManager|Notification\.requestPermission|showNotification|notificationclick/i);
  assert.doesNotMatch(html, /Premio aplicado recientemente/);
});


test("subscription status and countdown live only in Settings, not Home or the sidebar", () => {
  const dashboard = functionBody(html, "function dashboardView()", "function clientRow");
  const shell = functionBody(html, "function adminShell()", "function navItem");
  const settings = functionBody(html, "function renderSettings()", "function adminShell");
  const plan = functionBody(html, "function openPlanInfo()", "async function paySubscription");
  assert.doesNotMatch(dashboard, /subscriptionBanner|subscription-settings-card|data-action="pay"/);
  assert.doesNotMatch(shell, /side-subscription|ESTADO DE CUENTA|Gestionar plan/);
  assert.match(settings, /subscription-settings-card/);
  assert.match(settings, /Tiempo restante/);
  assert.match(settings, /subscriptionTimeLabel\(s\)/);
  assert.match(plan, /remainingDaysText\(status\.daysRemaining\)/);
  assert.match(plan, /trialEnded/);
  assert.match(plan, /no hay débitos automáticos/i);
});

test("customer list reads have a bounded retry circuit breaker and preserve stale cached data", () => {
  const loader = functionBody(html, "async function ensureAdminCustomersLoaded", "function sectionPreferenceKey");
  assert.match(loader, /state\.customersLoadPromise/);
  assert.match(loader, /state\.barberUid===barberUid/);
  assert.match(loader, /state\.customersRetryAfter/);
  assert.match(loader, /Math\.min\(300000,10000\*Math\.pow\(2/);
  assert.match(loader, /const hadLoaded=state\.customersLoaded/);
  assert.match(loader, /if\(state\.role!=='barber'\|\|state\.barberUid!==barberUid\)return/);
  assert.match(loader, /state\.customersLoaded=hadLoaded/);
  assert.match(loader, /Seguimos mostrando la última copia guardada/);
});

test("barber session does not open a redundant profile listener; customer listeners remain scoped", () => {
  const load = functionBody(html, "async function loadContext(me)", "function resumeSession");
  assert.doesNotMatch(load, /onSnapshot\(barberRef/);
  assert.match(load, /onSnapshot\(professionalMetaRef/);
  assert.match(load, /onSnapshot\(customerRef/);
});

test("legacy cycle display uses the same actual-visit basis as visit registration", () => {
  const cycle = functionBody(html, "function cycleCount(c)", "function progress(c)");
  assert.match(cycle, /actualCutsRegistered/);
  assert.match(cycle, /referralCreditsReceived/);
  assert.match(cycle, /cycleVersion>=2/);
});

test("client deletion confirmation is concise while the stored customer record remains a soft deletion", () => {
  assert.match(html, /confirm\(c\?\.fullName\?/);
  assert.match(html, /¿Eliminar cliente\?/);
  assert.match(api, /active: false, disabledAt: serverTimestamp\(\)/);
  assert.doesNotMatch(api, /async function disableCustomer[\s\S]*?deleteDoc\(customerRef/);
});

test("Mercado Pago Checkout Pro keeps all eligible payment methods available by default", () => {
  const preference = functionBody(worker, "async function createPaymentPreference", "async function handleMercadoPagoWebhook");
  assert.match(preference, /Leave payment_methods unrestricted/);
  assert.doesNotMatch(preference, /excluded_payment_types|excluded_payment_methods/);
});


test("customer detail exposes the effective standard or custom milestone configuration", () => {
  const detail = functionBody(html, "function openClientView(id)", "function openCutModal()");
  const program = functionBody(html, "function programForCustomer(c", "function rewardsForCustomer(c");
  assert.match(detail, /programMode/);
  assert.match(detail, /rewardConfig\.map/);
  assert.match(detail, /Programa de fidelización/);
  assert.match(program, /loyaltyOverride\?\.mode==='custom'/);
  assert.match(program, /loyaltyPrograms\(barber\)/);
});

test("editing customer identity or preferences cannot overwrite visit history or cycle counters", () => {
  const update = functionBody(api, "async function updateCustomer(data)", "async function disableCustomer(data)");
  assert.doesNotMatch(update, /totalCuts|actualCutsRegistered|cycleCuts|cycleVersion|availableRewards|rewardReady/);
  const visit = functionBody(api, "async function addCut(data)", "const apiRequest");
  assert.match(visit, /runTransaction\(db\(\)/);
  assert.match(visit, /transaction\.get\(customerRef\)/);
  assert.match(visit, /transaction\.get\(barberRef\)/);
  assert.match(visit, /totalCuts, actualCutsRegistered, cycleCuts: cycleNext/);
});


test("customer query cooldown persists locally and is isolated by barber identity", () => {
  assert.match(html, /barberVipCustomersRetry:v1:/);
  assert.match(html, /restoreAdminCustomersRetryGuard\(\)/);
  assert.match(html, /saveAdminCustomersRetryGuard\(\)/);
  assert.match(html, /clearAdminCustomersRetryGuard\(\)/);
  assert.match(html, /state\.user\?\.uid/);
  assert.match(html, /state\.barberUid/);
});

test("Instagram profile editor persists a validated canonical URL for customer cards", () => {
  assert.match(html, /normalizeInstagramProfileUrl\(rawInstagram\)/);
  assert.match(html, /instagramUrl,mapsUrl/);
  assert.match(api, /normalizeInstagramProfileUrl\(rawInstagram\)/);
  assert.match(api, /query\(collection\(db\(\), 'barbers', uid, 'customers'\), where\('active', '==', true\)\)/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});

test("active client roster query excludes soft-deleted records from repeated reads", () => {
  const loader = functionBody(html, "async function ensureAdminCustomersLoaded", "function sectionPreferenceKey");
  assert.match(loader, /query\(clientsRef,where\('active','==',true\)\)/);
  assert.doesNotMatch(loader, /getDocs\(clientsRef\)/);
  assert.match(html, /ADMIN_CUSTOMERS_CACHE_TTL_MS=24\*60\*60\*1000/);
});

test("customer login index migration batches do not overlap or skip customer records", () => {
  const migration = functionBody(api, "async function migrateCustomerLoginIndex", "const apiRequest");
  assert.match(migration, /offset \+= 350/);
  assert.match(migration, /active\.slice\(offset, offset \+ 350\)/);
  assert.doesNotMatch(migration, /offset \+= 200|offset \+ 400/);
});

test("home quick actions have restrained portrait spacing and height", () => {
  const style = functionBody(html, '<style id="barbervip-home-spacing-v2">', '</style>');
  assert.match(style, /margin-top:15px/);
  assert.match(style, /row-gap:15px/);
  assert.match(style, /min-height:158px/);
});

test("payment webhook verifies signatures, approves exact amount and guards duplicate processing", () => {
  const webhook = functionBody(worker, "async function handleMercadoPagoWebhook", "async function resetCustomerPassword");
  assert.match(webhook, /validMercadoPagoSignature/);
  assert.match(webhook, /payment\.status !== "approved"/);
  assert.match(webhook, /transaction_amount\) !== amount/);
  assert.match(webhook, /currency_id !== "ARS"/);
  assert.match(webhook, /preference\.data\.processedAt/);
  assert.match(webhook, /currentDocument: \{ exists: false \}/);
  assert.match(webhook, /currentDocument: \{ updateTime: preference\.updateTime \}/);
  assert.match(webhook, /Mercado Pago puede reintentar/);
});

test("customer search and visit picker are bounded to 25 remote matches", () => {
  const search = functionBody(api, "async function searchCustomers", "const apiRequest");
  assert.match(search, /limit\(25\)/);
  assert.match(search, /where\(field, '>='/);
  assert.match(search, /where\(field, '<='/);
  assert.match(html, /runCustomerSearch\(term,'cut'\)/);
  assert.match(html, /cutSearchResults/);
});

test("direct customer signup publishes a single-document roster event for instant barber synchronization", () => {
  assert.match(worker, /appendCustomerRosterChange/);
  const signup = functionBody(worker, "async function registerCustomerAccount", "async function hmacHex");
  assert.match(signup, /customerRoster\/state/);
  assert.match(signup, /currentDocument: currentRoster\?\.updateTime/);
  assert.match(signup, /fsCommit\(env, \[\.\.\.customerWrites, lookupWrite, rosterWrite\]\)/);
  const load = functionBody(html, "async function loadContext(me)", "function resumeSession");
  assert.match(load, /onSnapshot\(rosterRef/);
  assert.match(html, /applyCustomerRosterChanges/);
  assert.doesNotMatch(load, /onSnapshot\(collection\(.*customers/);
});

test("customer cards receive updated standard loyalty settings without refreshing the app", () => {
  const load = functionBody(html, "async function loadContext(me)", "function resumeSession");
  assert.match(load, /loyaltyPrograms:Array\.isArray\(fresh\.loyaltyPrograms\)/);
  assert.match(load, /defaultLoyaltyProgramId:fresh\.defaultLoyaltyProgramId/);
  const save = functionBody(api, "async function saveLoyalty(data)", "apiRequest.resetSessionCache");
  assert.match(save, /publicMeta/);
  assert.match(save, /loyaltyPrograms: \[program\]/);
});

test("customer detail keeps standard and custom rewards isolated by customer", () => {
  const program = functionBody(html, "function programForCustomer(c", "function rewardsForCustomer(c");
  assert.match(program, /loyaltyOverride\?\.mode==='custom'/);
  assert.match(program, /loyaltyPrograms\(barber\)/);
  const update = functionBody(api, "async function updateCustomer(data)", "async function disableCustomer");
  assert.match(update, /normalizeOverride\(data\.loyaltyMode, data\.loyaltyRewards, state\.barber \|\| \{\}\)/);
  assert.doesNotMatch(update, /totalCuts|actualCutsRegistered|cycleCuts|cycleVersion|availableRewards|rewardReady/);
});

test("customer local state and cache are scoped to the authenticated identity", () => {
  assert.match(html, /barberVipAdminCustomers:v2:/);
  assert.match(html, /state\.user\?\.uid/);
  assert.match(html, /cleanupContext\(\)/);
  assert.match(html, /browserLocalPersistence/);
  assert.match(html, /state\.customersTotalCount/);
});

test("service worker and release package contain the customer roster module and Firestore indexes", () => {
  assert.match(serviceWorker, /customer-roster\.js/);
  assert.match(serviceWorker, /v71-customer-roster-scale/);
  assert.match(wrangler, /\{\s*"indexes"\s*:/);
});

