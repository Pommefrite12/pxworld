import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import es from "@/messages/es.json";
import zh from "@/messages/zh.json";
import { withFallback } from "@/i18n/request";
import { locales } from "@/i18n/routing";

const keys = (o: unknown, prefix = ""): string[] =>
  typeof o === "object" && o !== null ? Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}|<(\w+)>/g)].map((m) => m[1] ?? `<${m[2]}>`).sort().join(",");
const flat = (o: unknown, prefix = ""): Record<string, string> =>
  typeof o === "object" && o !== null
    ? Object.assign({}, ...Object.entries(o).map(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k)))
    : { [prefix]: String(o) };

describe("translations", () => {
  it("declares English (default), French, Spanish and Chinese", () => expect([...locales]).toEqual(["en", "fr", "es", "zh"]));
  it("French has exactly the same keys as English", () => {
    const e = new Set(keys(en)), f = new Set(keys(fr));
    expect([...e].filter((k) => !f.has(k))).toEqual([]);
    expect([...f].filter((k) => !e.has(k))).toEqual([]);
  });
  it("interpolation placeholders match between languages", () => {
    const fe = flat(en), ff = flat(fr);
    for (const k of Object.keys(fe)) expect(placeholders(ff[k] ?? ""), k).toBe(placeholders(fe[k]!));
  });
  it("no empty strings", () => {
    for (const [k, v] of Object.entries({ ...flat(en) })) expect(v.trim().length, k).toBeGreaterThan(0);
    for (const [k, v] of Object.entries({ ...flat(fr) })) expect(v.trim().length, k).toBeGreaterThan(0);
  });
});

/** Spanish and Chinese translate everything the public sees; English fills the staff back office (`admin`) and the legal texts (`pages`, still being reviewed: they are shown in English with a mention). */
describe.each([["es", es], ["zh", zh]] as const)("%s", (name, own) => {
  const left = new Set(["admin", "pages"]);
  const e = flat(en), t = flat(own);
  it("translates every public text: all the keys of English except the staff back office and the legal pages", () => {
    const missing = Object.keys(e).filter((k) => !left.has(k.split(".")[0]!) && !(k in t));
    expect(missing).toEqual([]);
    expect(Object.keys(t).filter((k) => !(k in e))).toEqual([]); // and nothing English does not have
  });
  it("keeps the placeholders, the tags and the plural/select structure of every string it translates", () => {
    const icu = (s: string) => [...s.matchAll(/\{(\w+),\s*(plural|select)/g)].map((m) => `${m[1]}:${m[2]}`).sort().join(",");
    for (const k of Object.keys(t)) { expect(placeholders(t[k]!), k).toBe(placeholders(e[k]!)); expect(icu(t[k]!), k).toBe(icu(e[k]!)); expect(t[k]!.trim().length, k).toBeGreaterThan(0); }
  });
  it("is completed by English where it does not translate (a missing key never breaks a page), and translated strings win", () => {
    const merged = flat(withFallback(en as never, own as never));
    expect(Object.keys(merged).sort()).toEqual(Object.keys(e).sort());
    for (const k of Object.keys(t)) expect(merged[k], k).toBe(t[k]);
    expect(merged["admin.title"] ?? merged[Object.keys(merged).find((k) => k.startsWith("admin."))!]).toBeTruthy();
  });
  it("says it in its own language when the legal texts are in English (the mention is translated, the texts are English)", () => {
    expect(t["pages.officialNotice"]).toBeTruthy();
    expect(t["pages.officialNotice"]).not.toBe(e["pages.officialNotice"]);
    expect(Object.keys(t).filter((k) => /^pages\.(terms|privacy|rules|credits)\./.test(k))).toEqual([]);
  });
});
