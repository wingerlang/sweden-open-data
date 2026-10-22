import test from "node:test";
import assert from "node:assert/strict";
import {getWeddingName, WEDDING_NAMES_SOURCE} from "../src/anniversaries/mod.ts";
test("Swedish wedding milestones are local, deterministic and reject invalid years", () => {
  assert.equal(getWeddingName(1), "Bomullsbröllop");
  assert.equal(getWeddingName(10), "Tennbröllop");
  assert.equal(getWeddingName(25), "Silverbröllop");
  assert.equal(getWeddingName(50), "Guldbröllop");
  assert.equal(getWeddingName(80), "Platinabröllop");
  for (const year of [-1, 0, 2, 10.5, 99, NaN, Infinity]) assert.equal(getWeddingName(year), undefined);
  assert.equal(getWeddingName(10), getWeddingName(10));
  assert.match(WEDDING_NAMES_SOURCE.url, /svenskakyrkan.se/);
});
