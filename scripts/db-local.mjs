// Is this DATABASE_URL a database on the developer's own machine / private compose network?
// Same rule as src/lib/db/ssl.ts: `localhost`, `127.0.0.1`, `::1`, or a bare service name (`db`). Anything with a dot in its
// host name (db.xyz.supabase.co, an IP address that is not 127.0.0.1…) is treated as remote.
export function isLocalDatabase(databaseUrl) {
  let host;
  try { host = new URL(databaseUrl).hostname; } catch { return false; }
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || !host.includes(".");
}
