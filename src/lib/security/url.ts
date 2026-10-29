/**
 * External links published by users. Strict allow-list: https only, no credentials, no IP literals,
 * no local/internal hosts, bounded length. Returns the normalised URL or null.
 */
export function sanitizeExternalUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 500) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost") || host === "localhost") return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) return null; // IPv4/IPv6 literals
  if (/[^\x20-\x7e]/.test(host) && !host.startsWith("xn--")) { /* IDN is normalised to punycode by URL */ }
  u.hash = "";
  return u.toString();
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
