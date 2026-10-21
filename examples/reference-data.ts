/**
 * Offline reference data for forms: universities and colleges listed by UKÄ, and a sport vocabulary. Store the stable
 * id, show the name. No network, so there is no --live.
 *
 *   node examples/reference-data.ts [query]
 */
import { findSport, searchSports, searchSwedishInstitutions, SWEDISH_INSTITUTIONS_SOURCE } from "../src/mod.ts";

const query = process.argv[2] ?? "kth";
console.log(`Institutions matching "${query}":`);
for (const i of searchSwedishInstitutions(query, 3)) console.log(`  ${i.id.padEnd(14)} ${i.name} (${i.website})`);
console.log(`  (UKÄ list checked ${SWEDISH_INSTITUTIONS_SOURCE.checkedAt})`);

console.log(`\nSports matching "brott":`);
for (const s of searchSports("brott", 3)) console.log(`  ${s.id.padEnd(20)} ${s.emoji} ${s.name}`);
console.log(`\nfindSport("ice hockey") → ${findSport("ice hockey")?.id}`);
