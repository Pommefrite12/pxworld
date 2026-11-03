/**
 * Which moment of the story a page shows, when nothing real is configured. Pure: `useDoom` reads the address and the tab's storage and asks here.
 *
 * `?preview=J-9` looks at a chapter of the story without touching the real date (it is kept for the tab, `?preview=off` forgets it). A
 * deployment can also show the story to EVERY visitor as such a simulation, with no end date and so no end of the shop:
 * `NEXT_PUBLIC_STORY_PREVIEW=J-40` (`fallback` here). `?preview=off` then switches it off for one tab, `?preview=default` brings it back.
 */
export function resolvePreview(query: string | null, stored: string | null, fallback: string): string {
  const q = query === null ? null : query.trim();
  if (q === null) return stored ?? fallback;
  if (q.toLowerCase() === "default") return fallback;
  if (q === "" || q.toLowerCase() === "off") return "off";
  return q;
}

/** What to do with the tab's storage after reading the address. */
export type PreviewStorage = { action: "keep" } | { action: "forget" } | { action: "set"; value: string };

export function previewStorage(query: string | null, fallback: string): PreviewStorage {
  if (query === null) return { action: "keep" };
  const q = query.trim().toLowerCase();
  if (q === "default") return { action: "forget" };
  if (q === "" || q === "off") return fallback ? { action: "set", value: "off" } : { action: "forget" }; // with a default, "off" must be remembered, or the default would come back
  return { action: "set", value: query.trim() };
}

/**
 * Is the moment shown a simulation the VISITOR asked for (`?preview=J-9`)? Then the plate says PREVIEW. When it is the deployment's own
 * default (`NEXT_PUBLIC_STORY_PREVIEW`), it is simply the site: the plate says "FICTION · 100 DAYS", like the real story would.
 */
export function isVisitorPreview(value: string, fallback: string): boolean {
  const v = value.trim();
  return v !== "" && v.toLowerCase() !== "off" && v !== fallback.trim();
}
