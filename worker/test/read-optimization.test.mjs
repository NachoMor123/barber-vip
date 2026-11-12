import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArsPrice, formatArsPriceInput } from "../../profile-utils.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const [html, api, cutsApi, customersApi, profileApi, worker, serviceWorker, rules, indexes, packageWorkflow] = await Promise.all([
  readFile(join(root, "index.html"), "utf8"),
  readFile(join(root, "spark-api.js"), "utf8"),
  readFile(join(root, "api", "cuts.js"), "utf8"),
  readFile(join(root, "api", "customers.js"), "utf8"),
  readFile(join(root, "api", "me.js"), "utf8"),
  readFile(join(root, "worker", "src", "index.js"), "utf8"),
  readFile(join(root, "sw.js"), "utf8"),
  readFile(join(root, "firestore.rules"), "utf8"),
  readFile(join(root, "firestore.indexes.json"), "utf8").then(JSON.parse),
  readFile(join(root, ".github", "workflows", "package-app.yml"), "utf8")
]);

function functionBody(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, `Missing function or marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `Missing boundary after: ${start}`);
  return source.slice(a, b);
}

test("legacy promotions and Push backends remain absent", async () => {
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
  assert.doesNotMatch(rules, /pushSubscriptions|match \/promotions\b/i);
});

test("Clients keeps the real latest-visit order and a single centered create action", () => {
  const clients = functionBody(html, "function clientsView()", "function renderSettings()");
  const list = functionBody(api, "async function listCustomers", "async function searchCustomers");
  assert.doesNotMatch(html, /customerSourceFilter|sortSelect|Todos los orígenes|Creados por vos|Registro directo/);
  assert.doesNotMatch(api, /customerListSort|customerDirectoryFilters|signupSource/);
  assert.match(list, /where\('active', '==', true\)/);
  assert.match(list, /orderBy\('lastCutAt', 'desc'\)/);
  assert.doesNotMatch(clients, /Tus clientes, ordenados por última visita/);
  assert.doesNotMatch(clients, /Mostramos los 10|cinco más|cargá cinco/);
  assert.match(clients, /data-action="new-client"/);
  assert.doesNotMatch(clients, /open-cut-modal|Registrar visita/);
  assert.doesNotMatch(clients, /Más visitas totales|Menos visitas totales|Todos los orígenes/);
});

test("directory cache persists across logout and is scoped by both Firebase UIDs", () => {
  assert.match(html, /barberVipAdminCustomers:v7:/);
  const key = functionBody(html, "function adminCustomersCacheKey()", "function customerDirectoryQueryKey()");
  assert.match(key, /state\.user\?\.uid/);
  assert.match(key, /state\.barberUid/);
  const restore = functionBody(html, "function restoreAdminCustomersCache()", "function clearAdminCustomersCache()");
  assert.match(restore, /cached\?\.ownerUid!==state\.user\.uid/);
  assert.match(restore, /cached\?\.barberUid!==state\.barberUid/);
  assert.match(restore, /cached\?\.directoryVersion/);
  assert.doesNotMatch(restore, /CACHE_TTL|24\*60\*60/);
  const logout = functionBody(html, "async function signOutAndReturn()", "function openCustomerModal");
  assert.doesNotMatch(logout, /clearAdminCustomersCache/);
  assert.match(html, /state\.customersLoadSeq/);
  assert.doesNotMatch(html, /customersDirectoryCheckSeq/);
});

test("directory starts with thirteen records and explicitly loads six-record cursor pages", () => {
  const loader = functionBody(html, "async function ensureAdminCustomersLoaded", "async function loadMoreAdminCustomers");
  const more = functionBody(html, "async function loadMoreAdminCustomers", "async function loadMoreCustomerSearch");
  const list = functionBody(api, "async function listCustomers", "async function searchCustomers");
  assert.match(html, /ADMIN_CUSTOMERS_FIRST_PAGE_SIZE=13/);
  assert.match(html, /ADMIN_CUSTOMERS_NEXT_PAGE_SIZE=6/);
  assert.match(loader, /pageSize:ADMIN_CUSTOMERS_FIRST_PAGE_SIZE/);
  assert.match(more, /pageSize:ADMIN_CUSTOMERS_NEXT_PAGE_SIZE/);
  assert.match(more, /const cursorId=String\(state\.customersCursorId\|\|''\),cursorValue=state\.customersCursorValue/);
  assert.match(more, /cursorId:state\.customersCursorId\|\|cursorId/);
  assert.match(more, /cursorValue:state\.customersCursorValue\?\?cursorValue/);
  assert.match(more, /refreshFirstPage/);
  assert.match(list, /Math\.min\(15, Number\(data\.pageSize\) \|\| 15\)/);
  assert.match(list, /limit\(pageSize \+ 1\)/);
  assert.match(list, /const hasMore = snap\.docs\.length > pageSize/);
  assert.match(list, /snap\.docs\.slice\(0, pageSize\)/);
  assert.match(list, /startAfter\(cursorValue, String\(data\.cursorId\)\)/);
  assert.doesNotMatch(list, /getCountFromServer|includeCount/);
  assert.match(html, /function observeCustomersPagination/);
});

test("scrolling alone never triggers a Firestore customer page read", () => {
  const loader = functionBody(html, "async function ensureAdminCustomersLoaded", "async function loadMoreAdminCustomers");
  const finalizer = loader.slice(loader.indexOf("}finally{"));
  const observer = functionBody(html, "function observeCustomersPagination()", "function renderApp()");
  assert.match(finalizer, /state\.customersLoading=false/);
  assert.match(finalizer, /if\(state\.section==='clients'&&document\.visibilityState==='visible'\)renderApp\(\)/);
  assert.ok(finalizer.indexOf("state.customersLoading=false") < finalizer.indexOf("renderApp()"));
  assert.match(observer, /Deliberately no automatic loading/);
  assert.doesNotMatch(observer, /new IntersectionObserver|loadMoreAdminCustomers\(\)|loadMoreCustomerSearch\(\)/);
});

test("six-record pagination uses an explicit button and a 3-second loading indicator", () => {
  const markup = functionBody(html, "function customerResultsMarkup", "function clientsView");
  const clients = functionBody(html, "function clientsView()", "function renderSettings()");
  assert.ok(markup.includes("customer-load-more-indicator"));
  assert.ok(markup.includes("Mostrar más"));
  assert.doesNotMatch(markup, /Mostrar 5|cinco más/);
  assert.ok(markup.includes("load-more-clients"));
  assert.ok(markup.includes("load-more-search"));
  assert.ok(markup.includes("Cargando más coincidencias"));
  assert.ok(markup.includes("Cargando más clientes"));
  assert.match(html, /CUSTOMER_PAGINATION_INDICATOR_MIN_MS=3000/);
  assert.match(html, /function keepCustomerPaginationIndicatorVisible\(startedAt\)/);
  const listPagination = functionBody(html, "async function loadMoreAdminCustomers()", "async function loadMoreCustomerSearch");
  const searchPagination = functionBody(html, "async function loadMoreCustomerSearch()", "async function runCustomerSearch");
  assert.match(listPagination, /await keepCustomerPaginationIndicatorVisible\(indicatorStartedAt\)/);
  assert.match(searchPagination, /await keepCustomerPaginationIndicatorVisible\(indicatorStartedAt\)/);
  assert.doesNotMatch(clients, /Tus clientes, ordenados por última visita/);
  assert.doesNotMatch(clients, /Mostramos los 10|cinco más|cargá cinco/);
  assert.doesNotMatch(clients, /open-cut-modal|Registrar visita/);
  assert.doesNotMatch(html, /customerLoadSentinel|customerSearchLoadSentinel/);
  assert.doesNotMatch(html, /clientsRefreshUntil|clientsRefreshCooldownTimer|startClientsRefreshCooldown|updateClientsRefreshControl|syncCustomerDirectory|clients-refresh-btn/);
});

test("list order is deterministic by last visit, with never-visited customers retained", () => {
  const defaults = functionBody(api, "function customerDefaults(", "function standardProgram");
  const list = functionBody(api, "async function listCustomers", "async function searchCustomers");
  assert.match(defaults, /lastCutAt: null/);
  assert.match(defaults, /createdAt: serverTimestamp\(\)/);
  assert.match(list, /orderBy\('lastCutAt', 'desc'\)/);
  assert.match(list, /orderBy\(documentId\(\), 'desc'\)/);
  assert.match(list, /cursorValue/);
  assert.match(list, /last\.data\(\)\.lastCutAt/);
});

test("customer search declares its collection reference and cannot throw ReferenceError", () => {
  const search = functionBody(api, "async function searchCustomers", "const apiRequest");
  assert.match(search, /const customersRef\s*=\s*collection\(db\(\),\s*'barbers',\s*uid,\s*'customers'\)/);
  assert.match(search, /query\(customersRef,\s*\.\.\.constraints\)/);
  assert.doesNotMatch(search, /query\(ref,/);
});

test("name and WhatsApp searches are prefix-based and capped at six matches", () => {
  const search = functionBody(api, "async function searchCustomers", "const apiRequest");
  const inputStart = html.indexOf("if(target.id==='clientSearch')");
  const inputEnd = html.indexOf("else if(['settingDisplayName'", inputStart);
  const input = html.slice(inputStart, inputEnd);
  assert.match(search, /Math\.min\(6, Number\(data\.pageSize\) \|\| 6\)/);
  assert.match(search, /where\(field, '>='/);
  assert.match(search, /where\(field, '<='/);
  assert.match(search, /rawDigits\.length < requiredDigits/);
  assert.match(search, /normalizeName\(term\)\.length < 2/);
  assert.match(search, /Date\.now\(\) \+ 5000/);
  assert.match(input, /term\.length>=2/);
  assert.match(input, /digits\.length<4/);
  assert.match(input, /setTimeout\(\(\)=>\{void runCustomerSearch\(term,'clients'\);\},350\)/);
  assert.match(html, /minDigits:isCut\?3:4/);
  assert.match(html, /minDigits:4/);
});

test("search and visit picker never read the full client collection", () => {
  const modal = functionBody(html, "function openCutModal()", "async function saveCustomerForm");
  const visit = functionBody(api, "async function addCut(data)", "async function listCustomers");
  assert.doesNotMatch(modal, /ensureAdminCustomersLoaded|collection\(state\.db/);
  assert.match(modal, /runCustomerSearch\(term,'cut'\)/);
  assert.match(visit, /transaction\.get\(customerRef\)/);
  assert.match(visit, /transaction\.get\(barberRef\)/);
  assert.doesNotMatch(visit, /getDocs\(|getCountFromServer|customerRoster/);
});

test("the directory revision is watched only while Clients or quick visit search is open", () => {
  const listener = functionBody(html, "function startAdminCustomersListener()", "function markCustomerDirectoryChanged");
  const load = functionBody(html, "async function loadContext(me)", "async function resumeSession");
  assert.ok(listener.includes("onSnapshot(directoryRef"));
  assert.ok(listener.includes("remoteVersion"));
  assert.ok(listener.includes("api.clearCustomerSearchCache"));
  assert.ok(listener.includes("document.visibilityState"));
  assert.ok(listener.includes("isAdminCustomerDirectorySurfaceOpen"));
  assert.equal(listener.includes("onSnapshot(collection("), false);
  assert.ok(load.includes("startAdminCustomersListener()"));
  assert.equal(load.includes("onSnapshot(rosterRef"), false);
  assert.doesNotMatch(api, /customerRoster|appendCustomerRosterChange/);
  assert.doesNotMatch(worker, /customerRoster|appendCustomerRosterChange/);
  assert.doesNotMatch(rules, /customerRoster/);
  assert.ok(rules.includes("match /customerDirectory"));
});
test("directory revisions carry a precise mutation descriptor for one-document synchronization", () => {
  const create = functionBody(api, "async function createCustomerForBarber", "async function updateCustomer");
  const update = functionBody(api, "async function updateCustomer", "async function deleteCustomer");
  const remove = functionBody(worker, "async function deleteCustomerAccount", "async function route");
  const visit = functionBody(api, "async function addCut(data)", "async function listCustomers");
  const migration = functionBody(api, "async function migrateCustomerDirectoryFieldsForBarber", "async function getMe");
  assert.match(create, /changeType: 'upsert'/);
  assert.match(create, /customerId: credential\.user\.uid/);
  assert.match(update, /changeType: 'upsert', customerId: id/);
  assert.match(remove, /changeType: "remove", customerId/);
  assert.match(visit, /changeType: 'upsert', customerId: id/);
  assert.match(migration, /changeType: 'refresh', customerId: ''/);
  assert.match(worker, /changeType: "upsert", customerId/);
  assert.match(worker, /"changeType", "customerId"/);
  assert.match(rules, /'changeType', 'customerId'/);
});

test("create and edit use transactions; permanent delete delegates to the secured Worker", () => {
  const create = functionBody(api, "async function createCustomerForBarber", "async function updateCustomer");
  const update = functionBody(api, "async function updateCustomer", "async function deleteCustomer");
  const remove = functionBody(api, "async function deleteCustomer", "async function addCut");
  const workerDelete = functionBody(worker, "async function deleteCustomerAccount", "async function route");
  assert.match(create, /limit\(1\)/);
  assert.match(update, /runTransaction\(db\(\)/);
  assert.match(update, /customerDirectory', 'state'/);
  assert.match(update, /increment\(1\)/);
  assert.match(update, /transaction\.get\(customerRef\)/);
  assert.match(update, /passwordResetFailed/);
  assert.match(remove, /workerRequest\('\/api\/customers\/delete'/);
  assert.match(workerDelete, /accounts:delete/);
  assert.match(workerDelete, /fsCommit\(env, writes\)/);
  assert.match(workerDelete, /changeType: "remove", customerId/);
  assert.doesNotMatch(remove, /active: false|disabledAt/);
});

test("a visit updates the loaded directory locally without a redundant first-page read", () => {
  const visit = functionBody(api, "async function addCut(data)", "async function listCustomers");
  const ui = functionBody(html, "async function addCut(id, button)", "function contactClient");
  const localUpdate = functionBody(html, "function applyCustomerVisitToDirectory", "function setAdminDirectoryVersion");
  const merge = functionBody(html, "function applyCustomerUpsertToDirectory", "function applyCustomerRemovalToDirectory");
  assert.match(visit, /transaction\.get\(customerRef\)/);
  assert.match(visit, /transaction\.get\(barberRef\)/);
  assert.match(visit, /lastCutAt: now/);
  assert.match(visit, /transaction\.set\(directoryRef,\s*\{\s*version: increment\(1\)/);
  assert.match(visit, /changeType: 'upsert', customerId: id/);
  assert.doesNotMatch(visit, /rosterRef|customerRoster/);
  assert.match(localUpdate, /applyCustomerUpsertToDirectory\(customer\)/);
  assert.match(merge, /compareCustomersByLastVisit/);
  assert.match(merge, /saveAdminCustomersCache\(\)/);
  assert.doesNotMatch(localUpdate, /ensureAdminCustomersLoaded|api\(['"]\/api\/customers\/list/);
  assert.match(ui, /applyCustomerVisitToDirectory\(result\.customer\)/);
  assert.doesNotMatch(ui, /markCustomerDirectoryChanged\(\{reorder:true\}\)/);
});

test("direct client registration commits the revision with the customer documents", () => {
  const signup = functionBody(worker, "async function registerCustomerAccount", "async function hmacHex");
  assert.match(signup, /customerDirectory\/state/);
  assert.match(signup, /fsGet\(env, directoryPath\)/);
  assert.match(signup, /directoryWrite/);
  assert.match(signup, /fsCommit\(env, \[\.\.\.customerWrites, lookupWrite, phoneLookupWrite, directoryWrite\]\)/);
  assert.doesNotMatch(signup, /customerRoster|signupSource/);
  assert.match(signup, /for \(let attempt = 0; attempt < 5/);
});

test("direct signup writes normalized search fields and last-visit defaults", () => {
  const signup = functionBody(worker, "async function registerCustomerAccount", "async function hmacHex");
  assert.match(signup, /usernameNormalized:\s*normalizedName/);
  assert.match(signup, /lastCutAt:\s*null/);
  assert.match(signup, /customerDirectory\/state/);
});

test("professional profile and loyalty settings use a separate cache scope", () => {
  const profile = functionBody(api, "async function saveProfile(data)", "async function saveLoyalty(data)");
  const loyalty = functionBody(api, "async function saveLoyalty(data)", "apiRequest.resetSessionCache");
  for (const source of [profile, loyalty]) {
    assert.match(source, /invalidateSessionCache\(\)/);
    assert.doesNotMatch(source, /clearCustomerSearchCache|customerDirectory/);
  }
  const changed = functionBody(html, "function markCustomerDirectoryChanged", "function adminCustomersRetryKey");
  assert.match(changed, /applyCustomerRemovalToDirectory/);
  assert.match(changed, /applyCustomerUpsertToDirectory/);
  assert.doesNotMatch(changed, /invalidateCustomerDirectoryPages/);
  assert.match(changed, /adminCustomersDirectoryRefreshPending=true/);
  assert.match(changed, /adminCustomersRefreshOnNextEntry=true/);
});

test("stale cycle flags cannot pin the barber or customer card at the final milestone", () => {
  const loyalty = functionBody(html, "function loyaltyPrograms(", "function safeExternalUrl");
  assert.match(loyalty, /function finalMilestoneApplied\(c\)\{return cycleCount\(c\)>=cycleLength\(c\);\}/);
  assert.doesNotMatch(loyalty, /cyclePausedAtMax|lastRewardAppliedOnFinalMilestone/);
  assert.doesNotMatch(loyalty, /if\(c\?\.lastRewardAppliedOnFinalMilestone===true\)return 100/);
  assert.match(loyalty, /if\(count>=max\)/);
});

test("PWA shell and production package cache the shared loyalty rules without shipping roster code or stale indexes", async () => {
  assert.match(serviceWorker, /v90-customer-document-id-authority/);
  assert.match(serviceWorker, /loyalty-core\.mjs/);
  assert.match(packageWorkflow, /loyalty-core\.mjs/);
  assert.doesNotMatch(serviceWorker, /customer-roster\.js|customerRoster/);
  assert.doesNotMatch(packageWorkflow, /customer-roster/);
  assert.equal(indexes.indexes.length, 3);
  assert.doesNotMatch(rules, /customerRoster/);
  await assert.rejects(access(join(root, "customer-roster.js")), error => error && error.code === "ENOENT");
  await assert.rejects(access(join(root, "customer-roster.mjs")), error => error && error.code === "ENOENT");
});


test("null lastCutAt cursors advance without reusing the previous page timestamp", () => {
  const more = functionBody(html, "async function loadMoreAdminCustomers()", "async function loadMoreCustomerSearch");
  assert.match(more, /Object\.prototype\.hasOwnProperty\.call\(page,'cursorValue'\)\?page\.cursorValue:state\.customersCursorValue/);
  assert.doesNotMatch(more, /page\.cursorValue\?\?state\.customersCursorValue/);
  assert.match(api, /lastCutAt: null/);
});

test("failed customer pages keep their cursor and expose an explicit retry", () => {
  const list = functionBody(html, "async function loadMoreAdminCustomers()", "async function loadMoreCustomerSearch");
  const search = functionBody(html, "async function loadMoreCustomerSearch()", "async function runCustomerSearch");
  const markup = functionBody(html, "function customerResultsMarkup", "function clientsView");
  assert.match(list, /customersPageError='No pudimos cargar/);
  assert.match(search, /customerSearchPageError='No pudimos cargar/);
  assert.doesNotMatch(list.slice(list.indexOf("}catch(error)"), list.indexOf("}finally")), /customersHasMore=false/);
  assert.doesNotMatch(search.slice(search.indexOf("}catch(error)"), search.indexOf("}finally")), /customerSearchHasMore=false/);
  assert.match(markup, /data-action=\"'\+retryAction\+'\"/);
  assert.match(html, /retry-more-clients/);
  assert.match(html, /retry-more-search/);
});

test("legacy customer directory fields are repaired once in bounded pages", () => {
  const migration = functionBody(api, "async function migrateCustomerDirectoryFieldsForBarber", "async function getMe");
  const getMe = functionBody(api, "async function getMe()", "async function ensureBarberProfile");
  assert.match(migration, /orderBy\(documentId\(\)\)/);
  assert.match(migration, /limit\(pageSize\)/);
  assert.match(migration, /lastCutAt/);
  assert.match(migration, /usernameNormalized/);
  assert.match(migration, /customerDirectoryFieldsMigratedAt/);
  assert.match(getMe, /migrateCustomerDirectoryFieldsForBarber\(barber\)/);
  assert.match(migration, /version: increment\(1\)/);
  assert.match(migration, /subscription\(barberData\)\.status === 'suspended'/);
});

test("visit retries are idempotent without adding a Firestore read", () => {
  const visit = functionBody(api, "async function addCut(data)", "async function listCustomers");
  const ui = functionBody(html, "async function addCut(id, button)", "function contactClient");
  assert.match(visit, /transaction\.get\(customerRef\)/);
  assert.match(visit, /customer\.lastCutOperationId === operationId/);
  assert.match(visit, /lastCutOperationId: operationId/);
  assert.match(visit, /outcome\.duplicate/);
  assert.match(ui, /getPendingCutOperationId\(id\)/);
  assert.match(ui, /operationId\}\}\)/);
  assert.match(ui, /clearPendingCutOperationId\(id\)/);
});

test("manual customer creation uses document-only transaction reads and an atomic phone uniqueness lock", () => {
  const create = functionBody(api, "async function createCustomerForBarber", "async function updateCustomer");
  assert.match(create, /transaction\.get\(lookupRef\)/);
  assert.match(create, /transaction\.get\(phoneLookupRef\)/);
  assert.match(create, /const legacyPhoneMatches = await getDocs\(phoneQuery\)/);
  assert.match(create, /transaction\.set\(phoneLookupRef/);
  assert.match(create, /'customerPhoneIndex'/);
  assert.doesNotMatch(create, /transaction\.get\(phoneQuery\)/);
  assert.doesNotMatch(create, /transaction\.get\([^)]*Query\)/);
});

test("customer edits maintain phone uniqueness; permanent delete releases all phone locks", () => {
  const update = functionBody(api, "async function updateCustomer", "async function deleteCustomer");
  const remove = functionBody(api, "async function deleteCustomer", "async function addCut");
  const workerDelete = functionBody(worker, "async function deleteCustomerAccount", "async function route");
  assert.match(update, /const phoneMatches = await getDocs\(phoneQuery\)/);
  assert.match(update, /transaction\.get\(newPhoneLookupRef\)/);
  assert.match(update, /transaction\.set\(newPhoneLookupRef/);
  assert.doesNotMatch(update, /transaction\.get\(phoneQuery\)/);
  assert.match(remove, /workerRequest\('\/api\/customers\/delete'/);
  assert.match(workerDelete, /fsQueryBarberCollection\(env, barber\.uid, "customerPhoneIndex", "uid", customerId/);
  assert.match(workerDelete, /phoneLookup\.data\?\.uid === customerId/);
  assert.doesNotMatch(workerDelete, /active: false|disabledAt/);
});

test("phone uniqueness indexes are private to the owning barber", () => {
  const phoneIndex = functionBody(rules, "match /customerPhoneIndex/{phoneId}", "match /customerDirectory/{metaId}");
  assert.match(phoneIndex, /allow get: if isOwner\(barberId\)/);
  assert.match(phoneIndex, /allow list: if false/);
  assert.match(phoneIndex, /customerExistsAfter\(barberId, request\.resource\.data\.uid\)/);
  assert.doesNotMatch(phoneIndex, /allow read: if true/);
});

test("customer identity changes cannot overwrite visit counters or cycle history", () => {
  const update = functionBody(api, "async function updateCustomer(data)", "async function deleteCustomer(data)");
  assert.match(update, /const fresh = \{ uid: id, \.\.\.customerSnap\.data\(\) \}/);
  assert.match(update, /transaction\.update\(customerRef, updates\)/);
  assert.doesNotMatch(update, /totalCuts\s*[:,=]|cycleCuts\s*[:,=]|actualCutsRegistered\s*[:,=]/);
});

test("customer card listener remains scoped to the signed-in customer's UID and barber", () => {
  const load = functionBody(html, "async function loadContext(me)", "async function resumeSession");
  assert.match(load, /const customerSessionUid=state\.user\?\.uid/);
  assert.match(load, /const customerBarberUid=me\.barberUid/);
  assert.match(load, /onSnapshot\(customerRef/);
  assert.match(load, /state\.user\?\.uid!==customerSessionUid/);
  assert.match(load, /state\.barberUid!==customerBarberUid/);
});

test("the three customer composite indexes cover visit ordering and both search prefixes", () => {
  const fields = indexes.indexes.map(index => (index.fields || []).map(field => field.fieldPath + ":" + field.order).join(","));
  assert.equal(fields.length, 3);
  assert.ok(fields.some(value => value.includes("active:ASCENDING") && value.includes("lastCutAt:DESCENDING")));
  assert.ok(fields.some(value => value.includes("active:ASCENDING") && value.includes("usernameNormalized:ASCENDING")));
  assert.ok(fields.some(value => value.includes("active:ASCENDING") && value.includes("whatsapp:ASCENDING")));
});


test("barber workspace uses Clients and Settings as the only navigation sections", () => {
  assert.match(html, /navItem\('clients'/);
  assert.match(html, /navItem\('settings'/);
  assert.doesNotMatch(html, /navItem\('home'/);
  assert.match(html, /readSectionPreference\('barber',me\.uid,\['clients','settings'\],'clients'\)/);
  const clients = functionBody(html, "function clientsView()", "function renderSettings()");
  assert.match(clients, /greetingForNow\(\)/);
  assert.doesNotMatch(clients, /open-cut-modal|Registrar visita/);
  assert.match(clients, /data-action="new-client"/);
  assert.match(html, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
});

test("mobile checkout return restores Firestore before resuming the barber session", () => {
  const sync = functionBody(html, "function syncFirestoreNetworkWithVisibility", "function adminShell");
  const resume = functionBody(html, "async function resumeSession", "async function signOutAndReturn");
  assert.match(sync, /forceResume/);
  assert.match(sync, /await enableNetwork\(state\.db\)/);
  assert.match(sync, /resumePaymentReturnSession/);
  assert.ok(resume.indexOf("await syncFirestoreNetworkWithVisibility") < resume.indexOf("api('/api/me')"));
  assert.match(resume, /state\.resumingSessionUid/);
  assert.match(html, /window\.addEventListener\('pageshow'/);
});

test("customer card cache is persistent and namespaced by customer UID plus barber UID", () => {
  const key = functionBody(api, "function customerCardCacheKey", "function readCustomerCardCache");
  const restore = functionBody(api, "function readCustomerCardCache", "function writeCustomerCardCache");
  const save = functionBody(api, "function writeCustomerCardCache", "function removeCustomerCardCache");
  assert.match(key, /barberVipCustomerCard:v1:/);
  assert.match(key, /encodeURIComponent\(String\(uid\)\)/);
  assert.match(key, /encodeURIComponent\(String\(barberUid\)\)/);
  assert.match(restore, /cached\?\.ownerUid !== uid/);
  assert.match(restore, /cached\?\.barberUid !== barberUid/);
  assert.match(restore, /cached\.customer\?\.uid !== uid/);
  assert.match(restore, /cached\.customer\?\.barberUid !== barberUid/);
  assert.match(save, /delete safeCustomer\.loginEmail/);
  assert.match(save, /delete safeCustomer\.usernameNormalized/);
  assert.match(save, /localStorage\.setItem/);
});

test("customer login reuses its own saved card before fetching the customer and public profile again", () => {
  const getMe = functionBody(api, "async function getMe()", "async function ensureBarberProfile");
  assert.match(getMe, /readCustomerCardCache\(uid, barberUid\)/);
  assert.ok(getMe.indexOf("readCustomerCardCache(uid, barberUid)") < getMe.indexOf("getDoc(doc(db(), 'barbers', barberUid, 'customers', uid))"));
  assert.match(getMe, /writeCustomerCardCache\(uid, barberUid, result\.customer, result\.barber\)/);
  const saveMethod = functionBody(api, "apiRequest.saveCustomerCardCache", "apiRequest.clearCustomerCardCache");
  assert.match(saveMethod, /state\.auth\?\.currentUser\?\.uid/);
});

test("customer card snapshots refresh only the active account cache and revoke disabled access", () => {
  const load = functionBody(html, "async function loadContext(me)", "async function resumeSession");
  assert.match(load, /const customerSessionUid=state\.user\?\.uid/);
  assert.match(load, /const customerBarberUid=me\.barberUid/);
  assert.match(load, /onSnapshot\(customerRef/);
  assert.match(load, /onSnapshot\(professionalMetaRef/);
  assert.match(load, /state\.user\?\.uid!==customerSessionUid/);
  assert.match(load, /state\.barberUid!==customerBarberUid/);
  assert.match(load, /api\.saveCustomerCardCache\?\.\(state\.customer,state\.barber\)/);
  assert.match(load, /api\.clearCustomerCardCache\?\.\(customerSessionUid,customerBarberUid\)/);
  assert.match(load, /state\.customerAccessRevoked=false/);
  const logout = functionBody(html, "async function signOutAndReturn()", "function openCustomerModal");
  assert.doesNotMatch(logout, /clearCustomerCardCache/);
});


test("barber listens only to one directory revision while Clients is visible", () => {
  const listener = functionBody(html, "function startAdminCustomersListener()", "function markCustomerDirectoryChanged");
  const clear = html.slice(html.indexOf("const clearListeners ="), html.indexOf("const cleanupContext", html.indexOf("const clearListeners =")));
  const visibilityStart = html.indexOf("document.addEventListener('visibilitychange'");
  const visibilityEnd = html.indexOf("window.addEventListener('pageshow'", visibilityStart);
  const visibility = html.slice(visibilityStart, visibilityEnd);
  const nav = html.slice(html.indexOf("else if(action==='nav')"), html.indexOf("else if(action==='load-more-clients')"));
  assert.match(listener, /onSnapshot\(directoryRef/);
  assert.match(listener, /isAdminCustomerDirectorySurfaceOpen/);
  assert.match(listener, /runCustomerSearch\(cutTerm,'cut'\)/);
  const quickModal = functionBody(html, "function openCutModal()", "async function saveCustomerForm");
  assert.match(quickModal, /startAdminCustomersListener\(\)/);
  assert.match(listener, /document\.visibilityState!=='visible'/);
  assert.match(listener, /state\.user\?\.uid!==accountUid/);
  assert.match(listener, /state\.barberUid!==barberUid/);
  assert.match(listener, /remoteVersion<=knownVersion/);
  assert.match(listener, /changeType==='upsert'/);
  assert.match(listener, /changeType==='remove'/);
  assert.match(listener, /remoteVersion===knownVersion\+1/);
  assert.match(listener, /getDoc\(customerRef\)/);
  assert.match(listener, /No pudimos actualizar un cliente visible/);
  assert.match(listener, /Several missed changes cannot be patched safely/);
  assert.match(listener, /ensureAdminCustomersLoaded/);
  assert.doesNotMatch(listener, /onSnapshot\(collection\(.*customers/);
  assert.match(clear, /stopAdminCustomersListener\(\)/);
  assert.match(visibility, /stopAdminCustomersListener\(\)/);
  assert.match(visibility, /syncFirestoreNetworkWithVisibility\(\)\.then/);
  assert.match(visibility, /startAdminCustomersListener\(\)/);
  assert.ok(visibility.indexOf("syncFirestoreNetworkWithVisibility().then") < visibility.indexOf("startAdminCustomersListener()"));
  assert.match(nav, /stopAdminCustomersListener\(\)/);
  assert.match(nav, /startAdminCustomersListener\(\)/);
});


test("the admin customer cache keeps up to 150 loaded records but exposes only thirteen on entry", () => {
  assert.match(html, /ADMIN_CUSTOMERS_CACHE_MAX_RECORDS=150/);
  const save = functionBody(html, "function saveAdminCustomersCache()", "function restoreAdminCustomersCache()");
  const restore = functionBody(html, "function restoreAdminCustomersCache()", "function clearAdminCustomersCache()");
  const reset = functionBody(html, "function resetAdminCustomersToFirstPage()", "function markCustomerDirectoryChanged");
  assert.match(save, /slice\(0,ADMIN_CUSTOMERS_CACHE_MAX_RECORDS\)/);
  assert.match(save, /cacheTruncated\?String\(cacheLastCustomer\?\.uid\|\|''\):state\.customersCursorId/);
  assert.match(restore, /restored\.slice\(0,ADMIN_CUSTOMERS_CACHE_MAX_RECORDS\)/);
  assert.match(restore, /state\.customersVisibleCount=Math\.min\(ADMIN_CUSTOMERS_FIRST_PAGE_SIZE,state\.customers\.length\)/);
  assert.match(restore, /state\.customersCursorId=String\(cached\.cursorId\|\|''\)/);
  assert.match(save, /firstPageSize:ADMIN_CUSTOMERS_FIRST_PAGE_SIZE/);
  assert.match(restore, /needsExpandedFirstPageRefresh/);
  assert.match(restore, /if\(!needsExpandedFirstPageRefresh\)saveAdminCustomersCache\(\)/);
  assert.match(reset, /state\.customersVisibleCount=Math\.min\(ADMIN_CUSTOMERS_FIRST_PAGE_SIZE,state\.customers\.length\)/);
  assert.doesNotMatch(reset, /state\.customers=state\.customers\.slice/);
  assert.match(reset, /saveAdminCustomersCache\(\)/);
});

test("previously loaded directory pages are revealed from cache without another Firestore request", () => {
  const more = functionBody(html, "async function loadMoreAdminCustomers()", "async function loadMoreCustomerSearch");
  const cachedBranch = more.slice(more.indexOf("if(revealCachedPages)"), more.indexOf("if(refreshFirstPage)"));
  assert.match(more, /const hasCachedPages=state\.customers\.length>visibleCount/);
  assert.match(more, /revealCachedPages=!refreshFirstPage&&hasCachedPages/);
  assert.match(cachedBranch, /keepCustomerPaginationIndicatorVisible\(indicatorStartedAt\)/);
  assert.match(cachedBranch, /state\.customersVisibleCount=Math\.min\(state\.customers\.length,visibleCount\+ADMIN_CUSTOMERS_NEXT_PAGE_SIZE\)/);
  assert.doesNotMatch(cachedBranch, /api\('\/api\/customers\/list/);
  assert.match(html, /state\.customersLoadingMoreFromCache\?'Mostrando más clientes/);
  const visible = functionBody(html, "function filteredCustomers()", "function clientStatus");
  assert.match(visible, /slice\(0,visibleCount\)/);
  const markup = functionBody(html, "function customerResultsMarkup", "function clientsView");
  assert.match(markup, /state\.customersVisibleCount<state\.customers\.length\|\|state\.customersHasMore/);
});

test("first-page customer load failures never masquerade as an empty directory", () => {
  const loader = functionBody(html, "async function ensureAdminCustomersLoaded", "const CUSTOMER_PAGINATION_INDICATOR_MIN_MS");
  const markup = functionBody(html, "function customerResultsMarkup", "function clientsView");
  assert.match(loader, /state\.customersLoadError=failure\.message/);
  assert.match(loader, /state\.customersLoadError=error\.message/);
  assert.match(markup, /const firstPageError=!searchTerm\?String\(state\.customersLoadError\|\|''\):''/);
  assert.match(markup, /No pudimos cargar tus clientes/);
  assert.match(markup, /data-action="retry-load-clients"/);
  assert.match(html, /action==='retry-load-clients'/);
});

test("leaving Clients resets pagination depth and re-entry checks one revision document", () => {
  const navStart = html.indexOf("else if(action==='nav')");
  const navEnd = html.indexOf("else if(action==='open-pip-help')", navStart);
  const nav = html.slice(navStart, navEnd);
  const listener = functionBody(html, "function startAdminCustomersListener()", "// Subscribe only while the Clients view");
  assert.match(nav, /resetAdminCustomersToFirstPage\(\)/);
  assert.match(nav, /adminCustomersAwaitingEntrySnapshot=true/);
  assert.match(nav, /if\(!state\.customersLoaded\)/);
  assert.doesNotMatch(nav, /directoryVersion!==cacheVersion/);
  assert.match(listener, /if\(adminCustomersAwaitingEntrySnapshot\)/);
  assert.match(listener, /adminCustomersRefreshOnNextEntry\|\|adminCustomersDirectoryRefreshPending/);
  assert.match(listener, /ensureAdminCustomersLoaded\(\{force:true,reset:true\}\)/);
});

test("a customer outside the unlocked page is deferred without reading its document", () => {
  const listener = functionBody(html, "function startAdminCustomersListener()", "// Subscribe only while the Clients view");
  const hiddenBranchStart = listener.indexOf("if(!customerIsVisible&&!canFillFirstPage)");
  const targetedRead = listener.indexOf("void getDoc(customerRef)");
  assert.ok(hiddenBranchStart >= 0);
  assert.ok(targetedRead > hiddenBranchStart);
  const hiddenBranch = listener.slice(hiddenBranchStart, listener.indexOf("const syncSeq", hiddenBranchStart));
  assert.match(hiddenBranch, /state\.customersDirectoryRefreshPending=true/);
  assert.match(hiddenBranch, /adminCustomersRefreshOnNextEntry=true/);
  assert.doesNotMatch(hiddenBranch, /getDoc\(customerRef\)/);
  assert.match(hiddenBranch, /refreshSearch\(\)/);
  assert.match(listener, /index<Math\.max\(0,Number\(state\.customersVisibleCount\)\|\|0\)/);
  const merge = functionBody(html, "function applyCustomerUpsertToDirectory", "function applyCustomerRemovalToDirectory");
  assert.match(merge, /priorIndex=complete\?state\.customers\.findIndex/);
  assert.match(merge, /priorIndex<visibleCount/);
  assert.match(merge, /adminCustomersDirectoryRefreshPending=true/);
  assert.match(merge, /state\.customersHasMore===false/);
  assert.match(merge, /state\.customers\.length<ADMIN_CUSTOMERS_FIRST_PAGE_SIZE/);
  assert.match(merge, /state\.customersVisibleCount=Math\.min\(ADMIN_CUSTOMERS_FIRST_PAGE_SIZE,state\.customers\.length\)/);
  assert.match(listener, /canFillFirstPage=state\.section==='clients'&&!state\.query\.trim\(\)/);
  assert.match(listener, /!modalRoot\.querySelector\('\.modal-backdrop'\)/);
});

test("a page is discarded when a directory revision changes while it is loading", () => {
  const more = functionBody(html, "async function loadMoreAdminCustomers()", "async function loadMoreCustomerSearch");
  assert.match(more, /directoryChangedDuringRequest=\(\)=>/);
  assert.match(more, /if\(directoryChangedDuringRequest\(\)\)\{deferStalePage\(\);return;\}/);
  assert.match(more, /adminCustomersDirectoryRefreshPending=true/);
  assert.match(more, /La lista cambió mientras se actualizaba/);
  assert.match(more, /refreshFirstPage=adminCustomersDirectoryRefreshPending/);
  assert.match(more, /customersDirectoryVersion\)\|\|0\)>Math\.max\(0,Number\(state\.customersCacheVersion/);
});

test("backgrounding and returning to the PWA resets the barber list to thirteen without losing its cache", () => {
  const visibilityStart = html.indexOf("document.addEventListener('visibilitychange'");
  const visibilityEnd = html.indexOf("window.addEventListener('pageshow'", visibilityStart);
  const visibility = html.slice(visibilityStart, visibilityEnd);
  const pageshowStart = visibilityEnd;
  const pageshowEnd = html.indexOf("function adminShell()", pageshowStart);
  const pageshow = html.slice(pageshowStart, pageshowEnd);
  const reset = functionBody(html, "function resetAdminCustomersToFirstPage()", "function markCustomerDirectoryChanged");
  assert.match(visibility, /document\.visibilityState==='hidden'/);
  assert.match(visibility, /resetAdminCustomersToFirstPage\(\)/);
  assert.match(visibility, /adminCustomersAwaitingEntrySnapshot=true/);
  assert.match(visibility, /if\(state\.role==='barber'&&state\.section==='clients'\)renderApp\(\)/);
  assert.match(pageshow, /if\(state\.role==='barber'&&state\.section==='clients'\)renderApp\(\)/);
  assert.match(reset, /state\.query=''/);
  assert.match(reset, /saveAdminCustomersCache\(\)/);
});


test("clearing a search reconciles deferred directory changes with one bounded first-page read", () => {
  const inputStart = html.indexOf("document.addEventListener('input'");
  const inputEnd = html.indexOf("document.addEventListener('change'", inputStart);
  const input = html.slice(inputStart, inputEnd);
  assert.match(input, /!term&&state\.role==='barber'/);
  assert.match(input, /adminCustomersDirectoryRefreshPending/);
  assert.match(input, /ensureAdminCustomersLoaded\(\{force:true,reset:true\}\)/);
});

test("manual creation can fill an incomplete first page locally without another read", () => {
  const merge = functionBody(html, "function applyCustomerUpsertToDirectory", "function applyCustomerRemovalToDirectory");
  assert.match(merge, /complete&&priorIndex<0&&state\.customersHasMore===false/);
  assert.match(merge, /state\.customers\.length<ADMIN_CUSTOMERS_FIRST_PAGE_SIZE/);
  assert.match(merge, /state\.customers=\[\.\.\.state\.customers,\{\.\.\.customer,uid:customerId\}\]/);
});
test("saving an edited hidden customer reconciles the visible directory without waiting for another click", () => {
  const save = functionBody(html, "async function saveCustomerForm(form)", "function collectSchedule");
  assert.match(save, /markCustomerDirectoryChanged\(\{customer:saved\}\)/);
  assert.match(save, /adminCustomersDirectoryRefreshPending/);
  assert.match(save, /ensureAdminCustomersLoaded\(\{force:true,reset:true\}\)/);
});

test("direct signup uses the Auth UID for metadata and atomically claims the normalized phone", () => {
  const signup = functionBody(worker, "async function registerCustomerAccount", "async function hmacHex");
  assert.match(signup, /customerDirectoryUpsertFields\(version, customerUid, now\)/);
  assert.doesNotMatch(signup, /changeType:\s*"upsert",\s*customerId\s*[,}]/);
  assert.match(signup, /customerPhoneIndex/);
  assert.match(signup, /const phoneLookupWrite/);
  assert.match(signup, /currentDocument:\s*latestPhoneLookup\?\.updateTime/);
  assert.match(signup, /fsCommit\(env, \[\.\.\.customerWrites, lookupWrite, phoneLookupWrite, directoryWrite\]\)/);
});

test("an unexpected empty customer page remains retryable instead of ending the directory", () => {
  const more = functionBody(html, "async function loadMoreAdminCustomers()", "async function loadMoreCustomerSearch");
  assert.match(more, /state\.customersHasMore=true/);
  assert.match(more, /No pudimos confirmar la siguiente página/);
  assert.match(more, /adminCustomersDirectoryRefreshPending=true/);
  assert.match(more, /adminCustomersRefreshOnNextEntry=true/);
});

test("Pip visibility is a persistent professional preference shared across devices", () => {
  const save = functionBody(api, "async function saveBarberPreferences", "async function saveProfile");
  const handler = html.slice(html.indexOf("if(target.id==='settingPipVisible')"), html.indexOf("if(firebaseConfigured())"));
  assert.match(save, /updateDoc\(doc\(db\(\), 'barbers', uid\)/);
  assert.match(save, /pipVisible: data\.pipVisible/);
  assert.match(html, /state\.barber\?\.pipVisible/);
  assert.match(handler, /api\('\/api\/preferences'/);
  assert.match(api, /path === '\/api\/preferences'/);
  assert.match(rules, /'theme', 'pipVisible'/);
  assert.match(rules, /request\.resource\.data\.pipVisible is bool/);
});

test("permanent customer deletion removes Firebase Auth, profile, customer and lookup indexes", () => {
  const remove = functionBody(worker, "async function deleteCustomerAccount", "async function route");
  assert.match(remove, /requireBarber\(env, request, false\)/);
  assert.match(remove, /accounts:delete/);
  assert.match(remove, /firestoreResourceName\(env, customerPath\)/);
  assert.match(remove, /firestoreResourceName\(env, profilePath\)/);
  assert.match(remove, /allLoginLookups/);
  assert.match(remove, /phoneLookups/);
  assert.match(remove, /writes\.push\(\{ delete:/);
  assert.match(remove, /changeType: "remove", customerId/);
  assert.match(worker, /path === "\/api\/customers\/delete"/);
});


test("service prices accept Argentine and international thousands separators without truncating values", () => {
  assert.equal(parseArsPrice("8.000"), 8000);
  assert.equal(parseArsPrice("5,000"), 5000);
  assert.equal(parseArsPrice("8000"), 8000);
  assert.equal(parseArsPrice("$ 1.250.000"), 1250000);
  assert.equal(parseArsPrice(""), null);
  assert.ok(Number.isNaN(parseArsPrice("8,00")));
  assert.ok(Number.isNaN(parseArsPrice("10.000.000.000")));
  assert.equal(formatArsPriceInput(8000), "8.000");
  assert.equal(formatArsPriceInput(5000), "5.000");
});

test("barber signup requests one display name and keeps credentials as account access fields", () => {
  const signup = functionBody(html, "function renderLogin(mode)", "async function renderCustomerSignup");
  assert.match(signup, /name="displayName"/);
  assert.match(signup, /label for="signupName">Tu nombre/);
  assert.match(signup, /Como dato personal, solo te pedimos tu nombre/);
  assert.doesNotMatch(signup, /name="barberName"/);
  assert.match(signup, /name="email"/);
  assert.match(signup, /barberNewPassword/);
});

test("Instagram profile editor explains that entering a handle builds its own link", () => {
  const modal = functionBody(html, "function openProfileModal()", "function collectLoyaltyPrograms");
  assert.match(modal, /placeholder="tuusuario"/);
  assert.match(modal, /genera el enlace a tu perfil automáticamente/);
});

test("Firestore retries only bounded read operations and never replays writes", () => {
  const fetcher = functionBody(worker, "async function firestoreFetch(", "async function fsRequest(");
  const request = functionBody(worker, "async function fsRequest(", "async function fsGet(");
  assert.match(fetcher, /readOnly \? 3 : 1/);
  assert.match(fetcher, /AbortSignal\.timeout\(10_000\)/);
  assert.match(fetcher, /FIRESTORE_RETRYABLE_STATUSES/);
  assert.match(request, /method === "GET" \|\| \(method === "POST" && path\.endsWith\(":runQuery"\)\)/);
});
