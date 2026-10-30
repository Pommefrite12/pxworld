/**
 * Should the PostgreSQL connection use TLS?
 *
 * Managed databases (Supabase, Neon, RDS…) are reached through a public host name such as `db.xyz.supabase.co`: TLS on.
 * A development database is reached as `localhost`, `127.0.0.1` or — in Docker Compose / GitHub Codespaces — through
 * the bare service name (`db`): those never leave the machine/private network and do not speak TLS, so TLS is off.
 * `DATABASE_SSL=true|false` always wins.
 */
export function shouldUseSsl(databaseUrl: string, override?: string | null): boolean {
  if (override === "true") return true;
  if (override === "false") return false;
  const host = new URL(databaseUrl).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || !host.includes(".");
  return !local;
}
