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
  w: number;
  h: number;
  anchor: Anchor;
  seed: number;
  /** How long ago the parcel was "bought", in hours (so that the newest creations are not all the same minute). */
  ageHours: number;
}

function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** `count` demonstration accounts with their parcel, picture and place. Parcels are big enough to be seen on a world map. */
export function demoPlan(count: number, seed = 1): DemoItem[] {
  const next = mulberry(seed * 7919 + 13);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const order = [...WORDS].sort(() => next() - 0.5);
  const titles = [...TITLES].sort(() => next() - 0.5);
  return Array.from({ length: count }, (_, i) => {
    const word = order[i % order.length]!, lap = Math.floor(i / order.length);
    const username = `demo_${word}${lap ? lap + 1 : ""}`.slice(0, 24);
    const roll = next();
    const base = roll < 0.3 ? int(70, 140) : roll < 0.8 ? int(140, 260) : int(260, 400); // 30 % medium, 50 % large, 20 % very large (in pixels of the grid)
    const ratio = 0.7 + next() * 0.6;
    const w = Math.max(60, Math.min(400, Math.round(base * ratio))), h = Math.max(60, Math.min(400, Math.round(base / ratio)));
    const title = titles[i % titles.length]! + (i >= titles.length ? ` ${Math.floor(i / titles.length) + 1}` : "");
    return {
      index: i,
      username,
      emailLocal: `demo-${String(i + 1).padStart(3, "0")}`,
      title,
      description: DESCRIPTIONS[i % DESCRIPTIONS.length]!,
      style: ART_STYLES[i % ART_STYLES.length]!,
      w, h,
      anchor: ANCHORS[i % ANCHORS.length]!,
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
