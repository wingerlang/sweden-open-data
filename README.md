# sweden-open-data

[![CI](https://github.com/wingerlang/sweden-open-data/actions/workflows/ci.yml/badge.svg)](https://github.com/wingerlang/sweden-open-data/actions/workflows/ci.yml)

Svensk öppen data i ett litet TypeScript-paket: elpriser, väder, varningar, adresser, inflation, räntor och huspriser. Ett anrop per datakälla, med cache, omförsök och tydliga fel, så att du slipper bygga och underhålla egna klienter mot källor som ändrar sig.

**Live-demo:** <https://wingerlang.github.io/sweden-open-data/> (diagram över elpris, väder, inflation, huspriser och bolåneräntor, hämtade direkt i webbläsaren)

## Vad det gör

```ts
import { createClient } from "./src/mod.ts";   // eller "@wingerlang/sweden-open-data" när paketet är installerat

const se = createClient();

const { today } = await se.spot.prices("SE3");                          // elpris idag
const forecast = await se.weather.forecast({ latitude: 59.33, longitude: 18.07 });
const { alerts } = await se.alerts.near([{ latitude: 59.33, longitude: 18.07 }]);
const kpi = await se.economy.cpi("KPI");                                // inflation
const policy = await se.economy.policyRate();                           // styrränta
```

| Område | Du får | Källa | Nyckel? |
|---|---|---|---|
| Elpris | Spotpris per elområde SE1–SE4, idag och imorgon, billigaste fönster, prisnivå | elprisetjustnu.se (Nord Pool) | Nej |
| Väder | Nuläge, 7 dygn per timme och dag, historik, UV, pollen, luftkvalitet | Open-Meteo | Nej |
| Varningar | VMA, krisinformation och SMHI-varningar nära dina platser | Krisinformation, SMHI | Nej |
| Adresser | Adress- och ortssökning (även landsbygd), län och kommun för en position | Photon (OpenStreetMap) | Nej |
| Inflation | KPI, KPIF, KPIF-XE; "pengar då och nu", följde lönen med? | SCB | Nej |
| Räntor | Styrränta, snittränta för bolån, Handelsbankens listräntor (experimentell) | Riksbanken, SCB, Handelsbanken | Nej |
| Huspriser | Prisindex för småhus per region | SCB | Nej |
| Övrigt | Bilinformation (kräver nyckel), universitet, idrotter, bröllopsdagar, aktiekurser (experimentell) | Flera | Delvis |

Fler exempel för varje funktion finns i [`examples/`](examples/README.md). Alla anrop och alla parametrar står i [den fullständiga referensen](docs/reference.md).

## Kom igång

**Krav:** Node.js 22 eller senare (fungerar även i Deno, Bun och webbläsare). Inga API-nycklar behövs för kärnkällorna.

**Hämta källkoden och prova den**

```sh
git clone https://github.com/wingerlang/sweden-open-data
cd sweden-open-data
npm ci
npm run dev        # startar en testsida på http://localhost:5174
```

Använd det i ett annat projekt genom att bygga ett paket (`npm run build && npm pack`) och installera tarballen. Publicering på JSR är förberedd (`.github/workflows/publish.yml`) men paketet är ännu inte publicerat.

## Konfiguration

Det krävs ingen konfiguration. Allt valfritt ställs in när du skapar klienten:

```ts
import { createClient } from "./src/mod.ts";   // eller "@wingerlang/sweden-open-data" när paketet är installerat
import { fileStore } from "@wingerlang/sweden-open-data/node";

const se = createClient({
  timeoutMs: 8000,                          // tid per anrop
  retries: 2,                               // omförsök vid tillfälliga fel
  store: fileStore("./.cache"),             // spara senaste lyckade svar mellan körningar (från /node)
});
```

Miljövariabler:

| Variabel | Används av | Obligatorisk |
|---|---|---|
| `BILUPPGIFTER_API_KEY` | Valfri fordonsuppslagning (läses på servern, aldrig i webbläsaren) | Nej |
| `PORT` | Testsidan (`npm run dev`), standard 5174 | Nej |

Det finns inga hemligheter i repot. Alla fler alternativ är beskrivna under "Options" i [referensen](docs/reference.md).

## Kör

| Kommando | Vad det gör |
|---|---|
| `npm run dev` | Testsida där du provar alla anrop, ser rådata och simulerar fel |
| `npm test` | Alla tester, utan nätverk |
| `npm run check` | Typer, lint, exporter och täckning, kör före varje commit |
| `npm run examples` | Kör alla exempel offline (`-- --live` mot riktiga källor) |
| `npm run test:live` | Kontrolltest mot de riktiga källorna |

## Arkitektur

```
sweden-open-data/
├── src/
│   ├── core/        # HTTP-klient: timeout, omförsök, cache, delning av samtidiga anrop, fel
│   ├── spot/ weather/ alerts/ geo/ economy/ …   # en modul per datakälla, egen ingång
│   ├── node.ts      # fil-cache för Node
│   └── testing.ts   # fejkade källor så att allt kan testas och köras offline
├── test/            # tester (node:test)
├── examples/        # körbara exempel
├── dev/             # testsidan (npm run dev)
├── docs/            # demo-sidan (GitHub Pages) och fullständig referens
└── .github/workflows/   # CI, veckovisa livetester, publicering
```

Varje datakälla är en egen modul som bara pratar med sin källa och returnerar typade, validerade data. Delad logik för nätverk och cache ligger i `core`. Därför kan en källa ändras eller bytas ut utan att resten av paketet påverkas.

## Teknisk stack

| Komponent | Val | Anledning |
|---|---|---|
| Språk | TypeScript, inga beroenden vid körning | Litet att installera, fungerar överallt |
| Tester | `node:test` mot fejkade källor | Snabba och deterministiska, kräver inget nätverk |
| CI | GitHub Actions: Node 22/24, Deno, Bun, lint, typer, täckning | Fångar fel i alla körmiljöer |
| Publicering | Förberedd för JSR (vid tagg `v*`), ännu inte publicerad | Ingen hemlig nyckel behövs (OIDC) |
| Demo | GitHub Pages från `docs/` | Gratis och utan server |

## CI/CD

Vid push till `main` och vid pull requests körs tester, lint, typkontroll och täckningskontroll. En tagg som `v0.15.0` kör publiceringen till JSR (inte aktiverad än). En schemalagd körning varje måndag testar de riktiga källorna så att formatändringar upptäcks tidigt. Demo-sidan publiceras från `docs/`.

## Begränsningar

- **Källorna ägs av andra** och kan ändra format eller villkor utan förvarning. Därför finns veckovisa livetester och en cache med senaste lyckade svar.
- **Open-Meteo** är gratis för icke-kommersiellt bruk. Kommersiell användning kräver betalplan.
- **Aktiekurser, Handelsbankens listräntor och fordonssidor är experimentella** och bygger på inofficiella källor.
- **Webbläsare:** bara källor som tillåter anrop från andra domäner fungerar direkt (Open-Meteo, Photon, elpris). Använd paketet på en server för övriga.
- Räntor, priser och index är **statistik, inte rådgivning**.

## Data och källor

Datan tillhör respektive utgivare. Visa källan bredvid datan. Villkor per källa finns i [referensen](docs/reference.md#data-and-attribution) och som `*_SOURCE`-konstanter i koden.

## Bidra och licens

Se [CONTRIBUTING.md](CONTRIBUTING.md). Licens: [MIT](LICENSE) © Johannes Winger-Lang.

## Utvecklat med

Claude Code (agentdriven utveckling) som del av kursen Next-Generation Software Development with AI.
