import { describe, expect, it } from "vitest";
import { fitSize, homeImagePath, shareLines, shareState } from "@/lib/og/story";

const DAY = 86_400_000;

describe("the state of the share image", () => {
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  it("is the ordinary image while the story is off", () => {
    expect(shareState(null, now)).toEqual({ kind: "plain" });
    expect(shareLines("en", { kind: "plain" }, 3)).toBeNull();
  });
  it("counts the real days left, then says the world is over", () => {
    expect(shareState(now + 87 * DAY + 3_600_000, now)).toEqual({ kind: "countdown", days: 87 });
    expect(shareState(now + 9 * DAY + 100, now)).toEqual({ kind: "countdown", days: 9 });
    expect(shareState(now + 5_000, now)).toEqual({ kind: "countdown", days: 0 });
    expect(shareState(now, now)).toEqual({ kind: "end" });
    expect(shareState(now - 3 * DAY, now)).toEqual({ kind: "end" });
    expect(shareState(now + 400 * DAY, now)).toEqual({ kind: "countdown", days: 100 }); // never more than the story's hundred days
  });
  it("changes address with the state and the day, so that a cached preview is refreshed", () => {
    const urls = new Set([
      homeImagePath("fr", { kind: "plain" }), homeImagePath("fr", { kind: "countdown", days: 9 }), homeImagePath("fr", { kind: "countdown", days: 8 }), homeImagePath("fr", { kind: "end" }),
    ]);
    expect(urls.size).toBe(4);
    expect(homeImagePath("fr", { kind: "plain" })).toBe("/api/og/home?lang=fr");
    expect(homeImagePath("de", { kind: "end" })).toBe("/api/og/home?lang=en&s=e"); // anything but French is English
  });
});

describe("the words of the share image", () => {
  it("says the real number of days, with the right plural, in both languages", () => {
    expect(shareLines("en", { kind: "countdown", days: 9 }, null)!.title).toBe("9 DAYS LEFT");
    expect(shareLines("en", { kind: "countdown", days: 1 }, null)!.title).toBe("1 DAY LEFT");
    expect(shareLines("en", { kind: "countdown", days: 0 }, null)!.title).toBe("LAST DAY");
    expect(shareLines("fr", { kind: "countdown", days: 9 }, null)!.title).toBe("PLUS QUE 9 JOURS");
    expect(shareLines("fr", { kind: "countdown", days: 1 }, null)!.title).toBe("PLUS QU'1 JOUR");
    expect(shareLines("fr", { kind: "countdown", days: 0 }, null)!.title).toBe("DERNIER JOUR");
  });
  it("says the real number of survivors, and nothing about it when it is not known", () => {
    expect(shareLines("en", { kind: "end" }, 3)!.figure).toBe("3 PLOTS SURVIVED.");
    expect(shareLines("en", { kind: "end" }, 1)!.figure).toBe("1 PLOT SURVIVED.");
    expect(shareLines("en", { kind: "end" }, 0)!.figure).toBe("NO PLOT SURVIVED.");
    expect(shareLines("fr", { kind: "end" }, 3)!.figure).toBe("3 PARCELLES ONT SURVÉCU.");
    expect(shareLines("fr", { kind: "end" }, 1)!.figure).toBe("1 PARCELLE A SURVÉCU.");
    expect(shareLines("fr", { kind: "end" }, 0)!.figure).toBe("AUCUNE PARCELLE N'A SURVÉCU.");
    const unknown = shareLines("en", { kind: "end" }, null)!.figure;
    expect(unknown).not.toMatch(/\d/); // no number made up
    expect(shareLines("en", { kind: "end" }, 3)!.title).toBe("THE WORLD HAS BEEN DELETED.");
  });
});

describe("fitting a line on the image", () => {
  it("keeps the full size for a short line and shrinks a long one so that it fits", () => {
    expect(fitSize("9 DAYS LEFT", 980, 190)).toBe(190);
    const long = "PLUS QUE 100 JOURS";
    const size = fitSize(long, 980, 190);
    expect(size).toBeLessThan(190);
    expect(long.length * size * 0.385).toBeLessThanOrEqual(980);
    expect(fitSize("THE WORLD HAS BEEN DELETED.", 976, 108)).toBeLessThan(108);
  });
  it("fits every line the images can say, in both languages", () => {
    for (const lang of ["en", "fr"] as const) {
      for (const days of [0, 1, 9, 87, 100]) {
        const t = shareLines(lang, { kind: "countdown", days }, null)!.title;
        expect(t.length * fitSize(t, 980, 190) * 0.385).toBeLessThanOrEqual(980);
      }
      for (const n of [null, 0, 1, 3, 12_345, 999_999]) {
        const l = shareLines(lang, { kind: "end" }, n)!;
        expect(l.title.length * fitSize(l.title, 976, 108) * 0.385).toBeLessThanOrEqual(976);
        expect(l.figure.length * fitSize(l.figure, 976, 92) * 0.385).toBeLessThanOrEqual(976);
      }
    }
  });
  it("never goes below a readable size, and never fails on an empty line", () => {
    expect(fitSize("X".repeat(500), 100, 90)).toBe(12);
    expect(fitSize("", 500, 60)).toBe(60);
  });
});
