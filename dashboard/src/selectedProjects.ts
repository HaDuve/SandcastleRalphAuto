export const SELECTED_IDS_STORAGE_KEY = "selectedIds";
export const FOCUSED_PROJECT_ID_STORAGE_KEY = "focusedProjectId";

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

export function readFocusedProjectId(storage: Storage = localStorage): string | null {
  try {
    const raw = storage.getItem(FOCUSED_PROJECT_ID_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeFocusedProjectId(
  projectId: string | null,
  storage: Storage = localStorage,
): void {
  if (projectId === null) {
    storage.removeItem(FOCUSED_PROJECT_ID_STORAGE_KEY);
    return;
  }
  storage.setItem(FOCUSED_PROJECT_ID_STORAGE_KEY, JSON.stringify(projectId));
}

export function resolveFocusedProjectId(
  selectedIds: ReadonlySet<string>,
  storedFocus: string | null,
): string | null {
  if (storedFocus && selectedIds.has(storedFocus)) {
    return storedFocus;
  }
  const [first] = selectedIds;
  return first ?? null;
}
