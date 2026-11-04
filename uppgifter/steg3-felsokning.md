# Steg 3 – Felsökning: utdelning i fel enhet efter en aktiesplit

**Modul:** `src/market/history.ts` → `combineQuotes()`
**Status:** reproducerat och rättat (commit `90ca32b`). Underlag: `steg3-logg.txt`, `steg3-repro.mts`, `steg3-split-fix.patch`
**Datum:** 2026-10-28

## 1. Delegation – hur jag lade upp undersökningen

Jag började brett och smalnade sedan av:

1. Jag körde hela testsviten, typkontrollen, lint och exportkontrollen. Allt var grönt (163/163), så felet behövde hittas genom läsning och riktade tester.
2. Jag valde att granska den senast rättade koden först, eftersom ny kod har störst risk för fel.
3. Jag använde agenten för de mekaniska stegen: att köra sviterna, följa dataflödet mellan filerna och skriva ett första reproduktionstest. Bedömningen av hypoteserna, påverkan och rättningen gjorde jag själv.
4. Jag rättade i en kopia av repot, så att originalet var orört tills jag hade verifierat ändringen.

## 2. Description – felet med kontext

- **Symptom:** När en snabb kursuppdatering slås ihop med cachad data och en *ny* split upptäcks, kan resultatet få nytt pris men en gammal utdelning per aktie och gamla glidande medelvärden.
  Exempel från mitt test: pris **50 kr** efter en 2:1-split, men `dividendPerShare` = **10 kr** och `ma200` = **100** från före splitten.
- **Senaste förändring:** commit `456a18f` *fix(market): preserve actions and metrics across quick quotes* (2026-10-25). Commit-texten lovar: "A newly discovered split clears metrics … preventing a mixture of incompatible units". Den anger också: "No live-provider or full application tests were run." Rättningen var alltså inte fullt verifierad.
- **Miljö:** Node 22, lokala tester utan nätverk.

## 3. Underlag – tre sorter

Allt underlag kommer från `steg3-repro.mts`, som jag körde mot koden före rättningen (`cdf90d9`). Den fullständiga utskriften finns i `steg3-logg.txt`, och radnumren nedan syftar på den filen.

### 3a. Buggbeskrivning – användarens perspektiv

> "Efter att aktien splittades 2:1 visar appen kurs 50 kr men utdelning 10 kr per aktie. Direktavkastningen står på 10 %, men 10/50 blir 20 %. Vilket stämmer?"

Symptomet säger inte vad som är fel, bara att två siffror motsäger varandra. Uppföljande kontroller:
1. **Faktisk status hos källan:** stämmer splitten (datum och kvot) och den senaste utdelningen hos källan och i bolagets pressmeddelande? Utdelningen ska vara 5 kr per aktie efter splitten.
2. **Vilken siffra är gammal?** Jämför `fetchedAt` och `corporateSplits` i den cachade och den färska kursen.
3. **Omfattning:** gäller felet bara aktier som har splittats sedan senaste fullständiga hämtningen?

### 3b. Applikationslogg – förloppet

| Rad | Vad den visar | Slutsats |
|---|---|---|
| 1 | Cachad kurs: pris 100, utdelning 10, ma200 100, inga splittar | Utgångsläget är konsekvent |
| 2 | Färsk kurs: pris 50, utdelning `null`, full historik (260 punkter), **en ny 2:1-split** | Källan har rapporterat splitten. Utdelningen saknas i den färska kursen. |
| 3 | Ihopslagen kurs: pris **50** men utdelning **10** och ma200 **100** | Värden från före splitten har följt med in i resultatet. Här uppstår felet. |
| 4 | `WARN unit mismatch`: implicit avkastning 20 % mot rapporterad 10 % | Bekräftar användarens symptom med siffror |

Raderna 2 och 3 tillsammans visar att felet uppstår i ihopslagningen (`combineQuotes`) och inte vid hämtningen.

### 3c. Stack trace

Raderna 9–13: `AssertionError: pre-split dividend leaked: 10 kr at price 50`, `at uppgifter/steg3-repro.mts:23:8`.

Stack tracen pekar på min kontroll, inte på `combineQuotes`. Det beror på att funktionen inte kastar något fel, utan tyst returnerar ett felaktigt värde. Stack tracen visar alltså *var felet upptäcktes*, och loggen (rad 2–3) behövdes för att hitta *var det uppstod*. Därefter läste jag koden i `history.ts` rad 176–194. Rensningen sker bara under villkoret `splitChanged && !fresh.charts.MAX.length`, och det befintliga testet (`market.test.ts` rad 93–109) täcker bara fallet utan historik.

## 4. Discernment – hypoteser och prövning

| # | Hypotes | Prövning | Resultat |
|---|---|---|---|
| H1 | Villkoret `!fresh.charts.MAX.length` gör att rensningen uteblir när den färska kursen har full historik | Test: cachad kurs med utdelning 10 kr, färsk MAX-kurs med ny 2:1-split och `dividendPerShare: null` | **Bekräftad.** Testet fallerar utan rättning och går igenom med den. |
| H2 | Samma läcka gäller `analytics` (ma50/ma200 är prisnivåer) | Samma upplägg med `analytics: undefined` | **Bekräftad.** ma200 = 100 vid pris 50. |
| H3 | Felet når användare via bibliotekets egen klient | Följde dataflödet i `client.ts` och `quote.ts`: vid `range: "max"` räknas `analytics` alltid om, och `dividendPerShare` blir `null` bara när historiken är kortare än ett år | **Delvis motbevisad.** Via klienten krävs en ovanlig kombination: ny split, full hämtning och under ett års historik. `combineQuotes` är dock en publik export, och appen kan bygga den färska kursen på andra sätt. **Kontrolleras i appen.** |
| H4 | `dividendYieldPct` blir fel | Avkastning i procent är kvoten mellan utdelning och pris, och den påverkas inte av en split | **Avfärdad som felkälla.** Jag behåller ändå den befintliga försiktiga nollningen. |

Jag testade också `movingAverage` mot en naiv referensimplementation med 3 000 slumpade serier, där vissa priser saknades eller var ogiltiga. Jag hittade inga avvikelser, så den kunde uteslutas.

**Bedömning:** Felet är verkligt och bryter mot det kontrakt som commit-texten utlovar. Påverkan via SDK:ts egen klient är troligen liten. Påverkan i appen är okänd tills appens anrop är kontrollerade.

## 5. Rättning

```diff
-  if (splitChanged && !fresh.charts.MAX.length) {
-    delete result.analytics;
+  // Per-share values and price-level statistics change unit at a split: never carry them over from before it.
+  if (splitChanged) {
+    if (fresh.analytics == null) delete result.analytics;
```

Jag lade till ett regressionstest i `test/market.test.ts` som täcker split med full historik. Testet kontrollerar också att färsk, omräknad `analytics` behålls.

## 6. Diligence – verifiering innan användning

- [x] Regressionstestet fallerar **utan** rättningen och går igenom **med** den
- [x] `market.test.ts` 10/10, `tsc` ok, `lint` ok
- [x] Hela testsviten: 164/164 (163 befintliga + 1 nytt)
- [x] Reproduktionsskriptet: fallerar mot `cdf90d9`, går igenom mot `90ca32b`
- [ ] `npm run check` (inklusive täckningskraven) på `90ca32b`
- [ ] Kontrollera i appen hur `fresh` byggs innan `combineQuotes` anropas (H3)
- [ ] Kontrollera splitten och utdelningen hos källan (3a, punkt 1)

**Hantering av information:** Jag använde bara egen kod och syntetiska testdata, utan riktiga kurser eller konton. Ett diagnossteg skrev ut miljövariabler som innehöll tillfälliga åtkomstnycklar. Jag förde inte vidare dem till någon fil eller något dokument. Lärdomen är att loggar och miljöutskrifter ska granskas innan de delas.
