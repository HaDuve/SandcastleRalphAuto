#!/usr/bin/env tsx
import { join } from "node:path";
import { createDashboardServer } from "./createServer.js";

const rootDir = process.cwd();
const port = Number(process.env.PORT ?? 4173);
const host = "127.0.0.1";

const server = createDashboardServer({ rootDir });

server.listen(port, host, () => {
  console.log(`Dashboard listening on http://${host}:${port}`);
});
