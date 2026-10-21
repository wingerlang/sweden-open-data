import test from "node:test";
import assert from "node:assert/strict";
import { getSports, findSport, searchSports, SPORTS_SOURCE } from "../src/sports/mod.ts";

test("sports are immutable public facts with stable identities and semantic emoji", () => {
  const rows = getSports();
  assert.ok(rows.length >= 80);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.ok(Object.isFrozen(rows));
  for (const row of rows) {
    assert.match(row.id, /^sport:[a-z-]+$/);
    assert.ok(row.name && row.emoji && row.category);
    assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(row.aliases));
    assert.deepEqual(Object.keys(row).sort(), ["aliases", "category", "emoji", "id", "name"]);
    assert.equal(findSport(row.id), row);
    assert.equal(findSport(row.name), row);
  }
  assert.equal(SPORTS_SOURCE.kind, "curated");
  assert.equal(new URL(SPORTS_SOURCE.referenceUrl).protocol, "https:");
  assert.ok(Object.isFrozen(SPORTS_SOURCE));
});
test("names, aliases and accents resolve consistently while unknown custom sports remain free text", () => {
  assert.equal(findSport("wrestling")?.name, "Brottning");
  assert.equal(findSport(" BROTTNING ")?.emoji, "🤼");
  assert.equal(findSport("pingis")?.id, "sport:table-tennis");
  assert.equal(findSport("bjj")?.id, "sport:bjj");
  assert.equal(findSport("faktning")?.name, "Fäktning");
  assert.equal(findSport("missing"), undefined);
  assert.equal(findSport(""), undefined);
  assert.equal(searchSports("brott")[0]?.name, "Brottning");
  assert.equal(searchSports("cross country")[0]?.id, "sport:cross-country-skiing");
  assert.equal(searchSports("pingis")[0]?.name, "Bordtennis");
  assert.equal(searchSports("gym")[0]?.id, "sport:strength-training");
  assert.deepEqual(searchSports("missing"), []);
});
test("search bounds and sorting never mutate the underlying catalogue", () => {
  const before = JSON.stringify(getSports());
  assert.equal(searchSports("").length, 10);
  assert.equal(searchSports("", 2).length, 2);
  assert.equal(searchSports("", 2.9).length, 2);
  assert.equal(searchSports("", -1).length, 0);
  assert.equal(searchSports("", 0).length, 0);
  assert.equal(searchSports("", NaN).length, 10);
  assert.equal(searchSports("", Infinity).length, 10);
  assert.equal(searchSports("", 1000).length, getSports().length);
  assert.equal(JSON.stringify(getSports()), before);
});
