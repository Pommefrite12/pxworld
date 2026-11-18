import type { ArchiveValue } from "@/components/archive/ArchiveFields";

/**
 * Projects saved in the editor, to be taken up again later: for 24 hours at most.
 *
 * They are kept in the VISITOR'S OWN BROWSER (IndexedDB) and never sent to the server: nothing to store, to moderate or to erase on our side, and
 * nothing that another visitor of the site can see. The price of it: a project can only be taken up again on the same browser of the same device
 * (and it is gone if the visitor clears the site data). One project per account (the key is the user name), the latest one saved replaces the
 * previous one. A project is worth 24 hours from its LAST save; an older one is deleted the next time it is looked at, and every expired project
 * of the browser is purged when the map opens.
 *
 * `createDraftStore` takes its storage as an argument, so the rules (expiry, one slot per account) are tested without a browser.
 */

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
/** A project dated in the future (the clock of the device was changed) is not trusted beyond this. */
const CLOCK_SKEW_MS = 60_000;

export interface TextSnapshot { value: string; size: number; color: string; x: number; y: number; bold: boolean }
export interface PhotoSnapshot { source: Blob; fit: "cover" | "contain" | "stretch"; zoom: number; ox: number; oy: number; smooth: boolean }

/** What the editor needs to take the work up again: every layer, as the visitor left it. */
export interface EditorSnapshot {
  /** Dots per pixel at which it was drawn: a project only fits a parcel of the same size (so, the same precision). */
  dots: number;
  bg: string;
  /** The hand-drawn layer (transparent where nothing was drawn), as a PNG. */
  paint: Blob | null;
  text: TextSnapshot | null;
  /** The photo as it was sent in (not cropped), with its fit, so that it can still be moved and zoomed. */
  photo: PhotoSnapshot | null;
}

/** The fields of the dialog the visitor may have filled in (not the acceptance of the terms: that is given at the time). */
export interface DraftFields { title: string; description: string; link: string; commercial: boolean; archive: ArchiveValue; days: number }

export interface Draft {
  v: 1;
  /** Milliseconds since 1970 of the last save. */
  savedAt: number;
  /** Where the parcel was chosen (the size is what matters to take the project up again; the place is where it can go back to). */
  rect: { x: number; y: number; w: number; h: number };
  fields: DraftFields;
  editor: EditorSnapshot;
}

export interface DraftBackend {
  get(key: string): Promise<Draft | undefined>;
  put(key: string, draft: Draft): Promise<void>;
  delete(key: string): Promise<void>;
  all(): Promise<Array<[string, Draft]>>;
}

/** When a project stops being kept. */
export const expiresAt = (d: Pick<Draft, "savedAt">): number => d.savedAt + DRAFT_TTL_MS;

const alive = (d: Draft | undefined, now: number): d is Draft =>
  Boolean(d) && d!.v === 1 && d!.savedAt <= now + CLOCK_SKEW_MS && now - d!.savedAt < DRAFT_TTL_MS;

export function createDraftStore(backend: DraftBackend) {
  return {
    /** Keeps the project of `owner`, in place of the one that was there. */
    async save(owner: string, draft: Draft): Promise<void> {
      await backend.put(owner, draft);
    },
    /** The project of `owner`, or null when there is none or when its 24 hours are over (it is then deleted). */
    async load(owner: string, now: number = Date.now()): Promise<Draft | null> {
      const d = await backend.get(owner);
      if (alive(d, now)) return d;
      if (d) await backend.delete(owner);
      return null;
    },
    async remove(owner: string): Promise<void> {
      await backend.delete(owner);
    },
    /** Deletes every project whose 24 hours are over (whoever owns it); returns how many. */
    async purge(now: number = Date.now()): Promise<number> {
      let n = 0;
      for (const [key, d] of await backend.all()) if (!alive(d, now)) { await backend.delete(key); n++; }
      return n;
    },
  };
}
export type DraftStore = ReturnType<typeof createDraftStore>;

/* ---------- the browser's storage ---------- */

// A neutral name on purpose: it does not carry the name of the site, so renaming the site leaves saved projects where they are.
const DB_NAME = "px-drafts", STORE = "drafts";

export const draftsSupported = (): boolean => typeof indexedDB !== "undefined";

const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open(DB_NAME, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error ?? new Error("indexeddb_open"));
  r.onblocked = () => reject(new Error("indexeddb_blocked"));
});

async function withStore<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => () => T): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result());
      tx.onerror = () => reject(tx.error ?? new Error("indexeddb_error"));
      tx.onabort = () => reject(tx.error ?? new Error("indexeddb_abort"));
    });
  } finally {
    db.close();
  }
}

export const idbBackend = (): DraftBackend => ({
  get: (key) => withStore("readonly", (s) => { const r = s.get(key); return () => r.result as Draft | undefined; }),
  put: (key, draft) => withStore("readwrite", (s) => { s.put(draft, key); return () => undefined; }),
  delete: (key) => withStore("readwrite", (s) => { s.delete(key); return () => undefined; }),
  all: () => withStore("readonly", (s) => {
    const keys = s.getAllKeys(), values = s.getAll();
    return () => keys.result.map((k, i): [string, Draft] => [String(k), values.result[i] as Draft]);
  }),
});

/** The store of this browser. (Touching it on the server is harmless as long as nothing calls it: it only reaches for IndexedDB when asked.) */
export const draftStore: DraftStore = createDraftStore(idbBackend());
