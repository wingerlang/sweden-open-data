/**
 * Swedish universities and other higher education institutions listed by UKÄ: a dated reference snapshot with stable
 * ids, for autocomplete and lookups. Not personal education records and not a live accreditation API. No network.
 *
 * ```ts
 * import { searchSwedishInstitutions } from "@wingerlang/sweden-open-data/education";
 *
 * searchSwedishInstitutions("kth")[0].name; // "Kungliga Tekniska högskolan"
 * ```
 *
 * @module
 */
import { fold } from "../core/parse.ts";

/** A higher education institution. */
export interface SwedishInstitution {
  readonly id: string;
  readonly name: string;
  readonly kind: "university" | "college" | "other";
  readonly website: string;
  readonly countryCode: "SE";
  readonly aliases: readonly string[];
}
/** Official source and the snapshot's verification date. Refresh deliberately when the source changes. */
export const SWEDISH_INSTITUTIONS_SOURCE: Readonly<{ url: string; checkedAt: string }> = Object.freeze({
  url: "https://www.uka.se/sa-fungerar-hogskolan/universitet-och-hogskolor/lista-over-universitet-hogskolor-och-enskilda-utbildningsanordnare",
  checkedAt: "2026-10-18",
});
const rows: readonly (readonly [string, string, string, SwedishInstitution["kind"], ...string[]])[] = [
  ["uu", "Uppsala universitet", "https://www.uu.se", "university", "UU", "Uppsala University"],
  ["lu", "Lunds universitet", "https://www.lu.se", "university", "LU", "Lund University"],
  ["gu", "Göteborgs universitet", "https://www.gu.se", "university", "GU", "University of Gothenburg"],
  ["su", "Stockholms universitet", "https://www.su.se", "university", "SU", "Stockholm University"],
  ["umu", "Umeå universitet", "https://www.umu.se", "university", "UmU", "Umeå University"],
  ["liu", "Linköpings universitet", "https://liu.se", "university", "LiU", "Linköping University"],
  ["ki", "Karolinska institutet", "https://ki.se", "university", "KI", "Karolinska Institute"],
  [
    "kth",
    "Kungliga Tekniska högskolan",
    "https://www.kth.se",
    "university",
    "KTH",
    "KTH Royal Institute of Technology",
  ],
  [
    "chalmers",
    "Chalmers tekniska högskola",
    "https://www.chalmers.se",
    "university",
    "Chalmers",
    "Chalmers University of Technology",
  ],
  ["ltu", "Luleå tekniska universitet", "https://www.ltu.se", "university", "LTU", "Luleå University of Technology"],
  [
    "hhs",
    "Handelshögskolan i Stockholm",
    "https://www.hhs.se",
    "university",
    "HHS",
    "SSE",
    "Stockholm School of Economics",
  ],
  [
    "slu",
    "Sveriges lantbruksuniversitet",
    "https://www.slu.se",
    "university",
    "SLU",
    "Swedish University of Agricultural Sciences",
  ],
  ["kau", "Karlstads universitet", "https://www.kau.se", "university", "KAU", "Karlstad University"],
  ["lnu", "Linnéuniversitetet", "https://lnu.se", "university", "LNU", "Linnaeus University"],
  ["oru", "Örebro universitet", "https://www.oru.se", "university", "ORU", "Örebro University"],
  ["miun", "Mittuniversitetet", "https://www.miun.se", "university", "MIUN", "Mid Sweden University"],
  ["mau", "Malmö universitet", "https://mau.se", "university", "MAU", "Malmö University", "Malmö högskola"],
  [
    "mdu",
    "Mälardalens universitet",
    "https://www.mdu.se",
    "university",
    "MDU",
    "MDH",
    "Mälardalens högskola",
    "Mälardalen University",
  ],
  ["bth", "Blekinge tekniska högskola", "https://bth.se", "college", "BTH"],
  ["fhs", "Försvarshögskolan", "https://www.fhs.se", "college", "FHS"],
  ["gih", "Gymnastik- och idrottshögskolan", "https://gih.se", "college", "GIH"],
  ["hb", "Högskolan i Borås", "https://www.hb.se", "college", "HB"],
  ["du", "Högskolan Dalarna", "https://www.du.se", "college", "DU", "Dalarna University"],
  ["hig", "Högskolan i Gävle", "https://hig.se", "college", "HiG"],
  ["hh", "Högskolan i Halmstad", "https://www.hh.se", "college", "HH"],
  ["hkr", "Högskolan Kristianstad", "https://www.hkr.se", "college", "HKR"],
  ["his", "Högskolan i Skövde", "https://www.his.se", "college", "HiS"],
  ["hv", "Högskolan Väst", "https://www.hv.se", "college", "HV", "University West"],
  [
    "ju",
    "Stiftelsen Högskolan i Jönköping",
    "https://ju.se",
    "college",
    "JU",
    "Högskolan i Jönköping",
    "Jönköping University",
  ],
  ["sh", "Södertörns högskola", "https://www.sh.se", "college", "SH"],
  ["beckmans", "Beckmans designhögskola", "https://beckmans.se", "college", "Beckmans"],
  ["konstfack", "Konstfack", "https://www.konstfack.se", "college"],
  ["kkh", "Kungliga Konsthögskolan", "https://kkh.se", "college", "KKH"],
  ["kmh", "Kungliga Musikhögskolan i Stockholm", "https://www.kmh.se", "college", "KMH", "Kungliga Musikhögskolan"],
  ["uniarts", "Stockholms konstnärliga högskola", "https://www.uniarts.se", "college", "SKH", "Uniarts"],
  ["alt", "Akademi för ledarskap och teologi", "https://altutbildning.se", "other", "ALT"],
  ["brunnsvik", "Brunnsviks folkhögskola", "https://bemu.se", "other", "Brunnsvik"],
  ["ehs", "Enskilda Högskolan Stockholm", "https://ehs.se", "other", "EHS"],
  ["erica", "Ericastiftelsen", "https://ericastiftelsen.se", "other"],
  ["gammelkroppa", "Gammelkroppa skogsskola", "https://www.gammelkroppa.se", "other"],
  ["johannelund", "Johannelunds teologiska högskola", "https://www.johannelund.nu", "other"],
  ["mchs", "Marie Cederschiöld högskola", "https://www.mchs.se", "other", "MCHS", "Ersta Sköndal Bräcke högskola"],
  ["newman", "Newmaninstitutet", "https://newman.se", "other"],
  ["rkh", "Röda Korsets Högskola", "https://www.rkh.se", "other", "RKH"],
  ["sapu", "Skandinaviens akademi för psykoterapiutveckling", "https://sapu.se", "other", "SAPU"],
  ["shh", "Sophiahemmet Högskola", "https://www.shh.se", "other", "SHH", "Sophiahemmet"],
  ["sankt-ignatios", "Stiftelsen Sankt Ignatios", "https://www.sanktignatios.org", "other", "Sankt Ignatios"],
  ["smi", "Stockholms Musikpedagogiska Institut", "https://www.smi.se", "other", "SMI"],
  ["cbti", "Svenska institutet för kognitiv psykoterapi", "https://www.cbti.se", "other", "CBTI"],
  ["wmu", "Världssjöfartsuniversitetet", "https://www.wmu.se", "other", "WMU", "World Maritime University"],
];
const institutions: readonly SwedishInstitution[] = Object.freeze(
  rows.map(([id, name, website, kind, ...aliases]) =>
    Object.freeze({ id: "se:" + id, name, website, kind, countryCode: "SE" as const, aliases: Object.freeze(aliases) }),
  ),
);
/** Swedish universities and other UKÄ-listed higher education institutions. No network or side effects.
 * @example getSwedishInstitutions().map(institution => institution.name)
 */
export function getSwedishInstitutions(): readonly SwedishInstitution[] {
  return institutions;
}
/** Accent-insensitive autocomplete by name or alias. Exact aliases rank first; results keep stable IDs.
 * @example searchSwedishInstitutions('KTH')[0].name
 */
export function searchSwedishInstitutions(query: string, limit = 10): SwedishInstitution[] {
  const key = fold(query),
    count = Number.isFinite(limit) ? Math.min(institutions.length, Math.max(0, Math.floor(limit))) : 10;
  const score = (row: SwedishInstitution): number =>
    Math.max(
      ...[row.name, ...row.aliases].map((value) => {
        const term = fold(value);
        return term === key ? 3 : term.startsWith(key) ? 2 : term.includes(key) ? 1 : 0;
      }),
    );
  return institutions
    .map((row) => ({ row, score: score(row) }))
    .filter((value) => !key || value.score > 0)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name, "sv"))
    .slice(0, count)
    .map((value) => value.row);
}
