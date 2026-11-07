import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_ROSTER_MAX_EVENTS, appendCustomerRosterChange,
  customerRosterDelta, applyCustomerRosterChanges
} from "../../customer-roster.mjs";

test("roster mutations get monotonic versions and retain only the latest bounded event window", () => {
  let roster = { version: 0, changes: [] };
  for (let i = 1; i <= CUSTOMER_ROSTER_MAX_EVENTS + 5; i++) {
    roster = appendCustomerRosterChange(roster, "created", { uid: "c" + i }, new Date(1_800_000_000_000 + i));
  }
  assert.equal(roster.version, CUSTOMER_ROSTER_MAX_EVENTS + 5);
  assert.equal(roster.changes.length, CUSTOMER_ROSTER_MAX_EVENTS);
  assert.equal(roster.changes[0].version, 6);
  assert.equal(roster.changes.at(-1).version, CUSTOMER_ROSTER_MAX_EVENTS + 5);
});

test("a cached client roster can replay a contiguous sequence without fetching the full collection", () => {
  let roster = { version: 0, changes: [] };
  roster = appendCustomerRosterChange(roster, "created", { uid: "one", active: true }, new Date(1_800_000_000_100));
  roster = appendCustomerRosterChange(roster, "created", { uid: "two", active: true }, new Date(1_800_000_000_200));
  const delta = customerRosterDelta(roster, 0, 1_800_000_000_000);
  assert.equal(delta.requiresReload, false);
  assert.deepEqual(delta.changes.map(item => item.customerId), ["one", "two"]);
  assert.deepEqual(applyCustomerRosterChanges([], delta.changes).map(item => item.uid), ["one", "two"]);
});

test("a known version gap is detected and asks for one bounded resynchronization", () => {
  const roster = {
    version: 10,
    changes: [
      { version: 8, action: "created", customerId: "eight", customer: { uid: "eight" } },
      { version: 9, action: "created", customerId: "nine", customer: { uid: "nine" } },
      { version: 10, action: "created", customerId: "ten", customer: { uid: "ten" } }
    ]
  };
  const delta = customerRosterDelta(roster, 3, 0);
  assert.equal(delta.requiresReload, true);
  assert.deepEqual(delta.changes, []);
});

test("a legacy cache uses timestamps when it predates versioned roster metadata", () => {
  const roster = {
    version: 2,
    changes: [
      { version: 1, action: "created", customerId: "old", customer: { uid: "old" }, changedAt: new Date(1000) },
      { version: 2, action: "created", customerId: "new", customer: { uid: "new" }, changedAt: new Date(3000) }
    ]
  };
  const delta = customerRosterDelta(roster, 0, 2000);
  assert.deepEqual(delta.changes.map(item => item.customerId), ["new"]);
  assert.equal(delta.requiresReload, false);
});

test("roster disable events remove a cached record without touching visit fields", () => {
  const original = { uid: "c1", totalCuts: 18, cycleCuts: 2, active: true };
  const changed = applyCustomerRosterChanges([original, { uid: "c2", totalCuts: 3 }], [
    { version: 1, action: "disabled", customerId: "c2" },
    { version: 2, action: "updated", customerId: "c1", customer: { uid: "c1", fullName: "Actualizado" } }
  ]);
  assert.deepEqual(changed, [{ ...original, fullName: "Actualizado" }]);
});


test("a cold barber session replays the latest bounded roster events without a cache timestamp", () => {
  let roster = { version: 0, changes: [] };
  for (let i = 1; i <= CUSTOMER_ROSTER_MAX_EVENTS; i++) {
    roster = appendCustomerRosterChange(
      roster, "created", { uid: "cold-" + i, active: true },
      new Date(1_800_000_000_000 + i)
    );
  }
  const delta = customerRosterDelta(roster, 0, 0);
  assert.equal(delta.requiresReload, false);
  assert.equal(delta.changes.length, CUSTOMER_ROSTER_MAX_EVENTS);
  assert.equal(applyCustomerRosterChanges([], delta.changes).length, CUSTOMER_ROSTER_MAX_EVENTS);
});
