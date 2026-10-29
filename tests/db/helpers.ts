import pg from "pg";

const adminUrl = process.env.TEST_ADMIN_URL!;
const dbName = `pxtest_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
{
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName} template ${process.env.TEST_TEMPLATE_DB}`);
  await admin.end();
}
export const databaseUrl = adminUrl.replace(/\/[^/]*$/, `/${dbName}`);
export const pool = new pg.Pool({ connectionString: databaseUrl, max: 60 });
pool.on("error", () => undefined); // idle clients may be terminated when the database is dropped

/** Call from afterAll: closes the pool and drops this file's private database. */
export async function closeDb() {
  await pool.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
}

let seq = 0;
export async function createUser(name?: string, opts: { role?: "moderator" | "admin" } = {}): Promise<string> {
  const n = `${name ?? "user"}${++seq}_${Math.random().toString(36).slice(2, 6)}`;
  const { rows } = await pool.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('username', $2::text)) returning id`,
    [`${n}@example.test`, n],
  );
  const id = rows[0].id as string;
  if (opts.role) await pool.query(`insert into public.admin_roles (user_id, role) values ($1, $2)`, [id, opts.role]);
  return id;
}

export async function resetData() {
  await pool.query(`truncate public.parcels, public.rate_limits, public.stripe_events, public.audit_logs, public.moderation_actions restart identity cascade`);
  await pool.query(`update public.app_settings set value = '100'::jsonb where key = 'price_unit_cents'`);
  await pool.query(`update public.app_settings set value = 'true'::jsonb where key = 'sales_open'`);
}

export type Rect = { x: number; y: number; w: number; h: number };

export async function startOrder(user: string, r: Rect) {
  const { rows } = await pool.query(`select * from public.px_start_order($1, $2, $3, $4, $5)`, [user, r.x, r.y, r.w, r.h]);
  return rows[0] as {
    order_id: string; parcel_id: string; reservation_id: string; amount_cents: string;
    unit_price_cents: number; currency: string; expires_at: Date;
  };
}

export async function fulfill(orderId: string, over: Partial<{ subtotal: number; currency: string; pi: string }> = {}) {
  const { rows: [o] } = await pool.query(`select amount_cents, stripe_checkout_session_id from public.orders where id = $1`, [orderId]);
  const subtotal = over.subtotal ?? Number(o.amount_cents);
  const { rows } = await pool.query(
    `select public.px_fulfill_order($1, null, $2, $3, $4, 0, $4, $5, 'buyer@example.test', 'FR', 'Buyer', '[]'::jsonb) as outcome`,
    [orderId, over.pi ?? `pi_${orderId}`, `ch_${orderId}`, subtotal, over.currency ?? "eur"],
  );
  return rows[0].outcome as string;
}

/** Runs `fn` inside a transaction as a Supabase-like role (anon / authenticated), then rolls back. */
export async function asRole<T>(role: "anon" | "authenticated", userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    if (userId) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
}

export async function expectPgError(p: Promise<unknown>, match: RegExp | string): Promise<void> {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; code?: string };
    const text = `${err.code ?? ""} ${err.message ?? ""}`;
    if (typeof match === "string" ? text.includes(match) : match.test(text)) return;
    throw new Error(`Expected error matching ${String(match)} but got: ${text}`);
  }
  throw new Error(`Expected error matching ${String(match)} but the statement succeeded`);
}

export async function overlappingPairs(): Promise<number> {
  const { rows } = await pool.query(`
    select count(*)::int as n from public.parcels a join public.parcels b on a.id < b.id and a.bbox && b.bbox
     where a.status in ('reserved','active') and b.status in ('reserved','active')`);
  return rows[0].n as number;
}
