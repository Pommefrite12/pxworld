import { hash2 } from "./corruption";

/**
 * The "computer bug" of the destroyed land: every so often, for about a second, the destroyed zones tear sideways in bands (the
 * coasts' magenta and cyan fringes jump with them), then everything goes back to where it was. It is drawn over the tiles, never
 * baked into them. The envelope rises and falls so that it starts and ends softly.
 */
export const GLITCH_EVERY_MS = 30_000;
export const GLITCH_FOR_MS = 1_300;
/** The picture changes at about 11 images a second: a stutter, not a smooth movement. */
export const GLITCH_FRAME_MS = 90;
/** The most a band slides, in tile pixels (device pixels of the rendering level). */
export const GLITCH_MAX_PX = 44;

export interface GlitchFrame {
  /** Which still picture of the burst this is (its seed). */
  n: number;
  /** 0 → 1 → 0 over the burst. */
  power: number;
}

/** The picture of the burst `elapsed` ms after it began, or `null` once it is over (or before it began). */
export function glitchFrame(elapsed: number): GlitchFrame | null {
  if (!(elapsed >= 0) || elapsed >= GLITCH_FOR_MS) return null;
  return { n: Math.floor(elapsed / GLITCH_FRAME_MS), power: Math.sin((Math.PI * elapsed) / GLITCH_FOR_MS) };
}

/** How far (tile px, to the right when positive) a band of two lattice rows slides in this picture: nothing for most bands. */
export function glitchShift(band: number, frame: GlitchFrame): number {
  if (hash2(band, frame.n, 71) >= 0.1 + 0.4 * frame.power) return 0;
  const sign = hash2(band, frame.n, 72) < 0.5 ? -1 : 1;
  return Math.round(sign * (6 + hash2(band, frame.n, 73) * (GLITCH_MAX_PX - 6)) * Math.max(0.35, frame.power));
}

/* ------------------------------------------------------------------ the magenta zones that change place */
/** How many places the magenta zones take, one after the other, round a circle (a new one at every picture of the burst, so that they turn). */
export const GLITCH_ORBIT_PLACES = 6;
/** The radius of that circle, in tile pixels (device pixels of the rendering level), at the strongest moment of the burst. */
export const GLITCH_ORBIT_PX = 18;

/** Where the magenta zones are in this picture of the burst: one of `GLITCH_ORBIT_PLACES` places round a circle, the next one at each picture. */
export function magentaOrbit(frame: GlitchFrame): { dx: number; dy: number } {
  const angle = ((frame.n % GLITCH_ORBIT_PLACES) / GLITCH_ORBIT_PLACES) * Math.PI * 2, radius = GLITCH_ORBIT_PX * Math.max(0.55, frame.power);
  return { dx: Math.round(Math.cos(angle) * radius), dy: Math.round(Math.sin(angle) * radius) };
}

/** Is this pixel of a baked tile magenta (the error colour, whole or seen through a little transparency over the cream land)? */
export function isMagenta(r: number, g: number, b: number): boolean {
  return r >= 200 && b >= 90 && b <= 225 && r - g >= 80 && b - g >= 20;
}

/**
 * Takes the magenta out of a tile: `mag` holds the magenta pixels alone (everything else transparent), `calm` is the tile without them
 * (each one takes the colour of its neighbour on the left, or on the right at the start of a row). Drawing `calm` and then `mag` moved
 * makes the magenta zones travel instead of multiplying. `count` is how many pixels were magenta.
 */
export function splitMagenta(data: Uint8ClampedArray, width: number, height: number): { calm: Uint8ClampedArray<ArrayBuffer>; mag: Uint8ClampedArray<ArrayBuffer>; count: number } {
  const calm = new Uint8ClampedArray(data.length), mag = new Uint8ClampedArray(data.length);
  calm.set(data);
  let count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    let last = -1; // the last pixel of the row that is not magenta
    let pending = 0; // magenta pixels at the start of the row, waiting for a neighbour on their right
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (data[i + 3]! > 0 && isMagenta(data[i]!, data[i + 1]!, data[i + 2]!)) {
        count++;
        mag[i] = data[i]!; mag[i + 1] = data[i + 1]!; mag[i + 2] = data[i + 2]!; mag[i + 3] = data[i + 3]!;
        if (last >= 0) { calm[i] = calm[last]!; calm[i + 1] = calm[last + 1]!; calm[i + 2] = calm[last + 2]!; calm[i + 3] = calm[last + 3]!; } else pending++;
      } else {
        if (last < 0 && pending > 0) for (let k = 1; k <= pending; k++) { const j = i - k * 4; calm[j] = data[i]!; calm[j + 1] = data[i + 1]!; calm[j + 2] = data[i + 2]!; calm[j + 3] = data[i + 3]!; }
        last = i; pending = 0;
      }
    }
    if (last < 0 && pending > 0) for (let x = 0; x < width; x++) calm[row + x * 4 + 3] = 0; // a row of nothing but magenta: nothing is left
  }
  return { calm, mag, count };
}
