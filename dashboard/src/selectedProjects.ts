export const SELECTED_IDS_STORAGE_KEY = "selectedIds";

export function readSelectedIds(storage: Storage = localStorage): Set<string> {
  try {
    const raw = storage.getItem(SELECTED_IDS_STORAGE_KEY);
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

export function writeSelectedIds(ids: Set<string>, storage: Storage = localStorage): void {
  storage.setItem(SELECTED_IDS_STORAGE_KEY, JSON.stringify([...ids]));
}

export function pruneSelectedIds(
  selectedIds: Set<string>,
  knownProjectIds: ReadonlySet<string>,
): Set<string> {
  return new Set([...selectedIds].filter((id) => knownProjectIds.has(id)));
}
