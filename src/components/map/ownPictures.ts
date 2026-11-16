/**
 * Which parcels of a view fetch THEIR OWN picture.
 *
 * A picture is one request to the server (and, there, one read of the database and of the storage). A crowded view can show thousands of parcels (a
 * dense city seen at ×1 holds more than a thousand): asking for a picture each took minutes on a real site, for pictures that are 10 pixels wide on
 * the screen. Only the biggest parcels of the view fetch theirs; the others are their average colour, and the server-composed tile of that place
 * (one request for hundreds of parcels, kept by the CDN) stands in for the picture, as it already does while a big picture is on its way.
 */

/** A parcel smaller than this on the screen (CSS pixels, its longest side) never fetches its own picture. */
export const OWN_PICTURE_MIN_PX = 12;
/** At most this many parcels of a view fetch their own picture. */
export const MAX_OWN_PICTURES = 150;

/**
 * The smallest on-screen size (longest side, CSS pixels) from which a parcel of the view fetches its own picture, given the sizes of the parcels
 * that could (`sizes[0..count)`, each at least `OWN_PICTURE_MIN_PX`; the array is reordered). The lowest threshold such that no more than
 * `MAX_OWN_PICTURES` parcels reach it: `OWN_PICTURE_MIN_PX` when the view is not crowded, higher when it is, `Infinity` when so many parcels
 * share the same size that no threshold keeps the count down (nobody is preferred to the others).
 */
export function ownPictureMin(sizes: Float32Array, count: number, max = MAX_OWN_PICTURES): number {
  if (count <= max) return OWN_PICTURE_MIN_PX;
  const d = sizes.subarray(0, count).sort(); // ascending
  const firstExcluded = d[count - 1 - max]!; // the (max+1)-th biggest: no threshold at or below it keeps the count within `max`
  for (let i = count - max; i < count; i++) if (d[i]! > firstExcluded) return d[i]!; // the smallest size above it
  return Infinity;
}
