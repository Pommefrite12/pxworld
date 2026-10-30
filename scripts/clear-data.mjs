#!/usr/bin/env node
// Deletes every parcel, order, payment, creation and moderation record of a DEVELOPMENT database (accounts and
// settings are kept) and bumps the map version so browsers drop their tile caches.
//
// Why it exists: the world grid changed shape (see supabase/migrations/20261029000005_grid_mercator.sql), so parcels
// bought on the old grid would sit on the wrong place of the new map. Refuses to touch anything but a local database.
//
//   npm run data:clear -- --yes
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/pixelworld";
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
  console.error(`Refusing to clear a database on "${host}": this script only runs against a local development database.`);
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.error(`This deletes ALL parcels, orders, payments and creations from ${host}. Run again with --yes to confirm:\n  npm run data:clear -- --yes`);
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("begin");
  await client.query("truncate public.parcels, public.stripe_events, public.moderation_actions, public.moderation_reports restart identity cascade");
  await client.query("update public.map_state set version = version + 1, updated_at = now() where id = 1");
  await client.query("commit");
  const { rows } = await client.query("select count(*)::int as n from public.parcels");
  console.log(`done: ${rows[0].n} parcels left on ${host}`);
} catch (e) {
  await client.query("rollback");
  throw e;
} finally {
  await client.end();
}
