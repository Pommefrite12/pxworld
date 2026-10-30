#!/usr/bin/env bash
# One-time setup of a development container / GitHub Codespace.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Installing dependencies (about 2 minutes)…"
npm ci --no-audit --no-fund

[ -f .env.local ] || cp .env.example .env.local

# In a Codespace the browser reaches the site through a public forwarded URL, not localhost.
if [ -n "${CODESPACE_NAME:-}" ]; then
  url="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  sed -i "s#^NEXT_PUBLIC_SITE_URL=.*#NEXT_PUBLIC_SITE_URL=${url}#" .env.local
  echo "▶ Site URL: ${url}"
fi

echo "▶ Waiting for PostgreSQL…"
ready=0
for _ in $(seq 1 60); do
  if node -e "const pg=require('pg');const c=new pg.Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.end()).then(()=>process.exit(0),()=>process.exit(1))"; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "PostgreSQL did not start in time"; exit 1; }

echo "▶ Creating the database tables…"
node scripts/migrate.mjs --shim

echo "✔ Setup complete. The site starts automatically; open the PORTS tab and click the globe next to port 3000."
