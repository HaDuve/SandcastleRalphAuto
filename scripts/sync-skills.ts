#!/usr/bin/env tsx
import { syncSkills, formatSyncReport } from "../src/prompts/sync.js";

const result = await syncSkills();
process.stdout.write(formatSyncReport(result));
