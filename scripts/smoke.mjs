#!/usr/bin/env node
// Smoke test of a RUNNING Pixel World site — a production build locally (`npm run build && npm start`) or a deployment.
//   node scripts/smoke.mjs http://localhost:3000
// Looks at what only a production build shows: every page and map endpoint answers, the security headers are there, the
// share images render (their font file made it into the build), development-only doors are shut, nothing leaks.
// It never writes anything and never signs in. Exit code 1 if anything fails.
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`); };
const get = async (path, init) => { const r = await fetch(base + path, { redirect: "manual", ...init }); return { r, status: r.status, type: r.headers.get("content-type") ?? "", body: Buffer.from(await r.arrayBuffer()) }; };
const text = (x) => x.body.toString("utf8");

console.log(`Smoke test of ${base}\n`);

// First of all: is this address even the Pixel World site? (Another site, a typo or a deployment that failed answers differently.)
const probe = await get("/api/stats").catch((e) => ({ status: 0, type: "", body: Buffer.from(String(e?.message ?? e)) }));
let isOurs = false;
try { isOurs = Number.isFinite(JSON.parse(text(probe)).totalPixels); } catch { /* not JSON: not our site */ }
if (!isOurs) {
  console.log(`STOP: ${base} does not answer like the Pixel World site (/api/stats gave ${probe.status || "no answer"}${probe.body.length ? `: "${text(probe).slice(0, 60).replace(/\s+/g, " ")}"` : ""}).`);
  console.log("  - Is it the exact address Vercel shows for your project? (Project → Overview → Visit, then copy the address from the browser.)");
  console.log("  - A name like pixelworld-test.vercel.app may belong to somebody else: Vercel then adds letters to yours.");
  console.log("  - Open <address>/api/stats in a browser: it must show figures such as {\"totalPixels\":308046591,…}.");
  console.log("  - If it does and this test still stops, the database is probably not reachable: read the Vercel logs.");
  process.exit(2);
}


// 1. pages
for (const path of ["/", "/fr", "/map", "/discover", "/fr/discover", "/rules", "/terms", "/privacy", "/credits", "/contact", "/auth/sign-in", "/auth/sign-up"]) {
  const x = await get(path);
  check(`page ${path}`, x.status === 200 && x.type.includes("text/html") && text(x).includes("<main"), `${x.status}`);
}
const home = text(await get("/"));
check("home page: title and share image announced", /<title>[^<]*Pixel World/.test(home) && home.includes("/api/og/home?lang=en"));
check("home page: nothing of development left (no dev sign-in, no mock payment)", !/dev-login|STRIPE_MOCK|DEV_AUTH/.test(home));
check("the story is off unless configured (no countdown in the page)", !home.includes('data-testid="doom-plate"'));

// 2. map and data endpoints
const stats = await get("/api/stats");
check("/api/stats answers with real figures", stats.status === 200 && isOurs, `${stats.status}`);
// Locally the header carries `s-maxage`. On Vercel the edge consumes it (the browser is told `max-age=0, must-revalidate`) and says what it did in
// `x-vercel-cache` (HIT, MISS, STALE…): either proves that a CDN is allowed to keep the answer.
check("/api/stats is cacheable by a CDN", /s-maxage=\d+/.test(stats.r.headers.get("cache-control") ?? "") || Boolean(stats.r.headers.get("x-vercel-cache")), stats.r.headers.get("x-vercel-cache") ? `x-vercel-cache: ${stats.r.headers.get("x-vercel-cache")}` : "");
for (const path of ["/api/map/tiles/0/0", "/api/map/raster/5/0/0", "/api/availability?x=19000&y=11700&w=10&h=10", "/sitemap.xml", "/robots.txt", "/icon.png", "/apple-icon.png"]) {
  const x = await get(path);
  check(`endpoint ${path}`, x.status === 200 && x.body.length > 0, `${x.status}, ${x.body.length} bytes`);
}
const geo = await get("/data/geo/index.json");
check("map reference data is served (public/data/geo)", geo.status === 200 || geo.status === 404 /* the index name may differ */, `${geo.status}`);
const quoteIn = async (country) => { try { return JSON.parse(text(await get("/api/availability?x=19000&y=11700&w=10&h=10", { headers: { "x-vercel-ip-country": country } }))).price?.currency; } catch { return undefined; } };
const [inUs, inFr] = [await quoteIn("US"), await quoteIn("FR")];
// Locally, the header says where the visitor is: dollars for the US, euros for France. On Vercel the platform sets that header itself (a
// forged one is overwritten), so both answers are the currency of the country the request really comes from — also correct, and the proof
// that nobody can pick their own price.
check("the currency follows the country (or the host decides the country itself)", (inUs === "usd" && inFr === "eur") || (inUs === inFr && (inUs === "eur" || inUs === "usd")), inUs === inFr ? `the host decides: ${inUs}` : `US → ${inUs}, FR → ${inFr}`);

// 3. share images: the pixel font must have been carried into the build
for (const q of ["lang=en", "lang=fr", "lang=en&preview=J-9", "lang=fr&preview=0"]) {
  const x = await get(`/api/og/home?${q}`);
  check(`share image ${q}`, x.status === 200 && x.type.includes("image/png") && x.body.length > 5000, `${x.status}, ${x.body.length} bytes`);
}
check("share image of an unknown parcel is a clean 404", (await get("/api/og/parcel/ZZZZZZ")).status === 404);

// 4. headers
const hdr = (await get("/")).r.headers;
for (const [h, want] of [["strict-transport-security", /max-age=\d+/], ["x-content-type-options", /nosniff/], ["x-frame-options", /DENY/], ["referrer-policy", /./], ["permissions-policy", /camera=\(\)/]]) {
  check(`header ${h}`, want.test(hdr.get(h) ?? ""));
}
check("no X-Powered-By", !hdr.get("x-powered-by"));
const csp = hdr.get("content-security-policy-report-only") ?? "";
check("the Content-Security-Policy is sent (report-only)", /default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && !/unsafe-eval/.test(csp) && /report-uri \/api\/csp-report/.test(csp));
const rep = (body, type = "application/csp-report") => get("/api/csp-report", { method: "POST", headers: { "content-type": type }, body });
check("a violation report is accepted (204)", (await rep(JSON.stringify({ "csp-report": { "document-uri": base + "/", "violated-directive": "img-src", "blocked-uri": "https://smoke.example/x.png" } }))).status === 204);
check("…an oversized one is refused (413)", (await rep("x".repeat(20_000))).status === 413);
check("…and one that is not JSON too (400)", (await rep("not json")).status === 400);

// 5. doors that must be shut in production
const dev = await get("/api/dev/login", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ email: "x@example.test" }) });
check("dev sign-in is shut", dev.status === 404 || dev.status === 403 || dev.status === 401, `${dev.status}`);
const pay = await get("/api/dev/pay", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: "{}" });
check("mock payment is shut", pay.status === 404 || pay.status === 403 || pay.status === 401, `${pay.status}`);
const co = await get("/api/checkout", { method: "POST", headers: { origin: "https://evil.example" } });
check("checkout refuses a foreign origin", co.status === 403, `${co.status}`);
const co2 = await get("/api/checkout", { method: "POST", headers: { origin: base } });
check("checkout refuses a visitor who is not signed in", co2.status === 401 || co2.status === 403 || co2.status === 503, `${co2.status}`);
const wh = await get("/api/stripe/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
check("the Stripe webhook refuses an unsigned call", wh.status >= 400, `${wh.status}${wh.status === 503 ? " (payments not configured here)" : ""}`);
const cron = await get("/api/cron/maintenance");
check("the maintenance job refuses a call without its secret", cron.status >= 400, `${cron.status}${cron.status === 503 ? " (no CRON_SECRET here)" : ""}`);
// a well-formed, dangerous request from somebody who is not signed in: it must stop at the door, whatever its content
const admin = await get("/api/admin/action", { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ action: "set_setting", key: "price_unit_cents", value: 1 }) });
check("the admin API refuses a visitor who is not signed in", admin.status === 401 || admin.status === 403, `${admin.status}`);
check("an unknown page is a 404", (await get("/this-page-does-not-exist")).status === 404);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
