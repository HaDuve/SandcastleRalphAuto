import { beforeEach, describe, expect, it } from "vitest";
import {
  FOCUSED_PROJECT_ID_STORAGE_KEY,
  pruneSelectedIds,
  readFocusedProjectId,
  readSelectedIds,
  resolveFocusedProjectId,
  SELECTED_IDS_STORAGE_KEY,
  writeFocusedProjectId,
  writeSelectedIds,
} from "../../dashboard/src/selectedProjects.js";

describe("selectedProjects", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    const data = new Map<string, string>();
    storage.getItem = (key) => data.get(key) ?? null;
    storage.setItem = (key, value) => {
      data.set(key, value);
    };
    storage.removeItem = (key) => {
      data.delete(key);
    };
    storage.clear = () => {
      data.clear();
    };
    storage.key = (index) => [...data.keys()][index] ?? null;
    Object.defineProperty(storage, "length", {
      get: () => data.size,
    });
  });

  it("persists selected project ids under selectedIds", () => {
    writeSelectedIds(new Set(["portfolio", "other"]), storage);

    expect(storage.getItem(SELECTED_IDS_STORAGE_KEY)).toBe(
      JSON.stringify(["portfolio", "other"]),
    );
    expect(readSelectedIds(storage)).toEqual(new Set(["portfolio", "other"]));
  });

  it("returns an empty set when nothing is stored", () => {
    expect(readSelectedIds(storage)).toEqual(new Set());
  });

  it("drops selected ids that are not in the loaded project list", () => {
    const pruned = pruneSelectedIds(
      new Set(["portfolio", "removed"]),
      new Set(["portfolio", "other"]),
    );

    expect(pruned).toEqual(new Set(["portfolio"]));
  });

  it("persists the focused project id", () => {
    writeFocusedProjectId("portfolio", storage);

    expect(storage.getItem(FOCUSED_PROJECT_ID_STORAGE_KEY)).toBe(JSON.stringify("portfolio"));
    expect(readFocusedProjectId(storage)).toBe("portfolio");
  });

  it("resolves focus from storage when still selected", () => {
    expect(resolveFocusedProjectId(new Set(["portfolio", "other"]), "other")).toBe("other");
  });

  it("falls back to the first selected project when stored focus is stale", () => {
    expect(resolveFocusedProjectId(new Set(["portfolio", "other"]), "removed")).toBe("portfolio");
  });
});
