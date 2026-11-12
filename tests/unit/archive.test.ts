import { describe, expect, it } from "vitest";
import { CATEGORIES, COUNTRY_RE, PLACE_MAX, isCategory, normalizeCountry } from "@/lib/archive";
import { parseCreationMeta } from "@/lib/creations";
import { COUNTRY_CODES } from "@/lib/countries";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const fails = (o: Record<string, string>) => { try { parseCreationMeta(form(o)); } catch (e) { return [(e as { status: number }).status, (e as { code: string }).code]; } return null; };

describe("the archive fields", () => {
  it("has the eleven categories of the plan, each said in English and in French", () => {
    expect(CATEGORIES).toHaveLength(11);
    for (const c of CATEGORIES) {
      expect((en.archive.categories as Record<string, string>)[c], `en ${c}`).toBeTruthy();
      expect((fr.archive.categories as Record<string, string>)[c], `fr ${c}`).toBeTruthy();
    }
    expect(Object.keys(en.archive.categories).sort()).toEqual([...CATEGORIES].sort()); // no orphan label
    expect(isCategory("food")).toBe(true);
    for (const bad of ["Food", "", null, undefined, 3, "pizza"]) expect(isCategory(bad)).toBe(false);
  });

  it("keeps the country as two upper-case letters, or nothing", () => {
    expect(normalizeCountry(" it ")).toBe("IT");
    for (const bad of ["ITA", "I", "1A", "", null, undefined, 5]) expect(normalizeCountry(bad)).toBeNull();
    expect(COUNTRY_RE.test("FR")).toBe(true);
    expect(COUNTRY_CODES.every((c) => COUNTRY_RE.test(c))).toBe(true); // every country of the list is accepted by the rule
    expect(PLACE_MAX).toBe(80);
  });
});

describe("what the API accepts for a creation (the same form for a purchase, a project and a new version)", () => {
  const base = { title: "Hello world", description: "A short description" };

  it("does not require the archive fields: a creation sent without them is simply not classified", () => {
    expect(parseCreationMeta(form(base))).toMatchObject({ category: null, placeLabel: null, placeCountry: null });
  });

  it("reads them, cleaned: spaces, control characters, a lower-case country", () => {
    const m = parseCreationMeta(form({ ...base, category: " food ", placeLabel: "  Naples \u0000 (centre)  ", placeCountry: "it" }));
    expect(m).toMatchObject({ category: "food", placeLabel: "Naples (centre)", placeCountry: "IT" });
    expect(parseCreationMeta(form({ ...base, category: "", placeLabel: "   ", placeCountry: "" }))).toMatchObject({ category: null, placeLabel: null, placeCountry: null });
  });

  it("cuts the place at 80 characters", () => {
    expect(parseCreationMeta(form({ ...base, placeLabel: "x".repeat(200) })).placeLabel).toHaveLength(80);
  });

  it("refuses a category or a country that is not valid, with a code the interface translates", () => {
    expect(fails({ ...base, category: "pizza" })).toEqual([400, "invalid_category"]);
    expect(fails({ ...base, category: "FOOD" })).toEqual([400, "invalid_category"]);
    expect(fails({ ...base, placeCountry: "ITA" })).toEqual([400, "invalid_country"]);
    expect(fails({ ...base, placeCountry: "1!" })).toEqual([400, "invalid_country"]);
    expect(fails({ ...base, category: "food", placeCountry: "IT" })).toBeNull();
  });

  it("requires a short description too, after the title (owner's rule): missing, blank or too short is refused", () => {
    expect(fails({ title: "Hello world", category: "food" })).toEqual([400, "description_required"]);
    expect(fails({ title: "Hello world", description: "   " })).toEqual([400, "description_required"]);
    expect(fails({ title: "Hello world", description: " ab " })).toEqual([400, "description_required"]);
    expect(fails({ description: "A short description" })).toEqual([400, "title_required"]); // the title is checked first
    expect(parseCreationMeta(form({ ...base, description: "  a \u0000 b  " })).description).toBe("a b");
    expect(parseCreationMeta(form({ ...base, description: "x".repeat(400) })).description).toHaveLength(280);
  });

  it("still requires the title (the archive fields do not replace it)", () => {
    expect(fails({ category: "food" })).toEqual([400, "title_required"]);
  });
});
