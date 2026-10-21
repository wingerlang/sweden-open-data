/**
 * Experimental: the free vehicle lookup from Transportstyrelsen's public page, with a link for a browser tab when
 * automatic reading is not possible. The page is not an API and registration numbers can be personal data, so look up
 * only vehicles you have a reason to, and check the terms before using it live.
 *
 *   node examples/vehicle-lookup.ts ABC123          # fake sources (an invented vehicle)
 *   node examples/vehicle-lookup.ts ABC123 --live
 */
import { createFreeVehicleClient, vehicleLookupLinks } from "../src/vehicles/free.ts";
import { createFakeSources } from "../src/testing.ts";

const live = process.argv.includes("--live");
const plate = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "ABC123";
const vehicles = createFreeVehicleClient(
  live ? { userAgent: "sweden-open-data example" } : { fetch: createFakeSources().fetch },
);

try {
  const v = await vehicles.lookup(plate);
  if (!v) console.log("No vehicle with that registration number.");
  else {
    console.log(`${v.registrationNumber}  ${v.make ?? ""} ${v.model ?? ""}`);
    if (v.modelYear) console.log(`  model year        ${v.modelYear}`);
    if (v.mileageKm !== undefined) console.log(`  odometer          ${v.mileageKm.toLocaleString("sv-SE")} km`);
    if (v.annualTaxKr !== undefined) console.log(`  annual tax        ${v.annualTaxKr} kr`);
    if (v.nextInspectionDeadline) console.log(`  inspect by        ${v.nextInspectionDeadline}`);
  }
} catch {
  console.log("Could not read the page automatically. Open it yourself:");
}
console.log(`  ${vehicleLookupLinks(plate).transportstyrelsen}`);
