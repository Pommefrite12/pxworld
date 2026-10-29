#!/usr/bin/env bash
# Local PostgreSQL for development and tests (no Docker needed). Data lives in .data/pg.
#   bash scripts/local-db.sh start|stop|reset
# Listens on 127.0.0.1:54329, database "pixelworld", user "pixel" (password "pixel", local only).
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
[ -z "$PGBIN" ] && PGBIN=$(dirname "$(command -v pg_ctl)")
DATA="$PWD/.data/pg"
PORT="${PGPORT_LOCAL:-54329}"
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || { echo "need a 'postgres' user when running as root"; exit 1; }
  mkdir -p "$PWD/.data"; chown -R postgres "$PWD/.data" 2>/dev/null || true
  # postgres must be able to traverse the parents
  chmod o+x "$PWD" "$(dirname "$PWD")" 2>/dev/null || true
  RUNAS="su postgres -c"
fi
run() { if [ -n "$RUNAS" ]; then su postgres -c "$*"; else bash -c "$*"; fi; }

case "${1:-start}" in
  start)
    if [ ! -d "$DATA" ]; then
      run "$PGBIN/initdb -D '$DATA' -A trust -U postgres --encoding=UTF8 >/dev/null"
    fi
    run "$PGBIN/pg_ctl -D '$DATA' status >/dev/null 2>&1 || $PGBIN/pg_ctl -D '$DATA' -o '-p $PORT -k /tmp -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=200' -l '$DATA/server.log' -w start >/dev/null"
    run "psql -h 127.0.0.1 -p $PORT -U postgres -tc \"select 1 from pg_roles where rolname='pixel'\" | grep -q 1 || psql -h 127.0.0.1 -p $PORT -U postgres -c \"create role pixel superuser login password 'pixel'\" >/dev/null"
    run "psql -h 127.0.0.1 -p $PORT -U postgres -tc \"select 1 from pg_database where datname='pixelworld'\" | grep -q 1 || createdb -h 127.0.0.1 -p $PORT -U postgres -O pixel pixelworld"
    echo "postgres://pixel:pixel@127.0.0.1:$PORT/pixelworld"
    ;;
  stop) run "$PGBIN/pg_ctl -D '$DATA' -m fast stop" ;;
  reset) bash "$0" stop || true; rm -rf "$DATA"; bash "$0" start ;;
esac
