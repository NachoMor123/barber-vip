import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

test("Clients has one implicit order and no source/sort controls", () => {
  const clients = functionBody(html, "function clientsView()", "function renderSettings()");
  const list = functionBody(api, "async function listCustomers", "async function searchCustomers");
  assert.doesNotMatch(html, /customerSourceFilter|sortSelect|Todos los orígenes|Creados por vos|Registro directo/);
  assert.doesNotMatch(api, /customerListSort|customerDirectoryFilters|signupSource/);
  assert.match(list, /where\('active', '==', true\)/);
  assert.match(list, /orderBy\('lastCutAt', 'desc'\)/);
  assert.match(clients, /Los clientes con visita más reciente aparecen primero/);
  assert.doesNotMatch(clients, /Más visitas totales|Menos visitas totales|Última visita: más reciente|Todos los orígenes/);
});

test("directory cache persists across logout and is scoped by both Firebase UIDs", () => {
  assert.match(html, /barberVipAdminCustomers:v5:/);
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
  assert.match(html, /state\.customersDirectoryCheckSeq/);
});

test("the first directory page is 15 records, subsequent cursor pages are three", () => {
  const loader = functionBody(html, "async function ensureAdminCustomersLoaded", "async function loadMoreAdminCustomers");
  const more = functionBody(html, "async function loadMoreAdminCustomers", "async function loadMoreCustomerSearch");
  const list = functionBody(api, "async function listCustomers", "async function searchCustomers");
  assert.match(html, /ADMIN_CUSTOMERS_FIRST_PAGE_SIZE=15/);
  assert.match(html, /ADMIN_CUSTOMERS_NEXT_PAGE_SIZE=3/);
  assert.match(loader, /pageSize:ADMIN_CUSTOMERS_FIRST_PAGE_SIZE/);
  assert.match(more, /pageSize:ADMIN_CUSTOMERS_NEXT_PAGE_SIZE/);
  assert.match(more, /cursorId:state\.customersCursorId/);
  assert.match(list, /Math\.min\(15, Number\(data\.pageSize\) \|\| 15\)/);
  assert.match(list, /limit\(pageSize\)/);
  assert.match(list, /startAfter\(cursorValue, String\(data\.cursorId\)\)/);
  assert.doesNotMatch(list, /getCountFromServer|includeCount/);
  assert.match(html, /function observeCustomersPagination/);
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

test("name and WhatsApp searches are prefix-based and capped at five matches", () => {
  const search = functionBody(api, "async function searchCustomers", "const apiRequest");
  const inputStart = html.indexOf("if(target.id==='clientSearch')");
  const inputEnd = html.indexOf("else if(['settingDisplayName'", inputStart);
  const input = html.slice(inputStart, inputEnd);
  assert.match(search, /Math\.min\(5, Number\(data\.pageSize\) \|\| 5\)/);
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

test("the directory revision replaces the roster and is checked only on Clients entry", () => {
  const sync = functionBody(html, "async function syncCustomerDirectory", "function adminCustomersRetryKey");
  const load = functionBody(html, "async function loadContext(me)", "async function resumeSession");
  assert.match(sync, /getDoc\(doc\(state\.db,'barbers',barberUid,'customerDirectory','state'\)\)/);
  assert.match(sync, /remoteVersion/);
  assert.doesNotMatch(sync, /onSnapshot|setInterval|setTimeout/);
  assert.match(load, /startAdminCustomersListener\(\)/);
  assert.doesNotMatch(load, /onSnapshot\(rosterRef/);
  assert.doesNotMatch(api, /customerRoster|appendCustomerRosterChange/);
  assert.doesNotMatch(worker, /customerRoster|appendCustomerRosterChange/);
  assert.doesNotMatch(rules, /customerRoster/);
  assert.match(rules, /match \/customerDirectory/);
});

test("create, edit and disable increment the revision inside the same Firestore transaction", () => {
  const create = functionBody(api, "async function createCustomerForBarber", "async function updateCustomer");
  const update = functionBody(api, "async function updateCustomer", "async function disableCustomer");
  const disable = functionBody(api, "async function disableCustomer", "async function addCut");
  for (const source of [create, update, disable]) {
    assert.match(source, /runTransaction\(db\(\)/);
    assert.match(source, /customerDirectory', 'state'/);
    assert.match(source, /increment\(1\)/);
    assert.doesNotMatch(source, /customerRoster|signupSource/);
  }
  assert.match(create, /limit\(1\)/);
  assert.match(update, /transaction\.get\(customerRef\)/);
  assert.match(update, /passwordResetFailed/);
  assert.match(disable, /active: false/);
});

test("a visit uses two reads, updates lastCutAt and invalidates only the directory", () => {
  const visit = functionBody(api, "async function addCut(data)", "async function listCustomers");
  const ui = functionBody(html, "async function addCut(id, button)", "function contactClient");
  assert.match(visit, /transaction\.get\(customerRef\)/);
  assert.match(visit, /transaction\.get\(barberRef\)/);
  assert.match(visit, /lastCutAt: now/);
  assert.match(visit, /transaction\.set\(directoryRef, \{ version: increment\(1\)/);
  assert.doesNotMatch(visit, /rosterRef|customerRoster/);
  assert.match(ui, /markCustomerDirectoryChanged\(\{reorder:true\}\)/);
});

test("direct client registration commits the revision with the customer documents", () => {
  const signup = functionBody(worker, "async function registerCustomerAccount", "async function hmacHex");
  assert.match(signup, /customerDirectory\/state/);
  assert.match(signup, /fsGet\(env, directoryPath\)/);
  assert.match(signup, /directoryWrite/);
  assert.match(signup, /fsCommit\(env, \[\.\.\.customerWrites, lookupWrite, directoryWrite\]\)/);
  assert.doesNotMatch(signup, /customerRoster|signupSource/);
  assert.match(signup, /for \(let attempt = 0; attempt < 5/);
});

test("professional profile and loyalty settings use a separate cache scope", () => {
  const profile = functionBody(api, "async function saveProfile(data)", "async function saveLoyalty(data)");
  const loyalty = functionBody(api, "async function saveLoyalty(data)", "apiRequest.resetSessionCache");
  for (const source of [profile, loyalty]) {
    assert.match(source, /invalidateSessionCache\(\)/);
    assert.doesNotMatch(source, /clearCustomerSearchCache|customerDirectory/);
  }
  const changed = functionBody(html, "function markCustomerDirectoryChanged", "async function syncCustomerDirectory");
  assert.match(changed, /invalidateCustomerDirectoryPages/);
  assert.match(changed, /api\.clearCustomerSearchCache/);
});

test("PWA shell and production package no longer ship roster code or stale indexes", async () => {
  assert.match(serviceWorker, /v75-visit-first/);
  assert.doesNotMatch(serviceWorker, /customer-roster\.js|customerRoster/);
  assert.doesNotMatch(packageWorkflow, /customer-roster/);
  assert.equal(indexes.indexes.length, 3);
  assert.doesNotMatch(rules, /customerRoster/);
  await assert.rejects(access(join(root, "customer-roster.js")), error => error && error.code === "ENOENT");
  await assert.rejects(access(join(root, "customer-roster.mjs")), error => error && error.code === "ENOENT");
});

test("customer identity changes cannot overwrite visit counters or cycle history", () => {
  const update = functionBody(api, "async function updateCustomer(data)", "async function disableCustomer(data)");
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
  const listener = functionBody(html, "function startAdminCustomersListener()", "async function syncCustomerDirectory");
  const clear = html.slice(html.indexOf("const clearListeners ="), html.indexOf("const cleanupContext", html.indexOf("const clearListeners =")));
  const visibilityStart = html.indexOf("document.addEventListener('visibilitychange'");
  const visibilityEnd = html.indexOf("});", visibilityStart) + 3;
  const visibility = html.slice(visibilityStart, visibilityEnd);
  const nav = html.slice(html.indexOf("else if(action==='nav')"), html.indexOf("else if(action==='refresh-clients')"));
  assert.match(listener, /onSnapshot\(directoryRef/);
  assert.match(listener, /state\.section!=='clients'/);
  assert.match(listener, /document\.visibilityState!=='visible'/);
  assert.match(listener, /state\.user\?\.uid!==accountUid/);
  assert.match(listener, /state\.barberUid!==barberUid/);
  assert.match(listener, /remoteVersion<=knownVersion/);
  assert.match(listener, /ensureAdminCustomersLoaded/);
  assert.doesNotMatch(listener, /onSnapshot\(collection\(.*customers/);
  assert.match(clear, /stopAdminCustomersListener\(\)/);
  assert.match(visibility, /stopAdminCustomersListener\(\)/);
  assert.match(visibility, /startAdminCustomersListener\(\)/);
  assert.match(nav, /stopAdminCustomersListener\(\)/);
  assert.match(nav, /startAdminCustomersListener\(\)/);
});


test("directory cache restores every page already seen up to a safe record cap and resumes at its saved cursor", () => {
  assert.match(html, /ADMIN_CUSTOMERS_CACHE_MAX_RECORDS=150/);
  const serializer = functionBody(html, "function customerCursorValue", "function customerDirectoryQueryKey");
  assert.match(serializer, /toDate\(\)\.toISOString\(\)/);
  assert.match(serializer, /typeof value==='string'&&value\?value:null/);
  const save = functionBody(html, "function saveAdminCustomersCache()", "function restoreAdminCustomersCache()");
  assert.match(save, /slice\(0,ADMIN_CUSTOMERS_CACHE_MAX_RECORDS\)/);
  assert.match(save, /cacheTruncated\?String\(cacheLastCustomer\?\.uid\|\|''\):state\.customersCursorId/);
  assert.match(save, /cacheTruncated\?customerCursorValue\(cacheLastCustomer\):state\.customersCursorValue/);
  assert.match(save, /hasMore:cacheTruncated\|\|state\.customersHasMore/);
  const restore = functionBody(html, "function restoreAdminCustomersCache()", "function clearAdminCustomersCache()");
  assert.match(restore, /state\.customers=cached\.customers\.filter/);
  assert.match(restore, /state\.customersCursorId=String\(cached\.cursorId\|\|''\)/);
  assert.match(restore, /state\.customersCursorValue=cached\.cursorValue\?\?null/);
});