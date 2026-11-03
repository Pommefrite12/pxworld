import type { Instrumentation } from "next";

/**
 * Runs once when a server instance starts: in production, writes what is wrong with the configuration to the log (it never stops the
 * server: a missing secret turns off one feature with a clear message, see lib/env). And reports unhandled server errors as alerts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { configProblems } = await import("@/lib/config-check");
  for (const p of configProblems(process.env)) console[p.level === "error" ? "error" : "warn"](`[config] ${p.level} ${p.key}: ${p.message}`);
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { raiseAlert } = await import("@/lib/alerts");
  const e = err as { message?: string; digest?: string };
  await raiseAlert("server-error", { path: request.path.split("?")[0], route: context.routePath, kind: context.routeType, digest: e.digest, error: e.message });
};
