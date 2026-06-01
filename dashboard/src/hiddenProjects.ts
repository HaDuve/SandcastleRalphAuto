export const HIDDEN_IDS_STORAGE_KEY = "hiddenIds";

export function readHiddenIds(storage: Storage = localStorage): Set<string> {
  try {
    const raw = storage.getItem(HIDDEN_IDS_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function writeHiddenIds(ids: Set<string>, storage: Storage = localStorage): void {
  storage.setItem(HIDDEN_IDS_STORAGE_KEY, JSON.stringify([...ids]));
}

export function pruneHiddenIds(
  hiddenIds: Set<string>,
  knownProjectIds: ReadonlySet<string>,
): Set<string> {
  return new Set([...hiddenIds].filter((id) => knownProjectIds.has(id)));
}
