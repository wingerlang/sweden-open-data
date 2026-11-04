# Steg 4 och 5 – CV-punkt och demo

## CV-punkt

Designade och utvecklade ett typat TypeScript-bibliotek utan runtime-beroenden (Node/Deno/Bun, node:test, GitHub Actions, JSR) som hämtar svensk öppen data (elpriser, väder, VMA, adresser, SCB:s KPI) med cache, omförsök och felhantering, med hjälp av agentdriven utveckling (Claude Code). Projektet löser problemet att varje utvecklare annars bygger egna klienter mot instabila öppna källor och är tillgängligt på https://jsr.io/@wingerlang/sweden-open-data (kod: https://github.com/wingerlang/sweden-open-data).

## Demo – 3 minuter (≈ 380 ord)

**0:00–1:00 – Vad är byggt? (visa live)**
Öppna jsr.io-sidan och GitHub-repot med grön CI-badge. Kör `npm run dev` och visa dev-sidan: klicka *Run all*, visa elpriset för SE3 med diagram, slå på fel "503" på en källa och visa hur klienten försöker igen och använder cachen. Säg: "Ett bibliotek, inga beroenden, ett anrop per datakälla."

**1:00–2:00 – Hur hjälpte AI konkret?**
Exempel från steg 3: en användare såg kurs 50 kr men utdelning 10 kr efter en aktiesplit. Agenten körde alla sviter, följde dataflödet till `combineQuotes()` och skrev ett reproduktionstest (`steg3-repro.mts`). Jag bedömde hypoteserna och godkände rättningen (commit 90ca32b). I steg 4 körde agenten polerings­prompten och fann otydliga felmeddelanden i `fetchMarketQuote`: "Provider status 404" blev "Unknown symbol …, check the ticker".

**2:00–3:00 – Vad gör jag annorlunda nästa gång?**
1. Sätter upp deployment och CI första dagen, inte sista.
2. Skriver kravspecen först och låter agenten verifiera mot den.
3. Låter en separat agent granska innan jag litar på "alla tester gröna". Commit-texten sa själv att inga fulla tester körts.

Öva med timer: sikta på 2:45.
