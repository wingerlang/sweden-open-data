import { test } from "node:test";
import assert from "node:assert/strict";
import * as root from "../src/mod.ts";
import * as vehicles from "../src/vehicles/mod.ts";
import * as freeVehicles from "../src/vehicles/free.ts";
import * as investments from "../src/investments/mod.ts";

test("experimental sources stay out of the main entry point and createClient", () => {
  const se = root.createClient({ fetch: () => Promise.reject(new Error("no network in this test")) });
  assert.equal("investments" in se, false);
  for (const name of ["createFreeVehicleClient", "parseTransportstyrelsenVehicle", "vehicleLookupLinks"]) {
    assert.equal(name in root, false, `${name} must not be exported from the main entry point`);
    assert.equal(name in vehicles, false, `${name} must not be exported from /vehicles`);
    assert.equal(
      typeof (freeVehicles as Record<string, unknown>)[name],
      "function",
      `${name} is available from /vehicles/free`,
    );
  }
  assert.equal("createInvestmentClient" in root, false);
  assert.equal(typeof investments.createInvestmentClient, "function");
  assert.equal(typeof vehicles.createVehicleClient, "function");
});
