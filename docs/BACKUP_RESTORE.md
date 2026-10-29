# Backup and restore strategy

**What must be recoverable:** parcels/orders/payments (money), creations (files + metadata), audit/moderation records (legal), profiles.

| Asset | Backup | Target |
|---|---|---|
| PostgreSQL | Supabase **daily backups** (Pro) + **Point-in-Time Recovery** add-on (recommended before launch) | RPO ≤ 5 min with PITR; RTO ≈ 1 h |
| Extra logical dump | weekly `pg_dump -Fc` to an independent bucket (different provider/account) | defence against account-level loss |
| Storage bucket `pixel-world-creations` | nightly copy to a second bucket/provider (`rclone sync` with the Supabase S3-compatible endpoint) | files are immutable (`<parcel>/<ts>-<hash>.png`), so an incremental copy is cheap |
| Stripe | Stripe is the system of record for payments; `payments`/`orders` mirror it. Export monthly (Dashboard → Reports) for accounting | |
| Configuration | everything in Git (migrations, code); secrets in a password manager | |

## Logical dump / restore

```bash
# dump (schema + data), from a trusted machine
pg_dump "$DATABASE_URL" --no-owner --no-privileges -Fc -f pixelworld-$(date +%F).dump

# restore into a fresh database (verify BEFORE you need it)
createdb pixelworld_restore
pg_restore --no-owner --dbname pixelworld_restore pixelworld-2026-10-29.dump
```

Restoring to Supabase: restore into a new project (same migrations), then point `DATABASE_URL` and the Supabase keys at it.
The `auth.users` rows must be restored together with `public.*` (profiles reference them): use Supabase's project-level restore or dump the `auth` schema too.

## Recovery procedure after an incident

1. Put the site in **sales-closed** mode (`/admin/settings` → "Sales are open" off, or `update app_settings … 'sales_open' = false`).
2. Restore the database (PITR to just before the incident, or the last dump) and the storage bucket.
3. Run `select * from public.px_expire_reservations();` then trigger `/api/cron/maintenance` — it releases lapsed holds,
   recovers payments whose webhook was lost (asks Stripe), and retries pending refunds.
4. Reconcile: in Stripe, list successful payments for the outage window; any order still `pending`/`refund_required` is
   shown in `/admin/orders`. Stripe can replay events (Dashboard → Webhooks → resend) — the handler is idempotent.
5. Verify the invariant: `select count(*) from parcels a join parcels b on a.id < b.id and a.bbox && b.bbox where a.status in ('reserved','active') and b.status in ('reserved','active');` must be **0** (the constraint guarantees it, the query proves the restore).
6. Re-open sales.

## Drills

Restore the latest dump into a scratch database once a quarter and run the integrity query above plus
`select * from public.px_public_stats();`.
