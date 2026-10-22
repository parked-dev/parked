# ADR-0001: Write the backend in TypeScript

- **Status:** Accepted, not yet implemented
- **Date:** 2026-10-22
- **Related:** NFR-6 (maintainable), FR-2, FR-8, FR-9, FR-10

## Context

The backend is plain JavaScript ESM (`db.js`, `mcp.js`, `web.js`, `poller.js`, `resolve.js`, `resume.js`,
`install.js`) and the UI is TypeScript. The API's shape is therefore declared twice: once by whatever
`db.js` returns, and again by hand in `ui/src/lib/types.ts`. Nothing checks that they agree.

That drift is not hypothetical. An item already grew fields (`session_id`, `watch`, `status_reason`) and
will grow more with the list view work: `title` and `priority`. Each addition is a chance for the UI to
believe something the server never sends.

## Decision

Rewrite the backend modules in TypeScript, run directly by Node's built-in type stripping. No build step,
no transpiler, no bundler, no new runtime dependency.

## Rationale

- **One definition of the data.** `Item` and `State` move to a single shared module, imported by both the
  server and the UI, so a change to the API shape breaks the type-check instead of surfacing as a runtime
  surprise.
- **Zero cost at runtime.** Node 22.5+ strips types natively, so `node web.js` and the MCP server keep
  starting instantly and the runtime dependency count stays at zero (NFR-6).
- **No new build machinery.** The UI already has a build; the backend deliberately does not, and the
  installer depends on that staying true.

## Consequences

- **Node 22.5 or newer becomes a hard requirement** — it already is, for `node:sqlite`.
- **Types must be erasable.** Only syntax that can be deleted: no `enum`, no `namespace`, no constructor
  parameter properties. Use union types and plain objects instead.
- **Relative imports need the file extension** (`./db.ts`), matching what the UI tests already do.
- **Type stripping does not type-check.** `tsc --noEmit` must run in CI over the backend, or the types are
  decoration. This adds one CI step.
- **The UI needs a path to the shared types**, via a Vite alias, so it imports them rather than redeclaring
  them.
- **Tests stay runnable as they are**: `node:test` runs `.ts` directly, so the existing test files keep
  working whether they remain `.js` or become `.ts`.

## Alternatives considered

- **JavaScript with JSDoc types.** No new tooling, but verbose for anything non-trivial, and it cannot give
  the UI a shared type to import.
- **Compile the backend with `tsc` before running.** Real type-checking, but adds a build step, an output
  directory and a chance for the running code to be stale — all to avoid a feature Node already has.
- **Leave it as it is.** Cheapest today, and it is how the drift above happened.
