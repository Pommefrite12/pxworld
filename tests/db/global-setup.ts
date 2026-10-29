import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres";
const DB_NAME = `pixelworld_tpl_${process.pid}`;

/** Builds a TEMPLATE database (shim + every migration). Each test file clones it, so files are isolated and can run in parallel. */
export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(
      `Cannot reach PostgreSQL at ${ADMIN_URL}. Start one with "npm run db:local" (or set TEST_PG_ADMIN_URL).\n${String(e)}`,
    );
  }
  await admin.query(`create database ${DB_NAME}`);
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${DB_NAME}`);
  execFileSync("node", [path.resolve(__dirname, "../../scripts/migrate.mjs"), "--shim"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  process.env.TEST_TEMPLATE_DB = DB_NAME;
  process.env.TEST_ADMIN_URL = ADMIN_URL;
  return async () => {
    await admin.query(`drop database if exists ${DB_NAME} with (force)`);
    await admin.end();
  };
}
