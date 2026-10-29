#!/usr/bin/env node
// Starts an isolated stack for the end-to-end tests: a fresh PostgreSQL database, an empty local storage
// folder and the Next.js dev server with mocked Stripe and dev sign-in (both impossible in production builds).
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres";
const DB = "pixelworld_e2e";
const PORT = process.env.E2E_PORT ?? "3100";

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`drop database if exists ${DB} with (force)`);
await admin.query(`create database ${DB}`);
await admin.end();
const DATABASE_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${DB}`);
execFileSync("node", [path.join(root, "scripts/migrate.mjs"), "--shim"], { env: { ...process.env, DATABASE_URL }, stdio: "inherit" });
const storage = path.join(root, ".data/e2e-storage");
fs.rmSync(storage, { recursive: true, force: true });
fs.rmSync(path.join(root, ".next-e2e"), { recursive: true, force: true }); // never reuse a stale dev cache: it can make the dev server reload pages in a loop

const child = spawn("npx", ["next", "dev", "-p", PORT], {
  cwd: root,
  stdio: "inherit",
  detached: true, // own process group, so that stopping us stops Next.js too (npx would otherwise orphan it)
  env: {
    ...process.env,
    DATABASE_URL,
    NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
    DEV_AUTH: "true", NEXT_PUBLIC_DEV_AUTH: "true", DEV_AUTH_SECRET: "e2e-secret",
    STRIPE_MOCK: "true", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    LOCAL_STORAGE_DIR: storage,
    NEXT_DIST_DIR: ".next-e2e",
  },
});
const stop = () => { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ } };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
process.on("exit", stop);

// Warm the dev server (first compilation of each route is slow) before telling Playwright we are ready.
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(`${base}/api/stats`)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 1000));
}
for (const route of ["/", "/fr", "/discover", "/auth/sign-in", "/rules", "/api/map/tiles/0/0", "/api/map/raster/5/0/0", "/api/availability?x=0&y=0&w=10&h=10", "/sitemap.xml", "/robots.txt"]) {
  await fetch(base + route).catch(() => undefined);
}
http.createServer((_, res) => res.end("ready")).listen(Number(PORT) + 1);
