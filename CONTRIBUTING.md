# Contributing

Thanks for helping! Issues and pull requests are welcome.

> **New data sources are frozen** until step 16 of [`implementation.md`](implementation.md) is done. Until then, only
> fixes and the steps of that plan are accepted.

## Ground rules

* **No runtime dependencies.** Web-standard APIs only (`fetch`, `URL`, `AbortController`, `Intl`); file-system code
  belongs in `src/node.ts`.
* **Pure where possible.** Parsing and analysis are pure functions that take data and return data. Network, cache and
  clock live in the clients and come from the shared `Context`.
* **Never invent data.** When a source is incomplete, say so (`null`, `missing`, `approximate: true`) instead of
  filling gaps.
* **Defensive parsing.** A malformed entry is skipped; it never breaks a whole response.
* **Explicit types on everything exported** (`isolatedDeclarations`), and JSDoc with an example for public functions.
* **Tests for every change.** Tests use a scripted `fetch` (`test/helpers.ts`) and never touch the network.
  Coverage must stay above 95 % lines.

## Workflow

```sh
npm run dev         # dev board – try your change against real or fake sources
npm test            # run the tests (Node ≥ 22.18)
npm run coverage    # tests with coverage thresholds
npm run typecheck   # strict TypeScript, no slow types
npm run test:live   # contract tests against the real sources
```

A new source needs all of these (`npm run check` catches a missing source name or export entry):

1. A parser with offline tests, reading data through the helpers in `src/core/parse.ts`.
2. Its address in `Endpoints` / `DEFAULT_ENDPOINTS` and its lifetime in `CacheTtl` / `DEFAULT_TTL` (`src/core/context.ts`).
3. A source name in `SourceId`, `SOURCE_IDS` and `sourceOf()`, and a fake in `createFakeSources()` (`src/testing.ts`).
4. A contract test in `live/live.test.ts`.
5. Its entry point in both `package.json` and `jsr.json`, if it has one.

Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org) style
(`feat(spot): …`, `fix(geo): …`) and add a line to `CHANGELOG.md` under *Unreleased*.

## Releasing

1. Update the version in `package.json` and `jsr.json` (CI checks that they match) and move *Unreleased* in the
   changelog to the new version.
2. Tag the commit `vX.Y.Z` and push the tag. The *Publish* workflow publishes to JSR with provenance.
