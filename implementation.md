# Åtgärdsplan

Steg för steg för att åtgärda alla fynd i [`docs/kodgranskning.md`](docs/kodgranskning.md). Fyndkoderna (S1, P1, T1 …) hänvisar dit.

## Så här används planen

1. Gör stegen **i ordning**. Varje steg bygger på de föregående.
2. **Ett steg = en commit** (eller en PR). Blanda aldrig formatering och logikändringar.
3. Kör `npm run check` före varje commit. Allt ska vara grönt.
4. Bocka av steget här när ”Klart när” är uppfyllt.
5. Lägg inte till nya datakällor förrän steg 16 är klart.

Varje steg har tre delar: **Varför** (vilket fynd), **Gör** (konkreta ändringar) och **Klart när** (hur du vet att det fungerar).

---

## Fas 0 · Stoppa skulden (1 dag)

### Steg 1 · Skapa arbetsgren och baslinje

- [x] Klart (2026-10-21: 93/93 tester, täckning 99,86 % rader / 95,24 % grenar / 98,45 % funktioner)

**Gör**
1. `git switch -c refactor/kodgranskning`
2. Kör `npm test` och `npm run coverage`. Spara utdata i PR-beskrivningen som baslinje.

**Klart när:** 93 tester passerar på grenen.

### Steg 2 · Lås verktygsversionerna (S4)

- [x] Klart (2026-10-21): typescript 5.9.3 och @types/node 22.20.1 i `devDependencies`, `package-lock.json` incheckad, CI installerar med `npm ci`. `npm run typecheck` fungerar nu lokalt.

**Varför:** TypeScript saknas i `package.json`. Lokalt används 7.0.2, i CI 5.9, och det finns ingen låsfil.

**Gör**
1. `npm install --save-dev --save-exact typescript@5.9 @types/node@22`
2. Checka in `package-lock.json`.
3. I `.github/workflows/ci.yml`, `live.yml` och `publish.yml`: lägg `- run: npm ci` före första `npm`-kommandot.
4. I `ci.yml`, jobbet `types`: ta bort raden `npm install --no-save typescript@5.9 @types/node@22`.

**Klart när:** `npm ci && npm run typecheck` fungerar lokalt och i CI.

### Steg 3 · Säkra dev-servern (S2)

- [x] Klart (2026-10-21). Utöver planen: `Host`-headern kontrolleras (skydd mot DNS rebinding), fault-objekt valideras, upptagen port ger ett tydligt fel, och `test/devServer.test.ts` kontrollerar allt automatiskt.

**Varför:** Servern lyssnar på alla nätverkskort och tar emot POST från vilken webbsida som helst.

**Gör** i `dev/server.ts`:
1. Ändra `.listen(port, …)` till `.listen(port, "127.0.0.1", …)`.
2. I `body()`: räkna bytes och svara `413` om summan passerar 64 kB.
3. För alla `POST`:
   - svara `415` om `content-type` inte börjar med `application/json`,
   - svara `403` om `Origin` finns och inte är `http://localhost:<port>` eller `http://127.0.0.1:<port>`.
4. I `/api/config`: kopiera bara kända fält (`mode`, `timeoutMs`, `retries`, `staleIfErrorMs`, `cache`, `locale`) och kontrollera deras typer. Svara `400` annars.

**Klart när:** `curl -X POST -H "Origin: https://example.com" -H "content-type: application/json" -d "{}" http://127.0.0.1:5174/api/config` ger `403`.

### Steg 4 · Beslut om skrapade källor (S1)

- [ ] Klart. Koddelen gjord 2026-10-21: `investments` är borta ur `createClient`, den fria fordonsuppslagningen ligger på `/vehicles/free`, båda är märkta `@experimental` i JSDoc och README, och CHANGELOG har en brytande post. `test/exports.test.ts` låser exportytan. **Kvar för dig:** skicka den skriftliga frågan om villkor till Transportstyrelsen och IBIndex (punkt 1).

**Varför:** `vehicles/free.ts` skrapar Transportstyrelsens webbsida och `investments` använder IBIndex interna API. Ingen av dem har avtal eller API-garanti.

**Gör**
1. Skicka en skriftlig fråga om villkor till Transportstyrelsen och IBIndex.
2. Tills svar finns:
   - ta bort `investments` från `createClient` och `SwedenOpenData` i `src/mod.ts`,
   - ta bort `export {createFreeVehicleClient, …}` från `src/vehicles/mod.ts`; lägg `free.ts` på en egen export `./vehicles/free` i `package.json` och `jsr.json`,
   - lägg `@experimental` och en mening om villkoren i JSDoc för båda,
   - lägg en varningsruta i README under respektive avsnitt.
3. Skriv in beslutet i CHANGELOG under en ny rubrik (0.11.0, brytande ändring).

**Klart när:** `import { createClient } from "@wingerlang/sweden-open-data"` drar inte in någon skrapad källa.

### Steg 5 · Frys nya källor

- [x] Klart (2026-10-21)

**Gör:** Lägg en rad överst i `CONTRIBUTING.md`: ”Inga nya datakällor tas emot förrän åtgärdsplanen steg 16 är klar.”

**Klart när:** raden finns.

---

## Fas 1 · Rätta korrekthetsfelen (1–2 dagar)

### Steg 6 · Skriv regressionstest för P1 (ska först misslyckas)

- [x] Klart (2026-10-21): `test/cancellation.test.ts`. Alla tre testerna misslyckades mot den gamla cachen och checkades in tillsammans med rättningen i steg 7, så att varje commit är grön.

**Varför:** När två anrop delar en laddning och den första anroparen avbryter, får även den andra `aborted`.

**Gör** i `test/core.test.ts`:
1. Skapa klient med `createFakeSources()`, `retries: 0` och `setFault("open-meteo", { delayMs: 200 })`.
2. Starta två `weather.forecast` mot samma position: den första med en `AbortController`, den andra utan signal.
3. Avbryt den första efter 50 ms.
4. Förvänta: första avvisas med `code: "aborted"`, andra lyckas. Kontrollera även att bara **ett** nätverksanrop gjordes.
5. Lägg ett motsvarande test direkt mot `createMemoryCache`.

**Klart när:** testerna finns och **misslyckas** (beviset på felet).

### Steg 7 · Rätta P1 i cachen

- [x] Klart (2026-10-21): varje laddning har en egen `AbortController`; anroparens signal avslutar bara dess egen väntan. Fordonsklienternas cache-bypass är borttagen.

**Gör** i `src/core/cache.ts`:
1. Ändra signaturen till
   `get<V>(key, ttl, load: (signal: AbortSignal) => Promise<V>, options?: { signal?: AbortSignal }): Promise<V>`.
2. Ge varje laddning en egen `AbortController` och en räknare `waiters`.
3. För varje anropare: öka `waiters`; om anroparens signal avbryts, minska `waiters` och avvisa **bara den anroparens** promise. Avbryt laddningens controller först när `waiters` blir 0.
4. Om anroparens signal redan är avbruten: avvisa direkt utan att starta något.
5. Uppdatera alla anropsställen så att signalen skickas som option och laddningen använder den signal den får:
   - `spot/client.ts` (`day`)
   - `weather/client.ts` (`forecast`)
   - `weather/environment.ts` (`environment`)
   - `alerts/client.ts` (`feed`)
   - `geo/client.ts` (`addresses`, `places`, `region`)
   - `economy/client.ts` (`cpi`)
   - `investments/mod.ts` (`cached`)
6. Ta bort undantaget ”med signal, hoppa över cachen” i `vehicles/mod.ts` (`lookup`) och `vehicles/free.ts` (`lookup`).

**Klart när:** testerna från steg 6 passerar och alla övriga tester är gröna.

### Steg 8 · Låt historik ha egen cache (P2)

- [x] Klart (2026-10-21): delad `ctx.archive` (400 dagar, `cache.archiveEntries`) som också töms av `clearCache()`. Test i `test/scaling.test.ts`, som misslyckades före ändringen.

**Varför:** Ett års historik för två elområden (732 poster) tränger ut allt annat ur den delade cachen på 500 poster.

**Gör** i `src/spot/client.ts`:
1. Skapa en separat `createMemoryCache({ maxEntries: 400, now: ctx.now })` för historiska dagar.
2. I `history()`: hämta dagar före idag via den separata cachen (och `PersistentStore` som idag). Idag och framåt går fortfarande via `day()`.
3. Lägg till ett test: hämta en prognos, kör `history` för SE3 och SE4 över ett helt år, hämta prognosen igen. Förvänta 0 nya nätverksanrop.

**Klart när:** testet passerar.

### Steg 9 · Gör `countryFilter` säkrare (P4)

- [x] Klart (2026-10-21): filtret stängs bara av när samma anrop utan filter lyckas, och bara i en timme. Test i `test/geo.test.ts`.

**Gör** i `src/geo/client.ts`:
1. Ersätt `let countryFilter = true` med `let countryFilterOffUntil = 0`.
2. Stäng bara av filtret om anropet gav 400 **och** samma anrop utan `countrycode` lyckades.
3. Stäng av i en timme (`ctx.now() + 3_600_000`), inte för alltid.
4. Test: 400 följt av 400 utan filter → filtret ska vara kvar. Efter en timme (injicerad klocka) → filtret används igen.

**Klart när:** testerna passerar.

### Steg 10 · Storleksgräns för svar och textläsning i kärnan (S3)

- [x] Klart (2026-10-21): `maxResponseBytes` (5 MB) och `http.text()` med `redirect`-val i kärnan; Transportstyrelsen-klienten använder dem (2 MB) i stället för sin egen läsare. Tester i `test/http.test.ts`.

**Gör** i `src/core/http.ts`:
1. Lägg `maxResponseBytes?: number` i `HttpOptions`, default `5_000_000`.
2. Läs svaret med `response.body.getReader()`, räkna bytes och avbryt med `SourceError` (`code: "invalid-response"`, meddelande ”response too large”) när gränsen passeras. Flytta logiken från `vehicles/free.ts`.
3. Lägg `text(source, url, options)` bredvid `json()` i `Http`, med samma retries, timeout och gräns.
4. I `vehicles/free.ts`: använd `ctx.http.text()` och ta bort den egna läsaren och omslaget som gör HTML till falsk JSON.
5. Test: svar på 6 MB ger fel; svar på 1 MB går igenom.

**Klart när:** testerna passerar.

---

## Fas 2 · Gemensam grund (3–4 dagar)

### Steg 11 · Inför formaterare och linter (T3)

- [x] Klart (2026-10-21) med avvikelse: Deno gick inte att installera här, så formateraren är **Prettier 3.8.1** (`npm run fmt`, `npm run fmt:check`, körs via `npx` och kräver ingen ändring i låsfilen) och lintern är ett eget skript utan beroenden (`npm run lint`, `scripts/lint.ts`) för projektets regler. `.editorconfig` finns. CI-ändringen ligger i `ci-steg11-29.patch`.

**Gör**
1. Skapa `deno.json` med `fmt` (`lineWidth: 120`, `indentWidth: 2`, `singleQuote: false`) och `lint` (`recommended`). Deno körs redan i CI, och koden har redan `deno-lint-ignore`-kommentarer.
2. Lägg till i `package.json`: `"fmt": "deno fmt"`, `"lint": "deno lint"`. Lägg `deno fmt --check` och `deno lint` i CI-jobbet `deno`.
3. Skapa `.editorconfig` (UTF-8, LF, 2 mellanslag).

**Klart när:** `deno lint` körs i CI (den får misslyckas tills steg 12 och 17 är klara; markera jobbet `continue-on-error: true` tillfälligt).

### Steg 12 · Formatera om, utan logikändringar

- [x] Klart (2026-10-21): hela kodbasen formaterad med Prettier i en ren stilcommit; hashen står i `.git-blame-ignore-revs`. `npm run lint` hittar inga rader över 120 tecken i koden.

**Gör**
1. Kör `deno fmt src test live dev examples`.
2. Kontrollera att `npm test` fortfarande är grönt.
3. Commit med meddelandet `style: format with deno fmt` och **inga andra ändringar**.
4. Lägg commit-hashen i `.git-blame-ignore-revs`.
5. Ta bort `continue-on-error` för `deno fmt --check`.

**Klart när:** inga rader i `src/` är längre än 120 tecken (`awk 'length > 120' $(git ls-files 'src/**/*.ts')` ger inget).

### Steg 13 · Dokumentation och importer i de nya filerna

- [x] Klart (2026-10-21): alla filer i `src/` börjar med en modulkommentar med exempel, och allt som exporteras har JSDoc. Två nya regler i `npm run lint` (`module-doc`, `export-doc`) håller det så. `deno-lint-ignore`-kommentarerna är borttagna; dubbelimporten i `spot/client.ts` slogs ihop redan i steg 8.

**Gör**
1. Flytta importerna under modulens JSDoc i `src/mod.ts`, `src/weather/client.ts` och `src/vehicles/mod.ts`.
2. Slå ihop de två importerna från `../core/time.ts` i `src/spot/client.ts`.
3. Skriv JSDoc med `@module` och ett exempel för varje export i `vehicles/`, `weather/history.ts`, `weather/environment.ts`, `investments/`, `education/` och `sports/`.

**Klart när:** `deno doc --lint src/mod.ts` ger inga fel.

### Steg 14 · En plats för delade hjälpfunktioner

- [x] Klart (2026-10-21): `src/core/parse.ts` (`fold`, `text`, `finiteNumber`, `isoDay`, `dayFromEpochMs`, `invalidResponse`) med tester i `test/parse.test.ts`. Kopiorna är borta; kvarvarande lokala namn är enradsalias till `parse.ts`. Lintregeln `shared-helper` stoppar nya kopior. Två följdfel hittades och rättades: `.map(text)` skickade index som maxlängd, och skrapad text utan siffror blev tidigare `0` men blir nu `undefined`.

**Gör**
1. Skapa `src/core/parse.ts` med:
   - `fold(text)` – en enda variant: NFKD, ta bort diakritiska tecken, `toLocaleLowerCase("sv")`, trimma, slå ihop mellanslag
   - `text(value, max?)` – trimmad sträng eller `undefined`
   - `finiteNumber(value, { min? })` – tal eller `null`
   - `isoDay(value)` – `YYYY-MM-DD` eller `undefined` (bygger på `isCalendarDate`)
   - `invalidResponse(source, message?)` – `SourceError` med `code: "invalid-response"`
2. Ersätt kopiorna:
   - `fold` i `core/geo.ts` (exportera vidare från `parse.ts`), `education/mod.ts`, `sports/mod.ts`
   - datumvalidering i `weather/history.ts`, `vehicles/mod.ts`, `vehicles/free.ts`, `investments/mod.ts`
   - `text`/`num`/`number`/`value` i `alerts/alerts.ts`, `geo/client.ts`, `vehicles/*`, `investments/mod.ts`, `weather/forecast.ts`, `weather/environment.ts`
   - felfabrikerna i `environment`, `history`, `cpi`, `investments`, `vehicles`
3. Lägg tester för `parse.ts`, särskilt tom sträng, negativa tal, `"12"` som sträng och `2026-02-30`.

**Klart när:** `grep -rnE "const (fold|text|num|number|value|invalid|bad)\s*=" src` bara träffar `src/core/parse.ts`.

### Steg 15 · Delade mönster för cache med lagring och maskning

- [x] Klart (2026-10-21): `src/core/source.ts` med `cachedWithStore`, som används av economy och investments, samt `redactError` och `redactedHooks`, som används av båda fordonsklienterna. Färsk data har aldrig `stale`. Tester i `test/source.test.ts`.

**Gör**
1. Skapa `src/core/source.ts` med `cachedWithStore(ctx, key, ttl, isValid, load, options)`: läs lagret, returnera färskt värde, annars ladda, spara och returnera; vid fel returnera lagrat värde med `stale: true`.
2. Använd den i `economy/client.ts` och `investments/mod.ts`. Färsk data ska aldrig ha `stale: true`.
3. Lägg en `redactedHooks(options, redactedUrl, keyPrefix)` i samma fil och använd den i båda fordonsklienterna.

**Klart när:** logiken finns på ett ställe och befintliga tester för economy, investments och vehicles passerar.

### Steg 16 · Alla klienter via `Context`

- [x] Klart (2026-10-21): fyra nya endpoints och fyra nya TTL:er i `Context`. `weather.history` finns på huvudklienten, tar ett `Context` och har `signal`, liksom alla investments-metoder. Fordonsklienterna läser alltid standardadressen, så en API-nyckel eller ett registreringsnummer aldrig skickas till en överskriven adress. Lintregeln `endpoint` stoppar hårdkodade API-adresser. Tester i `test/context.test.ts`.

**Gör**
1. I `src/core/context.ts`, lägg till:
   - `Endpoints`: `weatherArchive`, `ibindex`, `biluppgifter`, `transportstyrelsen`
   - `CacheTtl`: `weatherHistory` (6 h), `investments` (6 h), `investmentsOverview` (15 min), `vehicle` (6 h)
2. Byt de hårdkodade URL:erna och TTL:erna i `weather/history.ts`, `investments/mod.ts`, `vehicles/mod.ts`, `vehicles/free.ts` mot `ctx.endpoints.*` och `ctx.ttl.*`.
3. Lägg `signal?: AbortSignal` i `history()` och i alla `investments`-metoder.
4. Låt `createWeatherHistoryClient` ta `ClientOptions | Context`, och lägg `history` i `WeatherClient` så att `se.weather.history(...)` fungerar.
5. Gör rot-exporten konsekvent med beslutet i steg 4.

**Klart när:** `grep -rn "https://" src --include=*.ts | grep -v "core/context.ts\|SOURCE\|url:"` ger inga hårdkodade API-adresser i klienterna.

### Steg 17 · Ta bort `any`

- [x] Klart (2026-10-21): ingen `any` kvar i `src/`. Parsrarna läser okänd data med `record()`, `list()` och `pick()`. Lintregeln `no-any` gäller i stället för `deno lint`, som inte kunde köras här.

**Gör**
1. Ersätt `any` med `unknown` i `alerts/alerts.ts`, `geo/address.ts`, `geo/client.ts`, `weather/forecast.ts` och `investments/mod.ts`.
2. Använd hjälparna från steg 14 och små typvakter för att läsa fälten.
3. Ta bort alla `deno-lint-ignore no-explicit-any`.
4. Ta bort `continue-on-error` för `deno lint` i CI.

**Klart när:** `deno lint` är grönt utan undantag.

### Steg 18 · Unika källnamn

- [x] Klart (2026-10-21): historik heter `open-meteo-archive`. Alla källor finns i `SourceId`, `SOURCE_IDS` och `sourceOf()`, så fel kan simuleras per källa i dev-tavlan och i tester.

**Gör**
1. Döp om källorna så att statistiken inte blandas: `open-meteo-archive` (historik), `open-meteo-air-quality` (finns), `ibindex`, `transportstyrelsen`, `biluppgifter`.
2. Lägg alla i `SourceId`, `SOURCE_IDS` och `sourceOf()` i `src/testing.ts`.

**Klart när:** `se.stats().sources` visar en rad per källa.

---

## Fas 3 · Skala (2–3 dagar)

### Steg 19 · Gräns per källa (P3)

- [x] Klart (2026-10-21): `src/core/limit.ts` med samtidighet och anrop per minut per källa, inkopplat i `http`. Platsen släpps före backoff, och en väntande begäran kan avbrytas. Standardvärdet är Photon med två åt gången, och README beskriver hur gränserna sätts. Tester i `test/limit.test.ts`.

**Gör** i `src/core/http.ts`:
1. Lägg `limits?: Record<string, { concurrency?: number; perMinute?: number }>` i `HttpOptions`.
2. Bygg en semafor (samtidiga anrop) och en token bucket (anrop per minut) per källnamn.
3. Ett anrop som väntar i kö ska kunna avbrytas med sin `AbortSignal`.
4. Sätt försiktiga standardvärden för `photon` (t.ex. 2 samtidiga) och dokumentera dem i README. Ange att användaren ska justera efter källans villkor.
5. Test: 10 samtidiga anrop mot en källa med `concurrency: 2` → aldrig fler än 2 samtidigt.

**Klart när:** testet passerar.

### Steg 20 · Färre anrop per adressökning (P3)

- [x] Klart (2026-10-21): högst två varianter i första steget, och orten slås bara upp om den inte redan fanns i svaren. Exemplet `"Åraslöv 1105, 28890 Vinslöv"` ger 3 anrop när orten finns i första svaret och annars 4, mot tidigare 6. README beskriver debounce och `signal` för autocomplete (se steg 19). Med verkliga Photon-svar är detta inte verifierat; live-testet i steg 27 täcker det.

**Gör** i `src/geo/client.ts`:
1. Begränsa varianterna i steg 1 av `searchAddresses` till högst 2.
2. Hoppa över steg 2 om steg 1 gav en ort med samma namn.
3. Lägg ett avsnitt i README om att autocomplete ska använda debounce (300 ms) och `AbortSignal`.

**Klart när:** ett test visar högst 3 Photon-anrop för `"Åraslöv 1105, 28890 Vinslöv"`.

### Steg 21 · Bounding box för varningspolygoner (P5)

- [x] Klart (2026-10-21): bounding box per polygon cachas i en `WeakMap`. `scripts/bench-alerts.ts` (50 varningar × 20 platser) mätte 0,55 ms mot 6,02 ms, alltså 11 gånger snabbare. Korrekthetstest med en L-formad polygon i `test/scaling.test.ts`.

**Gör** i `src/alerts/alerts.ts`:
1. Lägg en `WeakMap<Polygon, [minLon, minLat, maxLon, maxLat]>` som fylls första gången en polygon används.
2. I `alertPlaces`: hoppa över `inPolygon` när platsen ligger utanför boxen.

**Klart när:** befintliga tester passerar och ett mikrotest med 50 varningar × 20 platser är minst 5 gånger snabbare.

### Steg 22 · Tolka tider en gång (P6)

- [x] Klart (2026-10-21): sorteringar i `spot/prices.ts` och `alerts` tolkar varje tid en gång innan de sorterar. De publika typerna är oförändrade. Lintregeln `parse-in-sort` stoppar `Date.parse` i jämförare.

**Gör** i `src/spot/prices.ts` och `src/alerts/alerts.ts`:
1. I funktioner som filtrerar eller sorterar: räkna ut `Date.parse` en gång per punkt i början och arbeta med talen.
2. Ändra inte de publika typerna.

**Klart när:** alla tester passerar och `Date.parse` inte anropas inne i `sort`-jämförare.

### Steg 23 · TTL och städning i lagret (P7, S6)

- [x] Klart (2026-10-21) med en justering: `PersistentStore.set` tar `{ ttlMs }`, och `memoryStore` och `fileStore` respekterar det. `fileStore` kodar nycklar reversibelt, tar bort gamla `.tmp`-filer, har `prune()` och läser filer i det gamla formatet. Justeringen: reservkopior för economy och investments sparas i 30 dagar (`STORE_RETENTION_MS`) i stället för minnes-TTL:en, eftersom de ska finnas kvar när källan ligger nere. Kompletta spotdagar sparas utan utgångstid. README har ett Redis-exempel.

**Gör**
1. I `src/core/cache.ts`: ändra till `set(key, value, options?: { ttlMs?: number })`. Befintliga implementationer fungerar fortfarande.
2. I `src/node.ts` (`fileStore`):
   - spara `{ "v": 1, "expires": <ms|null>, "data": "<värde>" }`; läs gamla filer som ”utan utgångstid”,
   - koda varje nyckeldel reversibelt: allt utom `A–Z a–z 0–9 -` blir `_` + två hex-siffror, så `a/b` och `a_b` blir olika filer,
   - ta bort `.tmp`-filer äldre än en timme vid första skrivningen,
   - lägg till `prune()` som tar bort utgångna filer.
3. Skicka `ttlMs` från `economy` och `investments`; spotdagar som är kompletta sparas utan utgångstid.
4. Lägg ett Redis-exempel i README.

**Klart när:** tester för kollision, utgång, `.tmp`-städning och läsning av gammalt format passerar.

### Steg 24 · Belastningstest

- [x] Klart (2026-10-21): `npm run load` kör 100 samtidiga anrop mot 11 metoder: högst ett anrop per URL, noll anrop i andra vågen och högst 2 samtidiga mot Photon. Testet krävde fakes för fyra källor som saknade dem; de gjordes här (se steg 27).

**Gör**
1. Skapa `scripts/load.ts`: 100 samtidiga anrop per metod mot `createFakeSources()`.
2. Räkna `fake.calls` per URL och kontrollera högst ett anrop per nyckel och TTL, och att gränserna från steg 19 hålls.
3. Lägg `"load": "node scripts/load.ts"` i `package.json`.

**Klart när:** `npm run load` passerar.

---

## Fas 4 · Styrning så att skulden inte kommer tillbaka (1 dag)

### Steg 25 · Kontroll av exportlistor (T1)

- [x] Klart (2026-10-21): `scripts/check-exports.ts` (`npm run check:exports`, ingår i `npm run check`) jämför exporterna i `package.json` och `jsr.json`, kontrollerar att filerna finns och att `dist`-sökvägarna matchar, och att varje standard-endpoint har en källa i `sourceOf()`. Test i `test/checkExports.test.ts`. CI-steget ligger i `ci-steg11-29.patch`.

**Gör**
1. Skapa `scripts/check-exports.ts` som jämför nycklarna i `package.json` `exports` och `jsr.json` `exports`, och kontrollerar att varje fil finns i `src/`.
2. Kontrollera även att varje nyckel i `DEFAULT_ENDPOINTS` har en matchande `SourceId` i `testing.ts`.
3. Kör skriptet i CI-jobbet `types`.

**Klart när:** en borttagen rad i `jsr.json` får CI att misslyckas.

### Steg 26 · Täckning per fil (T4)

- [x] Klart (2026-10-21): `npm run coverage` skriver `coverage/lcov.info`, och `scripts/check-coverage.ts` kräver per fil minst 95 % rader, 90 % grenar och 95 % funktioner. Efter formateringen i steg 12 visade `vehicles/free.ts` sin verkliga täckning, 89,6 % rader och 77 % grenar. Nya tester lyfte den och tre andra filer över gränsen, så inga undantag behövdes. Alla 36 filer klarar gränserna.

**Gör**
1. Kör täckningen med `--test-reporter=lcov --test-reporter-destination=coverage/lcov.info`.
2. Skapa `scripts/check-coverage.ts` som läser `lcov.info` och misslyckas om någon fil i `src/` har under 90 % grenar eller 95 % funktioner.
3. Ersätt det nuvarande totala kravet i `npm run coverage` med skriptet.

**Klart när:** CI misslyckas om en enskild fil faller under gränsen.

### Steg 27 · Fakes och live-tester för alla källor (T5)

- [x] Klart (2026-10-21): fakes för fyra källor (från steg 24) och live-tester för arkivet, luftkvaliteten, antalet Photon-anrop och, med `LIVE_SCRAPED=1`, IBIndex och Transportstyrelsen. `CONTRIBUTING.md` listar de fem sakerna en ny källa kräver. Live-testerna är inte körda härifrån eftersom nätet är spärrat; kör `npm run test:live`.

**Gör**
1. Lägg fakes i `src/testing.ts` för `open-meteo-archive`, `open-meteo-air-quality`, och (om de finns kvar efter steg 4) `ibindex` och `transportstyrelsen`.
2. Lägg live-tester i `live/live.test.ts` för samma källor. Skrapade källor körs bara med en miljövariabel (`LIVE_SCRAPED=1`).
3. Uppdatera `CONTRIBUTING.md`: en ny källa kräver parser, fake, live-test, endpoint i `Context` och TTL i `CacheTtl`.

**Klart när:** tabellen ”Kodbasen i korthet” i granskningen har ”Ja” i alla kolumner.

### Steg 28 · Bestäm npm-paketeringen (T2)

- [x] Klart (2026-10-21), alternativ A utan publicering: bygget skriver `.d.ts` till `dist/`, `types` pekar dit och `prepack` bygger. `scripts/check-package.ts` (`npm run check:package`) packar paketet, installerar det i ett tomt strikt TypeScript-projekt, typkontrollerar och importerar. Det passerar; med den gamla layouten gav samma kontroll fel TS5097. `"private": true` och JSR-publiceringen är oförändrade. Att publicera på npm är ditt beslut.

**Gör** ett av följande:
- **A, om npm-användare finns:** sätt `declaration: true` i `tsconfig.build.json`, peka `types` på `./dist/**/*.d.ts`, ta bort `"private": true`, bygg i CI och publicera med `npm publish --provenance` i `publish.yml`.
- **B, annars:** ta bort `default`/`dist`-exporterna och `build`-skriptet, och skriv i README att paketet installeras via JSR (`npx jsr add @wingerlang/sweden-open-data`).

**Klart när:** ett tomt TypeScript-projekt med standard-tsconfig kan installera och typkontrollera paketet.

### Steg 29 · Säkra CI-kedjan (S4)

- [ ] Klart. Förberett 2026-10-21; **kvar för dig**, eftersom `.github` är skyddad för mig: (1) `git apply ci-steg11-29.patch` lägger till jobbet `quality` (`fmt:check`, `lint`, `check:exports`, `check:package`), täckning per fil, `npm ci` överallt och `.github/dependabot.yml`; (2) `node scripts/pin-actions.ts` slår upp varje actions riktiga commit-SHA med `git ls-remote` och pinnar den. Jag kunde inte nå GitHub härifrån och har inte hittat på några SHA:er.

**Gör**
1. Byt `actions/checkout@v4`, `actions/setup-node@v4`, `denoland/setup-deno@v2` och `oven-sh/setup-bun@v2` mot sina commit-SHA (behåll versionen som kommentar).
2. Skapa `.github/dependabot.yml` för `github-actions` och `npm`, varje vecka.

**Klart när:** inga actions refereras med tagg.

### Steg 30 · Säkra länkar från varningar (S5)

- [ ] Klart

**Gör** i `src/alerts/alerts.ts`:
1. Godkänn bara `https://`-länkar vars värd är `krisinformation.se` eller slutar med `.krisinformation.se`. Utöka listan med myndighetsdomäner som faktiskt syns i live-data.
2. Andra länkar ersätts med `https://www.krisinformation.se`, som idag.
3. Skriv i JSDoc för `Alert.summary` och i README att texten är oescapad och alltid ska renderas som text.

**Klart när:** ett test med `https://evil.example/` ger förstasidan.

### Steg 31 · Validera endpoints (S7)

- [ ] Klart

**Gör** i `createContext` (`src/core/context.ts`):
1. Tolka varje endpoint med `new URL()`.
2. Tillåt `https:`, eller `http:` bara för `localhost` och `127.0.0.1`.
3. Kasta `RangeError` med namnet på endpointen annars.

**Klart när:** test med `endpoints: { spot: "file:///etc/passwd" }` kastar `RangeError`.

### Steg 32 · Paketets omfång (T6)

- [ ] Klart

**Gör:** Besluta om `education` och `sports` ska ligga kvar. Om de flyttas: skapa ett eget paket (t.ex. `@wingerlang/sweden-reference-data`), behåll en återexport med `@deprecated` i en version och ta bort den i nästa.

**Klart när:** beslutet står i CHANGELOG.

### Steg 33 · Dokumentation i takt (T7)

- [ ] Klart

**Gör**
1. Lägg till 0.10.0, 0.10.1 och den nya versionen i `CHANGELOG.md`, med alla brytande ändringar listade.
2. Sortera README efter domän: spot, weather, alerts, geo, economy, sedan valfria/experimentella moduler, sist License.
3. Uppdatera `description` i `package.json` så att den beskriver vad paketet faktiskt innehåller.

**Klart när:** CHANGELOG nämner aktuell version och README slutar med `## License`.

### Steg 34 · Släpp

- [ ] Klart

**Gör**
1. Höj versionen till `0.11.0` i `package.json` och `jsr.json`.
2. Kör `npm run check`, `npm run load` och `npm run test:live`.
3. Slå ihop grenen, tagga `v0.11.0` och pusha taggen.

**Klart när:** Publish-jobbet är grönt.

---

## Fynd → steg

| Fynd | Steg |
| --- | --- |
| S1 Skrapade källor | 4, 27 |
| S2 Dev-servern | 3 |
| S3 Svarsstorlek | 10 |
| S4 Verktyg och CI | 2, 29 |
| S5 Länkar i varningar | 30 |
| S6 `fileStore` | 23 |
| S7 Endpoints | 31 |
| P1 Delad `AbortSignal` | 6, 7 |
| P2 Historik i cachen | 8 |
| P3 Gräns per källa | 19, 20 |
| P4 `countryFilter` | 9 |
| P5 Polygoner | 21 |
| P6 Tidtolkning | 22 |
| P7 Lager utan TTL | 23, 24 |
| Enradsstil | 11, 12, 13 |
| Duplicerade hjälpare | 14, 15 |
| `any` | 17 |
| Ojämnt API, hårdkodade adresser | 16, 18 |
| T1 Sju ställen per källa | 25, 27 |
| T2 npm-paketering | 28 |
| T3 Formaterare och linter | 11, 12 |
| T4 Täckning | 26 |
| T5 Kontraktstester | 27 |
| T6 Omfång | 32 |
| T7 Dokumentation | 33 |

---

## Deluppgift A · Uppföljning av agentens arbete

### Vad identifierade agenten?

Agenten läste hela `src/`, CI-flödena och dev-servern, körde testerna och verifierade två fel genom att köra koden mot projektets egna fakes. Huvudfynden (detaljer i [`docs/kodgranskning.md`](docs/kodgranskning.md)):

- **Korrekthet:** en avbruten anropare avbryter även alla andra som väntar på samma data (P1, verifierat), och `spot.history` tränger ut resten av cachen (P2, verifierat).
- **Säkerhet:** två moduler skrapar källor utan avtal (Transportstyrelsen, IBIndex). Dev-servern är öppen mot nätverket och sårbar för CSRF. HTTP-svar läses utan storleksgräns, och verktygsversionerna är inte låsta.
- **Läsbarhet och duplicering:** sju filer i komprimerad enradsstil (upp till 986 tecken per rad) och samma hjälpfunktioner i 3–7 kopior med olika beteende.
- **Skalbarhet och teknisk skuld:** ingen gräns per källa, lagring utan TTL, sju ställen att uppdatera per ny källa och en täckningsgräns som inte mäter något i komprimerade filer.

Utifrån det tog agenten fram en plan på 34 steg i fem faser, med en kontroll per steg.

### Vad ville agenten göra som jag stoppade, och varför?

- **Egen gren för dokumentationen.** Agenten lade granskningen och planen på grenen `docs/kodgranskning`. Jag ville ha dem på `main` direkt, eftersom de är underlag för hela teamet och inte en kodändring som behöver granskas.
- **Mer än ett steg i taget.** Jag lät inte agenten genomföra planen i ett svep. Den får göra ett steg, köra testerna, checka in och sedan vänta på mitt klartecken. Varför: flera steg är brytande ändringar (t.ex. steg 4) eller rör hela kodbasen (steg 12), och jag vill kunna granska och stoppa mellan varje.

[Komplettera här om du stoppade något mer.]

### Vad missade den?

- **Typkontrollen kördes aldrig.** Den lokala TypeScript-installationen (7.0.2) saknar sitt plattformspaket, så `tsc` gick inte att köra. Granskningen bygger på tester och läsning av koden.
- **Ingen push.** Pushen till GitHub stoppades av nätverksproxyn (HTTP 403), och GitHub var inte kopplat till agenten. Jag fick pusha själv.
- **Dev-servern kunde inte hållas igång.** Den startade och svarade på port 5199 men stängdes när agentens kommando avslutades. Jag startar den själv med `npm run dev -- --port 5199`.
- **Live-tester, Deno och Bun kördes inte.** Ingen riktig källa anropades. Det är oklart om källorna fortfarande svarar som förväntat.
- **Overifierade bedömningar.** Den juridiska bedömningen (GDPR, källornas villkor), tidsuppskattningen på 8–11 dagar och påståendet om hur JSR läser modulkommentarer är agentens bedömningar, inte kontrollerade fakta.
- **Översiktlig granskning av vissa filer.** `dev/board.html` och README granskades bara översiktligt.
- **Fel i första versionen.** Dokumentet hade två teckenfel som agenten själv fick rätta i efterhand.
- **Verktygsval utan förankring.** Planen väljer `deno fmt`/`deno lint` som formaterare; det valet bör teamet ta.

### Är projektet körbart efter implementationen?

Ja. Hittills är bara steg 1 genomfört (gren och baslinje, inga kodändringar):

- `npm test`: 93 av 93 tester passerar.
- `npm run coverage`: 99,86 % rader, 95,24 % grenar, 98,45 % funktioner, över gränsvärdena.
- Dev-servern startar och svarar (`/api/state` gav HTTP 200 på port 5199).
- `npm run typecheck` går inte att köra lokalt på grund av TypeScript-installationen. Det åtgärdas i steg 2.
