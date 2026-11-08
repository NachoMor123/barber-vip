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
  assert.doesNotMatch(apiList, /getCountFromServer|includeCount/);
  assert.doesNotMatch(api, /getCountFromServer/);

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

test("global customer sorting exposes only the three supported server orders", () => {
  const clients = functionBody(html, "function clientsView()", "function renderSettings()");
  const sort = functionBody(api, "function customerListSort", "function customerDirectoryFilters");
  assert.match(clients, /Más visitas totales/);
  assert.match(clients, /Menos visitas totales/);
  assert.match(clients, /Última visita: más reciente/);
  assert.doesNotMatch(clients, /Última visita: más antigua|Nombre: A–Z|last-cut-asc|name-asc/);
  assert.doesNotMatch(sort, /last-cut-asc|name-asc/);
  assert.match(sort, /case 'visit-order-desc'/);
  const filtered = functionBody(html, "function filteredCustomers()", "function clientStatus");
  assert.doesNotMatch(filtered, /list\.sort/);
  assert.match(html, /resetCustomerDirectoryForCriteria\(\)/);
  assert.match(html, /\['cuts-desc','cuts-asc','visit-order-desc'\]/);
  assert.match(html, /\.mobile-nav\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(html, /\.mobile-nav\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
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
  assert.match(api, /customerDirectoryFilters\(ref, source\)/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});

test("customer directory queries only active records and caps each page", () => {
  const list = functionBody(api, "async function listCustomers", "async function searchCustomers");
  assert.match(list, /customerDirectoryFilters\(ref, source\)/);
  assert.match(list, /limit\(pageSize\)/);
  assert.match(list, /Math\.min\(100, Number\(data\.pageSize\) \|\| 50\)/);
  assert.doesNotMatch(list, /getCountFromServer|includeCount/);
  assert.doesNotMatch(api, /getCountFromServer/);
  assert.match(html, /function observeCustomersPagination/);
  assert.doesNotMatch(html, /clientes cargados|Total de clientes|25\+ resultados/);
  const clientsView = functionBody(html, "function clientsView()", "function renderSettings()");
  assert.doesNotMatch(clientsView, /result-count|customersTotalCount/);
  assert.match(api, /where\('active', '==', true\)/);
  assert.match(html, /ADMIN_CUSTOMERS_PAGE_SIZE=50/);
  assert.match(html, /loadMoreAdminCustomers/);
  assert.match(html, /ADMIN_CUSTOMERS_CACHE_TTL_MS=24\*60\*60\*1000/);
});

test("legacy customer login-index migration is resumable and bounds each read/write block", () => {
  const migration = functionBody(api, "async function migrateCustomerLoginIndexForBarber", "async function migrateCustomerLoginIndex");
  assert.match(migration, /const pageSize = 250/);
  assert.match(migration, /orderBy\(documentId\(\)\)/);
  assert.match(migration, /startAfter\(cursorId\)/);
  assert.match(migration, /batch\.update\(barberRef, \{/);
  assert.match(migration, /sparkLoginIndexMigrationCursor: completed \? null : nextCursorId/);
  assert.match(migration, /sparkLoginIndexMigratedAt: serverTimestamp\(\)/);
  assert.match(migration, /const snapshot = await getDocs\(pageQuery\)/);
  assert.doesNotMatch(migration, /while\s*\(true\)/);
  assert.doesNotMatch(migration, /getDocs\(collection\(db\(\), 'barbers', uid, 'customers'\)\)/);
  const getMe = functionBody(api, "async function getMe()", "async function ensureBarberProfile");
  assert.match(getMe, /migrateCustomerLoginIndexForBarber\(barber\)/);
  assert.doesNotMatch(getMe, /getDocs\(activeCustomersQuery\)/);
});

test("home quick actions are visibly enlarged and separated in the final overriding style", () => {
  const style = functionBody(html, '<style id="barbervip-home-spacing-final">', '</style>');
  assert.match(style, /margin-top:28px/);
  assert.match(style, /row-gap:16px/);
  assert.match(style, /min-height:188px/);
  assert.match(style, /min-height:168px/);
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

test("customer search is prefix-based, cursor-paginated by 25, and independently sorted from visit ranking", () => {
  const search = functionBody(api, "async function searchCustomers", "const apiRequest");
  assert.match(search, /limit\(25\)/);
  assert.match(search, /where\(field, '>='/);
  assert.match(search, /where\(field, '<='/);
  assert.match(search, /startAfter\(cursorValue, cursorId\)/);
  assert.match(search, /hasMore: snap\.docs\.length === 25/);
  assert.match(search, /\[uid, source, field, prefix, cursorValue, cursorId\]/);
  assert.match(search, /numericSearch && rawDigits\.length < 3/);
  assert.match(html, /runCustomerSearch\(term,'cut'\)/);
  assert.match(html, /cutSearchResults/);
  assert.match(html, /customerSearchLoadSentinel/);
  assert.match(html, /loadMoreCustomerSearch/);
  assert.match(html, /state\.query\.trim\(\)\.length>=1/);
  assert.match(html, /state\.customerSearchHasMore/);
  assert.match(html, /state\.customerSearchLoadingMore/);
  assert.match(html, /numericOnly&&digits\.length<3/);
  assert.match(html, /Orden: coincidencia/);
  assert.match(html, /aria-label="Orden de búsqueda"/);
  const more = functionBody(html, "async function loadMoreCustomerSearch", "async function runCustomerSearch");
  assert.match(more, /cursorId:state\.customerSearchCursorId/);
  assert.match(more, /cursorValue:state\.customerSearchCursorValue/);
  assert.match(more, /state\.customerSearchSeq===searchSeq/);
  assert.match(more, /state\.user\?\.uid===accountUid/);
  assert.match(more, /renderApp\(\)/);
  const filtered = functionBody(html, "function filteredCustomers()", "function clientStatus");
  assert.match(filtered, /if\(searchActive\)return list/);
  assert.match(html, /activeQuery\.length>=1/);
  assert.match(html, /customerSearchTerm=activeListSearch/);
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

test("customer local cache is versioned and cannot restore another barber or browser account", () => {
  assert.match(html, /barberVipAdminCustomers:v4:/);
  assert.match(html, /ownerUid:state\.user\.uid/);
  assert.match(html, /barberUid:state\.barberUid/);
  assert.match(html, /cached\?\.ownerUid!==state\.user\.uid/);
  assert.match(html, /cached\?\.barberUid!==state\.barberUid/);
  assert.match(html, /encodeURIComponent\(queryKey\)/);
  assert.match(html, /state\.customersFirstPageCursorId/);
  assert.match(html, /api\.resetSessionCache\?\.\(\)/);
  assert.match(html, /browserLocalPersistence/);
  assert.doesNotMatch(html, /customersTotalCount/);
});

test("directory pages never mix sort or origin queries and reject stale responses", () => {
  const list = functionBody(api, "async function listCustomers", "async function searchCustomers");
  const filtered = functionBody(html, "function filteredCustomers()", "function clientStatus");
  const loader = functionBody(html, "async function ensureAdminCustomersLoaded", "async function loadMoreAdminCustomers");
  const more = functionBody(html, "async function loadMoreAdminCustomers", "async function loadMoreCustomerSearch");
  assert.match(list, /orderBy\(sort\.field, sort\.direction\)/);
  assert.match(list, /orderBy\(documentId\(\), sort\.direction\)/);
  assert.match(list, /startAfter\(cursorValue, String\(data\.cursorId\)\)/);
  assert.match(filtered, /The server owns ordering and cursors/);
  assert.doesNotMatch(filtered, /list\.sort/);
  assert.match(html, /customerDirectoryQueryKey\(\)/);
  assert.match(html, /barberVipAdminCustomers:v4:/);
  assert.match(html, /customersLoadSeq/);
  assert.match(html, /customersLoadQueryKey/);
  assert.match(loader, /customerDirectoryQueryKey\(\)!==queryKey/);
  assert.match(loader, /state\.customersLoadSeq!==requestSeq/);
  assert.match(more, /state\.customersLoadSeq!==requestSeq/);
  assert.match(more, /state\.customersQueryKey!==queryKey/);
  assert.match(html, /state\.customersFirstPageCursorId/);
});

test("service worker and release package contain the customer roster module and Firestore indexes", () => {
  assert.match(serviceWorker, /customer-roster\.js/);
  assert.match(serviceWorker, /v73-count-free-directory/);
  assert.match(rules, /match \/customerRoster/);
});

test("release bundle includes indexed pagination and native ESM roster module", async () => {
  const packageWorkflow = await readFile(join(root, ".github", "workflows", "package-app.yml"), "utf8");
  const firebase = await readFile(join(root, "firebase.json"), "utf8");
  const indexes = JSON.parse(await readFile(join(root, "firestore.indexes.json"), "utf8"));
  assert.match(packageWorkflow, /firestore\.indexes\.json/);
  assert.match(packageWorkflow, /customer-roster\.mjs/);
  assert.match(firebase, /firestore\.indexes\.json/);
  assert.ok(indexes.indexes.length >= 10);
  assert.match(worker, /customer-roster\.mjs/);
  assert.match(serviceWorker, /customer-roster\.js/);
});

test("client search and visit picker never load a full customer collection", () => {
  const search = functionBody(api, "async function searchCustomers", "const apiRequest");
  assert.match(search, /limit\(25\)/);
  assert.match(search, /where\(field, '>='/);
  const modal = functionBody(html, "function openCutModal()", "async function saveCustomerForm");
  assert.doesNotMatch(modal, /ensureAdminCustomersLoaded|collection\(state\.db/);
  assert.match(modal, /runCustomerSearch\(term,'cut'\)/);
  assert.match(html, /action==='open-cut-modal'\)\{openCutModal\(\);/);
});

test("customer query failure keeps the previous page visible until resync succeeds", () => {
  const loader = functionBody(html, "async function ensureAdminCustomersLoaded", "async function loadMoreAdminCustomers");
  assert.match(loader, /Keep the previous page visible/);
  assert.doesNotMatch(loader, /state\.customers=\[\];state\.customersLoaded=false/);
});

test("direct signup roster replay and own-customer updates remain bounded", () => {
  const roster = functionBody(html, "async function applyCustomerRosterSnapshot", "async function ensureAdminCustomersLoaded");
  assert.match(roster, /customerRosterDelta/);
  assert.match(roster, /applyCustomerRosterChanges/);
  const load = functionBody(html, "async function loadContext(me)", "function resumeSession");
  assert.match(load, /onSnapshot\(rosterRef/);
  assert.match(load, /onSnapshot\(customerRef/);
  assert.match(load, /loyaltyPrograms:Array\.isArray\(fresh\.loyaltyPrograms\)/);
});
test("standard customers always inherit the current barber program, while custom discounts stay per customer", () => {
  const visit = functionBody(api, "async function addCut(data)", "function customerListSort");
  assert.match(visit, /customer\.loyaltyOverride\?\.mode === 'custom'/);
  assert.match(visit, /programs\.find\(p => p\.id === freshBarber\.defaultLoyaltyProgramId\)/);
  assert.doesNotMatch(visit, /programs\.find\(p => p\.id === customer\.loyaltyProgramId\)/);
  const program = functionBody(html, "function programForCustomer(c", "function rewardsForCustomer(c");
  assert.match(program, /loyaltyOverride\?\.mode==='custom'/);
  assert.match(program, /loyaltyPrograms\(barber\)/);
});


test("standard loyalty semantics match the legacy visit endpoint and never follow stale customer program ids", () => {
  assert.doesNotMatch(cutsApi, /programs\.find\(p=>p\.id===customer\.loyaltyProgramId\)/);
  const visit = functionBody(api, "async function addCut(data)", "function customerListSort");
  assert.doesNotMatch(visit, /programs\.find\(p => p\.id === customer\.loyaltyProgramId\)/);
  assert.match(visit, /customer\.loyaltyOverride\?\.mode === 'custom'/);
});

test("pending searches, pagination requests and customer listeners are isolated by account uid", () => {
  const search = functionBody(html, "async function runCustomerSearch", "function sectionPreferenceKey");
  assert.match(search, /const accountUid=state\.user\?\.uid/);
  assert.match(search, /state\.user\?\.uid!==accountUid/);
  const loadMore = functionBody(html, "async function loadMoreAdminCustomers", "async function runCustomerSearch");
  assert.match(loadMore, /const accountUid=state\.user\?\.uid/);
  assert.match(loadMore, /state\.barberUid!==barberUid/);
  const listeners = functionBody(html, "async function loadContext(me)", "function resumeSession");
  assert.match(listeners, /customerSessionUid/);
  assert.match(listeners, /state\.user\?\.uid!==customerSessionUid/);
  assert.match(html, /state\.cutSearchSeq\+\+/);
});


test("migration cursor is permitted only as a barber-owned technical field", () => {
  const barberRules = rules.slice(rules.indexOf("match /barbers/{barberId}"), rules.indexOf("match /customers/{customerId}"));
  assert.match(barberRules, /sparkLoginIndexMigrationCursor/);
});


test("customer directory pagination is invisible and the UI does not display partial or total counts", () => {
  const markup = functionBody(html, "function customerResultsMarkup(list)", "function clientsView()");
  const clients = functionBody(html, "function clientsView()", "function renderSettings()");
  assert.match(markup, /customerLoadSentinel/);
  assert.doesNotMatch(markup, /Cargar 50 clientes más|Mostramos los primeros 50/);
  assert.match(html, /IntersectionObserver/);
  assert.doesNotMatch(clients, /customersTotalCount|result-count/);
  assert.doesNotMatch(html, /clientes cargados|de \$\{state\.customers\.length\}|Total de clientes|25\+ resultados/);
});

test("repeated exact customer searches use a short account-scoped memory cache that is invalidated after changes", () => {
  const search = functionBody(api, "async function searchCustomers", "const apiRequest");
  assert.match(search, /customerSearchCache\.get\(cacheKey\)/);
  assert.match(search, /Date\.now\(\) \+ 30000/);
  assert.match(search, /limit\(25\)/);
  assert.match(api, /apiRequest\.clearCustomerSearchCache = clearCustomerSearchCache/);
  assert.match(html, /api\.clearCustomerSearchCache\?\.\(\)/);
});

test("barber-created, edited and disabled customers publish roster events atomically", () => {
  const create = functionBody(api, "async function createCustomerForBarber", "async function updateCustomer");
  const update = functionBody(api, "async function updateCustomer", "async function disableCustomer");
  const disable = functionBody(api, "async function disableCustomer", "async function addCut");
  for (const block of [create, update, disable]) {
    assert.match(block, /appendCustomerRosterChange/);
    assert.match(block, /runTransaction\(db\(\)/);
    assert.match(block, /customerRoster', 'state'/);
  }
  assert.match(rules, /allow create, update: if rosterId == 'state'/);
  assert.match(rules, /request\.resource\.data\.changes\.size\(\) <= 100/);
});

test("legacy customers can sign in while the resumable migration is incomplete", () => {
  assert.match(api, /workerRequest\('\/api\/customer-login'/);
  assert.match(worker, /async function lookupCustomerAccount/);
  assert.match(worker, /fsQueryCustomerField\(env, barberUid, "usernameNormalized", normalizedName, 2\)/);
  assert.match(worker, /path === "\/api\/customer-login"/);
  assert.match(worker, /const legacyNameMatches = await fsQueryCustomerField/);
  assert.match(worker, /const phoneMatches = await fsQueryCustomerField/);
});


test("profile and loyalty data publish atomically to the customer-facing professional card", () => {
  const profile = functionBody(api, "async function saveProfile(data)", "async function saveLoyalty(data)");
  const loyalty = functionBody(api, "async function saveLoyalty(data)", "apiRequest.resetSessionCache");
  for (const block of [profile, loyalty]) {
    assert.match(block, /writeBatch\(db\(\)\)/);
    assert.match(block, /batch\.update\(/);
    assert.match(block, /batch\.set\(doc\(db\(\), 'barbers', uid, 'publicMeta', 'professional'\)/);
    assert.match(block, /await batch\.commit\(\)/);
    assert.match(block, /invalidate\(\)/);
  }
});

test("customer profile edits read the current database version before appending the roster update", () => {
  const update = functionBody(api, "async function updateCustomer(data)", "async function disableCustomer(data)");
  assert.match(update, /transaction\.get\(customerRef\)/);
  assert.match(update, /transaction\.get\(rosterRef\)/);
  assert.match(update, /const fresh = \{ uid: id, \.\.\.customerSnap\.data\(\) \}/);
  assert.match(update, /const rosterCustomer = \{ \.\.\.fresh, \.\.\.updates/);
  assert.match(update, /appendCustomerRosterChange/);
});


test("roster events only reorder the directory when creation, removal, origin or sort fields change", () => {
  const decision = functionBody(html, "function directoryRosterChangesRequireReload", "function invalidateCustomerDirectoryPages");
  assert.match(decision, /changedFields/);
  assert.match(decision, /totalCuts/);
  assert.match(decision, /lastCutAt/);
  assert.match(decision, /signupSource/);
  assert.match(html, /clearAllAdminCustomersCaches\(\)/);
  assert.match(html, /customerRosterResync/ === false ? /never/ : /invalidateCustomerDirectoryPages/);
});

test("recording a visit emits a roster change and refreshes only one bounded directory page", () => {
  const visit = functionBody(api, "async function addCut(data)", "function customerListSort");
  const addCutUi = functionBody(html, "async function addCut(id, button)", "function contactClient");
  assert.match(visit, /transaction\.get\(rosterRef\)/);
  assert.match(visit, /appendCustomerRosterChange/);
  assert.match(visit, /lastCutAt/);
  assert.match(addCutUi, /state\.customerSearchResults\?\.find/);
  assert.match(addCutUi, /invalidateCustomerDirectoryPages\(\)/);
  assert.match(addCutUi, /ensureAdminCustomersLoaded\(\{force:true,reset:true\}\)/);
  assert.match(addCutUi, /No encontramos/ === false ? /never/ : /No se encontró al cliente seleccionado/);
});
