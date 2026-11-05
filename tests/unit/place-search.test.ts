import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FR_DEPARTEMENTS } from "@/lib/geo/frDepartements";
import { departmentLabel, findSmall, indexCommunes, indexPlaces, isShownAsCity, normName, type CommuneRow, type PlaceRow } from "@/lib/geo/placeSearch";

const communes = JSON.parse(readFileSync("public/data/search-communes.json", "utf8")) as CommuneRow[];
const places = JSON.parse(readFileSync("public/data/search-places.json", "utf8")) as PlaceRow[];

describe("how names are compared", () => {
  it("ignores accents, capitals, hyphens, apostrophes and dots, and repeated spaces", () => {
    expect(normName("Saint-Jean-de-Luz")).toBe("saint jean de luz");
    expect(normName("  SAINT  jean DE luz ")).toBe("saint jean de luz");
    expect(normName("Ceyzérieu")).toBe("ceyzerieu");
    expect(normName("L'Isle-d'Abeau")).toBe("l isle d abeau");
    expect(normName("St. Étienne")).toBe("st etienne");
    expect(normName("Île-de-Ré")).toBe("ile de re");
    expect(normName("")).toBe("");
  });
});

describe("finding small places", () => {
  const index = indexCommunes([[1, 1, "Saint-Jean-de-Luz", "64"], [2, 2, "Saint-Jean", "31"], [3, 3, "Luz-Saint-Sauveur", "65"], [4, 4, "Ceyzérieu", "01"], [5, 5, "Saint-Martin", "73"], [6, 6, "Saint-Martin", "24"]]);

  it("puts the exact name first, then the names that start with the query, then those that contain it", () => {
    const m = findSmall(index, normName("saint jean"));
    expect(m.exact.map((c) => c.name)).toEqual(["Saint-Jean"]);
    expect(m.starts.map((c) => c.name)).toEqual(["Saint-Jean-de-Luz"]);
    expect(findSmall(index, normName("luz")).contains.map((c) => c.name)).toEqual(["Saint-Jean-de-Luz"]);
    expect(findSmall(index, normName("luz")).starts.map((c) => c.name)).toEqual(["Luz-Saint-Sauveur"]);
  });

  it("finds a name typed without its accents and hyphens, and keeps homonyms apart", () => {
    expect(findSmall(index, normName("CEYZERIEU")).exact.map((c) => c.dep)).toEqual(["01"]);
    expect(findSmall(index, normName("saint martin")).exact.map((c) => c.dep)).toEqual(["73", "24"]);
    expect(findSmall(index, "nothing like it")).toEqual({ exact: [], starts: [], contains: [] });
    expect(findSmall(index, "")).toEqual({ exact: [], starts: [], contains: [] });
  });

  it("caps each class, so that a short query stays cheap", () => {
    const many = indexPlaces(Array.from({ length: 5000 }, (_, i): PlaceRow => [i, i, 6000, `Sainte-Place ${i}`, "BE"]));
    const m = findSmall(many, "sainte", { exact: 3, starts: 7, contains: 5 });
    expect(m.starts).toHaveLength(7);
    expect(m.exact).toHaveLength(0);
  });

  it("does not list a commune again when the same city is already in the other index", () => {
    const cities = new Map([[normName("Paris"), [{ x: 18983, y: 11738 }]]]);
    expect(isShownAsCity({ n: "paris", x: 18985, y: 11740 }, cities)).toBe(true);
    expect(isShownAsCity({ n: "paris", x: 30000, y: 11740 }, cities)).toBe(false); // a homonym far away is another place
    expect(isShownAsCity({ n: "lyon", x: 18985, y: 11740 }, cities)).toBe(false);
  });
});

describe("the data of the search", () => {
  it("has every département that a commune refers to, with its name", () => {
    const deps = new Set(communes.map((c) => c[3]));
    for (const d of deps) expect(FR_DEPARTEMENTS[d], `département ${d}`).toBeTruthy();
    expect(departmentLabel("01")).toBe("Ain (01)");
    expect(departmentLabel("2A")).toBe("Corse-du-Sud (2A)");
    expect(departmentLabel("XX")).toBe("XX");
  });

  it("holds the communes of France, in the grid, by name, with small villages in it", () => {
    expect(communes.length).toBeGreaterThan(34_000);
    for (const [x, y, name, dep] of communes) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(40_000); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(25_000); expect(name.length).toBeGreaterThan(0); expect(dep).toMatch(/^(\d\d|2A|2B)$/); }
    const idx = indexCommunes(communes);
    const [ceyz] = findSmall(idx, normName("ceyzerieu")).exact;
    expect(ceyz).toMatchObject({ name: "Ceyzérieu", dep: "01" });
    // Ceyzérieu is in the east of France (Ain), around 5.8°E, 45.8°N: x ≈ 19 358 of 40 000
    expect(ceyz!.x).toBeGreaterThan(19_000);
    expect(ceyz!.x).toBeLessThan(19_700);
    // the very small ones are there too (Rochefourchat has a handful of inhabitants)
    expect(findSmall(idx, normName("Rochefourchat")).exact.length).toBeGreaterThan(0);
  });

  it("holds the smaller places of the world and not the cities that the other index has", () => {
    expect(places.length).toBeGreaterThan(15_000);
    for (const [, , pop, name, cc] of places) { expect(pop).toBeLessThan(15_000); expect(pop).toBeGreaterThanOrEqual(1_000); expect(name.length).toBeGreaterThan(0); expect(cc).toMatch(/^[A-Z]{2}$/); }
    expect(places.some((p) => ["RE", "GP", "MQ", "GF", "YT"].includes(p[4]))).toBe(true); // the French overseas places (the communes file has none of them)
  });
});
