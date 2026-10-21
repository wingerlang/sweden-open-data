/**
 * Node.js (and Deno/Bun) helpers that need the file system.
 *
 * ```ts
 * import { createClient } from "@wingerlang/sweden-open-data";
 * import { fileStore } from "@wingerlang/sweden-open-data/node";
 *
 * const se = createClient({ store: fileStore("./.cache/sweden-open-data") });
 * ```
 *
 * @module
 */
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { PersistentStore, StoreSetOptions } from "./core/cache.ts";

/** Options for {@link fileStore}. */
export interface FileStoreOptions {
  /** Clock in milliseconds since the epoch, for expiry. Default `Date.now`. */
  now?: () => number;
}

/** A {@link PersistentStore} on disk that can also remove what has expired. */
export interface FileStore extends PersistentStore {
  /** Deletes expired values and left-over temporary files. Returns how many files were removed. */
  prune(): Promise<number>;
}

/** What a file holds: the value and when it expires (`null`: never). Files from older versions hold the raw value. */
interface Envelope {
  v: 1;
  expires: number | null;
  data: string;
}

const isEnvelope = (value: unknown): value is Envelope =>
  !!value &&
  typeof value === "object" &&
  (value as Envelope).v === 1 &&
  typeof (value as Envelope).data === "string" &&
  ((value as Envelope).expires === null || typeof (value as Envelope).expires === "number");

/**
 * Encodes one part of a key as a file name, reversibly and safely on every file system: letters, digits and `-` stay,
 * every other byte becomes `_` and two hex digits. `a/b` and `a_b` are different files; `..` cannot escape.
 */
function encodePart(part: string): string {
  if (!part) return "_";
  let out = "";
  for (const char of part) {
    if (/^[A-Za-z0-9-]$/.test(char)) out += char;
    else for (const byte of new TextEncoder().encode(char)) out += "_" + byte.toString(16).padStart(2, "0");
  }
  return out;
}

const TEMP_MAX_AGE_MS = 3_600_000;

/** All files under `dir`, recursively; an empty list when it does not exist. */
async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

/**
 * A {@link PersistentStore} that keeps one JSON file per key under `directory` (created on demand). Writes are atomic
 * (write to a temporary file, then rename), so a crash never leaves a half-written file behind; temporary files a
 * crash left are removed on the first write. Values written with `ttlMs` are forgotten after it, and `prune()` deletes
 * them. Keys map to file names part by part: `spot:SE3:2026-01-01` becomes `spot/SE3/2026-01-01.json`.
 */
export function fileStore(directory: string, options: FileStoreOptions = {}): FileStore {
  const root = resolve(directory);
  const now = options.now ?? Date.now;
  const path = (key: string): string => join(root, ...key.split(":").map(encodePart)) + ".json";
  let counter = 0;
  let swept = false;

  const removeOldTemporaries = async (): Promise<number> => {
    let removed = 0;
    for (const file of await walk(root)) {
      if (!file.endsWith(".tmp")) continue;
      try {
        if (now() - (await stat(file)).mtimeMs > TEMP_MAX_AGE_MS) {
          await unlink(file);
          removed++;
        }
      } catch {
        // Another process may have renamed or removed it.
      }
    }
    return removed;
  };

  return {
    async get(key) {
      const file = path(key);
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return undefined;
        throw error;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return raw;
      }
      if (!isEnvelope(parsed)) return raw;
      if (parsed.expires !== null && parsed.expires <= now()) {
        try {
          await unlink(file);
        } catch {
          // Already removed by another process.
        }
        return undefined;
      }
      return parsed.data;
    },
    async set(key, value, setOptions?: StoreSetOptions) {
      const file = path(key);
      await mkdir(dirname(file), { recursive: true });
      if (!swept) {
        swept = true;
        void removeOldTemporaries();
      }
      const ttl = setOptions?.ttlMs;
      const envelope: Envelope = { v: 1, expires: ttl !== undefined && ttl >= 0 ? now() + ttl : null, data: value };
      const temporary = `${file}.${Date.now().toString(36)}${(++counter).toString(36)}.tmp`;
      await writeFile(temporary, JSON.stringify(envelope), "utf8");
      await rename(temporary, file);
    },
    async prune() {
      let removed = await removeOldTemporaries();
      for (const file of await walk(root)) {
        if (!file.endsWith(".json")) continue;
        try {
          const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
          if (isEnvelope(parsed) && parsed.expires !== null && parsed.expires <= now()) {
            await unlink(file);
            removed++;
          }
        } catch {
          // Not ours, or removed meanwhile.
        }
      }
      return removed;
    },
  };
}
