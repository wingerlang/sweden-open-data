/**
 * Address autocomplete done kindly: wait until typing pauses, cancel the previous search, and let the per-source
 * limit queue requests to Photon instead of flooding it. Simulates someone typing an address.
 *
 *   node examples/autocomplete.ts [address]           # fake sources
 *   node examples/autocomplete.ts "Drottninggatan 1, Stockholm" --live
 */
import { createClient, type AddressSuggestion, SourceError } from "../src/mod.ts";
import { createFakeSources } from "../src/testing.ts";

const live = process.argv.includes("--live");
const address = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "Drottninggatan 1, Stockholm";
let photonRequests = 0;
const se = createClient({
  ...(live ? { userAgent: "sweden-open-data example" } : { fetch: createFakeSources().fetch }),
  limits: { photon: { concurrency: 2, perMinute: 60 } }, // queue instead of exceeding Photon's fair use
  onRequest: (e) => {
    if (e.source === "photon") photonRequests++;
  },
});

/** Searches when typing pauses for `delayMs`; a newer keystroke cancels the older search. */
function autocomplete(delayMs: number, show: (list: AddressSuggestion[]) => void): (text: string) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: AbortController | undefined;
  return (text) => {
    clearTimeout(timer);
    running?.abort();
    if (text.trim().length < 3) return;
    timer = setTimeout(() => {
      running = new AbortController();
      se.geo.addresses(text, { limit: 3, signal: running.signal }).then(show, (error: unknown) => {
        if (!(error instanceof SourceError && error.code === "aborted")) throw error;
      });
    }, delayMs);
  };
}

let finished: () => void = () => {};
const done = new Promise<void>((resolve) => (finished = resolve));
const type = autocomplete(300, (list) => {
  console.log(`suggestions for "${address}":`);
  for (const s of list) console.log(`  ${s.label}${s.approximate ? " (approximate)" : ""}`);
  finished();
});
for (let i = 1; i <= address.length; i++) {
  type(address.slice(0, i));
  await new Promise((resolve) => setTimeout(resolve, 60)); // someone typing
}
await done;
console.log(`${address.length} keystrokes, ${photonRequests} request(s) to Photon`);
