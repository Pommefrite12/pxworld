#!/usr/bin/env node
// Starts an isolated stack for the end-to-end tests: a fresh PostgreSQL database, an empty local storage
// folder and the Next.js dev server with mocked Stripe and dev sign-in (both impossible in production builds).
import { spawn, execFileSync } from "node:child_process";
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

const child = spawn("npx", ["next", "dev", "-p", PORT], {
  cwd: root,
  stdio: "inherit",
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
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop); process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
