/** Fixed-date anniversaries with historical source references.
 * @module
 */
/** Swedish wedding anniversary names. Local reference data; no requests or personal dates. */
export const WEDDING_NAMES_SOURCE: Readonly<{ url: string; checkedAt: string; note: string }> = Object.freeze({
  url: "https://www.svenskakyrkan.se/landvetterharryda/guld-silver-eller-jarnbrollop",
  checkedAt: "2026-10-22",
  note: "Traditional Swedish names vary; unnamed years return undefined.",
});
const names: Readonly<Record<number, string>> = Object.freeze({
  1: "Bomullsbröllop",
  5: "Träbröllop",
  10: "Tennbröllop",
  15: "Kristallbröllop",
  20: "Porslinsbröllop",
  25: "Silverbröllop",
  30: "Pärlbröllop",
  35: "Korallbröllop",
  40: "Rubinbröllop",
  45: "Safirbröllop",
  50: "Guldbröllop",
  55: "Smaragdbröllop",
  60: "Diamantbröllop",
  65: "Krondiamantbröllop",
  70: "Järnbröllop",
  80: "Platinabröllop",
});
/** Name for completed whole years of marriage, or undefined for an unknown/invalid year. */
export function getWeddingName(years: number): string | undefined {
  return Number.isInteger(years) && years > 0 ? names[years] : undefined;
}
