export const CUSTOMER_ROSTER_MAX_EVENTS = 100;

function asMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value === "object") {
    const seconds = Number(value.seconds ?? value._seconds);
    const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
    if (Number.isFinite(seconds)) return seconds * 1000 + (Number.isFinite(nanos) ? nanos / 1e6 : 0);
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function appendCustomerRosterChange(current, action, customer, changedAt = new Date(), changedFields = null) {
  const previousVersion = Number(current?.version);
  const version = Number.isSafeInteger(previousVersion) && previousVersion >= 0 ? previousVersion + 1 : 1;
  const normalizedAction = String(action || "updated");
  const defaultFields = normalizedAction === "created"
    ? ["active", "signupSource", "totalCuts", "lastCutAt"]
    : (normalizedAction === "disabled" || normalizedAction === "deleted"
      ? ["active", "signupSource"] : []);
  const event = {
    version,
    action: normalizedAction,
    customerId: String(customer?.uid || ""),
    customer: customer && typeof customer === "object" ? customer : null,
    changedFields: Array.isArray(changedFields)
      ? [...new Set(changedFields.map(value => String(value)))]
      : defaultFields,
    changedAt
  };
  const previous = Array.isArray(current?.changes) ? current.changes : [];
  return {
    version,
    changes: [...previous, event].slice(-CUSTOMER_ROSTER_MAX_EVENTS),
    updatedAt: changedAt
  };
}

export function customerRosterDelta(roster, lastVersion = 0, cacheSavedAt = 0) {
  const version = Number(roster?.version);
  const currentVersion = Number.isSafeInteger(version) && version >= 0 ? version : 0;
  const raw = Array.isArray(roster?.changes) ? roster.changes : [];
  const changes = raw
    .filter(item => item && Number.isSafeInteger(Number(item.version)))
    .slice()
    .sort((a, b) => Number(a.version) - Number(b.version));

  if (lastVersion > 0) {
    if (currentVersion <= lastVersion) return { version: currentVersion, changes: [], requiresReload: false };
    const pending = changes.filter(item => Number(item.version) > lastVersion);
    const contiguous = pending.length === currentVersion - lastVersion
      && Number(pending[0]?.version) === lastVersion + 1
      && Number(pending[pending.length - 1]?.version) === currentVersion;
    return { version: currentVersion, changes: contiguous ? pending : [], requiresReload: !contiguous };
  }

  const savedAt = Number(cacheSavedAt);
  if (!Number.isFinite(savedAt) || savedAt <= 0) {
    return { version: currentVersion, changes: [], requiresReload: false };
  }
  const oldestMillis = changes.length ? asMillis(changes[0].changedAt) : 0;
  const possibleOverflow = changes.length >= CUSTOMER_ROSTER_MAX_EVENTS && oldestMillis > savedAt;
  if (possibleOverflow) return { version: currentVersion, changes: [], requiresReload: true };

  const pending = changes.filter(item => asMillis(item.changedAt) > savedAt);
  return { version: currentVersion, changes: pending, requiresReload: false };
}

export function applyCustomerRosterChanges(customers, changes) {
  const byId = new Map((Array.isArray(customers) ? customers : []).map(item => [String(item?.uid || ""), item]));
  for (const event of Array.isArray(changes) ? changes : []) {
    const id = String(event?.customerId || event?.customer?.uid || "");
    if (!id) continue;
    if (event.action === "deleted" || event.action === "disabled" || event.customer?.active === false) {
      byId.delete(id);
      continue;
    }
    if (event.customer && typeof event.customer === "object") {
      byId.set(id, { ...byId.get(id), ...event.customer, uid: id });
    }
  }
  return [...byId.values()];
}
