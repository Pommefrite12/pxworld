/** Colours of the drawing tools (the editor of a parcel and the shared canvas use the same ones). */
export const PALETTE = ["#17151f", "#ffffff", "#ff4d2e", "#ff9f1c", "#ffd23f", "#12b886", "#0b7a5a", "#2b35e0", "#5bc0eb", "#9b5de5", "#f15bb5", "#8d6e63", "#c9c1ae", "#6b6b78", "#fbf5e6", "#c9dfe8"];

/** A multicolour brush cycles through at most this many colours. */
export const MAX_MIX = 8;

/**
 * Length, in dots, of the stretch a multicolour stroke paints in one colour before moving to the next: one brush width,
 * and never less than a whole pixel (so a hairline brush does not flicker colour from one dot to the next).
 */
export const strokeRun = (brushDots: number, dotsPerPixel: number): number => Math.max(1, brushDots, dotsPerPixel);

/** The colour of the stroke after it has travelled `travelled` dots: each colour of `mix`, in order, `run` dots at a time. */
export function mixColor(mix: readonly string[], travelled: number, run: number): string {
  if (mix.length === 0) throw new Error("a multicolour brush needs at least one colour");
  return mix[Math.floor(Math.max(0, travelled) / Math.max(1, run)) % mix.length]!;
}

/** Adds a colour to the mix, or takes it out when it is already there. The mix is never empty and never longer than `MAX_MIX`. */
export function toggleMix(mix: readonly string[], colour: string): string[] {
  if (mix.includes(colour)) return mix.length > 1 ? mix.filter((c) => c !== colour) : [...mix];
  return mix.length < MAX_MIX ? [...mix, colour] : [...mix];
}

/** "#rrggbb" → 24-bit integer. */
export const hexToInt = (hex: string): number => parseInt(hex.slice(1), 16);
