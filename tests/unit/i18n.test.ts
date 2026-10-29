import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { locales } from "@/i18n/routing";

const keys = (o: unknown, prefix = ""): string[] =>
  typeof o === "object" && o !== null ? Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}|<(\w+)>/g)].map((m) => m[1] ?? `<${m[2]}>`).sort().join(",");
const flat = (o: unknown, prefix = ""): Record<string, string> =>
  typeof o === "object" && o !== null
    ? Object.assign({}, ...Object.entries(o).map(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k)))
    : { [prefix]: String(o) };

describe("translations", () => {
  it("declares English (default) and French", () => expect([...locales]).toEqual(["en", "fr"]));
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
