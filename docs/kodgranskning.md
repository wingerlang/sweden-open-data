# Kodgranskning: sweden-open-data

2026-10-21 · Johannes Winger-Lang · granskad version 0.10.1 (commit `5e7d9e5`)

Åtgärderna finns steg för steg i [`implementation.md`](../implementation.md). **Status 2026-10-21:** steg 1–34 är genomförda i version 0.11.0, utom de beslut och nätverkssteg som står som kvar i planen.

## Sammanfattning

Kärnan är stark, men de senaste sju dagarnas tillväxt har skapat en andra, sämre kodbas bredvid den första. `core/` (cache, HTTP, fel, tid) och de ursprungliga modulerna (spot, weather, alerts, geo, economy) är välskrivna, väldokumenterade och testade: 93 av 93 tester passerar och radtäckningen är 99,86 %. Men 7 av 12 exporter, tillagda i v0.3–v0.10 mellan 16 och 20 oktober, är skrivna i komprimerad enradsstil, går förbi den gemensamma `Context` och saknar fakes och live-tester.

De fem viktigaste fynden:

| # | Fynd | Typ | Allvar |
| --- | --- | --- | --- |
| 1 | En avbruten anropare avbryter även alla andra som väntar på samma data (verifierat) | Korrekthet | Hög |
| 2 | Två moduler skrapar odokumenterade källor (Transportstyrelsens webbsida, IBIndex interna API) | Juridik/säkerhet | Hög |
| 3 | Sju filer i enradsstil, upp till 986 tecken per rad, gör radtäckningen meningslös | Läsbarhet | Hög |
| 4 | Samma hjälpfunktioner finns i 3–5 varianter med olika beteende | Duplicering | Medel |
| 5 | `spot.history` fyller cachen och tränger ut allt annat; inga gränser per källa | Skalbarhet | Medel |

Rekommendationen är att frysa nya datakällor i två veckor och genomföra planen: först de två korrekthetsfelen och säkerhetsrisken, sedan en gemensam källmall som alla moduler bygger på. Uppskattad insats: 8–11 utvecklardagar.

## Kodbasen i korthet

`@wingerlang/sweden-open-data` v0.10.1 är ett beroendefritt TypeScript-bibliotek (Node ≥ 22.18, Deno, Bun) som publiceras på JSR. Källkoden är 3 900 rader i 34 filer under `src/`, plus 1 670 rader tester. Varje domän har en ren parser (data in, data ut) och en klient som hämtar via ett gemensamt `Context`: HTTP med timeout och retries, en LRU-cache med single-flight, statistik och en valfri `PersistentStore`.

Designen är bra. Problemet är att de nyare modulerna inte följer den. Tabellen visar vilka moduler som använder kärnans byggstenar.

| Modul | Tillagd | Stil | `ctx.endpoints` | `ctx.ttl` | `AbortSignal` | Fake i `/testing` | Live-test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| spot | v0.1 | Läsbar | Ja | Ja | Ja | Ja | Ja |
| weather.forecast | v0.1 | Läsbar | Ja | Ja | Ja | Ja | Ja |
| alerts | v0.1 | Läsbar | Ja | Ja | Ja | Ja | Ja |
| geo | v0.1 | Läsbar | Ja | Ja | Ja | Ja | Ja |
| economy | v0.9 | Läsbar | Ja | Ja | Ja | Ja | Ja |
| vehicles (Biluppgifter) | v0.3 | Komprimerad | Nej, hårdkodad | Egen | Ja, men utan cache | Ja | Opt-in |
| vehicles (Transportstyrelsen) | v0.4 | Komprimerad | Nej, hårdkodad | Hårdkodad | Ja, men utan cache | Nej | Nej |
| weather.history | v0.5 | Komprimerad | Nej, hårdkodad | Hårdkodad 6 h | Nej | Nej | Nej |
| weather.environment | v0.6 | Komprimerad | Ja | Återanvänder `weather` | Ja | Nej | Nej |
| investments (IBIndex) | v0.10 | Komprimerad | Nej, hårdkodad | Hårdkodad 6 h / 15 min | Nej | Nej | Nej |
| education, sports | v0.7–0.8 | Komprimerad | Statisk data | – | – | – | – |

CONTRIBUTING.md kräver att varje ny källa får en parser med tester, en fake och en live-kontroll. Fyra av de fem senaste nätverkskällorna saknar fake och live-test.

## Säkerhet

Inga kritiska sårbarheter i biblioteket; den största risken är juridisk och gäller källorna, inte koden. Grundhygienen är god: API-nyckeln skickas bara i header, omdirigeringar avvisas för fordonskällor, registreringsnummer maskas i hooks och fel, koordinater avrundas till ~1 km och `fileStore` skriver atomärt.

| # | Fynd | Var | Allvar | Åtgärd |
| --- | --- | --- | --- | --- |
| S1 | Skrapning av Transportstyrelsens webbsida och IBIndex odokumenterade `.req`-API. Inget avtal, ingen API-garanti; registreringsnummer kan vara personuppgifter enligt GDPR. | `vehicles/free.ts`, `investments/mod.ts` | Hög | Kontrollera villkor skriftligt. Flytta till separat, tydligt experimentellt paket eller ta bort. |
| S2 | Dev-servern lyssnar på alla nätverkskort, saknar autentisering och tar emot POST från vilken webbsida som helst (CSRF). Request-body läses utan storleksgräns. | `dev/server.ts:130–193` | Medel | Bind till `127.0.0.1`, kräv `content-type: application/json`, kontrollera `Origin`, begränsa body till 64 kB, validera config-fälten. |
| S3 | `http.json` läser hela svaret utan storleksgräns. En spegel, proxy eller kapad källa kan fylla minnet. Fordonsklienten har redan en gräns på 2 MB. | `core/http.ts:141` | Medel | Flytta strömmande läsning med `maxBytes` från `free.ts` in i kärnan, default 5 MB. |
| S4 | Ingen låsfil, TypeScript är inte deklarerat i `devDependencies` (lokalt 7.0.2, CI 5.9) och GitHub Actions pekas ut med taggar, inte commit-SHA. | `package.json`, `.github/workflows/` | Medel | Lägg till `devDependencies` + `package-lock.json`, `npm ci` i CI, pinna actions på SHA, slå på Dependabot. |
| S5 | Länkar från Krisinformation godkänns om de börjar med `https://`, oavsett domän. `stripHtml` är en regex, inte sanering. | `alerts/alerts.ts:83, 134` | Låg | Tillåt bara `*.krisinformation.se` och kända myndighetsdomäner. Dokumentera att `summary` alltid ska escapas. |
| S6 | `fileStore` mappar `a/b` och `a_b` till samma fil, växer obegränsat och lämnar `.tmp`-filer efter krasch. | `node.ts:24–44` | Låg | Koda nycklar reversibelt, städa `.tmp` vid start, lägg till valfri maxstorlek. |
| S7 | `endpoints` tar godtyckliga URL:er. Om en applikation låter användare påverka dem blir det SSRF. | `core/context.ts:171` | Låg | Validera `https:` (eller `http://localhost`) och dokumentera att värdena är betrodd konfiguration. |

## Prestanda och skalbarhet

Ett enskilt anrop är snabbt; problemen uppstår när biblioteket körs i en server med många samtidiga användare. Två av fynden nedan är verifierade genom att köra koden mot bibliotekets egna fakes.

**P1 · Single-flight delar den första anroparens `AbortSignal` (Hög, verifierat).** `cache.get(key, ttl, () => load(options.signal))` kör laddningen med signalen från den som kom först. Avbryter den anroparen, får alla andra som väntar på samma nyckel felet `aborted`, och deras egna signaler ignoreras. Test: två samtidiga `weather.forecast`, den första avbryts efter 50 ms, den andra (utan signal) får också `aborted`. Gäller spot, weather, alerts, geo och economy. Fordonsklienterna undviker felet genom att hoppa över cachen när en signal finns, vilket i stället ger ett nätverksanrop per förfrågan.

**P2 · `spot.history` tränger ut resten av cachen (Medel, verifierat).** Varje dag är en egen cachepost och LRU-taket är 500. Ett år för ett elområde tar 366 poster; två områden tvingade fram en ny hämtning av en väderprognos som låg i cachen. Historiska dagar borde bara leva i `PersistentStore` eller i en egen, separat begränsad cache.

**P3 · Ingen gräns per källa (Medel).** Bara `history` har en samtidighetsgräns (2). En adressökning i `geo.addresses` kan göra upp till 6 Photon-anrop, och autocomplete ger ett nytt sökord per tangent. Photon och Open-Meteo har fair use-gränser; en server med trafik blir spärrad. Behövs: en semafor och token bucket per källa i `core/http.ts`.

**P4 · Delat tillstånd som ändras av ett fel (Medel).** `countryFilter` i `geo/client.ts:100` stängs av permanent för hela klienten efter ett enda HTTP 400, även om felet berodde på något annat.

**P5 · Varningar matchas utan förfiltrering (Låg).** `alertPlaces` kör `inPolygon` för varje varning × plats × polygon × hörn. En bounding box per polygon skulle hoppa över nästan alla tester.

**P6 · Upprepad tolkning av tider (Låg).** `Date.parse` anropas på samma ISO-strängar i varje filter och sortering i `spot/prices.ts` och `alerts`. Tolka en gång per funktion i stället för en gång per jämförelse.

**P7 · En process, en cache (Låg nu, Hög vid tillväxt).** Cachen finns bara i minnet och `PersistentStore` saknar TTL. Flera serverinstanser hämtar därför samma data var för sig, och lagret växer för alltid.

## Duplicerad logik och läsbarhet

Kodbasen har två stilar, och den nya stilen går inte att granska. De ursprungliga filerna har JSDoc, radlängd under 165 tecken och förklarande kommentarer. De nyare saknar formatering helt:

| Fil | Rader | Rader > 160 tecken | Längsta rad |
| --- | --- | --- | --- |
| `vehicles/free.ts` | 29 | 9 | 986 tecken |
| `weather/history.ts` | 9 | 2 | 864 tecken |
| `investments/mod.ts` | 50 | 15 | 511 tecken |
| `vehicles/mod.ts` | 86 | 10 | 457 tecken |
| `weather/environment.ts` | 87 | 6 | 294 tecken |
| `sports/mod.ts` | 104 | 4 | 278 tecken |
| `education/mod.ts` | 77 | 4 | 263 tecken |

Två konsekvenser är viktigare än utseendet. Radtäckningen blir 100 % så fort en enda rad körs: `vehicles/free.ts` visar 100 % rader men bara 70,6 % grenar och 77,3 % funktioner. Och varje diff blir en ändrad rad på 900 tecken, så kodgranskning i praktiken upphör. Orsaken är att projektet saknar formaterare och linter.

### Samma logik på flera ställen

| Logik | Kopior | Var | Skillnad som kan ge fel |
| --- | --- | --- | --- |
| Vika bort accenter (`fold`) | 3 | `core/geo.ts`, `education`, `sports` | NFD + `toLowerCase` mot NFKD + `toLocaleLowerCase('sv')` + trim |
| Validera `YYYY-MM-DD` | 5 | `core/time.ts`, `weather/history.ts`, `vehicles/mod.ts`, `vehicles/free.ts`, `investments` | `history` använder inte `isCalendarDate` trots att den finns |
| Text- och talhjälpare (`text`, `num`, `number`, `value`) | 7 | alerts, geo, vehicles ×2, investments, forecast, environment | Olika syn på tom sträng, negativa tal och strängar som tal |
| Cache med lagring och stale-fallback | 2 | `economy/client.ts`, `investments/mod.ts` | Investments sätter inte `stale: undefined` på färsk data |
| Maskning av URL och fel | 2 | `vehicles/mod.ts`, `vehicles/free.ts` | Nästan identiska, olika felmeddelanden |
| `SourceError('invalid-response')`-fabrik | 5 | environment, history, cpi, investments, vehicles | `open-meteo` används både för prognos och historik, så statistiken blandas |

### Övriga läsbarhetsproblem

- Importer före modulens JSDoc i `mod.ts:1`, `weather/client.ts:1` och `vehicles/mod.ts:1`.
- Dubbel import från `core/time.ts` i `spot/client.ts` (rad 8 och 20).
- `any` i fem parsrar (`alerts`, `address`, `forecast`, `geo/client`, `investments`) i stället för `unknown` med typvakter.
- Ojämnt publikt API: `createClient` innehåller `investments` men inte `history`; rot-exporten exporterar `vehicles`, `education` och `sports` men inte `investments`; `createWeatherHistoryClient` tar inte emot ett `Context` och kan inte dela cache.
- CHANGELOG slutar vid 0.9.0 medan paketet är 0.10.1, och README har sex nya avsnitt tillagda efter `## License`.

## Teknisk skuld framåt

Den dyraste skulden är att varje ny källa kräver manuella ändringar på sju ställen som ingen kontroll håller ihop. Med 13 commits och tio minor-versioner på sju dagar växer den snabbare än den betalas av.

**T1 · Sju ställen per ny källa.** `src/mod.ts`, `package.json` exports, `jsr.json` exports, `Endpoints` + `DEFAULT_ENDPOINTS`, `CacheTtl`, `testing.ts` (`SourceId`, `sourceOf`, fake) och `live/live.test.ts`. CI kontrollerar bara att versionsnumren är lika.

**T2 · npm-paketet pekar typer på källkod.** `"types": "./src/mod.ts"` med `.ts`-importer kräver att konsumentens tsconfig tillåter `allowImportingTsExtensions`. `dist/` byggs inte i CI och publiceras inte (`"private": true`), så npm-vägen är otestad.

**T3 · Inga verktyg som håller stilen.** Ingen formaterare, linter, `.editorconfig` eller pre-commit-krok.

**T4 · Täckningsgränsen mäter fel sak.** Kravet är 95 % rader och 85 % grenar totalt. Komprimerade filer ger gratis radtäckning, och genomsnittet döljer `free.ts` (70,6 % grenar).

**T5 · Skrapade källor utan kontraktstest.** Transportstyrelsens HTML och IBIndex `.req`-API kan ändras när som helst.

**T6 · Paketets syfte glider.** Beskrivningen lovar ”Swedish open data”, men paketet innehåller nu en kurerad sportlista med emoji, en betald fordonstjänst och skrapning av ett privat API.

**T7 · Dokumentation i otakt.** CHANGELOG saknar 0.10.x, README:s avsnittsordning följer tilläggsordningen, och `package.json`-beskrivningen nämner inte investments, vehicles, education eller sports.

## Planens faser

| Fas | Innehåll | Insats | Kontrollpunkt |
| --- | --- | --- | --- |
| 0 · Stoppa skulden | S1, S2, S4, frys nya källor | 1 dag | Inga oavtalade källor i huvudexporten |
| 1 · Rätta felen | P1, P2, P4, S3 | 1–2 dagar | Regressionstester för P1 och P2 passerar |
| 2 · Gemensam grund | T3, formatering, delade hjälpare, Context överallt | 3–4 dagar | Linter utan undantag, alla klienter via Context |
| 3 · Skala | P3, P5, P6, P7, S6 | 2–3 dagar | En upstream-förfrågan per nyckel vid 100 samtidiga |
| 4 · Styrning | T1, T2, T4, T5, T6, T7, S5, S7 | 1 dag | Ny källa kan inte släppas utan fake, live-test och linter |
