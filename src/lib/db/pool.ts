import "server-only";
import pg from "pg";
import { env } from "@/lib/env";

// Keep one pool per server instance (survives hot reload in dev).
const g = globalThis as unknown as { __pxPool?: pg.Pool };

// Return BIGINT/NUMERIC counts as JS numbers (all values here are far below 2^53).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

function create(): pg.Pool {
  const url = env().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const useSsl = env().DATABASE_SSL ? env().DATABASE_SSL === "true" : !local;
  const pool = new pg.Pool({
    connectionString: url,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 15_000,
  });
  pool.on("error", (err) => console.error("pg pool error", err.message));
  return pool;
}

export function pool(): pg.Pool {
  return (g.__pxPool ??= create());
}

export type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool().query<T>(sql, params)).rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(sql, params))[0] ?? null;
}

const RETRYABLE = new Set(["40P01", "40001"]); // deadlock_detected, serialization_failure

/** Runs `fn` in a transaction, retrying on deadlocks/serialisation failures. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    const c = await pool().connect();
    try {
      await c.query("begin");
      const out = await fn(c);
      await c.query("commit");
      return out;
    } catch (e) {
      await c.query("rollback").catch(() => undefined);
      if (i < attempts && RETRYABLE.has((e as { code?: string }).code ?? "")) continue;
      throw e;
    } finally {
      c.release();
    }
  }
}

/** Extracts the business error code ("px_parcel_unavailable") raised by the SQL functions, if any. */
export function pxError(e: unknown): string | null {
  const m = (e as { message?: string } | null)?.message;
  return m && /^px_[a-z_]+$/.test(m) ? m : null;
}
