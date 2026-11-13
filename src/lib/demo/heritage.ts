/**
 * "World heritage": 100 hand-drawn pixel-art parcels for the DEMONSTRATION data of a test site — historic places, cultures, food, music,
 * discoveries and today's world — each placed where it really is, no bigger than 50 × 50 pixels, with a title and a sentence of its own.
 * Pure data and drawing code (see `scene.ts`); nothing is fetched, nothing is a photograph or a logo, no real person is shown.
 * Used by `seedDemo` through `heritagePlan` (`npm run demo:seed -- … --set heritage`).
 */
import { HERITAGE_I18N, HERITAGE_LANGS } from "./heritage-i18n";
import type { DemoItem } from "./plan";
import { C, Canvas, type RGB } from "./scene";

export type HeritageCategory = "arts" | "nature" | "science" | "food" | "future" | "tribute" | "other";

export interface Heritage {
  id: string;
  title: string;
  /** One sentence, in French, factual and neutral. */
  text: string;
  /** What it is about (the "place" field of the archive) and its country. */
  place: string;
  country: string;
  lat: number;
  lon: number;
  category: HeritageCategory;
  w: number;
  h: number;
  draw: (k: Canvas) => void;
}

const H = (id: string, title: string, place: string, country: string, lat: number, lon: number, category: HeritageCategory, size: [number, number], text: string, draw: (k: Canvas) => void): Heritage =>
  ({ id, title, text, place, country, lat, lon, category, w: size[0], h: size[1], draw });

const day = (k: Canvas, to = 0.7) => k.sky(C.skyTop, C.skyLow, 0, to);
const dusk = (k: Canvas, to = 0.7) => k.sky(C.duskTop, C.duskLow, 0, to);
const night = (k: Canvas, to = 0.8) => k.sky(C.nightTop, C.nightLow, 0, to).stars(14);
const shade = (c: RGB, t: number): RGB => [Math.round(c[0] * (1 - t)), Math.round(c[1] * (1 - t)), Math.round(c[2] * (1 - t))];
const tint = (c: RGB, t: number): RGB => [Math.round(c[0] + (255 - c[0]) * t), Math.round(c[1] + (255 - c[1]) * t), Math.round(c[2] + (255 - c[2]) * t)];

export const HERITAGE: Heritage[] = [
  /* ------------------------------------------------------------------ places and monuments */
  H("giza", "Les pyramides de Gizeh", "Gizeh, Égypte", "EG", 29.98, 31.13, "arts", [50, 50], "Il y a plus de 4 500 ans, l'Égypte ancienne bâtissait ces tombeaux monumentaux près du Caire.", (k) => {
    day(k, 0.66).sun(0.82, 0.2, 0.09).ground(0.66, C.sand);
    k.pyramid(0.62, 0.7, 0.34, 0.42, C.sandLight, C.sandDark).pyramid(0.2, 0.74, 0.2, 0.24, C.sandLight, C.sandDark).pyramid(0.9, 0.76, 0.12, 0.14, C.sandLight, C.sandDark);
    k.dome(0.3, 1, 0.34, C.sandLight).dome(0.85, 1, 0.3, C.sandDark).dot(0.5, 0.9, C.brownDark, 2).dot(0.54, 0.88, C.brownDark, 2).rect(0.5, 0.92, 0.07, 0.02, C.brownDark);
  }),
  H("muraille", "La Grande Muraille", "Badaling, Chine", "CN", 40.36, 116.02, "arts", [50, 36], "Des milliers de kilomètres de fortifications, bâties et reconstruites pendant plus de deux millénaires.", (k) => {
    day(k, 0.8).cloud(0.2, 0.2, 0.07);
    k.mountain(0.2, 0.9, 0.4, 0.5, C.greenDark, shade(C.greenDark, 0.35)).mountain(0.75, 0.9, 0.45, 0.62, C.green, C.greenDark).ground(0.9, C.greenDark);
    k.line(0, 0.74, 0.28, 0.6, 0.09, C.stone).line(0.28, 0.6, 0.6, 0.42, 0.09, C.stone).line(0.6, 0.42, 1, 0.3, 0.09, C.stone);
    for (const [x, y] of [[0.28, 0.6], [0.6, 0.42], [0.92, 0.32]] as const) k.rect(x - 0.045, y - 0.15, 0.09, 0.15, C.stoneLight).rect(x - 0.045, y - 0.15, 0.09, 0.03, C.stoneDark).dot(x, y - 0.08, C.black, 1);
  }),
  H("colisee", "Le Colisée", "Rome, Italie", "IT", 41.89, 12.49, "arts", [44, 36], "Inauguré à Rome en l'an 80, il pouvait accueillir des dizaines de milliers de spectateurs.", (k) => {
    dusk(k, 0.5).ground(0.84, C.sandDark);
    k.rect(0.06, 0.28, 0.88, 0.56, C.sand).rect(0.06, 0.28, 0.88, 0.04, C.sandLight);
    for (const [y, n] of [[0.36, 9], [0.52, 9], [0.68, 9]] as const) for (let i = 0; i < n; i++) k.arch(0.12 + i * 0.095, y + 0.14, 0.05, 0.13, C.brownDark);
    k.tri(0.06, 0.28, 0.2, 0.14, 0.2, 0.28, C.sand).tri(0.06, 0.28, 0.12, 0.28, 0.12, 0.2, C.duskLow);
  }),
  H("parthenon", "Le Parthénon", "Athènes, Grèce", "GR", 37.97, 23.73, "arts", [40, 40], "Temple d'Athéna sur l'Acropole d'Athènes, achevé au Ve siècle avant notre ère.", (k) => {
    day(k, 0.62).ground(0.8, C.stoneDark).rect(0.04, 0.74, 0.92, 0.07, C.stone);
    k.rect(0.1, 0.66, 0.8, 0.08, C.stoneLight).rect(0.12, 0.3, 0.76, 0.05, C.stoneLight).tri(0.1, 0.3, 0.5, 0.12, 0.9, 0.3, C.stoneLight).tri(0.2, 0.29, 0.5, 0.17, 0.8, 0.29, C.stone);
    k.columns(0.17, 0.83, 0.35, 0.66, 7, 0.07, C.stoneLight);
    for (const x of [0.17, 0.32, 0.5, 0.67, 0.83]) k.rect(x - 0.012, 0.35, 0.012, 0.31, C.stone);
  }),
  H("eiffel", "La tour Eiffel", "Paris, France", "FR", 48.858, 2.294, "arts", [30, 40], "Érigée pour l'Exposition universelle de 1889, elle ne devait rester que vingt ans.", (k) => {
    dusk(k, 0.86).ground(0.88, C.greenDark);
    const c = C.brownDark;
    k.poly([[0.5, 0.06], [0.54, 0.3], [0.62, 0.62], [0.78, 0.88], [0.68, 0.88], [0.5, 0.52], [0.32, 0.88], [0.22, 0.88], [0.38, 0.62], [0.46, 0.3]], c);
    k.rect(0.36, 0.3, 0.28, 0.03, c).rect(0.28, 0.6, 0.44, 0.04, c).tri(0.4, 0.88, 0.5, 0.64, 0.6, 0.88, C.duskLow).line(0.5, 0.06, 0.5, 0.0, 0.03, c);
  }),
  H("tajmahal", "Le Taj Mahal", "Agra, Inde", "IN", 27.175, 78.042, "arts", [44, 44], "Mausolée de marbre blanc construit à Agra au XVIIe siècle, à la mémoire d'une épouse aimée.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.72).ground(0.72, C.waterLight).waves(0.8, 0.2, C.water, C.waterLight);
    k.rect(0.28, 0.46, 0.44, 0.26, C.white).dome(0.5, 0.46, 0.18, C.white).tri(0.47, 0.28, 0.5, 0.16, 0.53, 0.28, C.white).arch(0.5, 0.72, 0.1, 0.2, C.stoneDark);
    for (const x of [0.12, 0.88]) { k.rect(x - 0.025, 0.3, 0.05, 0.42, C.white).dome(x, 0.3, 0.035, C.white); }
    for (const x of [0.28, 0.72]) k.dome(x, 0.5, 0.045, C.white);
  }),
  H("machu", "Machu Picchu", "Cusco, Pérou", "PE", -13.163, -72.545, "arts", [50, 40], "Cité inca perchée dans les Andes, bâtie au XVe siècle.", (k) => {
    day(k, 0.6).cloud(0.75, 0.15, 0.06);
    k.mountain(0.78, 0.7, 0.3, 0.5, C.greenDark, shade(C.greenDark, 0.4)).mountain(0.15, 0.7, 0.35, 0.34, C.green, C.greenDark);
    for (let i = 0; i < 5; i++) k.rect(0.1 + i * 0.03, 0.52 + i * 0.07, 0.7 - i * 0.07, 0.07, i % 2 ? C.greenLight : C.green).rect(0.1 + i * 0.03, 0.55 + i * 0.07, 0.7 - i * 0.07, 0.02, C.stone);
    for (const [x, y] of [[0.3, 0.5], [0.45, 0.58], [0.58, 0.66]] as const) k.rect(x, y - 0.05, 0.07, 0.05, C.stoneLight).tri(x - 0.01, y - 0.05, x + 0.035, y - 0.1, x + 0.08, y - 0.05, C.sandDark);
  }),
  H("chichen", "Chichén Itzá", "Yucatán, Mexique", "MX", 20.683, -88.568, "arts", [44, 44], "Cité maya du Yucatán, dominée par la pyramide de Kukulcán et ses quatre escaliers.", (k) => {
    day(k, 0.7).ground(0.72, C.greenDark).dome(0.1, 0.8, 0.12, C.green).dome(0.9, 0.8, 0.14, C.green);
    k.steps(0.5, 0.78, 0.4, 0.5, 9, C.stoneLight, C.stoneDark).rect(0.38, 0.14, 0.24, 0.12, C.stone).rect(0.46, 0.18, 0.08, 0.08, C.black).rect(0.47, 0.26, 0.06, 0.52, C.sandDark);
  }),
  H("angkor", "Angkor Vat", "Siem Reap, Cambodge", "KH", 13.412, 103.867, "arts", [50, 40], "Le plus grand monument religieux du monde, construit au XIIe siècle au Cambodge.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.62).sun(0.5, 0.52, 0.12, C.orange).waves(0.74, 0.26, C.water, C.waterLight);
    k.rect(0.12, 0.54, 0.76, 0.2, C.stoneDark);
    for (const [x, h] of [[0.5, 0.42], [0.34, 0.3], [0.66, 0.3], [0.2, 0.18], [0.8, 0.18]] as const) { k.rect(x - 0.035, 0.74 - h - 0.1, 0.07, h + 0.1, C.stoneDark); k.tri(x - 0.045, 0.74 - h - 0.1, x, 0.74 - h - 0.24, x + 0.045, 0.74 - h - 0.1, C.stoneDark); }
    k.rect(0.12, 0.72, 0.76, 0.03, C.black);
  }),
  H("petra", "Pétra", "Pétra, Jordanie", "JO", 30.329, 35.444, "arts", [36, 44], "Cité nabatéenne taillée dans le grès rose du désert jordanien.", (k) => {
    k.sky(C.skyTop, C.skyLow, 0, 0.2).rect(0, 0, 1, 1, C.clay);
    k.sky(C.skyTop, C.skyLow, 0, 0.12);
    k.rect(0, 0, 0.22, 1, shade(C.clay, 0.35)).rect(0.78, 0, 0.22, 1, shade(C.clay, 0.35));
    k.rect(0.26, 0.2, 0.48, 0.68, tint(C.clay, 0.25)).rect(0.3, 0.26, 0.4, 0.04, C.clay).columns(0.34, 0.66, 0.34, 0.56, 4, 0.06, tint(C.clay, 0.4));
    k.rect(0.4, 0.56, 0.2, 0.32, C.brownDark).tri(0.26, 0.2, 0.5, 0.1, 0.74, 0.2, tint(C.clay, 0.25)).disc(0.5, 0.2, 0.05, C.brownDark).ground(0.88, C.sandDark);
  }),
  H("stonehenge", "Stonehenge", "Wiltshire, Angleterre", "GB", 51.179, -1.826, "arts", [50, 36], "Cercle de pierres dressées il y a plus de 4 000 ans, au cœur de la campagne anglaise.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.66).sun(0.5, 0.64, 0.1, C.gold).ground(0.66, C.greenLight).ground(0.82, C.green);
    for (const [x, h] of [[0.12, 0.3], [0.26, 0.34], [0.7, 0.34], [0.84, 0.3]] as const) k.rect(x, 0.82 - h, 0.08, h, C.stoneDark);
    k.rect(0.22, 0.46, 0.2, 0.06, C.stone).rect(0.66, 0.46, 0.2, 0.06, C.stone);
    for (const [x, h] of [[0.42, 0.22], [0.52, 0.22]] as const) k.rect(x, 0.82 - h, 0.06, h, C.stone);
  }),
  H("montsaintmichel", "Le Mont-Saint-Michel", "Normandie, France", "FR", 48.636, -1.511, "arts", [24, 30], "Abbaye perchée sur un îlot rocheux, au milieu d'une baie aux marées spectaculaires.", (k) => {
    k.sky(C.skyTop, C.skyLow, 0, 0.58).waves(0.78, 0.22, C.waterLight, C.white).ground(0.72, C.sand);
    k.poly([[0.1, 0.78], [0.3, 0.46], [0.7, 0.46], [0.9, 0.78]], C.stoneDark).rect(0.3, 0.36, 0.4, 0.14, C.stone).rect(0.4, 0.24, 0.2, 0.14, C.stoneLight).tri(0.46, 0.24, 0.5, 0.0, 0.54, 0.24, C.stoneDark);
  }),
  H("hagia", "Sainte-Sophie", "Istanbul, Turquie", "TR", 41.008, 28.98, "arts", [36, 36], "Basilique achevée en 537 : sa grande coupole a traversé quinze siècles d'histoire.", (k) => {
    dusk(k, 0.74).ground(0.8, C.stoneDark);
    k.rect(0.2, 0.46, 0.6, 0.34, C.clay).dome(0.5, 0.5, 0.26, tint(C.clay, 0.2)).dome(0.5, 0.5, 0.2, C.clay).dome(0.2, 0.62, 0.1, tint(C.clay, 0.2)).dome(0.8, 0.62, 0.1, tint(C.clay, 0.2));
    for (const x of [0.06, 0.94]) { k.rect(x - 0.025, 0.2, 0.05, 0.6, C.stoneLight).tri(x - 0.035, 0.2, x, 0.04, x + 0.035, 0.2, C.greyDark); }
    for (const x of [0.4, 0.5, 0.6]) k.rect(x - 0.012, 0.58, 0.024, 0.08, C.gold);
  }),
  H("alhambra", "L'Alhambra", "Grenade, Espagne", "ES", 37.177, -3.588, "arts", [40, 36], "Palais-forteresse de Grenade, joyau de l'art nasride, entouré de jardins et de fontaines.", (k) => {
    day(k, 0.6).mountain(0.5, 0.72, 0.6, 0.4, C.snow, C.stoneLight).ground(0.7, C.green);
    k.rect(0.12, 0.4, 0.76, 0.32, C.clay).rect(0.12, 0.36, 0.76, 0.05, tint(C.clay, 0.25));
    for (const x of [0.12, 0.3, 0.7, 0.88]) k.rect(x - 0.03, 0.28, 0.07, 0.12, tint(C.clay, 0.2));
    for (const x of [0.3, 0.5, 0.7]) k.arch(x, 0.72, 0.1, 0.22, C.brownDark);
    k.rect(0.2, 0.84, 0.6, 0.08, C.water).rect(0.2, 0.84, 0.6, 0.02, C.waterLight);
  }),
  H("sagrada", "La Sagrada Família", "Barcelone, Espagne", "ES", 41.404, 2.174, "arts", [30, 40], "Basilique de Gaudí en chantier depuis 1882, mélange de pierre, de lumière et de nature.", (k) => {
    day(k, 0.9).ground(0.9, C.greenDark);
    for (const [x, w, top] of [[0.2, 0.1, 0.18], [0.4, 0.1, 0.06], [0.6, 0.1, 0.06], [0.8, 0.1, 0.18]] as const) { k.rect(x - w / 2, top + 0.08, w, 0.9 - top - 0.08, C.sandDark).poly([[x - w / 2, top + 0.08], [x, top - 0.04], [x + w / 2, top + 0.08]], C.sandDark); k.dot(x, top - 0.06, C.orange, 2); for (let j = 0; j < 6; j++) k.dot(x - 0.015, top + 0.14 + j * 0.1, C.brownDark, 2); }
    k.rect(0.1, 0.62, 0.8, 0.28, C.sand).arch(0.5, 0.9, 0.16, 0.3, C.brownDark);
  }),
  H("fuji", "Le mont Fuji", "Honshū, Japon", "JP", 35.361, 138.727, "nature", [50, 40], "Volcan sacré et emblème du Japon, haut de 3 776 mètres.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.7).sun(0.78, 0.22, 0.08, C.red).cloud(0.2, 0.22, 0.05, tint(C.dawnLow, 0.3));
    k.mountain(0.45, 0.8, 0.52, 0.64, C.blue, C.navy, C.snow).ground(0.8, C.greenDark).waves(0.86, 0.14, C.water, C.waterLight);
    for (const x of [0.12, 0.2, 0.74, 0.84]) k.disc(x, 0.82, 0.05, C.pink);
  }),
  H("fushimi", "Les torii de Fushimi Inari", "Kyoto, Japon", "JP", 34.967, 135.773, "arts", [30, 40], "Des milliers de portiques vermillon gravissent la colline sacrée de Kyoto.", (k) => {
    k.fill(C.greenDark);
    for (let i = 0; i < 6; i++) { const t = i / 5, w = 0.74 - t * 0.5, y = 0.9 - t * 0.52, c = i % 2 ? C.red : shade(C.red, 0.15); k.rect(0.5 - w / 2, y - 0.1 - t * 0.04, w, 0.04, c).rect(0.5 - w / 2 - 0.03, y - 0.14 - t * 0.04, w + 0.06, 0.03, C.black).rect(0.5 - w / 2 + 0.02, y - 0.1 - t * 0.04, 0.05 - t * 0.02, 0.1 + t * 0.04, c).rect(0.5 + w / 2 - 0.07 + t * 0.02, y - 0.1 - t * 0.04, 0.05 - t * 0.02, 0.1 + t * 0.04, c); }
    k.rect(0.42, 0.9, 0.16, 0.1, C.sandDark);
  }),
  H("citeinterdite", "La Cité interdite", "Pékin, Chine", "CN", 39.916, 116.397, "arts", [44, 36], "Palais impérial de Pékin, résidence des empereurs de Chine pendant près de cinq siècles.", (k) => {
    day(k, 0.55).ground(0.8, C.stone);
    k.rect(0.1, 0.5, 0.8, 0.3, C.red).rect(0.1, 0.46, 0.8, 0.06, C.gold).tri(0.04, 0.46, 0.5, 0.18, 0.96, 0.46, C.gold).tri(0.12, 0.46, 0.5, 0.24, 0.88, 0.46, C.orange).rect(0.04, 0.44, 0.92, 0.03, C.gold);
    k.columns(0.2, 0.8, 0.54, 0.8, 6, 0.05, C.redDark).rect(0.42, 0.62, 0.16, 0.18, C.brownDark).rect(0, 0.8, 1, 0.04, C.stoneDark);
  }),
  H("terrecuite", "L'armée de terre cuite", "Xi'an, Chine", "CN", 34.385, 109.273, "arts", [40, 36], "Des milliers de soldats en argile ont été enterrés auprès du premier empereur de Chine.", (k) => {
    k.fill(C.sandDark).rect(0, 0, 1, 0.08, C.brownDark).rect(0, 0.92, 1, 0.08, C.brownDark);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) { const x = 0.1 + i * 0.16 + (r ? 0.04 : 0), y = 0.42 + r * 0.34; k.disc(x, y - 0.16, 0.05, C.clay).rect(x - 0.055, y - 0.12, 0.11, 0.3, shade(C.clay, 0.12)).rect(x - 0.03, y - 0.22, 0.06, 0.02, C.brownDark); }
  }),
  H("borobudur", "Borobudur", "Java, Indonésie", "ID", -7.608, 110.204, "arts", [50, 40], "Immense temple bouddhiste du IXe siècle, bâti en terrasses au cœur de l'île de Java.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.7).ground(0.8, C.greenDark);
    for (let i = 0; i < 5; i++) k.rect(0.1 + i * 0.06, 0.7 - i * 0.1, 0.8 - i * 0.12, 0.1, i % 2 ? C.stoneDark : C.stone);
    for (let i = 0; i < 5; i++) k.dome(0.34 + i * 0.08, 0.24, 0.035, C.stoneLight).rect(0.32 + i * 0.08, 0.24, 0.04, 0.05, C.stone);
    k.dome(0.5, 0.18, 0.07, C.stoneLight).rect(0.465, 0.18, 0.07, 0.06, C.stone).dot(0.5, 0.06, C.gold, 2);
  }),
  H("lascaux", "La grotte de Lascaux", "Dordogne, France", "FR", 45.05, 1.169, "arts", [36, 36], "Des peintures vieilles d'environ 17 000 ans couvrent les parois de cette grotte du Périgord.", (k) => {
    k.fill(C.brownDark).checker(0, 0, 1, 1, C.brownDark, shade(C.brownDark, 0.08)).rect(0, 0, 1, 0.1, C.black).rect(0, 0.9, 1, 0.1, C.black);
    k.poly([[0.16, 0.6], [0.2, 0.44], [0.4, 0.4], [0.6, 0.42], [0.72, 0.5], [0.8, 0.46], [0.8, 0.6], [0.7, 0.6], [0.66, 0.72], [0.6, 0.72], [0.56, 0.62], [0.32, 0.62], [0.28, 0.74], [0.22, 0.74]], C.redDark).poly([[0.16, 0.6], [0.2, 0.44], [0.4, 0.4], [0.32, 0.5]], C.red);
    k.tri(0.74, 0.46, 0.8, 0.36, 0.78, 0.48, C.redDark).dot(0.76, 0.5, C.sandLight, 1);
    k.dot(0.14, 0.24, C.sandLight, 2).dot(0.22, 0.2, C.sandLight, 2).dot(0.3, 0.26, C.sandLight, 2);
  }),
  H("carnac", "Les alignements de Carnac", "Bretagne, France", "FR", 47.584, -3.078, "arts", [28, 28], "Des milliers de menhirs dressés en Bretagne il y a plus de 6 000 ans.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.5).ground(0.5, C.greenLight).ground(0.74, C.green);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) { const y = 0.9 - r * 0.2, s = 1 - r * 0.2, x = 0.1 + i * 0.16; k.rect(x, y - 0.22 * s, 0.07 * s, 0.22 * s, i % 2 ? C.stoneDark : C.stone); }
  }),
  H("basile", "La cathédrale Saint-Basile", "Moscou, Russie", "RU", 55.752, 37.623, "arts", [30, 40], "Ses bulbes colorés ornent la place Rouge de Moscou depuis le XVIe siècle.", (k) => {
    k.sky(C.duskTop, C.duskLow, 0, 0.8).ground(0.9, C.stoneDark).rect(0.1, 0.5, 0.8, 0.4, C.redDark);
    for (const [x, c, y, r] of [[0.5, C.green, 0.2, 0.12], [0.22, C.gold, 0.46, 0.09], [0.78, C.blue, 0.46, 0.09], [0.36, C.red, 0.4, 0.08], [0.64, C.orange, 0.4, 0.08]] as const) { k.rect(x - r * 0.45, y, r * 0.9, 0.5 - y + 0.1, tint(C.redDark, 0.2)); k.dome(x, y, r, c); k.tri(x - r * 0.5, y - r * 0.45, x, y - r * 1.6, x + r * 0.5, y - r * 0.45, c); }
    for (let i = 0; i < 5; i++) k.rect(0.16 + i * 0.16, 0.64, 0.06, 0.1, C.black);
  }),
  H("liberte", "La statue de la Liberté", "New York, États-Unis", "US", 40.689, -74.044, "arts", [30, 40], "Offerte par la France aux États-Unis, elle accueille les voyageurs à New York depuis 1886.", (k) => {
    k.sky(C.skyTop, C.skyLow, 0, 0.9).ground(0.92, C.water);
    k.rect(0.3, 0.76, 0.4, 0.16, C.stoneDark).rect(0.36, 0.62, 0.28, 0.16, C.stone).rect(0.4, 0.34, 0.2, 0.3, C.teal).disc(0.5, 0.26, 0.09, C.teal).rect(0.64, 0.12, 0.05, 0.3, C.teal).tri(0.62, 0.12, 0.665, 0.0, 0.71, 0.12, C.gold).rect(0.32, 0.4, 0.08, 0.1, C.teal);
    for (let i = 0; i < 5; i++) k.line(0.5, 0.2, 0.4 + i * 0.05, 0.11, 0.025, C.greenLight);
  }),
  H("teotihuacan", "Teotihuacan", "Mexico, Mexique", "MX", 19.692, -98.844, "arts", [44, 40], "La pyramide du Soleil domine une grande cité mésoaméricaine, bâtie bien avant les Aztèques.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.6).ground(0.74, C.sandDark).ground(0.9, C.sand);
    k.steps(0.62, 0.78, 0.36, 0.46, 5, C.stoneLight, C.stoneDark).steps(0.12, 0.78, 0.16, 0.16, 3, C.stone, C.stoneDark).rect(0.1, 0.74, 0.8, 0.04, C.stone);
    k.line(0.1, 0.96, 0.9, 0.84, 0.04, C.sandDark);
  }),
  H("opera", "L'opéra de Sydney", "Sydney, Australie", "AU", -33.857, 151.215, "arts", [30, 30], "Ses voiles de béton, inaugurées en 1973, sont devenues l'emblème de la ville.", (k) => {
    k.sky(C.skyTop, C.skyLow, 0, 0.6).waves(0.74, 0.26, C.water, C.waterLight).rect(0.08, 0.7, 0.84, 0.06, C.stoneLight);
    k.poly([[0.1, 0.7], [0.3, 0.32], [0.46, 0.7]], C.white).poly([[0.34, 0.7], [0.52, 0.22], [0.68, 0.7]], C.snow).poly([[0.58, 0.7], [0.76, 0.38], [0.9, 0.7]], C.white).poly([[0.52, 0.22], [0.68, 0.7], [0.6, 0.7]], C.stoneLight);
  }),
  H("uluru", "Uluru", "Territoire du Nord, Australie", "AU", -25.345, 131.036, "nature", [50, 32], "Immense monolithe de grès rouge, lieu sacré du peuple Anangu, au cœur du désert australien.", (k) => {
    k.sky(C.duskTop, C.duskLow, 0, 0.66).ground(0.7, C.clay);
    k.poly([[0.0, 0.74], [0.08, 0.5], [0.26, 0.38], [0.5, 0.34], [0.74, 0.38], [0.92, 0.5], [1, 0.74]], C.red).poly([[0.5, 0.34], [0.74, 0.38], [0.92, 0.5], [1, 0.74], [0.6, 0.74]], C.redDark).ground(0.74, C.clay);
    for (const x of [0.1, 0.34, 0.8]) k.tri(x, 0.98, x + 0.03, 0.82, x + 0.06, 0.98, C.greenDark);
  }),
  H("victoria", "Les chutes Victoria", "Zambèze, Zambie et Zimbabwe", "ZM", -17.925, 25.857, "nature", [44, 44], "Le Zambèze s'y jette dans une gorge, sur plus d'un kilomètre et demi de large.", (k) => {
    day(k, 0.34).ground(0.34, C.greenDark);
    k.rect(0, 0.34, 1, 0.1, C.green).rect(0.06, 0.4, 0.88, 0.5, C.waterLight);
    for (let i = 0; i < 14; i++) k.rect(0.08 + i * 0.062, 0.4, 0.03, 0.4 + (i % 3) * 0.04, i % 2 ? C.white : C.waterLight);
    k.disc(0.3, 0.92, 0.2, C.white).disc(0.62, 0.94, 0.24, tint(C.waterLight, 0.4)).rect(0, 0.88, 1, 0.12, C.waterDark).disc(0.8, 0.9, 0.14, C.white);
  }),
  H("karnak", "Les temples de Karnak", "Louxor, Égypte", "EG", 25.719, 32.657, "arts", [36, 40], "À Louxor, une forêt de colonnes et d'obélisques élevés par les pharaons pendant des siècles.", (k) => {
    day(k, 0.7).ground(0.7, C.sand);
    k.poly([[0.76, 0.7], [0.8, 0.12], [0.84, 0.7]], C.stone).tri(0.78, 0.14, 0.8, 0.04, 0.82, 0.14, C.gold);
    k.rect(0.06, 0.5, 0.66, 0.06, C.stone).columns(0.12, 0.66, 0.56, 0.9, 6, 0.1, C.sandLight);
    for (const x of [0.12, 0.3, 0.48, 0.66]) k.rect(x - 0.06, 0.5, 0.12, 0.04, C.sandDark);
    k.ground(0.9, C.sandDark);
  }),
  H("tombouctou", "Tombouctou", "Mali", "ML", 16.775, -3.007, "arts", [36, 36], "Cité de terre, carrefour du commerce et du savoir, au bord du Sahara.", (k) => {
    k.sky(C.duskTop, C.duskLow, 0, 0.7).ground(0.82, C.sand);
    k.poly([[0.12, 0.82], [0.18, 0.34], [0.82, 0.34], [0.88, 0.82]], C.clay).rect(0.1, 0.3, 0.8, 0.06, shade(C.clay, 0.2));
    for (const x of [0.2, 0.5, 0.8]) { k.tri(x - 0.07, 0.3, x, 0.08, x + 0.07, 0.3, C.clay); k.dot(x, 0.06, C.brownDark, 2); }
    for (let i = 0; i < 6; i++) k.rect(0.28 + (i % 3) * 0.2, 0.44 + Math.floor(i / 3) * 0.2, 0.05, 0.12, C.brownDark);
    for (let j = 0; j < 4; j++) k.rect(0.16 + (j % 2) * 0.66, 0.4 + j * 0.1, 0.04, 0.04, C.brownDark);
  }),
  H("zimbabwe", "Le Grand Zimbabwe", "Masvingo, Zimbabwe", "ZW", -20.267, 30.933, "arts", [36, 32], "Ruines d'une cité de pierres sèches, capitale d'un royaume médiéval d'Afrique australe.", (k) => {
    day(k, 0.64).ground(0.64, C.green).ground(0.86, C.greenDark);
    k.rect(0.18, 0.3, 0.64, 0.42, C.stoneDark);
    for (let j = 0; j < 7; j++) for (let i = 0; i < 8; i++) if ((i + j) % 2 === 0) k.rect(0.18 + i * 0.08, 0.3 + j * 0.06, 0.08, 0.06, C.stone);
    k.rect(0.62, 0.1, 0.12, 0.28, C.stone).tri(0.6, 0.1, 0.68, 0.0, 0.76, 0.1, C.stoneDark);
  }),
  H("lalibela", "Les églises de Lalibela", "Lalibela, Éthiopie", "ET", 12.032, 39.047, "arts", [36, 36], "Des églises taillées dans le roc, en Éthiopie, il y a environ huit siècles.", (k) => {
    k.fill(C.clay).rect(0.06, 0.2, 0.88, 0.76, shade(C.clay, 0.3)).rect(0.2, 0.34, 0.6, 0.62, C.clay).rect(0.2, 0.34, 0.6, 0.05, tint(C.clay, 0.2));
    k.rect(0.46, 0.14, 0.08, 0.22, C.clay).rect(0.4, 0.2, 0.2, 0.06, C.clay).rect(0.46, 0.1, 0.08, 0.1, tint(C.clay, 0.3));
    for (let i = 0; i < 3; i++) k.rect(0.3 + i * 0.16, 0.5, 0.08, 0.18, C.brownDark).dome(0.34 + i * 0.16, 0.5, 0.04, C.brownDark);
    k.rect(0.4, 0.78, 0.2, 0.18, C.black);
  }),
  H("kilimandjaro", "Le Kilimandjaro", "Tanzanie", "TZ", -3.067, 37.355, "nature", [44, 40], "Plus haut sommet d'Afrique, à 5 895 mètres, couronné de neiges malgré l'équateur.", (k) => {
    day(k, 0.7).mountain(0.5, 0.76, 0.55, 0.5, C.stoneLight, C.stoneDark, C.snow).ground(0.76, C.green).ground(0.88, C.greenLight);
    k.disc(0.2, 0.8, 0.07, C.greenDark).disc(0.82, 0.82, 0.08, C.greenDark).rect(0.18, 0.84, 0.04, 0.1, C.brownDark).rect(0.8, 0.86, 0.04, 0.1, C.brownDark);
    k.cloud(0.2, 0.28, 0.05).cloud(0.78, 0.18, 0.05);
  }),
  H("table", "La montagne de la Table", "Le Cap, Afrique du Sud", "ZA", -33.963, 18.403, "nature", [28, 28], "Un plateau rocheux, souvent coiffé d'une « nappe » de nuages, veille sur la ville du Cap.", (k) => {
    day(k, 0.6).rect(0.0, 0.34, 1, 0.34, C.stoneDark).rect(0.0, 0.34, 1, 0.05, C.stone).ground(0.68, C.green).waves(0.84, 0.16, C.water, C.waterLight);
    k.cloud(0.3, 0.3, 0.07, C.white).cloud(0.66, 0.3, 0.06, C.white);
  }),
  H("bigben", "Big Ben", "Londres, Royaume-Uni", "GB", 51.501, -0.125, "arts", [30, 40], "La grande cloche de la tour du palais de Westminster, à Londres.", (k) => {
    k.sky(C.duskTop, C.duskLow, 0, 0.9).ground(0.92, C.water);
    k.rect(0.38, 0.34, 0.24, 0.58, C.sand).rect(0.34, 0.24, 0.32, 0.12, C.sandLight).tri(0.34, 0.24, 0.5, 0.02, 0.66, 0.24, C.greyDark).disc(0.5, 0.3, 0.1, C.white).ring(0.5, 0.3, 0.1, 0.02, C.black).line(0.5, 0.3, 0.5, 0.24, 0.02, C.black).line(0.5, 0.3, 0.55, 0.3, 0.02, C.black);
    k.rect(0.1, 0.7, 0.28, 0.22, C.sandDark).rect(0.1, 0.66, 0.28, 0.06, C.sand);
  }),
  H("pise", "La tour de Pise", "Pise, Italie", "IT", 43.723, 10.396, "arts", [30, 40], "Un clocher célèbre pour son inclinaison, que l'on admire depuis le XIIe siècle.", (k) => {
    day(k, 0.9).ground(0.9, C.greenLight);
    k.poly([[0.38, 0.9], [0.42, 0.18], [0.64, 0.14], [0.66, 0.9]], C.white);
    for (let i = 0; i < 6; i++) { const y = 0.82 - i * 0.12; k.poly([[0.38 + i * 0.01, y], [0.4 + i * 0.012, y - 0.1], [0.66 + i * 0.006, y - 0.1], [0.66, y]], i % 2 ? C.stoneLight : C.white); for (let j = 0; j < 4; j++) k.rect(0.42 + j * 0.06 + i * 0.01, y - 0.07, 0.03, 0.05, C.stoneDark); }
    k.rect(0.44, 0.08, 0.2, 0.08, C.stone);
  }),
  H("brandebourg", "La porte de Brandebourg", "Berlin, Allemagne", "DE", 52.516, 13.378, "arts", [44, 36], "Monument de Berlin, symbole de la division puis de la réunification de l'Allemagne.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.8).ground(0.84, C.stoneDark);
    k.rect(0.06, 0.34, 0.88, 0.1, C.sandLight).rect(0.04, 0.3, 0.92, 0.05, C.sand).columns(0.14, 0.86, 0.44, 0.84, 6, 0.08, C.sandLight).rect(0.38, 0.14, 0.24, 0.16, C.green).disc(0.5, 0.12, 0.04, C.gold);
    k.rect(0.06, 0.84, 0.88, 0.04, C.stone);
  }),
  H("venise", "Venise", "Vénétie, Italie", "IT", 45.434, 12.339, "arts", [28, 28], "Une cité bâtie sur l'eau, où les gondoles tiennent lieu de voitures.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.4).waves(0.55, 0.45, C.water, C.waterLight);
    for (const [x, w, c] of [[0.04, 0.24, C.clay], [0.3, 0.22, C.orange], [0.56, 0.2, C.sand], [0.78, 0.2, C.pink]] as const) { k.rect(x, 0.24, w, 0.31, c); for (let i = 0; i < 3; i++) k.rect(x + 0.03 + i * 0.07, 0.3, 0.03, 0.08, C.brownDark); }
    k.poly([[0.2, 0.84], [0.8, 0.84], [0.7, 0.92], [0.3, 0.92]], C.black).line(0.7, 0.84, 0.82, 0.74, 0.03, C.black);
  }),
  H("montblanc", "Le mont Blanc", "Alpes, France", "FR", 45.833, 6.865, "nature", [44, 44], "Toit de l'Europe occidentale, à 4 806 mètres d'altitude.", (k) => {
    day(k, 0.8).mountain(0.3, 0.8, 0.4, 0.5, C.stoneLight, C.stoneDark, C.snow).mountain(0.7, 0.8, 0.5, 0.64, C.snow, C.stoneLight, C.snow).ground(0.8, C.greenDark);
    for (const x of [0.1, 0.22, 0.8, 0.9]) k.pine(x, 0.94, 0.2);
  }),
  H("persepolis", "Persépolis", "Fars, Iran", "IR", 29.935, 52.891, "arts", [36, 36], "Capitale cérémonielle de l'empire perse, fondée vers 518 avant notre ère.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.55).ground(0.7, C.sand).ground(0.84, C.sandDark);
    k.rect(0.08, 0.66, 0.84, 0.08, C.stone);
    for (const x of [0.2, 0.4, 0.6, 0.8]) { k.rect(x - 0.03, 0.2, 0.06, 0.46, C.stoneLight).rect(x - 0.06, 0.16, 0.12, 0.06, C.stone).rect(x - 0.045, 0.64, 0.09, 0.04, C.stone); }
    k.rect(0.16, 0.14, 0.68, 0.04, C.stone);
  }),
  H("goldengate", "Le Golden Gate", "San Francisco, États-Unis", "US", 37.82, -122.478, "arts", [36, 24], "Pont suspendu rouge à l'entrée de la baie de San Francisco, ouvert en 1937.", (k) => {
    k.sky(C.duskTop, C.duskLow, 0, 0.7).waves(0.7, 0.3, C.waterDark, C.water);
    k.rect(0.2, 0.18, 0.05, 0.54, C.red).rect(0.7, 0.18, 0.05, 0.54, C.red).rect(0.15, 0.4, 0.15, 0.03, C.red).rect(0.65, 0.4, 0.15, 0.03, C.red).rect(0, 0.62, 1, 0.05, C.red);
    for (let i = 0; i <= 10; i++) { const x = 0.225 + i * 0.05, y = 0.24 + 0.34 * Math.pow((x - 0.475) / 0.25, 2); k.rect(x, y, 0.01, 0.62 - y, C.redDark); }
  }),
  H("canyon", "Le Grand Canyon", "Arizona, États-Unis", "US", 36.107, -112.113, "nature", [50, 40], "Le fleuve Colorado y creuse depuis des millions d'années une gorge longue de 446 kilomètres.", (k) => {
    day(k, 0.3);
    for (let i = 0; i < 6; i++) k.poly([[0, 0.3 + i * 0.1], [0.2 + i * 0.03, 0.28 + i * 0.1], [0.5 - i * 0.02, 0.44 + i * 0.09], [0.8 - i * 0.03, 0.3 + i * 0.1], [1, 0.28 + i * 0.1], [1, 1], [0, 1]], i % 2 ? C.clay : C.orange);
    k.poly([[0.38, 1], [0.48, 0.74], [0.56, 0.74], [0.62, 1]], C.water);
  }),
  H("apollo", "Apollo 11", "Cap Canaveral, États-Unis", "US", 28.573, -80.649, "science", [28, 40], "En juillet 1969, deux êtres humains marchaient pour la première fois sur la Lune.", (k) => {
    k.sky(C.nightTop, C.nightLow, 0, 0.9).stars(18).disc(0.8, 0.2, 0.1, C.stoneLight).ground(0.9, C.stoneDark);
    k.rect(0.42, 0.28, 0.16, 0.56, C.white).tri(0.42, 0.28, 0.5, 0.08, 0.58, 0.28, C.white).rect(0.42, 0.5, 0.16, 0.06, C.black).tri(0.42, 0.84, 0.34, 0.92, 0.42, 0.7, C.red).tri(0.58, 0.84, 0.66, 0.92, 0.58, 0.7, C.red);
    k.tri(0.44, 0.92, 0.5, 0.74, 0.56, 0.92, C.orange).tri(0.46, 0.96, 0.5, 0.84, 0.54, 0.96, C.yellow);
  }),
  H("spoutnik", "Spoutnik 1", "Baïkonour, Kazakhstan", "KZ", 45.965, 63.305, "science", [30, 30], "Lancé depuis Baïkonour en 1957, il fut le premier satellite artificiel de la Terre.", (k) => {
    k.sky(C.nightTop, C.nightLow, 0, 1).stars(26).disc(0.5, 0.52, 0.2, C.stoneLight).disc(0.46, 0.48, 0.07, C.white);
    for (const [dx, dy] of [[-0.4, -0.3], [-0.42, 0.04], [0.4, -0.3], [0.42, 0.04]] as const) k.line(0.5, 0.52, 0.5 + dx, 0.52 + dy, 0.02, C.stoneLight);
  }),

  /* ------------------------------------------------------------------ cultures, music, food */
  H("flamenco", "Le flamenco", "Séville, Espagne", "ES", 37.389, -5.984, "arts", [36, 36], "Chant, guitare et danse nés en Andalousie, inscrits au patrimoine immatériel de l'humanité.", (k) => {
    k.fill(C.ink).ground(0.84, C.brownDark).rect(0, 0.82, 1, 0.03, C.gold);
    k.poly([[0.34, 0.84], [0.42, 0.46], [0.58, 0.46], [0.72, 0.84]], C.red).poly([[0.3, 0.84], [0.36, 0.7], [0.74, 0.7], [0.78, 0.84]], C.redDark).tri(0.3, 0.84, 0.34, 0.74, 0.4, 0.84, C.red);
    k.rect(0.44, 0.34, 0.12, 0.14, C.red).disc(0.5, 0.26, 0.08, C.skin).disc(0.5, 0.18, 0.06, C.black).line(0.56, 0.4, 0.74, 0.18, 0.045, C.skin).dot(0.5, 0.17, C.red, 2);
    k.disc(0.2, 0.62, 0.12, C.sand).disc(0.2, 0.62, 0.04, C.black).line(0.2, 0.52, 0.2, 0.3, 0.04, C.brown);
  }),
  H("tango", "Le tango", "Buenos Aires, Argentine", "AR", -34.61, -58.38, "arts", [32, 32], "Né dans les faubourgs de Buenos Aires et de Montevideo au XIXe siècle.", (k) => {
    dusk(k, 0.7).ground(0.84, C.brownDark).rect(0, 0.84, 1, 0.03, C.gold);
    k.poly([[0.3, 0.84], [0.36, 0.34], [0.46, 0.3], [0.5, 0.84]], C.black).disc(0.4, 0.22, 0.07, C.black).poly([[0.7, 0.84], [0.6, 0.4], [0.5, 0.4], [0.46, 0.84]], C.red).disc(0.56, 0.31, 0.07, C.black).line(0.44, 0.44, 0.56, 0.42, 0.05, C.black);
    k.rect(0.88, 0.2, 0.02, 0.64, C.greyDark).disc(0.89, 0.18, 0.05, C.yellow);
  }),
  H("carnaval", "Le carnaval de Rio", "Rio de Janeiro, Brésil", "BR", -22.95, -43.2, "arts", [36, 36], "Chaque année, les écoles de samba font défiler plumes, paillettes et tambours.", (k) => {
    k.fill(C.purple);
    for (let i = 0; i < 11; i++) { const a = Math.PI + (i / 10) * Math.PI, c = [C.yellow, C.green, C.red, C.pink, C.teal][i % 5]!; k.line(0.5, 0.62, 0.5 + Math.cos(a) * 0.42, 0.62 + Math.sin(a) * 0.5, 0.09, c); }
    k.disc(0.5, 0.66, 0.16, C.skinDark).rect(0.42, 0.72, 0.16, 0.28, C.gold).dot(0.44, 0.64, C.black, 2).dot(0.54, 0.64, C.black, 2).rect(0.46, 0.72, 0.08, 0.02, C.red).scatter(26, 0, 0, 1, 1, [C.yellow, C.white, C.pink, C.teal]);
  }),
  H("estampe", "La Grande Vague", "Japon", "JP", 35.7, 139.75, "arts", [40, 32], "Une vague géante dans la tradition de l'estampe japonaise, avec le mont Fuji au loin.", (k) => {
    k.fill(C.paper).sky(C.paper, tint(C.dawnLow, 0.3), 0, 0.5).tri(0.5, 0.56, 0.64, 0.38, 0.8, 0.56, C.navy).tri(0.6, 0.43, 0.64, 0.38, 0.68, 0.43, C.white);
    k.rect(0, 0.56, 1, 0.44, C.navy);
    k.poly([[0, 1], [0, 0.62], [0.1, 0.4], [0.24, 0.24], [0.4, 0.2], [0.5, 0.3], [0.42, 0.3], [0.34, 0.34], [0.36, 0.5], [0.5, 0.7], [0.6, 1]], C.blue).poly([[0.24, 0.24], [0.4, 0.2], [0.5, 0.3], [0.42, 0.3], [0.34, 0.34], [0.3, 0.28]], C.white);
    for (let i = 0; i < 7; i++) k.dot(0.3 + i * 0.03, 0.18 + (i % 3) * 0.04, C.white, 2);
    for (let i = 0; i < 5; i++) k.rect(0.62 + (i % 2) * 0.08, 0.74 + i * 0.05, 0.14, 0.02, C.waterLight);
  }),
  H("holi", "Holi", "Mathura, Inde", "IN", 27.49, 77.67, "arts", [32, 32], "Fête indienne des couleurs, célébrée à l'arrivée du printemps.", (k) => {
    k.fill(C.white);
    for (const [x, y, r, c] of [[0.3, 0.3, 0.26, C.magenta], [0.66, 0.28, 0.24, C.yellow], [0.5, 0.56, 0.28, C.teal], [0.22, 0.72, 0.2, C.green], [0.78, 0.7, 0.22, C.orange]] as const) k.disc(x, y, r, c);
    k.disc(0.48, 0.4, 0.16, C.pink).disc(0.4, 0.7, 0.14, C.purple).disc(0.62, 0.45, 0.12, C.blue).scatter(40, 0, 0, 1, 1, [C.magenta, C.yellow, C.teal, C.green, C.orange, C.blue]);
    k.disc(0.5, 0.62, 0.08, C.skinDark).dot(0.47, 0.6, C.white, 1).dot(0.53, 0.6, C.white, 1);
  }),
  H("mandala", "Mandala", "Varanasi, Inde", "IN", 25.317, 82.973, "arts", [36, 36], "Motif sacré de l'hindouisme et du bouddhisme, symbole de l'univers en équilibre.", (k) => {
    k.fill(C.navy);
    k.ring(0.5, 0.5, 0.48, 0.04, C.gold).ring(0.5, 0.5, 0.4, 0.05, C.red);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.disc(0.5 + Math.cos(a) * 0.3, 0.5 + Math.sin(a) * 0.3, 0.09, i % 2 ? C.pink : C.orange); k.disc(0.5 + Math.cos(a) * 0.3, 0.5 + Math.sin(a) * 0.3, 0.035, C.yellow); }
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; k.disc(0.5 + Math.cos(a) * 0.17, 0.5 + Math.sin(a) * 0.17, 0.05, C.teal); }
    k.disc(0.5, 0.5, 0.09, C.gold).disc(0.5, 0.5, 0.04, C.red);
  }),
  H("kente", "Le kente", "Kumasi, Ghana", "GH", 6.69, -1.62, "arts", [30, 30], "Tissu cérémoniel du Ghana, où chaque motif et chaque couleur ont un sens.", (k) => {
    k.fill(C.black);
    const cols = [C.gold, C.red, C.green, C.gold, C.black];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const x = i / 8, y = j / 8, c = cols[(i + j * 2) % 5]!; if ((i + j) % 2 === 0) k.rect(x, y, 1 / 8, 1 / 8, c); else k.rect(x + 0.02, y + 0.02, 1 / 8 - 0.04, 1 / 8 - 0.04, cols[(i * 3 + j) % 5]!); }
    for (let j = 0; j < 4; j++) k.rect(0, 0.23 + j * 0.25, 1, 0.03, C.white);
  }),
  H("dogon", "Les masques dogon", "Bandiagara, Mali", "ML", 14.34, -3.61, "arts", [30, 40], "Au Mali, les danses masquées honorent les ancêtres et rythment les cérémonies.", (k) => {
    k.fill(C.clay).ground(0.92, C.sandDark);
    k.rect(0.38, 0.04, 0.24, 0.5, C.brownDark).rect(0.43, 0.04, 0.14, 0.5, C.brown).rect(0.2, 0.46, 0.6, 0.42, C.brownDark).rect(0.26, 0.5, 0.48, 0.34, C.brown);
    k.tri(0.3, 0.6, 0.4, 0.6, 0.35, 0.72, C.white).tri(0.6, 0.6, 0.7, 0.6, 0.65, 0.72, C.white).rect(0.46, 0.62, 0.08, 0.2, C.black);
    for (let i = 0; i < 6; i++) k.rect(0.2 + i * 0.1, 0.88, 0.04, 0.12, C.sand);
    for (let j = 0; j < 4; j++) k.rect(0.45, 0.1 + j * 0.1, 0.1, 0.03, C.sandLight);
  }),
  H("aborigene", "Peinture aborigène", "Alice Springs, Australie", "AU", -23.698, 133.88, "arts", [36, 36], "Points et cercles concentriques racontent le Temps du Rêve, sur le sable et sur la toile.", (k) => {
    k.fill(C.brownDark);
    const cols = [C.orange, C.yellow, C.red, C.white, C.clay];
    for (const [cx, cy, rr] of [[0.5, 0.5, 0.3], [0.2, 0.2, 0.14], [0.8, 0.22, 0.14], [0.2, 0.8, 0.14], [0.8, 0.8, 0.14]] as const) {
      k.disc(cx, cy, rr + 0.03, C.black);
      const n = Math.round(rr * 40);
      for (let ring = 1; ring * 0.07 <= rr + 0.001; ring++) { const m = ring * 7; for (let i = 0; i < m; i++) { const a = (i / m) * Math.PI * 2; k.dot(cx + Math.cos(a) * ring * 0.07 * (n / n), cy + Math.sin(a) * ring * 0.07, cols[ring % cols.length]!, 1); } }
    }
    k.line(0.36, 0.36, 0.26, 0.26, 0.03, C.clay).line(0.64, 0.36, 0.74, 0.28, 0.03, C.clay).line(0.36, 0.64, 0.26, 0.74, 0.03, C.clay).line(0.64, 0.64, 0.74, 0.74, 0.03, C.clay);
  }),
  H("maori", "Le koru maori", "Rotorua, Nouvelle-Zélande", "NZ", -38.137, 176.249, "arts", [30, 30], "Spirale de fougère qui évoque la vie, la croissance et le renouveau.", (k) => {
    k.fill(C.black).rect(0, 0, 1, 0.08, C.teal).rect(0, 0.92, 1, 0.08, C.teal);
    for (let t = 0; t <= 1; t += 0.012) { const a = t * Math.PI * 3.6 + 0.4, rr = 0.36 * (1 - t * 0.85); k.disc(0.5 + Math.cos(a) * rr * (a < 6 ? 1 : 1), 0.5 + Math.sin(a) * rr, 0.045 + (1 - t) * 0.04, t < 0.5 ? C.white : C.stoneLight); }
    k.disc(0.5, 0.5, 0.05, C.teal);
  }),
  H("totem", "Le totem", "Yukon, Canada", "CA", 60.72, -135.06, "arts", [24, 40], "Mâts sculptés des peuples du nord-ouest du Pacifique, qui racontent des familles et des histoires.", (k) => {
    day(k, 0.9).ground(0.9, C.greenDark);
    k.rect(0.3, 0.06, 0.4, 0.84, C.brown);
    k.tri(0.06, 0.2, 0.3, 0.1, 0.3, 0.3, C.red).tri(0.94, 0.2, 0.7, 0.1, 0.7, 0.3, C.red).rect(0.34, 0.12, 0.32, 0.18, C.red).rect(0.38, 0.16, 0.08, 0.05, C.white).rect(0.54, 0.16, 0.08, 0.05, C.white).tri(0.44, 0.24, 0.56, 0.24, 0.5, 0.3, C.gold);
    k.rect(0.34, 0.36, 0.32, 0.16, C.teal).rect(0.38, 0.4, 0.08, 0.05, C.white).rect(0.54, 0.4, 0.08, 0.05, C.white).rect(0.4, 0.47, 0.2, 0.03, C.black);
    k.rect(0.34, 0.58, 0.32, 0.14, C.black).rect(0.38, 0.62, 0.08, 0.04, C.gold).rect(0.54, 0.62, 0.08, 0.04, C.gold).rect(0.34, 0.76, 0.32, 0.12, C.red).rect(0.42, 0.8, 0.16, 0.04, C.white);
  }),
  H("panda", "Le panda géant", "Chengdu, Chine", "CN", 30.572, 104.066, "nature", [30, 30], "Emblème du Sichuan, il vit dans les forêts de bambous des montagnes chinoises.", (k) => {
    k.fill(C.greenLight);
    for (const x of [0.06, 0.14, 0.9, 0.82]) { k.rect(x, 0, 0.04, 1, C.green); for (let j = 0; j < 6; j++) k.rect(x, j * 0.18 + 0.1, 0.04, 0.02, C.greenDark); }
    k.disc(0.3, 0.28, 0.12, C.black).disc(0.7, 0.28, 0.12, C.black).disc(0.5, 0.52, 0.3, C.white).disc(0.36, 0.5, 0.09, C.black).disc(0.64, 0.5, 0.09, C.black).disc(0.37, 0.5, 0.03, C.white).disc(0.63, 0.5, 0.03, C.white).disc(0.5, 0.62, 0.05, C.black).rect(0.47, 0.7, 0.06, 0.02, C.black);
  }),
  H("calligraphie", "La calligraphie chinoise", "Suzhou, Chine", "CN", 31.299, 120.585, "arts", [30, 30], "Le caractère « éternité » (永), dont on apprend à tracer huit traits fondamentaux.", (k) => {
    k.fill(C.paper).rect(0.04, 0.04, 0.92, 0.92, tint(C.paper, 0.35)).rect(0.04, 0.04, 0.92, 0.02, C.red).rect(0.04, 0.94, 0.92, 0.02, C.red);
    k.disc(0.5, 0.2, 0.05, C.black).line(0.5, 0.2, 0.62, 0.24, 0.07, C.black).line(0.24, 0.34, 0.78, 0.34, 0.06, C.black).line(0.5, 0.3, 0.5, 0.74, 0.07, C.black).line(0.5, 0.74, 0.42, 0.82, 0.07, C.black).line(0.3, 0.5, 0.42, 0.6, 0.05, C.black).line(0.7, 0.5, 0.82, 0.42, 0.05, C.black).line(0.5, 0.52, 0.2, 0.84, 0.06, C.black).line(0.5, 0.52, 0.82, 0.84, 0.06, C.black);
    k.rect(0.8, 0.76, 0.1, 0.12, C.red).dot(0.84, 0.8, C.paper, 2);
  }),
  H("wayang", "Le wayang", "Yogyakarta, Indonésie", "ID", -7.797, 110.37, "arts", [36, 36], "Théâtre d'ombres javanais, où des marionnettes de cuir racontent d'anciennes épopées.", (k) => {
    k.sky(C.orange, C.yellow, 0, 1).rect(0, 0.9, 1, 0.1, C.brownDark);
    k.poly([[0.5, 0.08], [0.64, 0.3], [0.7, 0.56], [0.62, 0.88], [0.38, 0.88], [0.3, 0.56], [0.36, 0.3]], C.black);
    for (let j = 0; j < 5; j++) { k.dot(0.46, 0.28 + j * 0.12, C.orange, 3); k.dot(0.54, 0.28 + j * 0.12, C.orange, 3); k.rect(0.48, 0.3 + j * 0.12, 0.04, 0.05, C.yellow); }
    k.rect(0.7, 0.2, 0.025, 0.74, C.brownDark).rect(0.3, 0.2, 0.025, 0.74, C.brownDark);
  }),
  H("pizza", "La pizza napolitaine", "Naples, Italie", "IT", 40.852, 14.268, "food", [24, 24], "Née à Naples, son art est inscrit au patrimoine immatériel de l'humanité.", (k) => {
    k.fill(C.brownDark).disc(0.5, 0.5, 0.46, C.sand).disc(0.5, 0.5, 0.38, C.red).disc(0.5, 0.5, 0.34, C.white);
    for (const [x, y] of [[0.36, 0.38], [0.62, 0.34], [0.5, 0.56], [0.34, 0.66], [0.68, 0.64]] as const) k.disc(x, y, 0.07, C.red).dot(x, y, C.redDark, 1);
    for (const [x, y] of [[0.5, 0.36], [0.44, 0.62], [0.64, 0.5]] as const) k.disc(x, y, 0.05, C.greenDark);
  }),
  H("sushi", "Les sushi", "Osaka, Japon", "JP", 34.69, 135.5, "food", [30, 30], "Du riz vinaigré et du poisson cru : une cuisine japonaise devenue universelle.", (k) => {
    k.fill(C.brownDark).disc(0.5, 0.5, 0.48, C.black).disc(0.5, 0.5, 0.44, C.white);
    k.rect(0.12, 0.28, 0.3, 0.16, C.white).rect(0.1, 0.22, 0.34, 0.1, C.orange).rect(0.5, 0.28, 0.3, 0.16, C.white).rect(0.48, 0.22, 0.34, 0.1, C.red);
    k.disc(0.28, 0.7, 0.14, C.black).disc(0.28, 0.7, 0.09, C.white).disc(0.28, 0.7, 0.04, C.orange).disc(0.62, 0.7, 0.14, C.black).disc(0.62, 0.7, 0.09, C.white).disc(0.62, 0.7, 0.04, C.green);
    k.line(0.1, 0.9, 0.9, 0.6, 0.025, C.brown);
  }),
  H("tajine", "Le tajine", "Marrakech, Maroc", "MA", 31.63, -8.0, "food", [30, 30], "Un plat mijoté dans sa poterie à couvercle conique, emblème de la cuisine du Maroc.", (k) => {
    k.sky(C.duskTop, C.duskLow, 0, 1).ground(0.78, C.sandDark);
    k.poly([[0.12, 0.78], [0.18, 0.7], [0.82, 0.7], [0.88, 0.78]], C.clay).poly([[0.22, 0.7], [0.46, 0.18], [0.54, 0.18], [0.78, 0.7]], C.orange).disc(0.5, 0.16, 0.05, C.clay).rect(0.2, 0.66, 0.6, 0.04, C.red);
    for (const x of [0.4, 0.5, 0.6]) k.rect(x, 0.4, 0.02, 0.2, C.redDark);
    for (let i = 0; i < 4; i++) k.disc(0.4 + (i % 2) * 0.2, 0.06 - 0.02 * i + 0.04, 0.03, C.white);
  }),
  H("cafe", "La cérémonie du café", "Addis-Abeba, Éthiopie", "ET", 9.03, 38.74, "food", [30, 30], "En Éthiopie, berceau du caféier, on torréfie le café et on le sert avec cérémonie.", (k) => {
    k.fill(C.brownDark).ground(0.8, C.brown);
    k.disc(0.4, 0.58, 0.22, C.black).rect(0.34, 0.2, 0.1, 0.3, C.black).tri(0.28, 0.2, 0.5, 0.2, 0.39, 0.1, C.black).line(0.58, 0.5, 0.76, 0.36, 0.04, C.black).line(0.2, 0.52, 0.12, 0.66, 0.04, C.black);
    for (const x of [0.62, 0.78]) k.rect(x, 0.7, 0.1, 0.1, C.white).rect(x - 0.01, 0.78, 0.12, 0.02, C.stoneLight);
    for (const [x, y] of [[0.1, 0.9], [0.2, 0.86], [0.3, 0.92], [0.9, 0.9]] as const) k.disc(x, y, 0.03, C.brownDark);
  }),
  H("chocolat", "Le chocolat belge", "Bruxelles, Belgique", "BE", 50.85, 4.35, "food", [28, 28], "Pralines et ganaches : un savoir-faire réputé dans le monde entier.", (k) => {
    k.fill(C.redDark).rect(0.06, 0.06, 0.88, 0.88, C.brownDark).rect(0.06, 0.06, 0.88, 0.02, C.gold);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const x = 0.12 + i * 0.28, y = 0.12 + j * 0.28; k.rect(x, y, 0.22, 0.22, C.brown); if ((i + j) % 2) k.disc(x + 0.11, y + 0.11, 0.07, C.brownDark); else k.rect(x + 0.04, y + 0.04, 0.14, 0.04, C.sandLight); }
    k.rect(0.46, 0.06, 0.08, 0.88, C.gold).rect(0.06, 0.46, 0.88, 0.08, C.gold);
  }),
  H("the", "Le thé de Darjeeling", "Darjeeling, Inde", "IN", 27.04, 88.26, "food", [40, 30], "Cultivé en terrasses sur les pentes de l'Himalaya, au nord-est de l'Inde.", (k) => {
    day(k, 0.4).mountain(0.7, 0.45, 0.4, 0.34, C.stoneLight, C.stoneDark, C.snow).mountain(0.25, 0.45, 0.3, 0.2, C.snow, C.stoneLight);
    for (let j = 0; j < 8; j++) { const y = 0.44 + j * 0.07; k.rect(0, y, 1, 0.07, j % 2 ? C.green : C.greenDark); for (let i = 0; i < 12; i++) k.disc(0.04 + i * 0.085 + (j % 2) * 0.04, y + 0.03, 0.03, j % 2 ? C.greenLight : C.green); }
    k.rect(0.5, 0.62, 0.04, 0.05, C.red);
  }),
  H("tulipes", "Les champs de tulipes", "Lisse, Pays-Bas", "NL", 52.27, 4.55, "nature", [44, 36], "Chaque printemps, les Pays-Bas se parent de rubans de couleurs.", (k) => {
    day(k, 0.4).ground(0.4, C.greenLight);
    const cols = [C.red, C.yellow, C.pink, C.orange, C.white, C.magenta];
    for (let i = 0; i < 6; i++) { const y = 0.4 + i * 0.1, h = 0.1 + i * 0.01; k.rect(0, y, 1, h, cols[i]!); for (let x = 0; x < 1; x += 0.05 + i * 0.004) k.rect(x, y + h * 0.5, 0.012, h * 0.5, C.green); }
    k.rect(0.76, 0.18, 0.06, 0.24, C.stoneLight).tri(0.74, 0.18, 0.79, 0.08, 0.84, 0.18, C.red).line(0.79, 0.24, 0.9, 0.12, 0.025, C.brownDark).line(0.79, 0.24, 0.68, 0.36, 0.025, C.brownDark).line(0.79, 0.24, 0.9, 0.36, 0.025, C.brownDark).line(0.79, 0.24, 0.68, 0.12, 0.025, C.brownDark);
  }),
  H("vin", "Les vignobles de Saint-Émilion", "Gironde, France", "FR", 44.89, -0.155, "food", [36, 36], "Des coteaux de vigne façonnés par des siècles de savoir-faire.", (k) => {
    dusk(k, 0.4).ground(0.4, C.green);
    for (let j = 0; j < 6; j++) { const y = 0.42 + j * 0.095; k.rect(0, y, 1, 0.095, j % 2 ? C.green : C.greenDark); for (let x = 0; x < 1; x += 0.07) k.rect(x, y, 0.02, 0.095, C.brownDark).dot(x + 0.03, y + 0.04, C.purple, 2); }
    k.rect(0.62, 0.2, 0.22, 0.2, C.sandLight).tri(0.6, 0.2, 0.73, 0.1, 0.86, 0.2, C.clay).rect(0.66, 0.26, 0.04, 0.08, C.brownDark).rect(0.76, 0.26, 0.04, 0.08, C.brownDark);
  }),
  H("jazz", "Le jazz", "La Nouvelle-Orléans, États-Unis", "US", 29.95, -90.07, "arts", [36, 36], "Né à La Nouvelle-Orléans au début du XXe siècle, mélange d'influences africaines et européennes.", (k) => {
    k.sky(C.nightTop, C.nightLow, 0, 1).stars(10).disc(0.8, 0.18, 0.09, C.sandLight);
    k.line(0.1, 0.6, 0.66, 0.6, 0.06, C.gold).line(0.18, 0.6, 0.18, 0.74, 0.06, C.gold).line(0.18, 0.74, 0.58, 0.74, 0.06, C.gold).line(0.58, 0.74, 0.58, 0.6, 0.06, C.gold);
    k.poly([[0.64, 0.54], [0.94, 0.32], [0.94, 0.82], [0.64, 0.66]], C.gold).poly([[0.7, 0.56], [0.92, 0.42], [0.92, 0.72], [0.7, 0.64]], C.yellow).disc(0.06, 0.6, 0.035, C.gold);
    for (const x of [0.32, 0.4, 0.48]) k.rect(x, 0.44, 0.03, 0.16, C.gold).disc(x + 0.015, 0.43, 0.035, C.sandLight);
    k.dot(0.78, 0.2, C.white, 2).dot(0.86, 0.12, C.white, 2).dot(0.9, 0.22, C.white, 2).ground(0.9, C.black).rect(0.1, 0.9, 0.8, 0.02, C.gold);
  }),
  H("reggae", "Le reggae", "Kingston, Jamaïque", "JM", 17.99, -76.79, "arts", [28, 28], "Musique jamaïcaine née à la fin des années 1960, portée par un message de paix et de partage.", (k) => {
    k.sky(C.duskTop, C.duskLow, 0, 0.8).ground(0.8, C.greenDark).disc(0.5, 0.5, 0.3, C.black).disc(0.5, 0.5, 0.1, C.gold).disc(0.5, 0.5, 0.025, C.black).ring(0.5, 0.5, 0.24, 0.015, C.greyDark).ring(0.5, 0.5, 0.18, 0.015, C.greyDark);
    k.palm(0.12, 0.9, 0.5).palm(0.88, 0.9, 0.42).rect(0, 0.9, 1, 0.1, C.green).rect(0, 0.93, 0.34, 0.02, C.gold).rect(0.34, 0.93, 0.33, 0.02, C.red).rect(0.67, 0.93, 0.33, 0.02, C.green);
  }),
  H("violon", "La musique à Vienne", "Vienne, Autriche", "AT", 48.208, 16.373, "arts", [30, 36], "Ville de Mozart, de Haydn et de Schubert, capitale de la musique classique.", (k) => {
    k.fill(C.redDark).ground(0.9, C.brownDark);
    k.disc(0.5, 0.66, 0.2, C.clay).disc(0.5, 0.44, 0.15, C.clay).rect(0.38, 0.5, 0.24, 0.1, C.clay).rect(0.46, 0.1, 0.08, 0.32, C.brownDark).disc(0.5, 0.08, 0.05, C.brownDark).rect(0.4, 0.7, 0.2, 0.04, C.brownDark).disc(0.5, 0.58, 0.05, C.black).line(0.4, 0.4, 0.38, 0.7, 0.012, C.black);
    k.line(0.74, 0.12, 0.2, 0.84, 0.02, C.sandLight).line(0.74, 0.12, 0.72, 0.18, 0.03, C.black);
  }),
  H("echecs", "Les échecs", "Kolkata, Inde", "IN", 22.57, 88.36, "arts", [36, 36], "Ce jeu de stratégie est né en Inde il y a plus de quinze siècles.", (k) => {
    k.fill(C.brownDark);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) if ((i + j) % 2) k.rect(i / 8, j / 8, 1 / 8, 1 / 8, C.sand);
    k.rect(0.3, 0.84, 0.4, 0.1, C.black).poly([[0.34, 0.84], [0.4, 0.4], [0.6, 0.4], [0.66, 0.84]], C.black).rect(0.34, 0.34, 0.32, 0.08, C.black).disc(0.5, 0.26, 0.09, C.black).rect(0.485, 0.04, 0.03, 0.16, C.gold).rect(0.44, 0.09, 0.12, 0.03, C.gold).rect(0.4, 0.5, 0.2, 0.03, C.gold);
  }),
  H("hangeul", "Le hangeul", "Séoul, Corée du Sud", "KR", 37.566, 126.978, "arts", [36, 36], "L'alphabet coréen, conçu en 1443 pour être appris facilement par tous.", (k) => {
    k.fill(C.navy).rect(0.04, 0.04, 0.92, 0.92, C.paper);
    k.rect(0.3, 0.14, 0.26, 0.05, C.black).rect(0.38, 0.22, 0.1, 0.04, C.black).ring(0.43, 0.36, 0.1, 0.05, C.black).rect(0.7, 0.1, 0.05, 0.46, C.black).rect(0.75, 0.3, 0.1, 0.04, C.black).rect(0.26, 0.64, 0.05, 0.2, C.black).rect(0.26, 0.8, 0.4, 0.05, C.black);
    k.disc(0.8, 0.8, 0.07, C.red).dot(0.8, 0.8, C.blue, 3);
  }),
  H("babel", "800 langues", "Papouasie-Nouvelle-Guinée", "PG", -6.0, 145.0, "arts", [40, 32], "En Papouasie-Nouvelle-Guinée, plus de 800 langues sont parlées : un record mondial.", (k) => {
    k.fill(C.teal);
    const cols = [C.yellow, C.pink, C.white, C.orange, C.purple, C.green];
    for (let i = 0; i < 8; i++) { const x = 0.06 + (i % 4) * 0.23, y = 0.08 + Math.floor(i / 4) * 0.44, c = cols[i % cols.length]!; k.rect(x, y, 0.2, 0.26, c).tri(x + 0.03, y + 0.26, x + 0.08, y + 0.26, x + 0.02, y + 0.36, c); for (let l = 0; l < 3; l++) k.rect(x + 0.03, y + 0.05 + l * 0.07, 0.04 + ((i + l) % 3) * 0.035, 0.03, C.black); }
  }),
  H("djembe", "Le djembé", "Bamako, Mali", "ML", 12.64, -8.0, "arts", [28, 36], "Tambour d'Afrique de l'Ouest, taillé dans un tronc et recouvert de peau.", (k) => {
    k.fill(C.clay).ground(0.9, C.sandDark);
    k.poly([[0.18, 0.28], [0.82, 0.28], [0.66, 0.52], [0.7, 0.9], [0.3, 0.9], [0.34, 0.52]], C.brown);
    k.rect(0.16, 0.22, 0.68, 0.08, C.sandLight).rect(0.16, 0.3, 0.68, 0.03, C.redDark);
    for (let i = 0; i < 7; i++) { k.line(0.2 + i * 0.1, 0.32, 0.36 + (i % 2) * 0.06, 0.52, 0.02, C.sandLight); }
    for (let i = 0; i < 6; i++) k.rect(0.32 + (i % 2) * 0.28, 0.6 + Math.floor(i / 2) * 0.08, 0.1, 0.04, C.brownDark);
  }),
  H("yourte", "La yourte", "Oulan-Bator, Mongolie", "MN", 47.92, 106.92, "arts", [40, 32], "Habitat mobile des nomades de la steppe mongole, démonté et remonté en quelques heures.", (k) => {
    day(k, 0.55).mountain(0.2, 0.62, 0.4, 0.24, C.greenDark, shade(C.greenDark, 0.4)).ground(0.6, C.greenLight).ground(0.8, C.green);
    k.rect(0.28, 0.5, 0.44, 0.34, C.white).tri(0.24, 0.5, 0.5, 0.3, 0.76, 0.5, C.white).rect(0.24, 0.5, 0.52, 0.03, C.red).rect(0.44, 0.62, 0.12, 0.22, C.orange).rect(0.48, 0.3, 0.04, 0.06, C.greyDark);
    k.cloud(0.8, 0.2, 0.05);
  }),
  H("inuksuk", "L'inuksuk", "Nunavut, Canada", "CA", 64.32, -96.03, "arts", [30, 40], "Empilement de pierres qui guide les voyageurs de l'Arctique depuis des siècles.", (k) => {
    k.sky(C.nightTop, C.teal, 0, 0.7).stars(8).ground(0.78, C.snow).rect(0, 0.88, 1, 0.12, C.waterLight);
    k.rect(0.38, 0.62, 0.24, 0.18, C.stoneDark).rect(0.34, 0.5, 0.12, 0.14, C.stone).rect(0.54, 0.5, 0.12, 0.14, C.stone).rect(0.42, 0.36, 0.16, 0.16, C.stoneDark).rect(0.2, 0.42, 0.6, 0.07, C.stone).rect(0.44, 0.24, 0.12, 0.14, C.stone).rect(0.46, 0.14, 0.08, 0.1, C.stoneDark);
  }),
  H("maya", "Les glyphes mayas", "Tikal, Guatemala", "GT", 17.222, -89.623, "arts", [30, 36], "Une écriture à la fois de syllabes et d'idées, gravée sur les stèles et les temples.", (k) => {
    k.fill(C.greenDark).scatter(30, 0, 0, 1, 1, [C.green, C.greenLight]);
    k.rect(0.2, 0.06, 0.6, 0.9, C.stoneDark).rect(0.24, 0.1, 0.52, 0.82, C.stone);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) { const x = 0.28 + i * 0.24, y = 0.14 + j * 0.2; k.rect(x, y, 0.2, 0.16, C.stoneLight).disc(x + 0.06, y + 0.06, 0.035, C.stoneDark).rect(x + 0.11, y + 0.03, 0.06, 0.03, C.stoneDark).rect(x + 0.04, y + 0.11, 0.12, 0.025, C.stoneDark).rect(x + 0.12, y + 0.07, 0.03, 0.05, C.stoneDark); }
  }),

  /* ------------------------------------------------------------------ history, discoveries, science */
  H("ur", "La ziggurat d'Ur", "Ur, Irak", "IQ", 30.963, 46.103, "arts", [40, 36], "En Mésopotamie, on écrivait déjà sur des tablettes d'argile il y a plus de 4 000 ans.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.66).ground(0.7, C.sand);
    for (let i = 0; i < 3; i++) k.rect(0.12 + i * 0.1, 0.62 - i * 0.16, 0.76 - i * 0.2, 0.16, i % 2 ? C.clay : shade(C.clay, 0.15));
    k.rect(0.12, 0.62, 0.76, 0.1, shade(C.clay, 0.2)).poly([[0.44, 0.72], [0.56, 0.72], [0.52, 0.3], [0.48, 0.3]], C.sandLight).rect(0.44, 0.22, 0.12, 0.1, C.blue);
    k.rect(0.66, 0.78, 0.24, 0.18, C.clay).rect(0.66, 0.78, 0.24, 0.02, C.sandDark);
    for (let i = 0; i < 4; i++) k.tri(0.69 + i * 0.05, 0.84, 0.72 + i * 0.05, 0.84, 0.705 + i * 0.05, 0.92, C.brownDark);
  }),
  H("mohenjo", "Mohenjo-daro", "Sind, Pakistan", "PK", 27.329, 68.135, "arts", [36, 32], "Cité de la vallée de l'Indus, avec ses rues en damier et ses égouts, il y a 4 500 ans.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.3);
    k.rect(0, 0.3, 1, 0.7, C.clay).rect(0.3, 0.52, 0.4, 0.22, C.waterDark).rect(0.3, 0.52, 0.4, 0.03, C.waterLight);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 12; i++) if ((i + j * 2) % 3 === 0) k.rect(i / 12, 0.3 + j * 0.09, 1 / 12, 0.045, shade(C.clay, 0.2));
    for (let i = 0; i < 5; i++) k.rect(0.3 + i * 0.05, 0.74 + i * 0.02, 0.4 - i * 0.1, 0.02, C.sandLight);
    k.rect(0.04, 0.16, 0.22, 0.2, C.clay).rect(0.74, 0.12, 0.22, 0.24, C.clay);
  }),
  H("gobekli", "Göbekli Tepe", "Şanlıurfa, Turquie", "TR", 37.223, 38.922, "arts", [36, 32], "Un sanctuaire de piliers sculptés, vieux d'environ 11 000 ans : le plus ancien temple connu.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.5).ground(0.5, C.sand).ground(0.8, C.sandDark);
    for (const [x, h] of [[0.18, 0.5], [0.34, 0.58], [0.5, 0.64], [0.66, 0.58], [0.82, 0.5]] as const) { k.rect(x - 0.07, 0.86 - h, 0.14, 0.1, C.stone).rect(x - 0.03, 0.94 - h, 0.06, h - 0.1, C.stoneDark); }
    k.rect(0.45, 0.46, 0.04, 0.04, C.stoneLight).tri(0.28, 0.6, 0.34, 0.6, 0.31, 0.7, C.sandLight);
  }),
  H("mains", "La grotte des Mains", "Santa Cruz, Argentine", "AR", -47.153, -70.659, "arts", [36, 32], "En Patagonie, des mains en négatif ont été tracées il y a près de 10 000 ans.", (k) => {
    k.fill(C.clay).checker(0, 0, 1, 1, C.clay, shade(C.clay, 0.06));
    const hand = (x: number, y: number, c: RGB, f = 1) => { k.rect(x, y, 0.14 * f, 0.14 * f, c); for (let i = 0; i < 4; i++) k.rect(x + i * 0.036 * f, y - 0.1 * f - (i === 1 || i === 2 ? 0.03 * f : 0), 0.026 * f, 0.12 * f, c); k.line(x, y + 0.04 * f, x - 0.06 * f, y - 0.02 * f, 0.03, c); };
    hand(0.12, 0.5, C.white); hand(0.4, 0.32, C.red); hand(0.62, 0.58, C.white); hand(0.76, 0.3, C.sandLight); hand(0.22, 0.82, C.red, 0.8);
    k.rect(0, 0.92, 1, 0.08, shade(C.clay, 0.4));
  }),
  H("samarcande", "Samarcande", "Samarcande, Ouzbékistan", "UZ", 39.654, 66.975, "arts", [36, 36], "Étape majeure de la route de la soie, entre la Chine et la Méditerranée.", (k) => {
    day(k, 0.7).ground(0.8, C.sand);
    k.rect(0.2, 0.46, 0.6, 0.34, C.sandLight).dome(0.5, 0.46, 0.22, C.teal).dome(0.5, 0.46, 0.16, C.waterLight);
    for (let i = 0; i < 6; i++) { const a = Math.PI + (i / 5) * Math.PI; k.line(0.5, 0.46, 0.5 + Math.cos(a) * 0.2, 0.46 + Math.sin(a) * 0.2, 0.012, C.navy); }
    k.arch(0.5, 0.8, 0.14, 0.26, C.navy).rect(0.2, 0.52, 0.6, 0.03, C.blue).rect(0.08, 0.28, 0.08, 0.52, C.sandLight).dome(0.12, 0.28, 0.05, C.teal).rect(0.84, 0.28, 0.08, 0.52, C.sandLight).dome(0.88, 0.28, 0.05, C.teal);
    k.rect(0.62, 0.9, 0.2, 0.05, C.brown).rect(0.68, 0.84, 0.05, 0.06, C.brown).disc(0.72, 0.82, 0.03, C.brown);
  }),
  H("vikings", "Les Vikings", "Uppsala, Suède", "SE", 59.858, 17.639, "arts", [40, 32], "Marins et explorateurs scandinaves, dont les drakkars ont sillonné l'Europe et l'Atlantique.", (k) => {
    k.sky(C.duskTop, C.duskLow, 0, 0.6).waves(0.62, 0.38, C.waterDark, C.water);
    k.poly([[0.1, 0.62], [0.9, 0.62], [0.78, 0.76], [0.22, 0.76]], C.brown).poly([[0.1, 0.62], [0.04, 0.4], [0.12, 0.38], [0.14, 0.62]], C.brown).disc(0.08, 0.36, 0.045, C.brownDark).poly([[0.9, 0.62], [0.96, 0.46], [0.92, 0.62]], C.brown);
    k.rect(0.49, 0.18, 0.025, 0.46, C.brownDark).rect(0.26, 0.2, 0.48, 0.3, C.white);
    for (let i = 0; i < 6; i++) k.rect(0.26 + i * 0.08, 0.2, 0.04, 0.3, C.red);
    for (let i = 0; i < 6; i++) k.disc(0.24 + i * 0.1, 0.68, 0.035, i % 2 ? C.gold : C.red);
  }),
  H("chartres", "La cathédrale de Chartres", "Chartres, France", "FR", 48.447, 1.488, "arts", [30, 40], "Ses vitraux du XIIIe siècle filtrent la lumière en bleu profond.", (k) => {
    k.sky(C.dawnTop, C.dawnLow, 0, 0.9).ground(0.92, C.greenDark);
    k.rect(0.16, 0.5, 0.68, 0.42, C.stone).rect(0.16, 0.2, 0.2, 0.32, C.stoneLight).tri(0.14, 0.2, 0.26, 0.0, 0.38, 0.2, C.stoneDark).rect(0.62, 0.3, 0.2, 0.22, C.stoneLight).rect(0.62, 0.3, 0.2, 0.03, C.stoneDark).tri(0.62, 0.3, 0.72, 0.18, 0.82, 0.3, C.stoneDark);
    k.disc(0.5, 0.6, 0.1, C.blue).ring(0.5, 0.6, 0.1, 0.02, C.stoneDark).disc(0.5, 0.6, 0.03, C.red);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.line(0.5, 0.6, 0.5 + Math.cos(a) * 0.09, 0.6 + Math.sin(a) * 0.09, 0.012, C.gold); }
    k.arch(0.5, 0.92, 0.12, 0.22, C.brownDark).arch(0.26, 0.4, 0.05, 0.1, C.blue);
  }),
  H("rosette", "La pierre de Rosette", "Rashid, Égypte", "EG", 30.95, 30.95, "science", [36, 40], "Son texte en trois écritures a permis à Champollion de déchiffrer les hiéroglyphes, en 1822.", (k) => {
    k.fill(C.brownDark).ground(0.9, C.sandDark);
    k.poly([[0.16, 0.9], [0.14, 0.24], [0.24, 0.1], [0.6, 0.06], [0.84, 0.2], [0.86, 0.9]], C.greyDark).poly([[0.2, 0.88], [0.2, 0.28], [0.28, 0.16], [0.58, 0.12], [0.78, 0.24], [0.8, 0.88]], C.stoneDark);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const x = 0.28 + i * 0.12, y = 0.2 + j * 0.06; if ((i + j) % 3 === 0) k.disc(x, y, 0.022, C.black); else if ((i + j) % 3 === 1) k.rect(x - 0.02, y - 0.02, 0.05, 0.015, C.black); else k.rect(x, y - 0.025, 0.015, 0.05, C.black); }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) k.rect(0.26 + i * 0.09, 0.49 + j * 0.05, 0.05, 0.012, C.black).dot(0.3 + i * 0.09, 0.51 + j * 0.05, C.black, 1);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) k.rect(0.26 + i * 0.09, 0.72 + j * 0.04, 0.012 + (i % 3) * 0.016, 0.025, C.black);
    k.rect(0.2, 0.46, 0.6, 0.015, C.black).rect(0.2, 0.69, 0.6, 0.015, C.black);
  }),
  H("gutenberg", "Gutenberg", "Mayence, Allemagne", "DE", 49.999, 8.274, "science", [36, 36], "À Mayence, vers 1450, les caractères mobiles ont mis les livres à la portée de tous.", (k) => {
    k.fill(C.brownDark).ground(0.9, C.brown);
    k.rect(0.2, 0.1, 0.08, 0.8, C.brown).rect(0.72, 0.1, 0.08, 0.8, C.brown).rect(0.2, 0.1, 0.6, 0.08, C.brown).rect(0.46, 0.18, 0.08, 0.34, C.sandDark).rect(0.34, 0.5, 0.32, 0.08, C.stoneDark).line(0.5, 0.18, 0.82, 0.28, 0.03, C.sandDark).disc(0.84, 0.3, 0.04, C.sandDark);
    k.rect(0.3, 0.6, 0.4, 0.1, C.white).rect(0.3, 0.7, 0.4, 0.14, C.stoneDark);
    for (let i = 0; i < 7; i++) k.rect(0.32 + i * 0.05, 0.64, 0.03, 0.02, C.black);
    for (let i = 0; i < 5; i++) k.rect(0.34 + i * 0.06, 0.74 + (i % 2) * 0.03, 0.04, 0.05, C.black);
  }),
  H("adn", "La double hélice", "Cambridge, Royaume-Uni", "GB", 52.205, 0.119, "science", [28, 44], "En 1953, à Cambridge, la structure en double hélice de l'ADN était dévoilée.", (k) => {
    k.sky(C.nightTop, C.nightLow, 0, 1);
    for (let j = 0; j < 44; j++) { const t = j / 43, a = t * Math.PI * 4, x1 = 0.5 + Math.sin(a) * 0.34, x2 = 0.5 - Math.sin(a) * 0.34; if (j % 4 === 0) k.line(x1, t, x2, t, 0.03, C.sandLight); k.dot(x1, t, Math.cos(a) > 0 ? C.red : shade(C.red, 0.4), 3); k.dot(x2, t, Math.cos(a) > 0 ? shade(C.waterLight, 0.4) : C.waterLight, 3); }
    k.scatter(14, 0, 0, 1, 1, [C.white, C.yellow]);
  }),
  H("wright", "Les premiers vols", "Dayton, États-Unis", "US", 39.76, -84.19, "science", [44, 32], "En 1903, deux frères américains faisaient voler un aéroplane motorisé.", (k) => {
    day(k, 0.8).ground(0.82, C.sand).cloud(0.2, 0.2, 0.06).cloud(0.8, 0.14, 0.05);
    k.rect(0.22, 0.36, 0.56, 0.06, C.paper).rect(0.22, 0.56, 0.56, 0.06, C.paper).rect(0.3, 0.42, 0.015, 0.14, C.brownDark).rect(0.5, 0.42, 0.015, 0.14, C.brownDark).rect(0.7, 0.42, 0.015, 0.14, C.brownDark).rect(0.78, 0.42, 0.14, 0.04, C.brown).rect(0.04, 0.38, 0.16, 0.04, C.brown).disc(0.12, 0.4, 0.03, C.greyDark);
    k.line(0.1, 0.36, 0.1, 0.5, 0.03, C.brownDark).disc(0.3, 0.72, 0.04, C.black).disc(0.7, 0.72, 0.04, C.black).line(0.3, 0.62, 0.3, 0.72, 0.012, C.brownDark).line(0.7, 0.62, 0.7, 0.72, 0.012, C.brownDark);
  }),
  H("web", "Le Web est né ici", "Genève, Suisse", "CH", 46.233, 6.055, "science", [36, 36], "Au CERN, près de Genève, le World Wide Web était proposé en 1989.", (k) => {
    k.fill(C.navy).stars(14).disc(0.5, 0.5, 0.4, C.blue);
    k.ring(0.5, 0.5, 0.4, 0.015, C.waterLight).ring(0.5, 0.5, 0.26, 0.012, C.waterLight).rect(0.1, 0.495, 0.8, 0.012, C.waterLight).rect(0.495, 0.1, 0.012, 0.8, C.waterLight);
    const nodes: [number, number][] = [[0.5, 0.1], [0.78, 0.28], [0.9, 0.5], [0.7, 0.8], [0.34, 0.82], [0.12, 0.6], [0.26, 0.26], [0.5, 0.5]];
    for (const [x, y] of nodes) k.line(0.5, 0.5, x, y, 0.012, C.gold);
    for (const [x, y] of nodes) k.disc(x, y, 0.035, C.yellow);
    k.disc(0.5, 0.5, 0.06, C.orange);
  }),
  H("rail", "Le chemin de fer", "Stockton-on-Tees, Royaume-Uni", "GB", 54.57, -1.318, "science", [44, 32], "En 1825, la première ligne publique à vapeur ouvrait en Angleterre.", (k) => {
    day(k, 0.7).ground(0.7, C.greenLight).ground(0.8, C.green).rect(0, 0.84, 1, 0.03, C.greyDark).rect(0, 0.9, 1, 0.03, C.greyDark);
    k.rect(0.22, 0.4, 0.4, 0.24, C.black).rect(0.62, 0.34, 0.14, 0.34, C.red).rect(0.14, 0.24, 0.07, 0.24, C.black).rect(0.11, 0.2, 0.13, 0.06, C.black).rect(0.62, 0.3, 0.14, 0.05, C.redDark);
    for (const x of [0.28, 0.46, 0.7]) k.disc(x, 0.72, 0.09, C.black).disc(x, 0.72, 0.03, C.red);
    for (const [x, y, r] of [[0.1, 0.12, 0.05], [0.04, 0.06, 0.06]] as const) k.disc(x, y, r, C.white);
  }),
  H("manchester", "La révolution industrielle", "Manchester, Royaume-Uni", "GB", 53.48, -2.24, "science", [44, 36], "Usines, vapeur et cheminées ont transformé le XIXe siècle.", (k) => {
    k.sky(C.duskTop, C.orange, 0, 0.8).ground(0.78, C.brownDark);
    for (let i = 0; i < 4; i++) { k.rect(0.06 + i * 0.12, 0.5, 0.12, 0.28, C.brown); k.tri(0.06 + i * 0.12, 0.5, 0.06 + i * 0.12, 0.4, 0.18 + i * 0.12, 0.5, C.brownDark); for (let w = 0; w < 2; w++) k.rect(0.09 + i * 0.12 + w * 0.05, 0.62, 0.03, 0.06, C.yellow); }
    for (const [x, h] of [[0.64, 0.52], [0.8, 0.62], [0.92, 0.46]] as const) k.rect(x - 0.035, 0.78 - h, 0.07, h, C.redDark).rect(x - 0.04, 0.78 - h, 0.08, 0.03, C.black);
    for (const [x, y, r] of [[0.64, 0.18, 0.08], [0.8, 0.08, 0.09], [0.7, 0.1, 0.06], [0.9, 0.26, 0.07]] as const) k.disc(x, y, r, C.greyDark);
  }),
  H("jantar", "Jantar Mantar", "Jaipur, Inde", "IN", 26.925, 75.824, "science", [36, 36], "À Jaipur, d'immenses cadrans de pierre mesurent le temps et suivent les astres depuis 1734.", (k) => {
    day(k, 0.7).ground(0.76, C.sand);
    k.poly([[0.16, 0.84], [0.16, 0.34], [0.2, 0.34], [0.68, 0.84]], C.red).poly([[0.2, 0.34], [0.68, 0.84], [0.68, 0.78], [0.24, 0.34]], C.redDark).rect(0.16, 0.84, 0.54, 0.05, C.stoneDark);
    k.dome(0.84, 0.88, 0.1, C.stoneLight).dome(0.84, 0.88, 0.06, C.stone).line(0.2, 0.34, 0.06, 0.88, 0.04, C.sandDark).rect(0.06, 0.88, 0.8, 0.03, C.sandDark);
  }),
  H("shinkansen", "Le Shinkansen", "Nagoya, Japon", "JP", 35.17, 136.9, "future", [44, 28], "Le train à grande vitesse japonais relie les villes depuis 1964.", (k) => {
    day(k, 0.7).mountain(0.78, 0.7, 0.3, 0.34, C.blue, C.navy, C.snow).ground(0.7, C.greenLight).rect(0, 0.8, 1, 0.04, C.greyDark);
    k.poly([[0.04, 0.78], [0.04, 0.5], [0.22, 0.44], [0.6, 0.44], [0.9, 0.62], [0.96, 0.78]], C.white).rect(0.04, 0.62, 0.92, 0.05, C.blue).poly([[0.6, 0.44], [0.9, 0.62], [0.7, 0.58]], C.stoneLight);
    for (let i = 0; i < 9; i++) k.rect(0.12 + i * 0.07, 0.52, 0.04, 0.06, C.navy);
    k.rect(0, 0.78, 1, 0.03, C.black);
  }),
  H("silicon", "La Silicon Valley", "Californie, États-Unis", "US", 37.386, -122.084, "future", [36, 36], "Berceau des puces électroniques et de l'informatique personnelle.", (k) => {
    k.fill(C.greenDark);
    k.rect(0.2, 0.2, 0.6, 0.6, C.black).rect(0.24, 0.24, 0.52, 0.52, C.greyDark).rect(0.34, 0.34, 0.32, 0.32, C.black).rect(0.4, 0.4, 0.2, 0.2, C.teal);
    for (let i = 0; i < 7; i++) { const t = 0.24 + i * 0.075; k.rect(0.12, t, 0.08, 0.03, C.gold).rect(0.8, t, 0.08, 0.03, C.gold).rect(t, 0.12, 0.03, 0.08, C.gold).rect(t, 0.8, 0.03, 0.08, C.gold); }
    for (const [x1, y1, x2, y2] of [[0.1, 0.3, 0.1, 0.06], [0.9, 0.7, 0.9, 0.94], [0.3, 0.9, 0.06, 0.9]] as const) k.line(x1, y1, x2, y2, 0.02, C.greenLight);
  }),
  H("kourou", "Kourou", "Guyane française", "GF", 4.9, -52.6, "science", [28, 44], "En Guyane, on lance des fusées vers l'espace depuis 1968.", (k) => {
    k.sky(C.skyTop, C.skyLow, 0, 0.8).ground(0.8, C.greenDark).dome(0.1, 0.9, 0.14, C.green).dome(0.9, 0.9, 0.14, C.green);
    k.rect(0.42, 0.18, 0.16, 0.6, C.white).tri(0.42, 0.18, 0.5, 0.02, 0.58, 0.18, C.white).rect(0.42, 0.5, 0.16, 0.05, C.red).rect(0.34, 0.5, 0.08, 0.28, C.stoneLight).rect(0.58, 0.5, 0.08, 0.28, C.stoneLight).rect(0.7, 0.3, 0.04, 0.5, C.greyDark).rect(0.7, 0.36, 0.14, 0.02, C.greyDark).tri(0.44, 0.96, 0.5, 0.78, 0.56, 0.96, C.orange).tri(0.46, 0.96, 0.5, 0.84, 0.54, 0.96, C.yellow);
  }),
  H("eoliennes", "L'énergie du vent", "Jutland, Danemark", "DK", 56.2, 8.7, "future", [44, 40], "Au Danemark, le vent fournit une grande part de l'électricité du pays.", (k) => {
    day(k, 0.7).ground(0.7, C.greenLight).ground(0.82, C.green).cloud(0.2, 0.18, 0.06);
    const turbine = (x: number, base: number, h: number, a: number) => { k.rect(x - 0.012, base - h, 0.024, h, C.white); for (let i = 0; i < 3; i++) { const r = a + (i * Math.PI * 2) / 3; k.line(x, base - h, x + Math.cos(r) * h * 0.55, base - h + Math.sin(r) * h * 0.55, 0.035, C.white); } k.disc(x, base - h, 0.025, C.stoneLight); };
    turbine(0.24, 0.8, 0.5, 0.3); turbine(0.62, 0.74, 0.38, 1.1); turbine(0.86, 0.7, 0.26, 0.7);
  }),
  H("solaire", "Le soleil du Maroc", "Ouarzazate, Maroc", "MA", 31.06, -6.87, "future", [44, 36], "Près d'Ouarzazate, une des plus grandes centrales solaires du monde capte la lumière du désert.", (k) => {
    k.sky(C.skyTop, C.skyLow, 0, 0.5).sun(0.82, 0.16, 0.1, C.yellow).ground(0.5, C.sand);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) { const x = 0.06 + i * 0.15 - j * 0.01, y = 0.56 + j * 0.09; k.poly([[x, y + 0.07], [x + 0.03, y], [x + 0.14, y], [x + 0.12, y + 0.07]], C.blue).rect(x + 0.04, y + 0.01, 0.01, 0.05, C.waterLight).rect(x + 0.08, y + 0.01, 0.01, 0.05, C.waterLight); }
    k.rect(0.47, 0.18, 0.05, 0.34, C.stoneLight).disc(0.495, 0.16, 0.05, C.yellow);
  }),
  H("inlandsis", "L'inlandsis", "Groenland", "GL", 70.0, -45.0, "nature", [44, 32], "La calotte glaciaire du Groenland : sa fonte suit de près l'évolution du climat.", (k) => {
    k.sky(C.dawnTop, tint(C.dawnLow, 0.4), 0, 0.4).ground(0.4, C.snow);
    for (let i = 0; i < 6; i++) k.rect(0, 0.4 + i * 0.1, 1, 0.1, i % 2 ? C.snow : tint(C.waterLight, 0.5));
    for (const [x, w] of [[0.18, 0.04], [0.42, 0.06], [0.7, 0.05]] as const) k.poly([[x, 0.5], [x + w, 0.5], [x + w * 0.5, 1]], C.waterDark);
    k.poly([[0, 0.4], [0.2, 0.34], [0.4, 0.38], [0.62, 0.32], [0.84, 0.36], [1, 0.34], [1, 0.42], [0, 0.42]], tint(C.waterLight, 0.6));
  }),
  H("amazonie", "L'Amazonie", "Amazonas, Brésil", "BR", -3.4, -60.0, "nature", [44, 40], "La plus grande forêt tropicale du monde abrite une biodiversité immense.", (k) => {
    k.sky(C.skyTop, C.skyLow, 0, 0.28).fill(C.greenDark).sky(C.skyTop, C.skyLow, 0, 0.28);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 8; i++) k.disc(0.06 + i * 0.13 + (j % 2) * 0.06, 0.34 + j * 0.13, 0.09, (i + j) % 3 === 0 ? C.green : (i + j) % 3 === 1 ? C.greenDark : C.greenLight);
    k.poly([[0.0, 0.64], [0.3, 0.58], [0.6, 0.72], [1, 0.66], [1, 0.76], [0.6, 0.82], [0.3, 0.7], [0, 0.74]], C.water);
    k.disc(0.76, 0.3, 0.05, C.red).rect(0.72, 0.32, 0.1, 0.03, C.blue).line(0.76, 0.34, 0.66, 0.46, 0.03, C.yellow);
  }),
  H("serengeti", "La grande migration", "Serengeti, Tanzanie", "TZ", -2.33, 34.83, "nature", [50, 32], "Chaque année, plus d'un million de gnous traversent le Serengeti.", (k) => {
    k.sky(C.duskTop, C.duskLow, 0, 0.5).sun(0.3, 0.46, 0.1, C.orange).ground(0.5, C.sand).ground(0.8, C.sandDark);
    k.rect(0.7, 0.22, 0.02, 0.3, C.brownDark).poly([[0.5, 0.26], [0.92, 0.26], [0.96, 0.34], [0.46, 0.34]], C.greenDark);
    for (const [x, y, s] of [[0.1, 0.62, 1], [0.24, 0.7, 1.1], [0.4, 0.64, 0.9], [0.56, 0.74, 1.2], [0.72, 0.66, 1], [0.86, 0.78, 1.2], [0.34, 0.86, 1.2], [0.64, 0.9, 1.3]] as const) { k.rect(x, y, 0.08 * s, 0.05 * s, C.black).rect(x - 0.02 * s, y - 0.03 * s, 0.04 * s, 0.05 * s, C.black).rect(x + 0.01 * s, y + 0.05 * s, 0.012, 0.04 * s, C.black).rect(x + 0.06 * s, y + 0.05 * s, 0.012, 0.04 * s, C.black); }
  }),
  H("orang", "L'orang-outan", "Bornéo, Indonésie", "ID", 0.9, 114.0, "nature", [30, 36], "« Homme de la forêt » en malais, il vit dans les forêts de Bornéo et de Sumatra.", (k) => {
    k.fill(C.greenDark).scatter(24, 0, 0, 1, 1, [C.green, C.greenLight]).line(0, 0.18, 1, 0.1, 0.07, C.brown);
    k.disc(0.5, 0.5, 0.36, C.orange).disc(0.5, 0.56, 0.22, C.skinDark).disc(0.4, 0.5, 0.045, C.black).disc(0.6, 0.5, 0.045, C.black).dot(0.4, 0.48, C.white, 1).dot(0.6, 0.48, C.white, 1).rect(0.44, 0.66, 0.12, 0.03, C.black).disc(0.5, 0.58, 0.03, C.brown);
    k.line(0.18, 0.2, 0.32, 0.44, 0.07, C.orange).line(0.82, 0.14, 0.7, 0.44, 0.07, C.orange);
  }),
];

export const HERITAGE_COUNT = HERITAGE.length;

/**
 * The plan of the "heritage" set for `seedDemo`: one account per parcel, the parcel exactly this size and as near as it can be to the real place,
 * its own drawing, title, sentence and category. Deterministic (the same plan every time).
 */
/** Dots per grid pixel side: 10 is a tenth of a pixel, the finest the site accepts (a 30 × 30 parcel is a 300 × 300 picture). */
export const HERITAGE_RES = 10;
/** The width of an art pixel, in dots: 5 of 10 is half a pixel of the grid (a 30 × 30 parcel is drawn on a 60 × 60 grid of visible pixels). */
export const HERITAGE_BLOCK = 5;
export function heritagePlan(res = HERITAGE_RES, block = Math.min(HERITAGE_BLOCK, res)): DemoItem[] {
  return HERITAGE.map((e, i) => ({
    index: i,
    username: `demo_${e.id}`.slice(0, 24),
    emailLocal: `demo-h${String(i + 1).padStart(3, "0")}`,
    title: e.title,
    description: e.text,
    style: "icon" as const,
    kind: "land" as const,
    w: e.w, h: e.h,
    anchor: { name: e.place, lat: e.lat, lon: e.lon, country: e.country },
    spot: { name: e.place, lat: e.lat, lon: e.lon },
    seed: 7000 + i,
    // spread over the last weeks, the way people arrive: not all in the same minute
    ageHours: 6 + ((i * 37) % 600),
    exact: true,
    illustration: true,
    category: e.category,
    i18n: Object.fromEntries(HERITAGE_LANGS.flatMap((l) => { const t = HERITAGE_I18N[e.id]?.[l]; return t ? [[l, { title: t[0], description: t[1] }]] : []; })),
    render: (w: number, h: number, seed: number) => { const k = new Canvas(w, h, C.black, seed, res, block); e.draw(k); return k.finish(); },
  }));
}
