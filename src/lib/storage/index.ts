import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { env, supabaseConfigured } from "@/lib/env";

/**
 * Private object storage. Files are never served from the bucket directly: public reads go through
 * /api/assets/[id], which enforces moderation status and sets cache headers.
 *  - production: Supabase Storage (private bucket, service role)
 *  - development: local filesystem under LOCAL_STORAGE_DIR
 */
export interface ObjectStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("invalid storage key");
  return key;
}

const localStore: ObjectStore = {
  async put(key, bytes) {
    const file = path.resolve(env().LOCAL_STORAGE_DIR, safeKey(key));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  },
  async get(key) {
    try {
      return await fs.readFile(path.resolve(env().LOCAL_STORAGE_DIR, safeKey(key)));
    } catch {
      return null;
    }
  },
  async remove(key) {
    await fs.rm(path.resolve(env().LOCAL_STORAGE_DIR, safeKey(key)), { force: true });
  },
};

function supabaseStore(): ObjectStore {
  const key = env().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Supabase Storage");
  const client = createClient(env().NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
  const bucket = client.storage.from(env().SUPABASE_PUBLIC_BUCKET);
  return {
    async put(k, bytes, contentType) {
      const { error } = await bucket.upload(safeKey(k), bytes, { contentType, upsert: false });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },
    async get(k) {
      const { data, error } = await bucket.download(safeKey(k));
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(k) {
      await bucket.remove([safeKey(k)]);
    },
  };
}

let store: ObjectStore | undefined;
export function objectStore(): ObjectStore {
  return (store ??= supabaseConfigured() && env().SUPABASE_SERVICE_ROLE_KEY ? supabaseStore() : localStore);
}
