/**
 * The illustration parcels (migration 24): decorative pictures that dress the map, placed by the site's owner with the demonstration tool, shown as
 * "Illustration image" instead of an author, covered by any purchase that touches them. They belong to ONE technical account that nobody can sign in
 * to; its name never appears on the site (the card, the archive page and the share titles say "Illustration image"), and its profile page does not exist.
 */
export const ILLUSTRATION_USERNAME = "image_illustration";
/** The technical account's address (it cannot match the `demo-…` pattern that `demo:clear` removes). */
export const illustrationEmail = (domain: string) => `illustration@${domain}`;
export type Tier = "paid" | "free" | "illustration";
export const toTier = (v: unknown): Tier => (v === "free" || v === "illustration" ? v : "paid");
