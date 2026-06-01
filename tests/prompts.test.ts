import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  CANONICAL_PHASES,
  formatSyncReport,
  parsePrompt,
  syncSkills,
} from "../src/prompts/index.js";

const PROMPTS_DIR = resolve("prompts");

describe("canonical phase prompts", () => {
  it("lists the linear pipeline phases without babysit", () => {
    expect(CANONICAL_PHASES).toEqual([
      "tdd",
      "create-pr",
      "review-pr",
      "review-tdd",
      "merge",
    ]);
  });
});

describe("buildPrompt", () => {
  it("wraps a skill body with the headless harness and snapshot markers", () => {
    const skill = "---\nname: tdd\n---\n\n# TDD\n";
    const prompt = buildPrompt("tdd", skill);

    expect(prompt).toContain("<!-- sandcastle-ralph:harness -->");
    expect(prompt).toContain("<!-- /sandcastle-ralph:harness -->");
    expect(prompt).toContain(
      "<!-- sandcastle-ralph:skill-snapshot source=~/.cursor/skills/tdd/SKILL.md -->",
    );
    expect(prompt).toContain("<!-- /sandcastle-ralph:skill-snapshot -->");
    expect(prompt).toContain(skill.trim());

    expect(prompt).toMatch(/current\.json/);
    expect(prompt).toMatch(/Do not ask questions/i);
    expect(prompt).toContain("<promise>PHASE_COMPLETE</promise>");

    const parsed = parsePrompt(prompt);
    expect(parsed.phase).toBe("tdd");
    expect(parsed.skillSnapshot).toBe(skill.trim());
    expect(parsed.harness).toMatch(/current\.json/);
  });
});

describe("committed prompts/*.md", () => {
  it.each(CANONICAL_PHASES.map((phase) => [phase]))(
    "%s exists with harness, skill snapshot, and completion signal",
    (phase) => {
      const path = resolve(PROMPTS_DIR, `${phase}.md`);
      const content = readFileSync(path, "utf8");
      const parsed = parsePrompt(content);

      expect(parsed.phase).toBe(phase);
      expect(parsed.harness).toMatch(/Do not ask questions/i);
      expect(parsed.harness).toContain("<promise>PHASE_COMPLETE</promise>");
      expect(parsed.skillSnapshot.length).toBeGreaterThan(0);
      expect(parsed.skillSnapshot).toMatch(/^---\nname: /);
    },
  );
});

describe("syncSkills", () => {
  async function fixtureRoots(): Promise<{
    skillsRoot: string;
    promptsDir: string;
  }> {
    const base = await mkdtemp(join(tmpdir(), "sync-skills-test-"));
    const skillsRoot = join(base, "skills");
    const promptsDir = join(base, "prompts");

    for (const phase of CANONICAL_PHASES) {
      const dir = join(skillsRoot, phase);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "SKILL.md"),
        `---\nname: ${phase}\n---\n\n# ${phase}\n`,
        "utf8",
      );
    }

    return { skillsRoot, promptsDir };
  }

  it("copies skill bodies into snapshots and reports when unchanged on re-run", async () => {
    const { skillsRoot, promptsDir } = await fixtureRoots();

    const first = await syncSkills({ skillsRoot, promptsDir });
    expect(first.phases.every((p) => p.changed)).toBe(true);
    expect(first.phases.every((p) => p.diff)).toBe(true);

    for (const phase of CANONICAL_PHASES) {
      const content = await readFile(join(promptsDir, `${phase}.md`), "utf8");
      expect(parsePrompt(content).skillSnapshot).toContain(`name: ${phase}`);
    }

    const second = await syncSkills({ skillsRoot, promptsDir });
    expect(second.phases.every((p) => !p.changed)).toBe(true);
    expect(second.phases.every((p) => p.diff === null)).toBe(true);
  });

  it("updates snapshots and includes a diff when a skill changes", async () => {
    const { skillsRoot, promptsDir } = await fixtureRoots();
    await syncSkills({ skillsRoot, promptsDir });

    await writeFile(
      join(skillsRoot, "tdd", "SKILL.md"),
      "---\nname: tdd\n---\n\n# TDD v2\n",
      "utf8",
    );

    const result = await syncSkills({ skillsRoot, promptsDir });
    const tdd = result.phases.find((p) => p.phase === "tdd");
    expect(tdd?.changed).toBe(true);
    expect(tdd?.diff).toMatch(/TDD v2/);

    const report = formatSyncReport(result);
    expect(report).toContain("tdd: updated");
    expect(report).toContain("TDD v2");
  });
});
