import { describe, expect, it } from "vitest";
import { fetchProjectQueue } from "../src/server/queue.js";
import { type Project } from "../src/registry/index.js";

const portfolio: Project = {
  id: "portfolio",
  path: "/tmp/portfolio",
  remote: "HaDuve/Portfolio",
  defaultBase: "main",
  afkLabel: "ready-for-agent",
  blockedLabels: ["needs-info"],
  autoMerge: true,
  concurrency: "single",
  sandbox: "none",
};

describe("fetchProjectQueue", () => {
  it("marks skipped and blocked issues as ineligible", async () => {
    const queue = await fetchProjectQueue(
      portfolio,
      "/tmp/state",
      async () =>
        JSON.stringify([
          {
            number: 10,
            title: "First slice",
            state: "OPEN",
            labels: [{ name: "ready-for-agent" }],
          },
          {
            number: 11,
            title: "Blocked slice",
            state: "OPEN",
            labels: [{ name: "ready-for-agent" }, { name: "needs-info" }],
          },
        ]),
      async () => [10],
    );

    expect(queue).toEqual([
      {
        number: 10,
        title: "First slice",
        labels: ["ready-for-agent"],
        skipped: true,
        eligible: false,
      },
      {
        number: 11,
        title: "Blocked slice",
        labels: ["ready-for-agent", "needs-info"],
        skipped: false,
        eligible: false,
      },
    ]);
  });

  it("omits title when gh does not return one", async () => {
    const queue = await fetchProjectQueue(
      portfolio,
      "/tmp/state",
      async () =>
        JSON.stringify([
          { number: 10, state: "OPEN", labels: [{ name: "ready-for-agent" }] },
        ]),
      async () => [],
    );

    expect(queue).toEqual([
      { number: 10, labels: ["ready-for-agent"], skipped: false, eligible: true },
    ]);
  });
});
