/**
 * The home page and the map used to be the same page (`/` was the map). Now `/` is the home page, and the map lives at `/map`. But every address
 * that was shared or saved as `/?x=…&y=…&z=…`, `/?p=<code>`, `/?buy=1`, `/?bx=…` (a purchase resumed after signing in), `/?preview=…` is still the MAP:
 * a link must never change meaning. Only the bare address (`/`, `/fr`) is the home page.
 */
export const MAP_PARAMS = ["x", "y", "z", "p", "bx", "by", "bw", "bh", "buy", "bk", "preview", "hud", "perf"] as const;

export function opensTheMap(sp: Record<string, string | string[] | undefined>): boolean {
  return MAP_PARAMS.some((k) => k in sp);
}
