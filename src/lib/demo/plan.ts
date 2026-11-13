/**
 * The plan of the DEMONSTRATION data of a test site: who, where, what. Pure and deterministic (the same seed gives the same plan), and the
 * guards that stop the tool from ever running on something that is not a test site. See `scripts/seed-demo.mts`.
 *
 * Everything the tool creates is recognisable: accounts are `demo_…` with an e-mail at a reserved `.invalid` address, their bio says so, and a
 * single command (`clear`) deletes all of it. The parcels are created WITHOUT any order or payment, so there is no fake revenue anywhere.
 */
import { ART_STYLES, type ArtStyle } from "./art";

export interface Anchor { name: string; lat: number; lon: number; country: string }
/** Where the demonstration parcels cluster: big cities, spread over the continents, so that the world map looks lived in. */
export const ANCHORS: readonly Anchor[] = [
  { name: "Paris", lat: 48.86, lon: 2.35, country: "FR" }, { name: "Londres", lat: 51.51, lon: -0.13, country: "GB" }, { name: "Berlin", lat: 52.52, lon: 13.4, country: "DE" },
  { name: "Madrid", lat: 40.42, lon: -3.7, country: "ES" }, { name: "Rome", lat: 41.9, lon: 12.5, country: "IT" }, { name: "Varsovie", lat: 52.23, lon: 21.01, country: "PL" },
  { name: "Istanbul", lat: 41.01, lon: 28.98, country: "TR" }, { name: "Moscou", lat: 55.75, lon: 37.62, country: "RU" }, { name: "Le Caire", lat: 30.04, lon: 31.24, country: "EG" },
  { name: "Lagos", lat: 6.52, lon: 3.38, country: "NG" }, { name: "Nairobi", lat: -1.29, lon: 36.82, country: "KE" }, { name: "Le Cap", lat: -33.92, lon: 18.42, country: "ZA" },
  { name: "Dubaï", lat: 25.2, lon: 55.27, country: "AE" }, { name: "Delhi", lat: 28.61, lon: 77.21, country: "IN" }, { name: "Mumbai", lat: 19.08, lon: 72.88, country: "IN" },
  { name: "Pékin", lat: 39.9, lon: 116.4, country: "CN" }, { name: "Shanghai", lat: 31.23, lon: 121.47, country: "CN" }, { name: "Tokyo", lat: 35.68, lon: 139.69, country: "JP" },
  { name: "Séoul", lat: 37.57, lon: 126.98, country: "KR" }, { name: "Bangkok", lat: 13.76, lon: 100.5, country: "TH" }, { name: "Jakarta", lat: -6.2, lon: 106.85, country: "ID" },
  { name: "Sydney", lat: -33.87, lon: 151.21, country: "AU" }, { name: "New York", lat: 40.71, lon: -74.0, country: "US" }, { name: "Chicago", lat: 41.88, lon: -87.63, country: "US" },
  { name: "Los Angeles", lat: 34.05, lon: -118.24, country: "US" }, { name: "Toronto", lat: 43.65, lon: -79.38, country: "CA" }, { name: "Mexico", lat: 19.43, lon: -99.13, country: "MX" },
  { name: "Bogota", lat: 4.71, lon: -74.07, country: "CO" }, { name: "São Paulo", lat: -23.55, lon: -46.63, country: "BR" }, { name: "Buenos Aires", lat: -34.6, lon: -58.38, country: "AR" },
];

/** Where the demonstration WATER parcels go: open water (seas and oceans), so that the sea does not look empty either. */
export const SEAS: readonly { name: string; lat: number; lon: number }[] = [
  { name: "Méditerranée est", lat: 34.5, lon: 25 }, { name: "Méditerranée ouest", lat: 38, lon: 5 }, { name: "Mer du Nord", lat: 56, lon: 3 }, { name: "Mer Baltique", lat: 58.5, lon: 20 },
  { name: "Mer Noire", lat: 43.2, lon: 34 }, { name: "Atlantique nord", lat: 45, lon: -30 }, { name: "Atlantique sud", lat: -20, lon: -15 }, { name: "Caraïbes", lat: 15, lon: -75 },
  { name: "Golfe du Mexique", lat: 25, lon: -90 }, { name: "Pacifique est", lat: 0, lon: -140 }, { name: "Pacifique nord", lat: 35, lon: -160 }, { name: "Océan Indien", lat: -15, lon: 75 },
  { name: "Mer d'Arabie", lat: 15, lon: 65 }, { name: "Mer de Chine méridionale", lat: 12, lon: 114 }, { name: "Mer du Japon", lat: 40, lon: 135 }, { name: "Mer de Corail", lat: -18, lon: 155 },
  { name: "Mer de Tasman", lat: -40, lon: 160 }, { name: "Golfe du Bengale", lat: 14, lon: 88 }, { name: "Mer Rouge", lat: 20, lon: 38 }, { name: "Golfe de Guinée", lat: 0, lon: 0 },
  { name: "Mer de Norvège", lat: 67, lon: 2 }, { name: "Mer d'Irlande", lat: 53.6, lon: -5 }, { name: "Golfe de Gascogne", lat: 45, lon: -5 }, { name: "Mer Égée", lat: 38.4, lon: 25 },
  { name: "Mer de Chine orientale", lat: 28, lon: 125 }, { name: "Mer d'Okhotsk", lat: 55, lon: 150 }, { name: "Golfe d'Oman", lat: 24, lon: 58 }, { name: "Mer des Philippines", lat: 15, lon: 130 },
  { name: "Atlantique centre", lat: 10, lon: -35 }, { name: "Pacifique sud", lat: -25, lon: -120 }, { name: "Océan Indien sud", lat: -40, lon: 85 }, { name: "Mer du Labrador", lat: 58, lon: -52 },
];

const WORDS = ["lucie", "mathis", "chloe", "hugo", "emma", "louis", "jade", "noah", "lea", "adam", "alice", "tom", "zoe", "leo", "nina", "paul", "ines", "theo", "mila", "ryan",
  "fox", "panda", "otter", "heron", "lynx", "koala", "gecko", "bison", "wolf", "crane", "orca", "yak", "moth", "newt", "seal", "swan", "ibis", "kiwi", "lark", "wren",
  "pixel", "neon", "mint", "coral", "amber", "indigo", "olive", "ruby", "onyx", "sky", "dune", "reef", "fjord", "delta", "ember", "frost", "grove", "lagoon", "mesa", "tundra"];

const TITLES = ["Soleil de minuit", "Le petit renard", "Neon Harbour", "Café des arts", "Mon premier pixel", "Studio Lumière", "Vagues", "Ciel d'orage", "Pixel Phoenix", "Les toits de Lyon",
  "Blue Hour", "Atelier 42", "Rêve éveillé", "Mosaïque", "Lanterne", "Hello World", "Jardin secret", "Cap au nord", "Retro Arcade", "Maison bleue", "Étoile filante", "Port de nuit",
  "Sunrise Club", "La grande ourse", "Fresque", "Tiny Planet", "Orange Cat", "Marché d'été", "Aurore", "Vinyle", "Green Valley", "Bonjour monde", "Totem", "Brise de mer", "Night Owl",
  "Origami", "Carnet de voyage", "Cosmos", "La Tour", "Kaléidoscope", "Retrowave", "Sieste", "Pop Corn", "Ligne claire", "Tropiques", "Bleu Klein", "Rouge Gorge", "Archipel", "Zen Garden", "Le Phare",
  "Pixel Bakery", "Matin calme", "Skyline", "Nuage rose", "Cabane", "Horizon", "Ping Pong", "Terre de feu", "Mille et un", "Papier peint"];

const DESCRIPTIONS = ["Création de démonstration.", "Démo : une parcelle pour voir à quoi ressemble la carte habitée.", "Exemple de création (données de démonstration).", "Démo : un morceau de planète décoré."];

export interface DemoItem {
  index: number;
  username: string;
  /** The local part of the e-mail address; the domain is chosen by the caller (`demo.invalid` by default). */
  emailLocal: string;
  title: string;
  description: string;
  style: ArtStyle;
  /** `water`: a parcel on the sea (every fifth one); it is shown in blue, whatever its picture is. */
  kind: "land" | "water";
  w: number;
  h: number;
  /** The home of the account (its country). */
  anchor: Anchor;
  /** Where the parcel goes: near the anchor (land) or in a sea (water). */
  spot: { name: string; lat: number; lon: number };
  seed: number;
  /** How long ago the parcel was "bought", in hours (so that the newest creations are not all the same minute). */
  ageHours: number;
  /** A curated item (`heritage.ts`): its own drawing, exactly this size, as near as possible to exactly this place, with this category. */
  exact?: boolean;
  render?: (w: number, h: number, seed: number) => import("./art").Raster;
  category?: string;
  /** An illustration parcel (migration 24): owned by the one technical account, shown as "Illustration image", covered by any purchase, kept by `clear`. */
  illustration?: boolean;
}

function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * `count` demonstration accounts with their parcel, picture and place, then `water` MORE accounts whose parcel is on the sea (so that the seas can be
 * filled without touching the first ones: with the same seed the first `count` items are the same whatever `water` is). Parcels are big enough to be seen on a world map.
 */
export function demoPlan(count: number, seed = 1, water = 0): DemoItem[] {
  const next = mulberry(seed * 7919 + 13);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const order = [...WORDS].sort(() => next() - 0.5);
  const titles = [...TITLES].sort(() => next() - 0.5);
  return Array.from({ length: count + water }, (_, i) => {
    const word = order[i % order.length]!, lap = Math.floor(i / order.length);
    const username = `demo_${word}${lap ? lap + 1 : ""}`.slice(0, 24);
    const roll = next();
    const base = roll < 0.3 ? int(70, 140) : roll < 0.8 ? int(140, 260) : int(260, 400); // 30 % medium, 50 % large, 20 % very large (in pixels of the grid)
    const ratio = 0.7 + next() * 0.6;
    const w = Math.max(60, Math.min(400, Math.round(base * ratio))), h = Math.max(60, Math.min(400, Math.round(base / ratio)));
    const title = titles[i % titles.length]! + (i >= titles.length ? ` ${Math.floor(i / titles.length) + 1}` : "");
    const onSea = i >= count || i % 5 === 4, anchor = ANCHORS[i % ANCHORS.length]!;
    // the seas of the first accounts are used in order (one in five); the extra ones continue where those stop, then wrap
    const sea = SEAS[(i >= count ? Math.floor(count / 5) + (i - count) : Math.floor(i / 5)) % SEAS.length]!;
    return {
      index: i,
      username,
      emailLocal: `demo-${String(i + 1).padStart(3, "0")}`,
      title,
      description: DESCRIPTIONS[i % DESCRIPTIONS.length]!,
      style: ART_STYLES[i % ART_STYLES.length]!,
      kind: onSea ? "water" : "land",
      w: onSea ? Math.max(180, w) : w, h: onSea ? Math.max(180, h) : h,
      anchor,
      spot: onSea ? sea : anchor,
      seed: seed * 1000 + i,
      ageHours: Math.round(next() * 14 * 24),
    };
  });
}

/* ------------------------------------------------------------------ the guards */
export interface GuardInput {
  /** What the tool is pointed at: a Supabase project (cloud) or a local development database. */
  mode: "supabase" | "local";
  /** The host of the database. */
  dbHost: string;
  stripeKey?: string | null;
  paymentsLive?: string | null;
  /** `--i-know-this-is-a-test-site` was given. */
  confirmed: boolean;
  /** `NEXT_PUBLIC_SUPABASE_URL`, and the project id given with `--project`. */
  supabaseUrl?: string | null;
  project?: string | null;
  /** Number of Stripe events in the database that were made in LIVE mode (real money). */
  liveEvents: number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db"]);

/** Why the tool must NOT run (an empty list: it may). Words a person can act on. */
export function demoGuard(g: GuardInput): string[] {
  const why: string[] = [];
  if (!g.confirmed) why.push("add --i-know-this-is-a-test-site: this tool fills a TEST site with made-up accounts and parcels, and must never touch a real one");
  if ((g.stripeKey ?? "").startsWith("sk_live_") || (g.stripeKey ?? "").startsWith("rk_live_") || (g.paymentsLive ?? "").length > 0) why.push("real payments are configured (a live Stripe key, or PAYMENTS_LIVE_ENABLED): this is not a test site");
  if (g.liveEvents > 0) why.push(`the database holds ${g.liveEvents} payment event(s) made with real money: this is not a test site`);
  if (g.mode === "local") {
    if (!LOCAL_HOSTS.has(g.dbHost)) why.push(`the database is on "${g.dbHost}", not on this machine, and no Supabase project is configured to check it against`);
  } else {
    let ref = "";
    try { ref = new URL(g.supabaseUrl ?? "").hostname.split(".")[0] ?? ""; } catch { /* handled below */ }
    if (!ref) why.push("NEXT_PUBLIC_SUPABASE_URL is missing or not a URL");
    else if (!g.project) why.push(`add --project ${ref}: the id of the Supabase project this tool may fill (a second, deliberate confirmation)`);
    else if (g.project !== ref) why.push(`--project ${g.project} is not the project this environment points to (${ref}): nothing was touched`);
  }
  return why;
}
