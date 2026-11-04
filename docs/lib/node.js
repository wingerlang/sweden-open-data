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
const isEnvelope = (value) =>
  !!value &&
  typeof value === "object" &&
  value.v === 1 &&
  typeof value.data === "string" &&
  (value.expires === null || typeof value.expires === "number");
/**
 * Encodes one part of a key as a file name, reversibly and safely on every file system: letters, digits and `-` stay,
 * every other byte becomes `_` and two hex digits. `a/b` and `a_b` are different files; `..` cannot escape.
 */
function encodePart(part) {
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
async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
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
export function fileStore(directory, options = {}) {
  const root = resolve(directory);
  const now = options.now ?? Date.now;
  const path = (key) => join(root, ...key.split(":").map(encodePart)) + ".json";
  let counter = 0;
  let swept = false;
  const removeOldTemporaries = async () => {
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
      let raw;
      try {
        raw = await readFile(file, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }
      let parsed;
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
    async set(key, value, setOptions) {
      const file = path(key);
      await mkdir(dirname(file), { recursive: true });
      if (!swept) {
        swept = true;
        void removeOldTemporaries();
      }
      const ttl = setOptions?.ttlMs;
      const envelope = { v: 1, expires: ttl !== undefined && ttl >= 0 ? now() + ttl : null, data: value };
      const temporary = `${file}.${Date.now().toString(36)}${(++counter).toString(36)}.tmp`;
      await writeFile(temporary, JSON.stringify(envelope), "utf8");
      await rename(temporary, file);
    },
    async prune() {
      let removed = await removeOldTemporaries();
      for (const file of await walk(root)) {
        if (!file.endsWith(".json")) continue;
        try {
          const parsed = JSON.parse(await readFile(file, "utf8"));
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
