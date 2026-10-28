# Steg 3 – Felsökning: utdelning i fel enhet efter en aktiesplit

**Modul:** `src/market/history.ts` → `combineQuotes()`
**Status:** reproducerat, rättning klar i `steg3-split-fix.patch` (inte incheckad än)
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

## 3. Underlag

| Typ | Vad det visar |
|---|---|
| **Kod** (`history.ts` rad 176–194) | Rensningen sker bara under villkoret `splitChanged && !fresh.charts.MAX.length`. Loopen innan kopierar `dividendPerShare`, `dividendYieldPct` och `analytics` från cachen när färska värden saknas. Om den färska kursen *har* en MAX-graf hoppas rensningen över, och de gamla värdena blir kvar. |
| **Befintligt test** (`market.test.ts` rad 93–109) | Testar bara split + **tom** MAX-graf. Fallet split + full historik är otestat. Därför är sviten grön. |
| **Stack trace / assertion** från min reproduktion | `AssertionError: pre-split dividend leaked: 10 kr at price 50` och `pre-split ma200 leaked: 100 at price 50` |

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
- [ ] `npm run coverage` (täckningströsklarna) körs efter att patchen är applicerad, via `npm run check`
- [ ] Kontrollera i appen hur `fresh` byggs innan `combineQuotes` anropas (H3)

**Hantering av information:** Jag använde bara egen kod och syntetiska testdata, utan riktiga kurser eller konton. Ett diagnossteg skrev ut miljövariabler som innehöll tillfälliga åtkomstnycklar. Jag förde inte vidare dem till någon fil eller något dokument. Lärdomen är att loggar och miljöutskrifter ska granskas innan de delas.
