import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [api, html, serviceWorker] = await Promise.all([
  readFile(join(root, "spark-api.js"), "utf8"),
  readFile(join(root, "index.html"), "utf8"),
  readFile(join(root, "sw.js"), "utf8")
]);

function functionBody(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, `Missing function or marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `Missing boundary after: ${start}`);
  return source.slice(a, b);
}

test("Firestore document IDs override any stale uid stored inside customer data", () => {
  const mapper = functionBody(api, "function customerFromSnapshot(", "async function listCustomers");
  const list = functionBody(api, "async function listCustomers", "async function searchCustomers");
  const search = functionBody(api, "async function searchCustomers", "const apiRequest");

  assert.match(mapper, /return \{ \.\.\.data, uid: item\.id \};/);
  assert.match(list, /customerFromSnapshot\(item\)/);
  assert.match(search, /customerFromSnapshot\(item\)/);
  assert.doesNotMatch(list, /uid: item\.id, \.\.\.item\.data\(\)/);
  assert.doesNotMatch(search, /uid: item\.id, \.\.\.item\.data\(\)/);
});

test("a visit targets and returns the selected Firestore document, never a stored UID", () => {
  const uiRow = functionBody(html, "function clientRow(c)", "function profileCompletion");
  const uiVisit = functionBody(html, "async function addCut(id, button)", "function contactClient");
  const transaction = functionBody(api, "async function addCut(data)", "function customerFromSnapshot");

  assert.match(uiRow, /data-action="add-cut" data-id="\$\{escapeHtml\(id\)\}"/);
  assert.match(uiVisit, /customerId:id/);
  assert.match(transaction, /const id = cleanText\(data\.customerId, 100\)/);
  assert.match(transaction, /doc\(db\(\), 'barbers', uid, 'customers', id\)/);
  const updates = functionBody(transaction, "const updates = {", "transaction.update(customerRef, updates);");
  assert.doesNotMatch(updates, /^\s*(uid|barberUid):/m);
  assert.match(transaction, /transaction\.update\(customerRef, updates\)/);
  assert.match(transaction, /resultCustomer = \{\s*\.\.\.customer, uid: id\s*\}/);
});

test("the persistent directory cache and installed PWA cannot restore the previous identity mapping", () => {
  assert.match(html, /barberVipAdminCustomers:v7:/);
  assert.doesNotMatch(html, /barberVipAdminCustomers:v6:/);
  assert.match(serviceWorker, /v90-customer-document-id-authority/);
});
