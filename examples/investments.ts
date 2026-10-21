/**
 * Experimental: investment companies from IBIndex – price against net asset value (NAV), sorted by discount. IBIndex
 * offers no public API or agreement for these endpoints, so this lives outside createClient(); check the terms before
 * you use it live.
 *
 *   node examples/investments.ts           # fake sources (two invented companies)
 *   node examples/investments.ts --live
 */
import { createInvestmentClient, IBINDEX_SOURCE } from "../src/investments/mod.ts";
import { createFakeSources } from "../src/testing.ts";

const live = process.argv.includes("--live");
const ib = createInvestmentClient(
  live ? { userAgent: "sweden-open-data example" } : { fetch: createFakeSources().fetch },
);

const { companies, stale } = await ib.overview();
const rows = companies
  .filter((c) => c.reportedDiscount !== null)
  .sort((a, b) => (b.reportedDiscount ?? 0) - (a.reportedDiscount ?? 0));
console.log(`${"company".padEnd(28)} ${"price".padStart(8)} ${"NAV".padStart(8)} discount`);
for (const c of rows.slice(0, 10)) {
  const discount = c.reportedDiscount as number;
  const label = discount >= 0 ? `${discount.toFixed(1)} %` : `premium ${(-discount).toFixed(1)} %`;
  console.log(
    `${c.name.slice(0, 28).padEnd(28)} ${c.price.toFixed(1).padStart(8)} ${c.reportedNav?.toFixed(1).padStart(8)} ${label}`,
  );
}
const first = rows[0];
if (first) {
  const detail = await ib.company(first.product);
  const top = detail.holdings.filter((h) => h.weightPct !== null).slice(0, 3);
  console.log(
    `\nlargest holdings of ${first.name}:`,
    top.map((h) => `${h.name} ${h.weightPct?.toFixed(0)} %`).join(", "),
  );
}
console.log(`\nSource: ${IBINDEX_SOURCE}${stale ? " (older copy – IBIndex did not answer)" : ""}`);
