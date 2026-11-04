# Steg 4 – Poleringslista (kodgenomgång)

Åtgärdat i commit `91fad5b`: punkterna markerade ✅. Övriga är kvarvarande förslag.

## 1. Saknad felhantering för externa anrop
| Fil:rad | Fynd | Åtgärd |
|---|---|---|
| ✅ `src/market/quote.ts:~41` | `response.json()` kastade rått `SyntaxError` vid ogiltigt svar | Fångas och ger ett tydligt fel (gjort) |
| `src/market/company.ts:54` | `await response.json()` ofångad: ogiltig JSON ger `SyntaxError` utan symbol | Wrappa i try/catch med `Error("Nyckeltal: ogiltigt svar från Yahoo för " + symbol)` |
| `src/market/company.ts:18-33` | `yahooCrumb`: nätverksfel i `fetchImpl` kastas rått | Fånga och kasta "Yahoo gav ingen åtkomstnyckel (nätverksfel)" med `cause` |
| `src/market/company.ts:196` | `response.text()` kan kasta vid avbruten ström | Samma mönster som ovan |

## 2. Otydliga felmeddelanden
| Fil:rad | Fynd | Åtgärd |
|---|---|---|
| ✅ `src/market/quote.ts:28` | "Provider status 404" | Nämner symbol och vad användaren ska göra (gjort) |
| ✅ `src/market/quote.ts:~75` | "Invalid provider data" | Förklarar vad som saknas (gjort) |
| `src/market/client.ts:352` | "Index source unavailable" | Lägg till indexnamn och HTTP-status |
| `src/market/indices.ts:89,93,100,122,126` | "Invalid index history/observation", "Insufficient index history" | Ange index-id och vad som var fel (t.ex. `färre än 2 observationer`) |
| `src/market/company.ts:164` | "Ogiltigt MFN-namn." | Visa mottaget värde och tillåtet format (`a-z, 0-9, -`, 2–80 tecken) |
| `src/market/cache.ts:99,123` | "Ogiltiga referensdata." / "Ogiltig cachenyckel." | Ta med nyckeln (kortad) |
| Flera filer | Felmeddelanden blandar svenska och engelska (market vs resten) | Välj ett språk per publikt fel; engelska i API, svenska bara i användartext |

## 3. Edge cases
| Fil:rad | Fynd | Åtgärd |
|---|---|---|
| `src/market/quote.ts:~95` | `stamps.length > 50000` ger "Too many quote observations" utan gräns i texten | Skriv ut gränsen och hur man får färre punkter (kortare `range`) |
| `src/market/history.ts:139` | `catch { return false; }` sväljer alla fel i marknadstidsberäkning | Logga via context-hook eller begränsa catch till `RangeError` |
| `src/node.ts:118,125,155` | Skadade cachefiler tolkas tyst som råtext / ignoreras | Räkna och exponera "korrupta poster" i `prune()`-resultatet |
| ✅ `test/housing.test.ts` | Dimensioner som array av koder (`index.map`) saknade test | Test tillagt |

## 4. Dokumentation i komplex kod
| Fil:rad | Fynd | Åtgärd |
|---|---|---|
| `src/market/company.ts:16` | `yahooCrumb` (cookie + crumb-flöde, cache 30 min) saknar förklaring | JSDoc: varför två anrop behövs, giltighetstid, att modulen är officiellt osupportad |
| `src/market/company.ts:138` | `feedItems` saknar doc | Beskriv indata (MFN-feed) och vilka fält som behålls |
| `src/market/client.ts:61` | `wait` saknar doc | Förklara samspelet mellan avbrutet anrop och delad promise |
| `src/market/history.ts:84` | `exchangeParts` saknar doc | Beskriv tidszonshantering |
| ✅ `src/market/quote.ts` | `fetchMarketQuote` saknade doc | JSDoc tillagd |

## 5. Hårdkodade värden
| Fil:rad | Fynd | Åtgärd |
|---|---|---|
| ✅ `src/market/quote.ts` | Timeout `6000` | Namngiven konstant `QUOTE_TIMEOUT_MS` (gjort); nästa steg: läs från client options |
| `src/market/company.ts:21,32,44,50,166,188` | Timeouts 8000/10000/12000 spridda | Samla i konstanter och styr via `ClientOptions.timeoutMs` |
| `src/market/client.ts:350` | Timeout `4000` för indexkälla | Samma |
| `src/market/company.ts:7`, `quote.ts:24` | User-Agent `Emergens` (ett annat projektnamn) hårdkodad | Använd klientens `userAgent`-option (`src/core/http.ts:42`) |
| `src/market/company.ts:18,30,204` | URL:er direkt i koden (övriga går via `ctx.endpoints`) | Lägg i `ctx.endpoints` så de kan bytas i test/proxy |
| `src/market/company.ts:37` | Crumb-livslängd `30 * 60000` | Namngiven konstant |
| `src/market/cache.ts:22` | `retryMs = 30000` | Redan parameter; dokumentera i README |

## 6. Egna preferenser
- Coverage: `src/market/` är undantagen från per-fil-kravet (se `scripts/check-coverage.ts`). Skriv tester för `capitalization.ts`, `series.ts`, `events.ts` och `history.ts` och ta bort undantaget.
- Tomma `catch {}` i `src/core/context.ts:258,275,290` och `src/core/http.ts:97`: kontrollera att varje har en kommentar som säger varför felet ignoreras.
