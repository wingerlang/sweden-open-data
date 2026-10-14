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
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { PersistentStore } from "./core/cache.ts";

/**
 * A {@link PersistentStore} that keeps one JSON file per key under `directory` (created on demand). Writes are
 * atomic (write to a temporary file, then rename), so a crash never leaves a half-written file behind.
 * Keys are mapped to safe file names; `spot:SE3:2026-01-01` becomes `spot/SE3/2026-01-01.json`.
 */
export function fileStore(directory: string): PersistentStore {
  const root = resolve(directory);
  const path = (key: string): string => {
    const parts = key.split(":").map((part) => part.replace(/[^\w.-]/g, "_").replace(/^\.+/, "_") || "_");
    return join(root, ...parts) + ".json";
  };
  let counter = 0;
  return {
    async get(key) {
      try {
        return await readFile(path(key), "utf8");
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return undefined;
        throw error;
      }
    },
    async set(key, value) {
      const file = path(key);
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.${Date.now().toString(36)}${(++counter).toString(36)}.tmp`;
      await writeFile(temporary, value, "utf8");
      await rename(temporary, file);
    },
  };
}
