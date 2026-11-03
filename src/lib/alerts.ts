/**
 * Alerts for a person to look at: a payment that could not be turned into a parcel, a refund that failed, a server error.
 *
 * Every alert is one `[alert]` line in the server log (Vercel keeps them, and a log drain or search can watch them). When
 * `ALERT_WEBHOOK_URL` is set (an https address: a Slack, Discord, ntfy… "incoming webhook"), it is also posted there, so that
 * somebody hears about it without reading logs. No vendor account is needed, and an alert can never break what it reports.
 *
 * Details are ids and short messages only (never a card, a key, an e-mail address), cleaned and clipped. An instance sends
 * at most one alert of a kind per window: a storm of identical errors is one message ("… and 40 more since").
 */
export type AlertDetail = Record<string, string | number | boolean | null | undefined>;

const WINDOW_MS = 5 * 60 * 1000;
const state = new Map<string, { at: number; suppressed: number }>();

const clean = (v: unknown, n = 200): string => String(v).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n);

export function formatAlert(kind: string, detail: AlertDetail, suppressed = 0): string {
  const parts = Object.entries(detail).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${clean(k, 40)}=${clean(v)}`);
  return `${clean(kind, 80)}${parts.length ? ` — ${parts.join(" ")}` : ""}${suppressed ? ` (and ${suppressed} more like it since the last alert)` : ""}`;
}

export interface AlertOptions { url?: string | null; now?: number; windowMs?: number; fetcher?: typeof fetch }

/** Raises an alert. Resolves (never throws) with what happened to it. */
export async function raiseAlert(kind: string, detail: AlertDetail = {}, opts: AlertOptions = {}): Promise<"sent" | "logged" | "throttled"> {
  try {
    const now = opts.now ?? Date.now(), windowMs = opts.windowMs ?? WINDOW_MS;
    const key = kind;
    const last = state.get(key);
    if (last && now - last.at < windowMs) { last.suppressed++; return "throttled"; }
    const suppressed = last?.suppressed ?? 0;
    state.set(key, { at: now, suppressed: 0 });
    const text = formatAlert(kind, detail, suppressed);
    console.error(`[alert] ${text}`);
    const url = opts.url !== undefined ? opts.url : process.env.ALERT_WEBHOOK_URL;
    if (!url || !/^https:\/\//.test(url)) return "logged";
    const res = await (opts.fetcher ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `text` for Slack-style webhooks, `content` for Discord-style ones
      body: JSON.stringify({ text: `Pixel World — ${text}`, content: `Pixel World — ${text}` }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? "sent" : "logged";
  } catch {
    return "logged"; // an alert must never break what it reports
  }
}

/** For the tests. */
export function resetAlertThrottle(): void { state.clear(); }
