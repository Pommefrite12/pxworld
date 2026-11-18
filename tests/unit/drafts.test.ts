import { describe, expect, it } from "vitest";
import { DRAFT_TTL_MS, createDraftStore, expiresAt, type Draft, type DraftBackend } from "@/lib/editor/drafts";

/** The rules of the saved projects (24 hours from the last save, one per account) do not need a browser: the storage is a plain Map here. */
const memory = (): DraftBackend & { data: Map<string, Draft> } => {
  const data = new Map<string, Draft>();
  return {
    data,
    get: async (k) => data.get(k),
    put: async (k, d) => { data.set(k, d); },
    delete: async (k) => { data.delete(k); },
    all: async () => [...data.entries()],
  };
};
const HOUR = 3_600_000;
const draft = (savedAt: number, w = 20, title = "My project"): Draft => ({
  v: 1, savedAt, rect: { x: 100, y: 200, w, h: w },
  fields: { title, description: "", link: "", commercial: false, archive: { category: "", placeLabel: "", placeCountry: "" }, days: 30 },
  editor: { dots: 10, bg: "#ffffff", paint: null, text: null, photo: null },
});

describe("saved projects", () => {
  it("are kept for 24 hours from the last save, then gone", async () => {
    const b = memory(), s = createDraftStore(b);
    const t0 = Date.UTC(2026, 10, 18, 9, 0, 0);
    await s.save("alice", draft(t0));
    expect((await s.load("alice", t0 + 1))?.fields.title).toBe("My project");
    expect(await s.load("alice", t0 + 23 * HOUR + 59 * 60_000)).not.toBeNull();
    expect(expiresAt(draft(t0))).toBe(t0 + DRAFT_TTL_MS);
    expect(await s.load("alice", t0 + DRAFT_TTL_MS)).toBeNull(); // exactly 24 h: over
    expect(b.data.has("alice"), "an expired project is deleted when it is looked at").toBe(false);
  });

  it("saving again restarts the 24 hours, and replaces the previous project (one per account)", async () => {
    const b = memory(), s = createDraftStore(b);
    const t0 = Date.UTC(2026, 10, 18, 9, 0, 0);
    await s.save("alice", draft(t0, 20, "first"));
    await s.save("alice", draft(t0 + 20 * HOUR, 50, "second"));
    const d = (await s.load("alice", t0 + 30 * HOUR))!; // 30 h after the first save, 10 h after the second
    expect([d.fields.title, d.rect.w]).toEqual(["second", 50]);
    expect(b.data.size).toBe(1);
  });

  it("belong to one account: another account on the same browser does not see them", async () => {
    const s = createDraftStore(memory());
    const t0 = Date.now();
    await s.save("alice", draft(t0));
    expect(await s.load("bob", t0)).toBeNull();
    expect(await s.load("alice", t0)).not.toBeNull();
  });

  it("can be removed (deleted by hand, or after being sent)", async () => {
    const s = createDraftStore(memory());
    const t0 = Date.now();
    await s.save("alice", draft(t0));
    await s.remove("alice");
    expect(await s.load("alice", t0)).toBeNull();
    await s.remove("nobody"); // nothing to remove is not an error
  });

  it("a project dated in the future (the clock was changed) is not kept beyond what is reasonable", async () => {
    const s = createDraftStore(memory());
    const now = Date.UTC(2026, 10, 18, 9, 0, 0);
    await s.save("alice", draft(now + 5 * 24 * HOUR));
    expect(await s.load("alice", now)).toBeNull();
    await s.save("bob", draft(now + 30_000)); // a few seconds of difference between two clocks are fine
    expect(await s.load("bob", now)).not.toBeNull();
  });

  it("an unknown format is never trusted", async () => {
    const b = memory(), s = createDraftStore(b);
    b.data.set("alice", { ...draft(Date.now()), v: 2 } as unknown as Draft);
    expect(await s.load("alice")).toBeNull();
  });

  it("every expired project of the browser is purged at once, whoever owns it, and the others stay", async () => {
    const b = memory(), s = createDraftStore(b);
    const now = Date.UTC(2026, 10, 18, 9, 0, 0);
    await s.save("alice", draft(now - 30 * HOUR));
    await s.save("bob", draft(now - 2 * HOUR));
    await s.save("carol", draft(now - 25 * HOUR));
    expect(await s.purge(now)).toBe(2);
    expect([...b.data.keys()]).toEqual(["bob"]);
  });
});
