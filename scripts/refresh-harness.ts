#!/usr/bin/env tsx
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPrompt, parsePrompt } from "../src/prompts/build.js";
import { RUNNABLE_PHASES } from "../src/prompts/phases.js";

const promptsDir = join(process.cwd(), "prompts");

for (const phase of RUNNABLE_PHASES) {
  const path = join(promptsDir, `${phase}.md`);
  const content = await readFile(path, "utf8");
  const { skillSnapshot } = parsePrompt(content);
  await writeFile(path, `${buildPrompt(phase, skillSnapshot)}\n`, "utf8");
  process.stdout.write(`${phase}: harness refreshed\n`);
}
