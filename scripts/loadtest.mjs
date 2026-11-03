#!/usr/bin/env node
// A small load test of the public, read-only endpoints of a RUNNING site (no tool to install).
//   node scripts/loadtest.mjs http://localhost:3000 [seconds=8] [concurrency=40]
// Reports requests per second and latency percentiles per endpoint. Run it against a production build (`npm run build && npm start`),
// not the dev server. Locally there is no CDN in front: the figures are what ONE server instance sustains with the cache
// headers ignored — a CDN serves most of these requests without ever reaching it.
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const seconds = Number(process.argv[3] ?? 8), concurrency = Number(process.argv[4] ?? 40);
const rnd = (n) => Math.floor(Math.random() * n);
const targets = [
  ["home page", () => "/"],
  ["/api/stats", () => "/api/stats"],
  ["/api/map/beacons", () => "/api/map/beacons"],
  ["/api/map/tiles (varied)", () => `/api/map/tiles/${rnd(20)}/${rnd(12)}`],
  ["/api/map/raster (varied)", () => `/api/map/raster/5/${rnd(8)}/${rnd(5)}`],
  ["/api/availability (varied)", () => `/api/availability?x=${19000 + rnd(500)}&y=${11700 + rnd(500)}&w=10&h=10`],
  ["share image /api/og/home", () => "/api/og/home?lang=en"],
];
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : NaN;
console.log(`Load test of ${base}: ${concurrency} at a time, ${seconds} s per endpoint\n`);
console.log("endpoint".padEnd(30), "req/s".padStart(8), "p50 ms".padStart(8), "p95 ms".padStart(8), "p99 ms".padStart(8), "errors".padStart(8));
let bad = 0;
for (const [name, path] of targets) {
  const lat = []; let errors = 0, done = 0;
  const end = Date.now() + seconds * 1000;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (Date.now() < end) {
      const t0 = performance.now();
      try {
        const r = await fetch(base + path(), { headers: { "x-forwarded-for": `10.0.${rnd(250)}.${rnd(250)}` } });
        await r.arrayBuffer();
        if (r.status >= 500) errors++; else if (r.status === 429) errors++; // too many requests is not a success for a read-only public endpoint
      } catch { errors++; }
      lat.push(performance.now() - t0); done++;
    }
  }));
  lat.sort((a, b) => a - b);
  if (errors > 0) bad++;
  console.log(name.padEnd(30), String(Math.round(done / seconds)).padStart(8), pct(lat, 50).toFixed(0).padStart(8), pct(lat, 95).toFixed(0).padStart(8), pct(lat, 99).toFixed(0).padStart(8), String(errors).padStart(8));
}
console.log(bad ? `\n${bad} endpoint(s) returned errors or were rate limited.` : "\nNo errors.");
process.exit(bad ? 1 : 0);
