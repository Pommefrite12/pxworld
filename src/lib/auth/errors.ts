/**
 * What went wrong when Supabase Auth refused a sign-up or a sign-in, in terms the visitor can act on. Pure: the form translates the key.
 * An error nobody anticipated keeps its code, so that it can be reported (and found in the Supabase logs) instead of being hidden
 * behind "something went wrong".
 */
export type AuthErrorKey = "exists" | "rateLimit" | "invalidEmail" | "weakPassword" | "notConfirmed" | "signupDisabled" | "invalidCredentials" | "network" | "badKey" | "generic";

export interface AuthErrorLike { code?: string | null; message?: string | null; status?: number | null; name?: string | null }

export function classifyAuthError(e: AuthErrorLike): { key: AuthErrorKey; detail: string | null } {
  const code = (e.code ?? "").toLowerCase(), msg = (e.message ?? "").toLowerCase(), status = e.status ?? 0;
  const detail = code || (status ? `HTTP ${status}` : null);
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered") || msg.includes("already been registered")) return { key: "exists", detail };
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || code === "over_sms_send_rate_limit" || status === 429 || msg.includes("rate limit")) return { key: "rateLimit", detail };
  if (msg.includes("invalid api key") || code === "invalid_api_key" || code === "no_authorization") return { key: "badKey", detail: null };
  if (code === "email_address_invalid" || code === "email_address_not_authorized") return { key: "invalidEmail", detail };
  if (code === "weak_password") return { key: "weakPassword", detail };
  if (code === "email_not_confirmed") return { key: "notConfirmed", detail };
  if (code === "signup_disabled" || code === "email_provider_disabled") return { key: "signupDisabled", detail };
  if (code === "invalid_credentials") return { key: "invalidCredentials", detail };
  if (e.name === "AuthRetryableFetchError" || status === 0 && (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("fetch failed"))) return { key: "network", detail: null };
  return { key: "generic", detail };
}
