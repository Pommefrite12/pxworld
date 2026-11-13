/** The name of a language in the language of the page ("français"), or null when the code is not one ("und" is "unknown"). */
export function languageName(code: string, locale: string): string | null {
  try { return /^[a-z]{2,3}$/.test(code) && code !== "und" ? new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? null : null; } catch { return null; }
}
