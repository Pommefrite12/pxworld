/**
 * Illustration parcels on the biggest capitals of the world, 50 × 50 to 200 × 200 pixels, drawn as "realistic pixel art" (`photo.ts`): scenes with light,
 * depth and atmosphere, made of plain pixels a quarter of a grid pixel wide. Plus one wink at Miami (a neon sunset on Ocean Drive, for those who wait for
 * a certain game): no logo, no character, no official picture, only a mood and two neon letters.
 * Pure data and drawing code; nothing is fetched, nothing is a photograph, no real person is shown. Used by `capitalsPlan` (`npm run demo:seed -- … --set capitals`).
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { CREATION_MAX_DOTS } from "@/lib/grid/constants";
import { MAX_UPLOAD_BYTES } from "@/lib/images/validate";
import type { Raster } from "./art";
import type { DemoItem } from "./plan";
import type { RGB } from "./scene";
import { Photo } from "./photo";
import { CAPITALS_I18N } from "./capitals-i18n";
import { HERITAGE_LANGS } from "./heritage-i18n";

export interface Capital {
  id: string;
  title: string;
  /** One sentence, in French, factual and neutral. */
  text: string;
  place: string;
  country: string;
  lat: number;
  lon: number;
  category: "arts" | "nature" | "science" | "food" | "future" | "tribute" | "other";
  /** The side of the (square) parcel, in grid pixels: 50 to 200. */
  size: number;
  draw: (k: Photo) => void;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
const shade = (c: RGB, t: number): RGB => [Math.round(c[0] * (1 - t)), Math.round(c[1] * (1 - t)), Math.round(c[2] * (1 - t))];

/** The silhouette of a skyline: `n` buildings across a band, between `top` and `bottom` heights, each with a flat roof, in colours between `a` and `b`. */
const skyline = (k: Photo, y: number, hmin: number, hmax: number, n: number, a: RGB, b: RGB, win?: { on: RGB; off: RGB; lit: number }) => {
  let x = -0.02;
  const step = 1.04 / n;
  for (let i = 0; i < n; i++) {
    const w = step * (0.8 + k.next() * 0.9), h = hmin + k.next() * (hmax - hmin), c = mix(a, b, k.next());
    k.rect(x, y - h, w, h + 0.02, c);
    if (win && w > 0.02) k.windows(x + w * 0.1, y - h + 0.01, w * 0.8, h * 0.9, Math.max(2, Math.round(w * 90)), Math.max(3, Math.round(h * 70)), win.on, win.off, win.lit, 0.5);
    x += w * 0.98;
  }
};

/** An onion dome: a bulb on its drum, `a` its colour, `b` the colour of its spiral stripes; `gold` makes it a plain gilded bulb with a cross. */
const onion = (k: Photo, x: number, y: number, r: number, a: RGB, b: RGB, gold: 0 | 1) => {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16, ang = t * Math.PI, w = Math.sin(ang) ** 0.8 * r * (1 + 0.28 * Math.sin(ang * 1.2)); pts.push([x + w, y - r * 1.5 * (1 - Math.cos(ang)) / 2 * 1.6 + r * 0.1]); }
  const left = pts.map(([px, py]) => [2 * x - px, py] as [number, number]);
  k.poly([...pts, ...left.reverse()], a).poly([...pts.slice(0, 9), [x, y - r * 1.5 * 0.9]], shade(a, 0.3));
  if (!gold) for (let i = -3; i <= 3; i++) k.line(x + i * r * 0.28, y + r * 0.05, x + i * r * 0.1 + r * 0.1, y - r * 1.15, 0.004, b);
  k.line(x, y - r * 1.6, x, y - r * 2.1, 0.005, [255, 214, 100]).line(x - r * 0.25, y - r * 1.85, x + r * 0.25, y - r * 1.85, 0.004, [255, 214, 100]);
};

export const CAPITALS: Capital[] = [
  {
    id: "paris", title: "La tour Eiffel au soleil couchant", place: "Paris, France", country: "FR", lat: 48.857, lon: 2.295, category: "arts", size: 160,
    text: "Dernier éclat du jour sur la Dame de fer, au bout du Champ-de-Mars, à Paris.",
    draw: (k) => {
      const hz = 0.7, hor: RGB = [255, 176, 112];
      k.sky([38, 58, 130], [150, 110, 170], 0, 0.42).sky([150, 110, 170], hor, 0.42, hz);
      k.glow(0.8, 0.62, 0.55, [255, 214, 140], 0.75);
      k.clouds(0.04, 0.62, 0.5, [255, 206, 172], [104, 80, 148], { seed: 4, scale: 3.4, sun: [0.8, 0.7] });
      k.sun(0.8, 0.64, 0.035, [255, 244, 200]);
      // the city far away: cream façades and slate roofs in the haze
      skyline(k, hz + 0.02, 0.03, 0.07, 46, [196, 160, 160], [230, 190, 170]);
      for (let i = 0; i < 18; i++) { const x = k.next(); k.tri(x - 0.012, hz - 0.02, x, hz - 0.045, x + 0.012, hz - 0.02, [96, 92, 130]); }
      k.veil(hz - 0.1, hz + 0.03, hor, 0.05, 0.55);
      // the lawn of the Champ-de-Mars, lit at the far end, and its path
      k.vgrad(0, hz + 0.02, 1, 1 - hz, [150, 160, 70], [28, 60, 36]);
      k.poly([[0.47, hz + 0.02], [0.53, hz + 0.02], [0.82, 1], [0.18, 1]], [196, 150, 112]);
      k.poly([[0.49, hz + 0.02], [0.51, hz + 0.02], [0.56, 1], [0.44, 1]], [226, 184, 140]);
      k.texture(0, hz + 0.02, 1, 1 - hz, 0.3, 90, 7);
      for (let i = 0; i < 12; i++) k.foliage(0.04 + i * 0.085, hz + 0.045, 0.04, 0.03, [30, 56, 38], [120, 130, 70], 30);
      for (const [x, y, r] of [[0.1, 0.84, 0.11], [0.9, 0.85, 0.12], [0.24, 0.8, 0.07], [0.78, 0.8, 0.07]] as const) k.foliage(x, y, r, r * 0.8, [22, 46, 32], [150, 150, 70], 140);
      // the tower: half-width from the top (t = 0) to the ground (t = 1)
      const top = 0.06, ground = 0.84, hw = (t: number) => 0.006 + 0.15 * t ** 2.35, y = (t: number) => top + t * (ground - top), cx = 0.5;
      const steps = 40, R: [number, number][] = [], L: [number, number][] = [];
      for (let i = 0; i <= steps; i++) { const t = i / steps; R.push([cx + hw(t), y(t)]); L.push([cx - hw(t), y(t)]); }
      k.poly([[cx, y(0)], ...R, [cx, y(1)]], [150, 100, 72]).poly([[cx, y(0)], ...L, [cx, y(1)]], [66, 48, 52]);
      // the arch between the legs, through which the sky shows
      const archT = 0.83, inner = (t: number) => hw(t) * 0.6;
      const arch: [number, number][] = [];
      for (let i = 0; i <= 14; i++) { const t = archT + ((1 - archT) * i) / 14; arch.push([cx + inner(t), y(t)]); }
      k.poly([[cx - inner(archT), y(archT)], [cx + inner(archT), y(archT)], ...arch, [cx + inner(1), y(1)], [cx - inner(1), y(1)], ...arch.map(([ax, ay]) => [2 * cx - ax, ay] as [number, number]).reverse()], mix(hor, [226, 150, 110], 0.4));
      k.dome(cx, y(archT) + 0.045, 0.045, mix(hor, [236, 160, 120], 0.3));
      // the ironwork: crossed bracing between the platforms, lighter on the lit side
      const levels = [0.04, 0.16, 0.26, 0.36, 0.48, 0.6, 0.72, 0.83];
      for (let i = 0; i + 1 < levels.length; i++) {
        const a = levels[i]!, b = levels[i + 1]!;
        k.line(cx - hw(a), y(a), cx + hw(b), y(b), 0.004, [176, 126, 92]).line(cx + hw(a), y(a), cx - hw(b), y(b), 0.004, [176, 126, 92]);
        k.line(cx, y(a), cx + hw(b) * 0.55, y(b), 0.0035, [206, 150, 104]).line(cx, y(a), cx - hw(b) * 0.55, y(b), 0.0035, [96, 70, 64]);
      }
      for (const [t, w] of [[0.83, 2.3], [0.62, 1.55], [0.16, 1.5]] as const) k.rect(cx - hw(t) * w, y(t) - 0.008, hw(t) * w * 2, 0.016, [120, 82, 62]).rect(cx - hw(t) * w, y(t) - 0.008, hw(t) * w, 0.016, [58, 42, 46]).rect(cx - hw(t) * w, y(t) + 0.008, hw(t) * w * 2, 0.004, [214, 150, 90]);
      k.line(cx, y(0), cx, y(0) - 0.03, 0.004, [90, 66, 60]).dot(cx, y(0) - 0.03, [255, 220, 150], 1.5);
      // a last warm veil, and the first lights of the avenue
      k.veil(0.5, 1, [255, 150, 90], 0, 0.14);
      k.lights(0.2, 0.9, 0.46, hz + 0.05, 7, [255, 214, 150], 1.1).lights(0.8, 0.9, 0.54, hz + 0.05, 7, [255, 214, 150], 1.1);
    },
  },
  {
    id: "miami", title: "Néons sur Ocean Drive", place: "Miami, États-Unis", country: "US", lat: 25.78, lon: -80.13, category: "arts", size: 90,
    text: "Coucher de soleil rétro sur la plage de Miami : néons, palmiers et façades Art déco, avec un clin d'œil à ceux qui attendent Vice City.",
    draw: (k) => {
      const hz = 0.66;
      k.sky([22, 8, 60], [128, 24, 150], 0, 0.4).sky([128, 24, 150], [255, 84, 130], 0.4, 0.58).sky([255, 84, 130], [255, 170, 80], 0.58, hz);
      k.stars(30, [255, 230, 250], 0.3);
      k.glow(0.68, 0.54, 0.7, [255, 120, 170], 0.7).glow(0.68, 0.56, 0.35, [255, 200, 120], 0.6);
      k.sunDisc(0.68, 0.5, 0.19, [255, 232, 110], [255, 60, 140], 7);
      k.clouds(0.04, 0.46, 0.42, [255, 150, 190], [90, 26, 130], { seed: 9, scale: 3, sun: [0.6, 0.6], alpha: 0.7 });
      // the sea, and the path of the sun on it
      k.vgrad(0, hz, 1, 0.14, [255, 150, 90], [96, 30, 120]).veil(hz, hz + 0.14, [60, 20, 110], 0, 0.5);
      k.reflect(hz, [150, 40, 150], 0.55, 0.5, 0.006);
      k.vgrad(0, 0.8, 1, 0.2, [92, 44, 120], [26, 10, 44]);
      // the Art Deco hotel, lit by the neon, with its sign on a mast
      const wall: RGB = [255, 184, 206], wallD: RGB = [226, 128, 176];
      k.hgrad(0.04, 0.44, 0.42, 0.38, wall, wallD).rect(0.04, 0.44, 0.42, 0.012, [255, 240, 246]);
      k.rect(0.09, 0.38, 0.32, 0.07, mix(wall, [255, 255, 255], 0.25)).rect(0.14, 0.33, 0.22, 0.06, mix(wall, [255, 255, 255], 0.35)).rect(0.2, 0.295, 0.1, 0.04, wall);
      k.rect(0.249, 0.1, 0.008, 0.2, [80, 220, 230]);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) { const px = 0.07 + c * 0.075; k.rect(px, 0.51 + r * 0.09, 0.045, 0.055, c % 2 ? [255, 220, 120] : [60, 200, 220]).rect(px - 0.004, 0.565 + r * 0.09, 0.053, 0.008, [255, 255, 255]); }
      k.rect(0.04, 0.48, 0.42, 0.012, [255, 70, 170]).rect(0.04, 0.8, 0.42, 0.012, [70, 230, 240]);
      for (let i = 0; i < 4; i++) k.disc(0.15 + i * 0.07, 0.355, 0.011, [60, 200, 230]);
      k.glow(0.25, 0.48, 0.22, [255, 60, 170], 0.45).glow(0.25, 0.81, 0.2, [60, 220, 240], 0.45);
      // the neon "VI", big, on its mast
      const neon: RGB = [90, 250, 255], pink: RGB = [255, 80, 190];
      k.glow(0.34, 0.2, 0.22, [90, 240, 255], 0.5);
      k.line(0.2, 0.07, 0.265, 0.3, 0.03, neon).line(0.33, 0.07, 0.265, 0.3, 0.03, neon).line(0.405, 0.07, 0.405, 0.3, 0.036, pink);
      k.line(0.2, 0.07, 0.265, 0.3, 0.011, [230, 255, 255]).line(0.33, 0.07, 0.265, 0.3, 0.011, [230, 255, 255]).line(0.4, 0.07, 0.4, 0.3, 0.011, [255, 224, 245]);
      k.rect(0.37, 0.07, 0.06, 0.012, pink).rect(0.37, 0.288, 0.06, 0.012, pink);
      // palms against the sky, a car on the wet street
      for (const [x, h, lean] of [[0.96, 0.6, -0.09], [0.52, 0.36, 0.05]] as const) k.palmTree(x, 0.88, h, lean, [34, 14, 50], [20, 8, 40], [96, 30, 120]);
      k.reflect(0.8, [140, 40, 150], 0.5, 0.7, 0.003);
      k.rect(0, 0.86, 1, 0.14, [18, 8, 34]);
      k.poly([[0.12, 0.93], [0.15, 0.9], [0.34, 0.885], [0.42, 0.865], [0.5, 0.88], [0.64, 0.9], [0.68, 0.93], [0.66, 0.96], [0.14, 0.96]], [236, 70, 160]);
      k.poly([[0.12, 0.93], [0.68, 0.93], [0.66, 0.96], [0.14, 0.96]], [58, 20, 90]);
      k.poly([[0.38, 0.9], [0.43, 0.865], [0.5, 0.88], [0.5, 0.9]], [130, 230, 250]);
      k.disc(0.24, 0.96, 0.028, [14, 6, 24]).disc(0.56, 0.96, 0.028, [14, 6, 24]).disc(0.24, 0.96, 0.012, [180, 180, 200]).disc(0.56, 0.96, 0.012, [180, 180, 200]);
      k.glow(0.125, 0.92, 0.08, [255, 60, 60], 0.9).dot(0.125, 0.92, [255, 120, 100], 2);
      k.veil(0.84, 1, [255, 70, 170], 0, 0.1);
    },
  },
  {
    id: "londres", title: "Big Ben au crépuscule", place: "Londres, Royaume-Uni", country: "GB", lat: 51.5007, lon: -0.1246, category: "arts", size: 140,
    text: "La tour Elizabeth et le palais de Westminster, allumés à l'heure bleue au bord de la Tamise, à Londres.",
    draw: (k) => {
      const hz = 0.72, hor: RGB = [255, 168, 110];
      k.sky([14, 26, 84], [64, 80, 150], 0, 0.4).sky([64, 80, 150], hor, 0.4, hz);
      k.clouds(0.05, 0.6, 0.5, [255, 170, 150], [50, 60, 120], { seed: 11, scale: 3.2, sun: [0.2, 0.7] });
      k.glow(0.15, 0.72, 0.5, [255, 170, 110], 0.5);
      // the river first, the buildings on its bank
      k.vgrad(0, hz, 1, 1 - hz, [200, 120, 110], [22, 30, 66]);
      // the Palace of Westminster: a long gothic façade in warm stone, pinnacles, lit windows
      const st: RGB = [214, 178, 120], stD: RGB = [150, 118, 86];
      k.hgrad(0.4, 0.5, 0.62, hz - 0.5 + 0.02, st, stD).rect(0.4, 0.49, 0.62, 0.012, [236, 206, 150]);
      for (let i = 0; i < 18; i++) { const px = 0.42 + i * 0.033; k.tri(px - 0.008, 0.49, px, 0.43 + (i % 3) * 0.012, px + 0.008, 0.49, stD); }
      for (const x of [0.58, 0.78, 0.94]) { k.rect(x - 0.035, 0.36, 0.07, 0.14, st).tri(x - 0.04, 0.36, x, 0.24, x + 0.04, 0.36, [70, 86, 96]).dot(x, 0.235, [255, 214, 120], 1.2); }
      k.windows(0.41, 0.53, 0.6, 0.18, 26, 4, [255, 214, 120], [92, 70, 70], 0.6, 0.5);
      k.rect(0.4, 0.7, 0.62, 0.02, [90, 70, 66]);
      // the tower: shaft, clock stage, belfry, spire
      const cx = 0.3;
      k.hgrad(cx - 0.04, 0.33, 0.08, hz - 0.31, [228, 192, 130], [140, 108, 80]);
      for (let i = 0; i < 9; i++) k.rect(cx - 0.02, 0.38 + i * 0.037, 0.012, 0.022, [255, 214, 120]);
      k.hgrad(cx - 0.055, 0.2, 0.11, 0.14, [236, 200, 138], [146, 112, 82]);
      k.rect(cx - 0.06, 0.2, 0.12, 0.014, [176, 138, 96]).rect(cx - 0.06, 0.335, 0.12, 0.014, [176, 138, 96]);
      k.disc(cx, 0.265, 0.036, [255, 236, 170]).ring(cx, 0.265, 0.036, 0.007, [60, 50, 44]).glow(cx, 0.265, 0.12, [255, 220, 140], 0.6);
      k.line(cx, 0.265, cx, 0.24, 0.004, [40, 30, 30]).line(cx, 0.265, cx + 0.018, 0.272, 0.004, [40, 30, 30]);
      k.hgrad(cx - 0.045, 0.12, 0.09, 0.09, [220, 184, 126], [136, 104, 78]);
      for (const x of [cx - 0.025, cx, cx + 0.025]) k.rect(x - 0.006, 0.135, 0.012, 0.05, [70, 52, 50]);
      k.poly([[cx - 0.05, 0.12], [cx, 0.01], [cx + 0.05, 0.12]], [78, 94, 104]).line(cx, 0.012, cx, 0.0, 0.004, [236, 196, 110]);
      for (const dx of [-0.05, 0.05]) k.tri(cx + dx - 0.008, 0.12, cx + dx, 0.075, cx + dx + 0.008, 0.12, [78, 94, 104]);
      k.glow(cx, 0.4, 0.4, [255, 190, 110], 0.28);
      k.veil(hz - 0.12, hz + 0.01, hor, 0, 0.35);
      // Westminster Bridge in the foreground: arches over the water, lamps, a red bus
      k.reflect(hz + 0.02, [255, 150, 100], 0.6, 0.5, 0.004);
      k.rect(0, 0.84, 1, 0.03, [66, 84, 84]).rect(0, 0.87, 1, 0.13, [48, 60, 64]);
      for (let i = 0; i < 6; i++) k.arch(0.08 + i * 0.17, 1.0, 0.13, 0.12, [30, 44, 80]);
      k.rect(0, 0.835, 1, 0.01, [120, 140, 130]);
      for (let i = 0; i < 6; i++) { const x = 0.06 + i * 0.18; k.rect(x, 0.78, 0.006, 0.06, [30, 40, 40]); k.glow(x + 0.003, 0.775, 0.05, [255, 210, 130], 0.9); k.dot(x + 0.003, 0.775, [255, 240, 190], 1.2); }
      k.rect(0.6, 0.78, 0.2, 0.052, [190, 36, 40]).rect(0.6, 0.79, 0.2, 0.012, [255, 214, 130]).rect(0.6, 0.805, 0.2, 0.014, [255, 214, 130]).disc(0.65, 0.834, 0.011, [20, 20, 24]).disc(0.76, 0.834, 0.011, [20, 20, 24]);
    },
  },
  {
    id: "tokyo", title: "La tour de Tokyo et le mont Fuji", place: "Tokyo, Japon", country: "JP", lat: 35.6586, lon: 139.7454, category: "arts", size: 170,
    text: "La tour de Tokyo domine la ville dans la lumière de l'après-midi, et le mont Fuji se dessine à l'horizon.",
    draw: (k) => {
      const hz = 0.7, hor: RGB = [255, 156, 136];
      k.sky([28, 24, 96], [120, 70, 150], 0, 0.42).sky([120, 70, 150], hor, 0.42, hz);
      k.clouds(0.08, 0.6, 0.45, [255, 170, 160], [70, 50, 130], { seed: 21, scale: 3.4, sun: [0.8, 0.8] });
      // Fuji, far and blue, its snow cap pink in the last light
      k.poly([[0.28, hz], [0.58, 0.3], [0.64, 0.28], [0.7, 0.3], [1.02, hz]], [92, 84, 150]);
      k.poly([[0.5, 0.38], [0.58, 0.3], [0.64, 0.28], [0.7, 0.3], [0.78, 0.38], [0.72, 0.36], [0.68, 0.4], [0.64, 0.37], [0.6, 0.41], [0.55, 0.37]], [250, 214, 214]);
      k.veil(0.3, hz, hor, 0.05, 0.65);
      // the city: three rows of towers, nearer is darker and its windows are lit
      skyline(k, hz + 0.1, 0.05, 0.13, 40, [120, 100, 150], [160, 130, 160], { on: [255, 214, 140], off: [96, 80, 120], lit: 0.25 });
      k.veil(hz - 0.05, hz + 0.1, hor, 0.05, 0.4);
      skyline(k, hz + 0.19, 0.07, 0.17, 30, [52, 44, 92], [84, 64, 112], { on: [255, 206, 120], off: [44, 36, 78], lit: 0.4 });
      k.rect(0, hz + 0.19, 1, 0.12, [26, 22, 56]);
      for (let i = 0; i < 40; i++) k.dot(k.next(), hz + 0.21 + k.next() * 0.08, [255, 220, 150], 0.9);
      // Tokyo Tower: orange and white lattice, two decks, an antenna with its red light
      const cx = 0.3, topY = 0.28, baseY = hz + 0.2, hw = (y: number) => 0.012 + 0.115 * ((y - topY) / (baseY - topY)) ** 1.25;
      const bands = 7, or: RGB = [255, 98, 40], wh: RGB = [250, 236, 226];
      for (let i = 0; i < bands; i++) {
        const y0 = topY + ((baseY - topY) * i) / bands, y1 = topY + ((baseY - topY) * (i + 1)) / bands, c = i % 2 ? wh : or;
        k.poly([[cx - hw(y0), y0], [cx + hw(y0), y0], [cx + hw(y1), y1], [cx - hw(y1), y1]], shade(c, 0.5));
        const m = 3; for (let q = 0; q < m; q++) { const a = (q + 0.5) / m; k.line(cx - hw(y0) + 2 * hw(y0) * a, y0, cx - hw(y1) + 2 * hw(y1) * (1 - a), y1, 0.004, c); k.line(cx - hw(y0) + 2 * hw(y0) * (1 - a), y0, cx - hw(y1) + 2 * hw(y1) * a, y1, 0.004, c); }
        k.line(cx - hw(y1), y1, cx + hw(y1), y1, 0.005, c);
      }
      for (const sgn of [-1, 1]) k.line(cx + sgn * hw(topY), topY, cx + sgn * hw(baseY), baseY, 0.008, or);
      k.rect(cx - 0.06, 0.5, 0.12, 0.028, or).rect(cx - 0.05, 0.5, 0.1, 0.01, [255, 214, 150]);
      k.rect(cx - 0.034, 0.37, 0.068, 0.022, or);
      k.line(cx, topY, cx, 0.06, 0.007, wh).line(cx, 0.17, cx, 0.1, 0.007, or).dot(cx, 0.06, [255, 70, 60], 2.4).glow(cx, 0.06, 0.05, [255, 70, 60], 0.9);
      k.glow(cx, 0.55, 0.5, [255, 130, 60], 0.35);
      k.veil(0.7, 1, [60, 30, 90], 0, 0.3);
    },
  },
  {
    id: "pekin", title: "La salle de l'Harmonie suprême", place: "Pékin, Chine", country: "CN", lat: 39.9163, lon: 116.3972, category: "arts", size: 200,
    text: "Toits d'or, murs vermillon et terrasses de marbre blanc : le cœur de la Cité interdite, à Pékin.",
    draw: (k) => {
      k.sky([48, 118, 214], [196, 224, 248], 0, 0.62);
      k.clouds(0.03, 0.5, 0.45, [255, 255, 255], [150, 176, 214], { seed: 31, scale: 3, sun: [0.3, 0] });
      const gold: RGB = [238, 188, 66], goldD: RGB = [158, 106, 40], red: RGB = [182, 36, 38], redD: RGB = [110, 20, 28], marble: RGB = [236, 232, 224];
      // the lower roof, wide, its eaves lifted at the corners, then the upper one
      k.poly([[0.04, 0.4], [0.1, 0.36], [0.5, 0.33], [0.9, 0.36], [0.96, 0.4], [0.9, 0.43], [0.5, 0.41], [0.1, 0.43]], goldD).poly([[0.06, 0.39], [0.5, 0.325], [0.94, 0.39], [0.5, 0.375]], gold);
      k.poly([[0.16, 0.3], [0.22, 0.26], [0.5, 0.22], [0.78, 0.26], [0.84, 0.3], [0.78, 0.33], [0.5, 0.31], [0.22, 0.33]], goldD).poly([[0.18, 0.29], [0.5, 0.215], [0.82, 0.29], [0.5, 0.265]], gold);
      k.poly([[0.3, 0.22], [0.36, 0.19], [0.5, 0.165], [0.64, 0.19], [0.7, 0.22], [0.5, 0.2]], goldD).rect(0.44, 0.15, 0.12, 0.022, gold).dot(0.5, 0.145, [255, 220, 120], 2);
      for (let i = 0; i < 30; i++) { const x = 0.07 + i * 0.029; k.line(x, 0.375, x + 0.004, 0.41, 0.002, goldD); }
      // the walls: red, with golden doors and windows between the columns
      k.vgrad(0.1, 0.43, 0.8, 0.2, red, redD);
      for (let i = 0; i < 13; i++) k.rect(0.115 + i * 0.0585, 0.44, 0.013, 0.18, redD);
      for (const x of [0.26, 0.38, 0.5, 0.62, 0.74]) k.rect(x - 0.03, 0.5, 0.06, 0.12, [60, 18, 22]).rect(x - 0.026, 0.505, 0.052, 0.04, gold).rect(x - 0.026, 0.55, 0.052, 0.07, mix(gold, red, 0.45));
      k.rect(0.1, 0.43, 0.8, 0.012, gold).rect(0.1, 0.46, 0.8, 0.008, [40, 120, 150]);
      // three tiers of white marble with their steps and balustrades
      for (let t = 0; t < 3; t++) {
        const y = 0.63 + t * 0.085, w = 0.8 + t * 0.1;
        k.vgrad(0.5 - w / 2, y, w, 0.085, marble, [188, 184, 178]).rect(0.5 - w / 2, y, w, 0.008, [255, 252, 246]);
        for (let i = 0; i < Math.floor(w * 60); i++) k.rect(0.5 - w / 2 + 0.006 + i * (w / Math.floor(w * 60)), y + 0.012, 0.004, 0.022, [150, 146, 142]);
      }
      for (let i = 0; i < 8; i++) { const y = 0.63 + i * 0.0325; k.rect(0.42 - i * 0.004, y, 0.16 + i * 0.008, 0.0325, i % 2 ? [226, 222, 214] : [248, 244, 236]); }
      k.rect(0.455, 0.63, 0.09, 0.26, [200, 150, 120]).texture(0.455, 0.63, 0.09, 0.26, 0.1, 80, 3);
      // the courtyard, in perspective
      k.vgrad(0, 0.89, 1, 0.11, [156, 150, 142], [112, 106, 100]).texture(0, 0.89, 1, 0.11, 0.25, 60, 8);
      for (let i = 0; i < 9; i++) k.line(0.5, 0.89, i * 0.125, 1, 0.002, [96, 90, 86]);
      k.texture(0.1, 0.63, 0.8, 0.26, 0.12, 120, 9);
      k.veil(0.55, 1, [255, 230, 170], 0, 0.12);
    },
  },
  {
    id: "delhi", title: "India Gate dans la brume dorée", place: "New Delhi, Inde", country: "IN", lat: 28.6129, lon: 77.2295, category: "arts", size: 120,
    text: "Le mémorial de grès rouge se dresse au bout de l'allée, à l'heure où la brume du soir se dore, à New Delhi.",
    draw: (k) => {
      k.sky([150, 130, 160], [250, 196, 130], 0, 0.66);
      k.clouds(0.05, 0.55, 0.38, [255, 214, 170], [160, 120, 150], { seed: 41, scale: 3, sun: [0.5, 0.7], alpha: 0.7 });
      k.sun(0.5, 0.62, 0.05, [255, 226, 150]).glow(0.5, 0.6, 0.6, [255, 190, 110], 0.55);
      k.foliage(0.1, 0.58, 0.14, 0.09, [44, 70, 44], [120, 120, 60], 70).foliage(0.9, 0.58, 0.14, 0.09, [44, 70, 44], [120, 120, 60], 70);
      // the gate: a great arch of red and gold sandstone
      const sand: RGB = [222, 150, 100], sandD: RGB = [150, 86, 64];
      k.hgrad(0.3, 0.3, 0.4, 0.4, sand, sandD).texture(0.3, 0.3, 0.4, 0.4, 0.14, 120, 4);
      k.rect(0.28, 0.26, 0.44, 0.045, mix(sand, [255, 230, 190], 0.25)).rect(0.27, 0.3, 0.46, 0.012, sandD).rect(0.45, 0.22, 0.1, 0.04, mix(sand, [255, 230, 190], 0.2)).dot(0.5, 0.215, [255, 220, 150], 2);
      k.arch(0.5, 0.7, 0.2, 0.3, [62, 40, 46]);
      k.rect(0.3, 0.45, 0.4, 0.008, sandD);
      for (let i = 0; i < 6; i++) k.rect(0.32 + i * 0.012, 0.34, 0.006, 0.08, sandD).rect(0.66 - i * 0.012, 0.34, 0.006, 0.08, sandD);
      k.rect(0.26, 0.7, 0.48, 0.025, sandD);
      // the lawns and the long red path, lamps lit
      k.vgrad(0, 0.72, 1, 0.28, [110, 140, 70], [34, 64, 38]).texture(0, 0.72, 1, 0.28, 0.3, 80, 6);
      k.poly([[0.46, 0.72], [0.54, 0.72], [0.82, 1], [0.18, 1]], [196, 120, 90]).poly([[0.47, 0.72], [0.53, 0.72], [0.6, 1], [0.4, 1]], [226, 152, 110]);
      for (const [x, y] of [[0.4, 0.78], [0.6, 0.78], [0.3, 0.88], [0.7, 0.88]] as const) { k.rect(x - 0.003, y, 0.006, 0.1, [40, 34, 40]); k.glow(x, y, 0.04, [255, 214, 130], 0.9); k.dot(x, y, [255, 240, 190], 1.4); }
      for (let i = 0; i < 16; i++) k.dot(0.35 + k.next() * 0.3, 0.76 + k.next() * 0.2, [40 + k.next() * 80, 40, 60], 1.3);
      k.veil(0.4, 0.78, [255, 214, 160], 0.0, 0.3);
    },
  },
  {
    id: "lecaire", title: "Les pyramides et le Sphinx au couchant", place: "Le Caire, Égypte", country: "EG", lat: 30.0444, lon: 31.2357, category: "arts", size: 180,
    text: "Gizeh, aux portes du Caire : le Sphinx veille au pied des pyramides, dans la lumière d'or du soir.",
    draw: (k) => {
      const hz = 0.66;
      k.sky([56, 104, 190], [255, 206, 140], 0, hz);
      k.clouds(0.05, 0.45, 0.28, [255, 226, 190], [150, 130, 170], { seed: 51, scale: 3, sun: [0.85, 0.65], alpha: 0.7 });
      k.glow(0.84, 0.62, 0.6, [255, 196, 110], 0.7).sun(0.84, 0.62, 0.04, [255, 240, 190]);
      const lit: RGB = [240, 200, 134], shd: RGB = [168, 118, 82];
      const pyr = (cx: number, hw: number, apex: number, base: number) => {
        k.poly([[cx - hw, base], [cx, apex], [cx, base]], lit).poly([[cx, apex], [cx + hw, base], [cx, base]], shd);
        for (let i = 1; i < 16; i++) { const t = i / 16, y = base - (base - apex) * t, w = hw * (1 - t); k.line(cx - w, y, cx, y, 0.0018, [206, 160, 108]).line(cx, y, cx + w, y, 0.0018, [128, 88, 66]); }
        k.texture(cx - hw, apex, hw * 2, base - apex, 0.12, 100, 12);
      };
      pyr(0.78, 0.2, 0.46, hz + 0.02); pyr(0.4, 0.3, 0.2, hz + 0.04); pyr(0.1, 0.12, 0.5, hz + 0.05);
      k.veil(0.3, hz + 0.05, [255, 206, 150], 0, 0.4);
      // the dunes, rippled by the wind
      k.vgrad(0, hz + 0.02, 1, 1 - hz, [232, 186, 120], [150, 100, 64]).texture(0, hz + 0.02, 1, 1 - hz, 0.3, 140, 13);
      k.poly([[0, 0.8], [0.2, 0.74], [0.5, 0.78], [0.8, 0.72], [1, 0.76], [1, 1], [0, 1]], [214, 166, 106]).poly([[0, 0.9], [0.3, 0.84], [0.65, 0.88], [1, 0.82], [1, 1], [0, 1]], [182, 130, 84]);
      k.texture(0, 0.72, 1, 0.28, 0.2, 200, 14);
      // the Sphinx, a lion lying with a king's head, in shadow against the light
      const sp: RGB = [118, 80, 58], spl: RGB = [170, 118, 80];
      k.poly([[0.05, 0.9], [0.05, 0.83], [0.1, 0.8], [0.2, 0.79], [0.34, 0.78], [0.42, 0.81], [0.47, 0.86], [0.52, 0.9]], sp);
      k.poly([[0.1, 0.82], [0.11, 0.7], [0.14, 0.66], [0.19, 0.66], [0.2, 0.72], [0.22, 0.82]], sp);
      k.poly([[0.095, 0.73], [0.12, 0.64], [0.15, 0.615], [0.18, 0.64], [0.205, 0.73], [0.2, 0.77], [0.1, 0.77]], spl).poly([[0.12, 0.64], [0.15, 0.615], [0.15, 0.77], [0.1, 0.77]], mix(spl, sp, 0.4));
      k.rect(0.128, 0.675, 0.044, 0.07, mix(spl, [236, 190, 130], 0.4)).dot(0.14, 0.7, [50, 34, 30], 1.4).dot(0.162, 0.7, [50, 34, 30], 1.4).rect(0.14, 0.73, 0.02, 0.006, [90, 60, 48]);
      k.rect(0.02, 0.87, 0.14, 0.035, sp).rect(0.02, 0.87, 0.14, 0.008, spl).rect(0.05, 0.9, 0.5, 0.012, [90, 60, 50]);
      // a caravan, small, in the distance
      for (let i = 0; i < 4; i++) { const x = 0.58 + i * 0.07, y = 0.82 + i * 0.005; k.rect(x, y - 0.012, 0.03, 0.016, [60, 40, 36]).rect(x + 0.025, y - 0.03, 0.006, 0.02, [60, 40, 36]).rect(x + 0.002, y + 0.004, 0.004, 0.014, [60, 40, 36]).rect(x + 0.022, y + 0.004, 0.004, 0.014, [60, 40, 36]); }
      k.veil(0.6, 1, [255, 170, 100], 0, 0.14);
    },
  },
  {
    id: "moscou", title: "Saint-Basile sous la neige", place: "Moscou, Russie", country: "RU", lat: 55.7525, lon: 37.6231, category: "arts", size: 150,
    text: "Dômes en bulbes de toutes les couleurs sur la place Rouge, à Moscou, un soir de neige.",
    draw: (k) => {
      k.sky([24, 34, 96], [190, 140, 170], 0, 0.7);
      k.clouds(0.05, 0.6, 0.55, [236, 190, 200], [50, 60, 120], { seed: 61, scale: 3, sun: [0.5, 0.8] });
      // the Kremlin wall at the back, crenellated, and its tower
      k.rect(0.62, 0.52, 0.4, 0.2, [150, 44, 40]);
      for (let i = 0; i < 14; i++) k.rect(0.62 + i * 0.03, 0.495, 0.018, 0.03, [150, 44, 40]);
      k.rect(0.84, 0.3, 0.07, 0.24, [166, 50, 44]).poly([[0.83, 0.3], [0.875, 0.12], [0.92, 0.3]], [56, 96, 72]).dot(0.875, 0.11, [255, 214, 120], 1.8).windows(0.855, 0.36, 0.03, 0.1, 2, 4, [255, 214, 130], [60, 30, 36], 0.7, 0.6);
      // the cathedral: red brick walls, white trim, kokoshnik arches
      const brick: RGB = [178, 56, 46], brickD: RGB = [104, 30, 34];
      k.hgrad(0.1, 0.46, 0.56, 0.3, brick, brickD).texture(0.1, 0.46, 0.56, 0.3, 0.16, 140, 5);
      for (let i = 0; i < 9; i++) { const x = 0.12 + i * 0.06; k.arch(x + 0.025, 0.58, 0.04, 0.1, [250, 240, 224]); k.rect(x + 0.02, 0.56, 0.01, 0.06, [60, 24, 30]); }
      for (let i = 0; i < 9; i++) k.rect(0.115 + i * 0.06, 0.66, 0.05, 0.012, [250, 240, 224]);
      k.rect(0.1, 0.76, 0.56, 0.02, [226, 216, 200]);
      // the tent tower, tall, then the domes around: stripes, spirals, gold crosses
      k.poly([[0.34, 0.5], [0.34, 0.3], [0.38, 0.22], [0.42, 0.3], [0.42, 0.5]], brick).poly([[0.38, 0.22], [0.42, 0.3], [0.42, 0.5], [0.4, 0.5], [0.4, 0.3]], brickD);
      k.poly([[0.32, 0.3], [0.38, 0.1], [0.44, 0.3]], [236, 228, 214]).poly([[0.38, 0.1], [0.44, 0.3], [0.41, 0.3]], [190, 180, 170]);
      onion(k, 0.38, 0.11, 0.022, [255, 206, 90], [190, 130, 40], 1);
      const doms: [number, number, number, RGB, RGB][] = [[0.17, 0.46, 0.055, [48, 140, 96], [236, 214, 90]], [0.27, 0.43, 0.05, [220, 70, 60], [250, 230, 200]], [0.5, 0.43, 0.05, [66, 110, 196], [250, 230, 200]], [0.6, 0.47, 0.055, [236, 190, 70], [60, 130, 90]], [0.38, 0.5, 0.05, [210, 60, 90], [250, 220, 140]]];
      for (const [x, y, r, a, b] of doms) { k.rect(x - r * 0.45, y, r * 0.9, 0.09, [246, 236, 220]); onion(k, x, y, r, a, b, 0); }
      // the square: cobbles, snow, lamp posts and their light
      k.vgrad(0, 0.76, 1, 0.24, [150, 140, 150], [60, 56, 80]).texture(0, 0.76, 1, 0.24, 0.35, 150, 6);
      for (let i = 0; i < 10; i++) k.line(0.5, 0.76, i * 0.12 - 0.05, 1, 0.002, [80, 74, 96]);
      for (let i = 0; i < 5; i++) k.line(0, 0.78 + i * 0.055, 1, 0.78 + i * 0.055, 0.002, [80, 74, 96]);
      for (const x of [0.12, 0.62, 0.9]) { k.rect(x - 0.004, 0.66, 0.008, 0.16, [30, 28, 40]); k.glow(x, 0.66, 0.1, [255, 214, 140], 0.9); k.dot(x, 0.66, [255, 244, 200], 2); }
      for (let i = 0; i < 80; i++) k.dot(k.next(), k.next() * 0.9, [250, 250, 255], 0.8 + k.next());
      k.veil(0.7, 1, [236, 236, 255], 0, 0.15);
    },
  },
  {
    id: "mexico", title: "L'Ange de l'Indépendance", place: "Mexico, Mexique", country: "MX", lat: 19.427, lon: -99.1677, category: "arts", size: 90,
    text: "La Victoire dorée veille sur le Paseo de la Reforma, bordé de jacarandas en fleurs, à Mexico.",
    draw: (k) => {
      k.sky([54, 134, 224], [196, 224, 248], 0, 0.7);
      k.clouds(0.03, 0.55, 0.5, [255, 255, 255], [150, 176, 214], { seed: 71, scale: 3, sun: [0.3, 0] });
      skyline(k, 0.72, 0.04, 0.16, 18, [120, 150, 190], [150, 176, 210]);
      k.veil(0.5, 0.74, [210, 230, 250], 0, 0.5);
      // jacarandas in bloom on both sides
      for (const [x, y, r] of [[0.1, 0.62, 0.15], [0.88, 0.6, 0.16], [0.24, 0.7, 0.1], [0.76, 0.7, 0.1]] as const) k.rect(x - 0.01, y, 0.02, 0.22, [76, 56, 52]).foliage(x, y - 0.02, r, r * 0.8, [110, 70, 160], [220, 170, 230], 110);
      // the column, its stone shaft, its gilded Victory
      k.hgrad(0.46, 0.3, 0.08, 0.42, [232, 224, 206], [150, 140, 128]).rect(0.44, 0.7, 0.12, 0.04, [208, 198, 182]).rect(0.42, 0.74, 0.16, 0.03, [188, 178, 164]).rect(0.4, 0.77, 0.2, 0.03, [168, 158, 146]);
      k.rect(0.45, 0.28, 0.1, 0.03, [214, 204, 186]).rect(0.47, 0.25, 0.06, 0.03, [236, 228, 212]);
      k.poly([[0.49, 0.25], [0.51, 0.25], [0.52, 0.14], [0.48, 0.14]], [255, 206, 80]).disc(0.5, 0.12, 0.018, [255, 214, 100]);
      k.poly([[0.49, 0.2], [0.4, 0.1], [0.44, 0.18]], [236, 180, 60]).poly([[0.51, 0.2], [0.6, 0.1], [0.56, 0.18]], [236, 180, 60]).line(0.5, 0.14, 0.58, 0.06, 0.012, [255, 214, 100]);
      k.glow(0.5, 0.15, 0.12, [255, 226, 140], 0.5);
      // the avenue
      k.vgrad(0, 0.8, 1, 0.2, [112, 112, 120], [64, 64, 76]).poly([[0.45, 0.8], [0.55, 0.8], [0.9, 1], [0.1, 1]], [88, 88, 98]);
      for (let i = 0; i < 4; i++) k.line(0.5, 0.83 + i * 0.045, 0.5, 0.845 + i * 0.045, 0.004 + i * 0.002, [236, 220, 120]);
      k.texture(0, 0.8, 1, 0.2, 0.2, 60, 3);
      k.veil(0.7, 1, [255, 240, 200], 0, 0.1);
    },
  },
  {
    id: "buenosaires", title: "L'Obélisque sur la 9 de Julio", place: "Buenos Aires, Argentine", country: "AR", lat: -34.6037, lon: -58.3816, category: "arts", size: 80,
    text: "L'Obélisque se dresse au milieu de l'une des avenues les plus larges du monde, à Buenos Aires, au coucher du soleil.",
    draw: (k) => {
      k.sky([60, 92, 176], [255, 168, 120], 0, 0.78);
      k.clouds(0.05, 0.6, 0.45, [255, 196, 170], [90, 90, 150], { seed: 81, scale: 3, sun: [0.5, 0.8] });
      k.glow(0.5, 0.78, 0.6, [255, 190, 120], 0.6);
      // the avenue, converging on the horizon, and the buildings that line it
      k.vgrad(0, 0.78, 1, 0.22, [150, 110, 110], [50, 50, 70]);
      k.poly([[0.46, 0.78], [0.54, 0.78], [0.98, 1], [0.02, 1]], [70, 70, 84]);
      for (const x of [0.3, 0.5, 0.7]) k.line(0.5, 0.78, 0.5 + (x - 0.5) * 2.4, 1, 0.004, [236, 226, 200]);
      for (const side of [-1, 1] as const) for (let i = 0; i < 5; i++) {
        const x0 = 0.5 + side * (0.1 + i * 0.07), h = 0.3 - i * 0.04, w = 0.07 * side;
        k.poly([[x0, 0.78], [x0 + w, 0.78], [x0 + w, 0.78 - h], [x0, 0.78 - h - 0.02]], mix([120, 100, 130], [236, 170, 140], i / 5));
        k.windows(Math.min(x0, x0 + w) + 0.005, 0.78 - h + 0.01, 0.06, h - 0.03, 3, 6, [255, 214, 140], [76, 66, 96], 0.4, 0.5);
      }
      k.veil(0.4, 0.8, [255, 190, 140], 0, 0.4);
      // the obelisk: white stone, a pyramid on top, lit on one side
      k.poly([[0.46, 0.84], [0.5, 0.84], [0.5, 0.2], [0.48, 0.2]], [244, 238, 226]).poly([[0.5, 0.84], [0.54, 0.84], [0.52, 0.2], [0.5, 0.2]], [170, 160, 150]).poly([[0.48, 0.2], [0.5, 0.12], [0.52, 0.2]], [255, 250, 240]);
      k.rect(0.44, 0.84, 0.12, 0.02, [200, 190, 176]).glow(0.5, 0.5, 0.3, [255, 200, 140], 0.25);
      for (const [x, y] of [[0.3, 0.9], [0.7, 0.92]] as const) { k.rect(x, y - 0.04, 0.04, 0.03, [200, 60, 50]).disc(x + 0.006, y - 0.008, 0.008, [10, 10, 14]).disc(x + 0.034, y - 0.008, 0.008, [10, 10, 14]); }
    },
  },
  {
    id: "seoul", title: "La tour N Seoul, nuit d'été", place: "Séoul, Corée du Sud", country: "KR", lat: 37.5512, lon: 126.9882, category: "arts", size: 100,
    text: "Sur la colline de Namsan, la tour brille au-dessus de Séoul et du fleuve Han, une nuit d'été.",
    draw: (k) => {
      k.sky([6, 8, 34], [64, 56, 120], 0, 0.7).stars(60, [255, 250, 240], 0.5);
      k.clouds(0.1, 0.5, 0.25, [120, 110, 170], [20, 20, 60], { seed: 91, scale: 3, sun: [0.5, 0.5], alpha: 0.5 });
      // the hill and its trees, black against the glow of the city
      k.poly([[0, 0.74], [0.12, 0.62], [0.3, 0.52], [0.5, 0.44], [0.72, 0.52], [0.9, 0.62], [1, 0.74], [1, 0.8], [0, 0.8]], [14, 22, 40]).veil(0.5, 0.8, [120, 90, 160], 0, 0.45);
      for (let i = 0; i < 30; i++) { const x = 0.05 + (i / 30) * 0.9; k.foliage(x, 0.62 + Math.abs(x - 0.5) * 0.3, 0.03, 0.03, [8, 14, 30], [22, 40, 54], 8); }
      // the tower: shaft, two pods, antenna, all lit
      k.rect(0.488, 0.22, 0.024, 0.28, [214, 224, 236]).rect(0.488, 0.22, 0.012, 0.28, [150, 160, 180]);
      k.disc(0.5, 0.34, 0.036, [236, 244, 250]).disc(0.5, 0.34, 0.022, [80, 200, 240]).rect(0.46, 0.335, 0.08, 0.012, [255, 120, 180]);
      k.disc(0.5, 0.26, 0.022, [240, 246, 252]).rect(0.497, 0.1, 0.006, 0.12, [220, 230, 240]).dot(0.5, 0.1, [255, 80, 80], 1.8);
      k.glow(0.5, 0.34, 0.22, [120, 210, 255], 0.55).glow(0.5, 0.1, 0.06, [255, 80, 80], 0.9);
      // the river, the bridges of light, the city below
      k.vgrad(0, 0.8, 1, 0.2, [70, 60, 120], [10, 12, 36]);
      for (let i = 0; i < 90; i++) { const x = k.next(), y = 0.66 + k.next() * 0.14; k.dot(x, y, [255, 214 + k.next() * 40, 130], 0.8 + k.next() * 0.8); }
      k.reflect(0.8, [90, 80, 160], 0.6, 0.5, 0.004);
      k.lights(0.04, 0.86, 0.96, 0.86, 22, [255, 230, 160], 0.9).line(0.04, 0.855, 0.96, 0.855, 0.004, [120, 110, 150]);
    },
  },
  {
    id: "bangkok", title: "Wat Arun au bord du fleuve", place: "Bangkok, Thaïlande", country: "TH", lat: 13.7437, lon: 100.4888, category: "arts", size: 130,
    text: "Le temple de l'Aube se dresse sur le Chao Phraya, ses flèches couvertes de mosaïques de porcelaine, à Bangkok.",
    draw: (k) => {
      const hz = 0.8;
      k.sky([70, 80, 170], [255, 176, 96], 0, hz);
      k.clouds(0.04, 0.6, 0.5, [255, 190, 130], [110, 90, 160], { seed: 101, scale: 3, sun: [0.5, 0.9] });
      k.glow(0.5, 0.76, 0.7, [255, 190, 110], 0.6);
      // the prang: a tall tapering tower, tiered, covered in tiny coloured shards
      const cx = 0.5, topY = 0.08, baseY = 0.72;
      const hw = (y: number) => 0.012 + 0.13 * Math.pow((y - topY) / (baseY - topY), 1.35);
      const tiers = 8;
      for (let i = tiers; i >= 0; i--) {
        const y0 = topY + ((baseY - topY) * i) / tiers - 0.02, y1 = topY + ((baseY - topY) * (i + 1)) / tiers, w0 = hw(Math.min(baseY, y0 + 0.04)), c = i % 2 ? [236, 222, 200] as RGB : [214, 196, 170] as RGB;
        k.poly([[cx - w0, y1], [cx - w0 * 0.82, y0], [cx + w0 * 0.82, y0], [cx + w0, y1]], c).poly([[cx, y1], [cx + w0, y1], [cx + w0 * 0.82, y0], [cx, y0]], shade(c, 0.28));
        for (let q = 0; q < 26 + i * 6; q++) k.dot(cx + (k.next() - 0.5) * w0 * 1.7, y0 + k.next() * (y1 - y0), [[200, 70, 70], [70, 140, 200], [236, 190, 70], [90, 170, 120]][Math.floor(k.next() * 4)] as RGB, 0.9);
        k.rect(cx - w0 * 1.04, y1 - 0.008, w0 * 2.08, 0.012, [150, 124, 100]);
      }
      k.line(cx, topY, cx, 0.0, 0.006, [236, 196, 100]).line(cx - 0.02, 0.04, cx + 0.02, 0.04, 0.004, [236, 196, 100]);
      for (const x of [0.25, 0.75]) { k.poly([[x - 0.06, 0.72], [x - 0.012, 0.36], [x + 0.012, 0.36], [x + 0.06, 0.72]], [226, 210, 186]).poly([[x, 0.72], [x + 0.06, 0.72], [x + 0.012, 0.36], [x, 0.36]], [160, 140, 124]); for (let q = 0; q < 50; q++) k.dot(x + (k.next() - 0.5) * 0.09, 0.4 + k.next() * 0.3, [[200, 70, 70], [70, 140, 200], [236, 190, 70]][Math.floor(k.next() * 3)] as RGB, 0.9); }
      k.rect(0.12, 0.72, 0.76, 0.06, [200, 170, 140]).texture(0.12, 0.72, 0.76, 0.06, 0.2, 100, 5);
      // the river, the long-tail boat, the reflection
      k.vgrad(0, hz - 0.02, 1, 1 - hz + 0.02, [200, 130, 100], [40, 36, 70]);
      k.reflect(hz, [200, 120, 90], 0.6, 0.55, 0.005);
      k.poly([[0.12, 0.92], [0.5, 0.92], [0.46, 0.96], [0.16, 0.96]], [30, 24, 30]).rect(0.2, 0.88, 0.16, 0.04, [60, 40, 40]).line(0.5, 0.93, 0.62, 0.86, 0.006, [30, 24, 30]);
      k.veil(0.82, 1, [255, 160, 100], 0, 0.1);
    },
  },
  {
    id: "jakarta", title: "Monas, la flamme de l'Indépendance", place: "Jakarta, Indonésie", country: "ID", lat: -6.1754, lon: 106.8272, category: "arts", size: 50,
    text: "Le Monument national et sa flamme dorée dominent les jardins de Jakarta.",
    draw: (k) => {
      k.sky([60, 140, 226], [200, 232, 250], 0, 0.8);
      k.clouds(0.02, 0.6, 0.5, [255, 255, 255], [150, 180, 214], { seed: 111, scale: 3, sun: [0.3, 0] });
      k.vgrad(0, 0.78, 1, 0.22, [96, 170, 80], [34, 90, 50]).texture(0, 0.78, 1, 0.22, 0.25, 60, 6);
      k.poly([[0.44, 0.8], [0.485, 0.2], [0.515, 0.2], [0.56, 0.8]], [246, 242, 232]).poly([[0.5, 0.8], [0.56, 0.8], [0.515, 0.2], [0.5, 0.2]], [180, 176, 170]);
      k.rect(0.455, 0.2, 0.09, 0.03, [236, 232, 222]).rect(0.46, 0.17, 0.08, 0.03, [255, 252, 244]);
      k.poly([[0.49, 0.17], [0.5, 0.04], [0.51, 0.17]], [255, 200, 60]).glow(0.5, 0.1, 0.18, [255, 214, 100], 0.8);
      k.rect(0.3, 0.78, 0.4, 0.04, [214, 206, 192]).rect(0.36, 0.74, 0.28, 0.04, [236, 228, 214]);
      for (const x of [0.12, 0.9]) k.palmTree(x, 0.9, 0.5, x < 0.5 ? 0.05 : -0.05, [90, 60, 44], [30, 100, 50], [96, 170, 80]);
    },
  },
  {
    id: "washington", title: "Le Capitole à l'aube", place: "Washington, États-Unis", country: "US", lat: 38.8899, lon: -77.0091, category: "arts", size: 110,
    text: "Premières lueurs du jour sur le dôme du Capitole, au bout de l'esplanade, à Washington.",
    draw: (k) => {
      k.sky([70, 100, 190], [255, 196, 190], 0, 0.72);
      k.clouds(0.04, 0.55, 0.5, [255, 214, 200], [130, 120, 180], { seed: 121, scale: 3, sun: [0.3, 0.8] });
      k.glow(0.2, 0.7, 0.6, [255, 210, 160], 0.55);
      const wh: RGB = [244, 240, 232], whD: RGB = [176, 170, 168];
      // the wings, long and low, with their columns and rows of windows
      for (const [x, w] of [[0.02, 0.32], [0.66, 0.32]] as const) { k.hgrad(x, 0.5, w, 0.24, wh, whD).rect(x, 0.48, w, 0.02, [226, 220, 212]).windows(x + 0.01, 0.53, w - 0.02, 0.18, 9, 3, [255, 226, 160], [90, 90, 120], 0.3, 0.5); for (let i = 0; i < 9; i++) k.rect(x + 0.015 + i * (w / 9.4), 0.52, 0.012, 0.2, mix(wh, whD, 0.3)); }
      // the dome: drum with columns, ribbed dome, lantern, statue
      k.hgrad(0.34, 0.4, 0.32, 0.34, wh, whD).rect(0.33, 0.38, 0.34, 0.025, [226, 220, 212]);
      for (let i = 0; i < 12; i++) k.rect(0.36 + i * 0.024, 0.42, 0.012, 0.3, mix(wh, whD, 0.4));
      k.rect(0.38, 0.28, 0.24, 0.1, [236, 232, 224]).rect(0.38, 0.28, 0.24, 0.012, [255, 252, 246]);
      for (let i = 0; i < 9; i++) k.rect(0.4 + i * 0.024, 0.3, 0.01, 0.07, whD);
      k.dome(0.5, 0.28, 0.14, wh);
      for (let i = -5; i <= 5; i++) k.line(0.5 + i * 0.026, 0.28, 0.5 + i * 0.008, 0.135, 0.003, [190, 184, 180]);
      k.rect(0.47, 0.115, 0.06, 0.03, [236, 232, 224]).rect(0.485, 0.085, 0.03, 0.03, [226, 222, 214]).poly([[0.49, 0.085], [0.5, 0.04], [0.51, 0.085]], [60, 56, 64]);
      k.glow(0.5, 0.15, 0.2, [255, 214, 160], 0.3);
      // steps, the lawn and the trees
      k.rect(0.3, 0.72, 0.4, 0.03, [226, 220, 212]).rect(0.27, 0.75, 0.46, 0.03, [206, 200, 194]).rect(0.24, 0.78, 0.52, 0.03, [190, 184, 178]);
      k.vgrad(0, 0.81, 1, 0.19, [124, 160, 90], [40, 84, 52]).texture(0, 0.81, 1, 0.19, 0.3, 90, 4);
      k.poly([[0.46, 0.81], [0.54, 0.81], [0.7, 1], [0.3, 1]], [200, 184, 160]);
      for (const [x, y, r] of [[0.08, 0.8, 0.1], [0.92, 0.8, 0.1], [0.22, 0.86, 0.07], [0.78, 0.86, 0.07]] as const) k.foliage(x, y, r, r * 0.8, [34, 70, 40], [150, 160, 80], 90);
      k.veil(0.5, 1, [255, 214, 170], 0, 0.1);
    },
  },
  {
    id: "berlin", title: "La porte de Brandebourg", place: "Berlin, Allemagne", country: "DE", lat: 52.5163, lon: 13.3777, category: "arts", size: 70,
    text: "Surmontée de sa Quadrige, la porte de Brandebourg se détache sur le ciel de Berlin, à la fin d'un jour d'automne.",
    draw: (k) => {
      k.sky([110, 130, 176], [250, 206, 160], 0, 0.7);
      k.clouds(0.04, 0.6, 0.6, [255, 220, 190], [110, 110, 156], { seed: 131, scale: 3, sun: [0.5, 0.8] });
      const sand: RGB = [214, 190, 150], sandD: RGB = [140, 118, 92];
      // the wall behind, the passages lit by the evening beyond, six columns in front
      k.hgrad(0.12, 0.4, 0.76, 0.42, sand, sandD).texture(0.12, 0.4, 0.76, 0.42, 0.12, 100, 6);
      for (let i = 0; i < 5; i++) { const x = 0.18 + i * 0.128 + 0.05, w = i === 2 ? 0.1 : 0.074; k.vgrad(x + (0.078 - w) / 2, 0.46, w, 0.36, [255, 224, 170], [214, 150, 110]); k.foliage(x + 0.039, 0.79, 0.03, 0.03, [92, 70, 40], [190, 130, 60], 10); }
      k.rect(0.1, 0.34, 0.8, 0.06, mix(sand, [255, 240, 210], 0.25)).rect(0.08, 0.4, 0.84, 0.02, sandD).rect(0.28, 0.26, 0.44, 0.08, sand).rect(0.28, 0.26, 0.44, 0.012, [236, 212, 170]);
      for (let i = 0; i < 6; i++) { const x = 0.15 + i * 0.128; k.hgrad(x, 0.42, 0.05, 0.4, mix(sand, [255, 240, 210], 0.3), sandD).rect(x - 0.008, 0.42, 0.066, 0.016, sandD).rect(x - 0.008, 0.81, 0.066, 0.014, sandD); }
      // the Quadriga: a chariot and four horses, green with age, against the sky
      const bronze: RGB = [84, 134, 108], bronzeL: RGB = [150, 196, 160];
      k.rect(0.38, 0.2, 0.26, 0.06, bronze).poly([[0.36, 0.26], [0.38, 0.17], [0.64, 0.17], [0.66, 0.26]], bronze);
      for (let i = 0; i < 4; i++) { const x = 0.37 + i * 0.065; k.poly([[x, 0.19], [x + 0.005, 0.12], [x + 0.025, 0.07], [x + 0.045, 0.06], [x + 0.052, 0.085], [x + 0.038, 0.1], [x + 0.044, 0.14], [x + 0.05, 0.19]], i % 2 ? bronze : mix(bronze, bronzeL, 0.35)); }
      k.rect(0.5, 0.055, 0.016, 0.12, bronze).disc(0.508, 0.05, 0.016, bronzeL).line(0.508, 0.065, 0.58, 0.02, 0.008, bronzeL).tri(0.57, 0.02, 0.6, 0.0, 0.6, 0.04, bronzeL);
      k.vgrad(0, 0.82, 1, 0.18, [150, 140, 120], [86, 80, 76]).texture(0, 0.82, 1, 0.18, 0.3, 120, 7);
      for (const [x, y, r] of [[0.06, 0.78, 0.1], [0.94, 0.78, 0.1]] as const) k.foliage(x, y, r, r * 0.9, [120, 70, 30], [236, 170, 70], 80);
      k.veil(0.6, 1, [255, 214, 160], 0, 0.1);
    },
  },
];

/** The pictures that stand in for the drawings: `<folder>/<id>.webp|png|jpg|jpeg`, one per capital (those without a file keep the drawing). */
const IMAGE_EXT = [".webp", ".png", ".jpg", ".jpeg"];
/** A stored creation must stay well under the upload limit (3 MB): the finest scale whose PNG fits is the one kept. */
const MAX_PNG = Math.floor(MAX_UPLOAD_BYTES * 0.88);

/**
 * Reads the supplied pictures of the capitals: each is cut to a square from its centre and made `size × k` pixels wide, where `k` (1 to 10 dots per grid
 * pixel) is the finest scale that the picture itself can fill, that fits the 4-million-dot cap and whose stored PNG stays under the upload limit.
 * A folder that does not exist gives an empty map (every capital keeps its drawing).
 */
export async function loadCapitalImages(dir: string): Promise<Map<string, Raster>> {
  const out = new Map<string, Raster>();
  if (!fs.existsSync(dir)) return out;
  for (const c of CAPITALS) {
    const file = IMAGE_EXT.map((e) => path.join(dir, c.id + e)).find((f) => fs.existsSync(f));
    if (!file) continue;
    const input = fs.readFileSync(file), meta = await sharp(input).metadata();
    const side = Math.min(meta.width ?? c.size, meta.height ?? c.size);
    for (let k = Math.max(1, Math.min(10, Math.floor(side / c.size))); k >= 1; k--) {
      if (c.size * k * c.size * k > CREATION_MAX_DOTS) continue;
      const w = c.size * k;
      const data = await sharp(input).rotate().resize(w, w, { fit: "cover", position: "centre", kernel: "lanczos3" }).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer();
      const png = await sharp(data, { raw: { width: w, height: w, channels: 3 } }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
      if (png.length <= MAX_PNG || k === 1) { out.set(c.id, { w, h: w, data: new Uint8Array(data) }); break; }
    }
  }
  return out;
}

export function capitalsPlan(res = 4, images?: Map<string, Raster>): DemoItem[] {
  return CAPITALS.map((e, i) => ({
    index: i, username: `demo_${e.id}`.slice(0, 24), emailLocal: `demo-c${String(i + 1).padStart(3, "0")}`,
    title: e.title, description: e.text, style: "icon" as const, kind: "land" as const, w: e.size, h: e.size,
    anchor: { name: e.place, lat: e.lat, lon: e.lon, country: e.country }, spot: { name: e.place, lat: e.lat, lon: e.lon },
    seed: 9000 + i, ageHours: 6 + ((i * 53) % 400), exact: true, illustration: true, category: e.category,
    i18n: Object.fromEntries(HERITAGE_LANGS.flatMap((l) => { const t = CAPITALS_I18N[e.id]?.[l]; return t ? [[l, { title: t[0], description: t[1] }]] : []; })),
    render: (w: number, _h: number, seed: number) => { const given = images?.get(e.id); if (given) return given; const k = new Photo(w, seed, res); e.draw(k); return k.finishPhoto(); },
  }));
}
