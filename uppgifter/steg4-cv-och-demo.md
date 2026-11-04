# Steg 4 och 5 – CV-punkt och demo

## CV-punkt

Designade och utvecklade ett typat TypeScript-bibliotek utan runtime-beroenden (Node/Deno/Bun, node:test, GitHub Actions, JSR, GitHub Pages) som hämtar svensk öppen data (elpriser, väder, VMA, adresser, SCB:s KPI, huspriser, bolåneräntor och Riksbankens styrränta) med cache, omförsök och felhantering, med hjälp av agentdriven utveckling (Claude Code). Projektet löser problemet att varje utvecklare annars bygger egna klienter mot instabila öppna källor, används i en egen app (Emergens) och är tillgängligt på https://wingerlang.github.io/sweden-open-data/ (kod: https://github.com/wingerlang/sweden-open-data, paket: https://jsr.io/@wingerlang/sweden-open-data).

## Demo – 3 minuter (≈ 400 ord)

**0:00–1:00 – Vad är byggt? (visa live)**
Öppna live-sidan på GitHub Pages. Visa elpriset med billigaste 3 timmarna, byt plats till Kiruna (elområde och väder byts), scrolla till inflationen (KPIF sedan 1995), huspriser per region och bolåneräntorna mot inflationen med realräntan. Visa sedan GitHub-repot med grön CI-badge. Säg: "Ett bibliotek, inga beroenden, ett anrop per datakälla. Samma paket driver min egen app."

**1:00–2:00 – Hur hjälpte AI konkret?**
Två exempel.
1. **Felsökning (steg 3):** en användare såg kurs 50 kr men utdelning 10 kr efter en aktiesplit. Agenten körde sviterna, följde dataflödet till `combineQuotes()` och skrev ett reproduktionstest. Jag bedömde hypoteserna och godkände rättningen.
2. **Flytt av ansvar till biblioteket (idag):** min app hämtade Riksbankens styrränta med ett eget anrop. Agenten sökte igenom appen, visade att allt annat redan kom från biblioteket, byggde `policyRate()` med tester och en ny version 0.15.0, och förberedde en patch som byter ut det egna anropet. Resultat: alla räntor och huspriser hämtas från samma ställe.

**2:00–3:00 – Vad gör jag annorlunda nästa gång?**
1. Sätter upp deployment och CI första dagen. Coverage-gaten fällde CI i sista stund, och jag fick undanta den experimentella modulen i stället för att skriva testerna.
2. Skriver kravspecen först och låter agenten verifiera mot den.
3. Låter en separat agent granska innan jag litar på "alla tester gröna". Commit-texten sa själv att inga fulla tester körts.

Öva med timer: sikta på 2:45. Har du bråttom, hoppa över Kiruna-bytet.
