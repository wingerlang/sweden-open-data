/** Only fixed-source public reference data belongs here. Never pass account/workspace payloads. */
export function createMarketReadCache({ store, now = Date.now, maxEntries = 128, timeoutMs = 6000, retryMs = 30000, valid, }) {
    const memory = new Map(), pending = new Map(), hydrating = new Map(), failures = new Map();
    const remember = (key, entry) => {
        memory.delete(key);
        memory.set(key, entry);
        while (memory.size > maxEntries)
            memory.delete(memory.keys().next().value);
    };
    const io = async (work, fallback) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(work),
                new Promise((r) => {
                    timer = setTimeout(() => r(fallback), 250);
                }),
            ]);
        }
        catch {
            return fallback;
        }
        finally {
            clearTimeout(timer);
        }
    };
    const restore = (key) => {
        const existing = hydrating.get(key);
        if (existing)
            return existing;
        if (!store || hydrating.size >= 16)
            return Promise.resolve(undefined);
        const job = (async () => {
            const raw = await io(() => store.get(key), undefined);
            try {
                if (raw) {
                    const row = JSON.parse(raw);
                    if (row.schema === 1 && Number.isFinite(row.at) && row.at <= now() && valid(row.value, key))
                        return { at: row.at, value: row.value };
                }
            }
            catch {
                /* Derived cache is disposable. */
            }
            return undefined;
        })().finally(() => hydrating.delete(key));
        hydrating.set(key, job);
        return job;
    };
    const refresh = (key, load) => {
        const existing = pending.get(key);
        if (existing)
            return existing;
        if (pending.size >= 16 || Number(failures.get(key) || 0) > now())
            return Promise.reject(Error("Källan är tillfälligt otillgänglig."));
        const controller = new AbortController();
        let timer;
        const job = (async () => {
            try {
                const value = await Promise.race([
                    Promise.resolve().then(() => load(controller.signal)),
                    new Promise((_, reject) => {
                        timer = setTimeout(() => {
                            controller.abort();
                            reject(Error("Källan tog för lång tid."));
                        }, timeoutMs);
                    }),
                ]);
                if (!valid(value, key))
                    throw Error("Ogiltiga referensdata.");
                const entry = { value, at: now() };
                remember(key, entry);
                failures.delete(key);
                if (store)
                    await io(() => store.set(key, JSON.stringify({ schema: 1, ...entry })), undefined);
                return entry;
            }
            catch (error) {
                failures.set(key, now() + retryMs);
                while (failures.size > maxEntries)
                    failures.delete(failures.keys().next().value);
                throw error;
            }
            finally {
                clearTimeout(timer);
                pending.delete(key);
            }
        })();
        pending.set(key, job);
        return job;
    };
    return async (key, ttlMs, maxAgeMs, load) => {
        if (!/^[A-Za-z0-9:%_.|^=-]{1,1024}$/.test(key))
            throw Error("Ogiltig cachenyckel.");
        let saved = memory.get(key);
        if (!saved && store) {
            saved = await restore(key);
            if (saved)
                remember(key, saved);
        }
        const output = (entry, stale) => ({
            value: entry.value,
            fetchedAt: new Date(entry.at).toISOString(),
            stale,
        });
        if (saved && now() - saved.at <= maxAgeMs) {
            const stale = now() - saved.at >= ttlMs;
            if (stale)
                void refresh(key, load).catch(() => { });
            return output(saved, stale);
        }
        return output(await refresh(key, load), false);
    };
}
