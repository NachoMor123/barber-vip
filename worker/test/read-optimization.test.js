import test from "node:test";
import assert from "node:assert/strict";
import { buildQueryPageRequest, filterCustomerSubscriptions } from "../src/index.js";

test("promotion fan-out pages by document cursor without an offset scan", () => {
  const cursor = "projects/barbervip-309dc/databases/(default)/documents/pushSubscriptions/device-015";
  const request = buildQueryPageRequest("pushSubscriptions", "barberUid", "barber-123", 50, cursor);
  const query = request.structuredQuery;

  assert.equal(query.limit, 5, "free Worker pages stay small enough for the subrequest budget");
  assert.deepEqual(query.from, [{ collectionId: "pushSubscriptions" }]);
  assert.deepEqual(query.where.fieldFilter, {
    field: { fieldPath: "barberUid" },
    op: "EQUAL",
    value: { stringValue: "barber-123" }
  });
  assert.deepEqual(query.orderBy, [
    { field: { fieldPath: "__name__" }, direction: "ASCENDING" }
  ]);
  assert.deepEqual(query.startAt, {
    values: [{ referenceValue: cursor }],
    before: false
  });
  assert.equal("offset" in query, false);
});

test("first promotion fan-out page starts at the beginning", () => {
  const query = buildQueryPageRequest("pushSubscriptions", "barberUid", "barber-123").structuredQuery;
  assert.equal(query.limit, 5);
  assert.equal("startAt" in query, false);
});

test("visit notifications return only this barber's enabled devices for this customer", () => {
  const docs = [
    { path: "pushSubscriptions/a", data: { barberUid: "barber-A", customerId: "customer-1", enabled: true } },
    { path: "pushSubscriptions/b", data: { barberUid: "barber-A", customerId: "customer-2", enabled: true } },
    { path: "pushSubscriptions/c", data: { barberUid: "barber-B", customerId: "customer-1", enabled: true } },
    { path: "pushSubscriptions/d", data: { barberUid: "barber-A", customerId: "customer-1", enabled: false } }
  ];

  const targets = filterCustomerSubscriptions(docs, "barber-A", "customer-1", true);
  assert.deepEqual(targets.map(doc => doc.path), ["pushSubscriptions/a"]);
});

test("customer subscription cleanup includes disabled devices but never another barber's devices", () => {
  const docs = [
    { path: "pushSubscriptions/a", data: { barberUid: "barber-A", customerId: "customer-1", enabled: true } },
    { path: "pushSubscriptions/b", data: { barberUid: "barber-A", customerId: "customer-1", enabled: false } },
    { path: "pushSubscriptions/c", data: { barberUid: "barber-B", customerId: "customer-1", enabled: true } }
  ];

  const targets = filterCustomerSubscriptions(docs, "barber-A", "customer-1", false);
  assert.deepEqual(targets.map(doc => doc.path), ["pushSubscriptions/a", "pushSubscriptions/b"]);
});
