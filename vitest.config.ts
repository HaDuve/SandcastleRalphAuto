import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["tests/dashboard/setup.ts"],
    // Cap the fork pool so AFK runs don't spawn one heavy jsdom worker per
    // CPU core. Bounds peak RAM regardless of host core count.
    pool: "forks",
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
  },
});
