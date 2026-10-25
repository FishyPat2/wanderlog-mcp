# Shared engineering guidance

This is the authoritative source for Codex and Claude. TypeScript ESM, Node.js 22+,
MCP SDK; stdio (`src/index.ts`) and stateless HTTP (`src/http.ts`) share `buildServer`.
REST handles discovery; ShareDB and `TripCache` maintain synchronized trip snapshots.
See README for client configuration and docs/engineering-evidence.md for verification.

## Invariants

- All ShareDB mutations go through `submitOp` in `src/tools/shared.ts`. Resolve natural
  references and construct paths inside its per-trip lock against the current snapshot.
  Failed submits/local applies invalidate the cache; retries are only for confirmed
  rate-limit non-application. Validation before submitting need not invalidate state.
- Section indices change after edits. Resolve by date/heading/type; reject ambiguous
  matches. Keep natural-language references as the normal interface, IDs optional.
- Discriminate block types; unknown blocks must not crash reads or become mutation targets.
- REST responses are envelopes with endpoint-specific fields; reject `success: false`.
  Do not invent undocumented API fields or mutation protocols.
- Match ShareDB error frames to pending sequence first; unscoped errors may fail all.
- Never disclose cookies in logs, errors, responses, URLs, or tracked files. Do not
  disable TLS verification. HTTP requires Bearer auth and explicit remote bind opt-in.
- Keep startup auth probing. A failed probe with configured credentials leaves tools
  available but auth-gated, with one shared lazy retry. Missing config fails startup.
- Hotel currency changes session-wide preference. Serialize preference changes and
  polling together per client; external processes/browser tabs remain outside this lock.

## Verification and boundaries

Run `npm run build`, `npm run typecheck`, `npm run test`, `npm run lint`,
`npm run format:check`, and `git diff --check` for an integrated change. Protocol unit
fixtures launch compiled entrypoints, so build first. Unit tests require localhost
network access but no external service/credentials. Existing lint warnings are not a
reason for unrelated refactoring. Use focused tests during development.

`npm run test:integration` is LIVE and includes mutations/deletions. Never run it
without explicit authorization and a disposable account/trip. Do not publish, deploy, or push without explicit authorization. Never inspect secret
values or mutate real accounts during offline development.
Keep changes narrow, avoid dependency churn, preserve tool names/order and useful schemas.
