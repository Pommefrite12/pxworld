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

## The archive: export, integrity check, second copy

The archive is the point of the site, so it has its own preservation, separate from the backups above (which restore a *running site*). The
closing of an edition takes a **snapshot** (`edition_snapshots`: one line per parcel, with the sha256 of each creation's picture, and the sha256 of
the whole manifest; append-only: a retraction after the closing makes a NEW revision, the old one is never rewritten). From it:

```bash
# 1. a REHEARSAL, on the test site, any time before the closing (it says PREVIEW everywhere and is never an archive)
npm run archive:export -- --env .env.production.local --preview

# 2. the real export, after the closing (the latest snapshot; --revision N for another), a folder and a ZIP of it
npm run archive:export -- --env .env.production.local --zip

# 3. check it, with nothing but itself (no database, no storage)
npm run archive:verify -- --dir exports/<the folder>        # or: --zip exports/<the folder>.zip

# 4. check the LIVE site: every stored picture against the hash the snapshot recorded
npm run archive:verify -- --env .env.production.local
```

**What the export is.** A folder anybody can read **without our software**: `index.html` (the whole archive on one static page: no script, no
outside file), `creations/<code>.png`, `manifest.json` (byte for byte the text the database hashed: `sha256sum manifest.json` gives the recorded
hash), `manifest.sha256`, `manifest.csv` (for a spreadsheet; a text that starts with `= + - @` gets an apostrophe so that no formula can run),
`edition.json`, `retractions.json` (what an earlier snapshot held and this one no longer does), `terms/` (the terms of that day, a provisional text),
`README.txt` (English and French, with the commands to check it) and `SHA256SUMS` (`sha256sum -c SHA256SUMS`, or `shasum -a 256 -c` on macOS).

**What it refuses.** An archive that would quietly lack a picture is worse than none: if a creation's file is missing or does not match the hash in
the snapshot, or if the manifest in the database no longer matches the hash recorded with it, the export **writes nothing** and names the problems.
`--keep-going` makes it go on for the pictures only (the gaps are written in `PROBLEMS.txt` and the README); a manifest that does not match its hash
is never exported.

**What it does not do.** It only *reads* the database and the storage. It never closes an edition and never takes a snapshot (that is the closing, by
the clock or from `/admin/edition`). The ZIP is a plain one (at most 65 535 files and 4 GiB, stored, not compressed: the pictures are PNG already);
beyond that the script says so and the folder, which has no limit, stays the archive. The export holds what the public sees (usernames as shown,
titles, descriptions, categories, places, dates), no e-mail, no payment, no comment, no like.

**Second copy.** After the real export: copy the folder (or the ZIP, and write down its sha256, which the script prints) to a **second place that is
not the same provider or account** (another cloud storage, an external disk), read-only if the provider offers it (object lock / immutable bucket).
Then run `npm run archive:verify -- --dir …` on the *copy*. A copy that was never verified is not a backup.

**Restoring.** There are two different things:

1. *Restoring the running site* (an incident): the database dump and the bucket copy above. Then **prove the files are the ones the archive promised**:
   `npm run archive:verify -- --env <the restored site's env file>`. It must say `OK`. If it names pictures, restore them from the second copy of the
   bucket or from the export (`creations/<code>.png` has the same bytes as the stored file, whose key is `storage_path` in `manifest.json`).
2. *Handing the archive on* (the service ends, or somebody else takes it over): the export **is** the archive. It needs only a web browser and, to check
   it, `sha256sum`. It is not meant to be re-imported into a database: the live tables hold accounts, orders and payments that an archive must not carry.

**Drill, once a year:** make a fresh export (`--preview` is enough before the closing), verify the folder, verify the ZIP, restore the last database dump
into a scratch database, and run `archive:verify` against it. Write the date down in the launch checklist.

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
