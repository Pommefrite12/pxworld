#!/usr/bin/env node
// How fast do the parcels of the map appear? Measured in a real browser, on a PRODUCTION build, with a slow network and a slow processor.
//
//   npm run build && npm start                      (a production build: `next dev` is not what visitors get)
//   node scripts/perf-map.mjs http://localhost:3000 [runs]
//   node scripts/perf-map.mjs https://localhost:3443 3 --bump     (over HTTP/2: see scripts/h2-front.mjs; --bump = what a purchase does, every tile address changes)
//
// Network 120 ms and 10 Mbit/s, processor 4× slower (the method of docs/ARCHITECTURE.md, "Display latency"). For each view (the world, a dense area zoomed
// out, a city, a close-up) it prints, per kind of request: how many, how many KB, how long the SERVER took to answer (median and 95th percentile: the
// time to the first byte, 120 ms of which is the network's own), and when the first and the last answer came. Fill the database first with
// `npm run demo:seed -- --volume 50000 …` (docs/DEPLOIEMENT_PAS_A_PAS.md, step 9a), and look at the densest tile with
//   select (x/1000)::int, (y/1000)::int, count(*) from parcels group by 1,2 order by 3 desc limit 3;     (the views below look at 20500, 11500).
import { chromium } from "playwright";
import pg from "pg";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const BASE = args[0] ?? "http://localhost:3000", RUNS = Number(args[1] ?? 2), BUMP = process.argv.includes("--bump");
const LATENCY = 120, DOWN = (10 * 1024 * 1024) / 8, UP = (5 * 1024 * 1024) / 8, CPU = 4;
const CENTRE = { x: Number(process.env.PERF_X ?? 20500), y: Number(process.env.PERF_Y ?? 11500) };

const kind = (u) => {
  const p = new URL(u).pathname;
  if (p.startsWith("/api/map/raster")) return "raster";
  if (p.startsWith("/api/map/tiles")) return "tiles(json)";
  if (p.startsWith("/api/assets")) return "pictures";
  if (p.startsWith("/api/map/water")) return "water";
  if (p.startsWith("/data/")) return "geography";
  if (p.startsWith("/api/")) return "api-other";
  if (p.startsWith("/_next/static")) return "js/css/fonts";
  return "page";
};
const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => (a.length ? sorted(a)[Math.floor(a.length / 2)] : 0);
const pct = (a, p) => (a.length ? sorted(a)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

/** What a purchase or an approval does: the map version goes up, so every tile has a new address. */
async function bumpVersion() {
  if (!BUMP) return;
  const url = process.env.DATABASE_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/pixelworld";
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("update public.map_state set version = version + 1 where id = 1");
  await c.end();
}

async function scenario(browser, url, after) {
  await bumpVersion();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: LATENCY, downloadThroughput: DOWN, uploadThroughput: UP });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const reqs = new Map();
  let inflight = 0, quietSince = Date.now();
  cdp.on("Network.requestWillBeSent", (e) => { if (!reqs.has(e.requestId)) { reqs.set(e.requestId, { url: e.request.url, start: e.timestamp, bytes: 0 }); inflight++; } quietSince = Date.now(); });
  cdp.on("Network.responseReceived", (e) => { const r = reqs.get(e.requestId); if (r) { r.headers = e.timestamp; r.ttfb = e.response.timing?.receiveHeadersEnd ?? 0; r.cached = Boolean(e.response.fromDiskCache); } });
  cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength; inflight--; } quietSince = Date.now(); });
  cdp.on("Network.loadingFailed", (e) => { const r = reqs.get(e.requestId); if (r && !r.end) { r.end = e.timestamp; inflight--; } });
  const settle = async (quiet = 1200, max = 40000) => {
    const began = Date.now();
    while (Date.now() - began < max) {
      await new Promise((r) => setTimeout(r, 100));
      if (inflight <= 0 && Date.now() - began > 500 && Date.now() - quietSince >= quiet) break;
    }
  };
  const t = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const t0 = Math.min(...[...reqs.values()].map((r) => r.start));
  await settle();
  const out = { settledMs: Date.now() - t };
  const sum = (from) => {
    const by = {};
    for (const r of reqs.values()) {
      if (r.start < from) continue;
      const b = (by[kind(r.url)] ??= { n: 0, kb: 0, ttfb: [], first: Infinity, last: 0 });
      b.n++; b.kb += r.bytes / 1024; if (r.ttfb) b.ttfb.push(r.ttfb);
      if (r.end) { b.last = Math.max(b.last, (r.end - from) * 1000); b.first = Math.min(b.first, (r.headers - from) * 1000 || Infinity); }
    }
    return by;
  };
  out.by = sum(t0);
  if (after) { const m = Date.now(); await after(page); await settle(); out.afterMs = Date.now() - m; }
  await ctx.close();
  return out;
}

const fmt = (by) => Object.entries(by).sort().map(([k, b]) => `    ${k.padEnd(13)} n=${String(b.n).padStart(3)} ${b.kb.toFixed(0).padStart(6)} KB  server wait med ${median(b.ttfb).toFixed(0).padStart(4)} ms  p95 ${pct(b.ttfb, 0.95).toFixed(0).padStart(4)} ms  first ${Number.isFinite(b.first) ? b.first.toFixed(0) : "-"} ms  last ${b.last.toFixed(0)} ms`).join("\n");
const pan = async (page) => { await page.mouse.move(680, 430); await page.mouse.down(); await page.mouse.move(180, 430, { steps: 12 }); await page.mouse.up(); };

const browser = await chromium.launch({ args: ["--ignore-certificate-errors"] });
const views = [
  ["the world", `${BASE}/map?perf`],
  ["a dense area, zoomed out (x0.3)", `${BASE}/map?perf&x=${CENTRE.x}&y=${CENTRE.y}&z=0.3`],
  ["a city (x1.2), then a pan of 500 px", `${BASE}/map?perf&x=${CENTRE.x}&y=${CENTRE.y}&z=1.2`, pan],
  ["a close-up (x6, the pictures)", `${BASE}/map?perf&x=${CENTRE.x}&y=${CENTRE.y}&z=6`],
];
for (const [label, url, after] of views) {
  for (let i = 1; i <= RUNS; i++) {
    const r = await scenario(browser, url, after);
    console.log(`\n== ${label} · run ${i} · everything arrived after ${r.settledMs} ms${r.afterMs ? ` (the pan, ${r.afterMs} ms)` : ""}`);
    console.log(fmt(r.by));
  }
}
await browser.close();
