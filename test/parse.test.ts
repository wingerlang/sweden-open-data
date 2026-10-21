import { test } from "node:test";
import assert from "node:assert/strict";
import { dayFromEpochMs, finiteNumber, fold, invalidResponse, isoDay, text } from "../src/core/parse.ts";
import { SourceError } from "../src/core/errors.ts";

test("parse: fold", () => {
  assert.equal(fold(" Åraslöv  Gård "), "araslov gard");
  assert.equal(fold("Hässleholms KOMMUN"), "hassleholms kommun");
  assert.equal(fold("ﬁka"), "fika");
  assert.equal(fold(""), "");
});

test("parse: text", () => {
  assert.equal(text("  hej "), "hej");
  assert.equal(text("abcdef", 3), "abc");
  assert.equal(text("   "), undefined);
  assert.equal(text(""), undefined);
  assert.equal(text(12), undefined);
  assert.equal(text(null), undefined);
});

test("parse: finiteNumber", () => {
  assert.equal(finiteNumber(0), 0);
  assert.equal(finiteNumber(-3.5), -3.5);
  assert.equal(finiteNumber(-1, { min: 0 }), null);
  assert.equal(finiteNumber("12"), null, "strings only on request");
  assert.equal(finiteNumber("12", { strings: true }), 12);
  assert.equal(finiteNumber(" 12.5 ", { strings: true }), 12.5);
  assert.equal(finiteNumber("", { strings: true }), null);
  assert.equal(finiteNumber("  ", { strings: true }), null);
  assert.equal(finiteNumber("12 kr", { strings: true }), null);
  for (const v of [null, undefined, NaN, Infinity, -Infinity, {}, [], true]) assert.equal(finiteNumber(v), null);
});

test("parse: isoDay and dayFromEpochMs", () => {
  assert.equal(isoDay("2026-10-21"), "2026-10-21");
  assert.equal(isoDay("2026-10-21T12:00:00Z"), "2026-10-21");
  assert.equal(isoDay("2026-02-30"), undefined);
  assert.equal(isoDay("2026-10-21x"), undefined);
  assert.equal(isoDay("21/10/2026"), undefined);
  assert.equal(isoDay(20261021), undefined);
  assert.equal(dayFromEpochMs(Date.parse("2026-10-21T23:30:00Z")), "2026-10-21");
  assert.equal(dayFromEpochMs(0), undefined);
  assert.equal(dayFromEpochMs(-5), undefined);
  assert.equal(dayFromEpochMs(9e15), undefined);
  assert.equal(dayFromEpochMs("2026-10-21"), undefined);
});

test("parse: invalidResponse", () => {
  const e = invalidResponse("scb");
  assert.ok(e instanceof SourceError);
  assert.equal(e.code, "invalid-response");
  assert.equal(e.source, "scb");
  assert.equal(e.message, "Unexpected response from scb");
  assert.equal(invalidResponse("scb", "SCB lacks Tid").message, "SCB lacks Tid");
});
