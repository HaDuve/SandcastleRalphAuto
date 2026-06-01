import { beforeEach, describe, expect, it } from "vitest";
import {
  HIDDEN_IDS_STORAGE_KEY,
  pruneHiddenIds,
  readHiddenIds,
  writeHiddenIds,
} from "../../dashboard/src/hiddenProjects.js";

describe("hiddenProjects", () => {
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

  it("persists hidden project ids under hiddenIds", () => {
    writeHiddenIds(new Set(["portfolio", "other"]), storage);

    expect(storage.getItem(HIDDEN_IDS_STORAGE_KEY)).toBe(
      JSON.stringify(["portfolio", "other"]),
    );
    expect(readHiddenIds(storage)).toEqual(new Set(["portfolio", "other"]));
  });

  it("returns an empty set when nothing is stored", () => {
    expect(readHiddenIds(storage)).toEqual(new Set());
  });

  it("drops hidden ids that are not in the loaded project list", () => {
    const pruned = pruneHiddenIds(new Set(["portfolio", "removed"]), new Set(["portfolio", "other"]));

    expect(pruned).toEqual(new Set(["portfolio"]));
  });
});
