# Engineering evidence

Scope: modernization of FishyPat2/wanderlog-mcp against original main baseline
`02c8165daf16591cfe55f5b7ad7029adaaae5846`. No packages published, services deployed,
or live account data changed. The reviewed changes are prepared on `review/mcp-modernization`
for a draft PR against the fork's main branch. No Wanderlog session credential was supplied
to these checks; protocol fixtures use synthetic credentials and local services.

## Implementation

Both entrypoints retain one shared MCP server and 33 tools in deterministic order.
Changes target confirmed behavior rather than replacing the architecture:

- HTTP uses Bearer headers only, loopback by default, Host/Origin restrictions,
  credential-safe diagnostics, early response cleanup, and active-request-aware eviction.
  Removing URL credentials and changing the default bind are deliberate security changes.
  Fly explicitly opts into external binding; Docker users must pass HOST.
- REST requests have a 30-second deadline and reject redirects to protect session cookies.
  JSON/network diagnostics omit arbitrary upstream text; logical failure envelopes are rejected.
  Cookie validation rejects embedded CR/LF/NUL. Final MCP results redact configured credentials,
  including decoded forms; WebSocket error frames redact them too. Bare rejection frames
  carrying a sequence affect only that pending operation.
- Failed submits invalidate trip state, including confirmed rejections after retry exhaustion.
  Validation before a submit retains state. Existing rate-limit retries remain bounded and
  apply only to confirmed non-application. Settled per-trip mutex entries are released.
- Hotel input validation rejects impossible dates, reversed price ranges, and malformed
  currencies before API effects. Preference changes and every poll share a per-client mutex,
  including searches with no explicit currency. Failed searches release the lock.
- Client-neutral instructions follow requested scope. Appropriate annotations describe reads,
  additive mutations, setters, and destructive ordinal operations. Hotel search is mutating
  because an explicit currency changes external session preferences.
- AGENTS.md is authoritative; CLAUDE.md points there. Removed references to absent design
  documents. Existing selective day/verbosity retrieval is preserved.

Rejected expansion: no new batch mutation API, dynamic tool subsets, extra caching layer,
client-specific server fork, unsupported Wanderlog fields, or dependencies. No workload evidence
justified those compatibility and concurrency costs. All existing tools remain discoverable.

## Unreleased feature inventory

All six README unreleased items were already implemented; none needed reimplementation.
Offline verification is not a claim of live API acceptance.

| Feature                                                        | Source and existing evidence                                                | Status                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Reject duplicate/ambiguous custom lists                        | add/update/delete-section; add-update-section and metadata tests; `6e47231` | Implemented, offline verified                                         |
| Hotel aggregator, filters, vendor comparisons, facets, polling | search-hotels; search-hotels tests; `8189532`                               | Implemented and strengthened; 32 hotel tests; live vendors unverified |
| One shared lazy auth retry after failed startup probe          | server; server-auth tests; `6aa595e`, `396e766`                             | Implemented, retry success/failure/deduplication verified             |
| Exact optional place_id insertion                              | add-place; add-place-id tests; `8e08bcd`                                    | Implemented, precedence/autocomplete bypass verified                  |
| Replace place annotation including embeds                      | annotate-place; annotation/Quill tests; `dc0c49c`                           | Implemented, replacement/newlines/idempotence verified                |
| Skip autocomplete entries without usable IDs                   | transport/rest; rest-autocomplete tests; `a0cc6ba`                          | Implemented, invalid types/order/empty results verified               |

Additional recent baseline history includes handshake/early-close recovery (`02c8165`,
`27e1d78`; sharedb/sharedb-connection tests), single-insert notes (`55f951a`; add-note),
and transit-note display (`6b9de4b`; mixed-blocks). These remain in the full offline suite.

## Reproduction and baseline

```bash
npm ci
npm run build
npm run typecheck
npm run test
npm run lint
npm run format:check
git diff --check
node --import tsx scripts/benchmark-mcp.ts
```

Node 22+ required. Build before tests: compiled transport fixtures launch dist/index.js and
dist/http.js. Unit tests require permission to bind/connect localhost, but no external APIs.
In this environment, use the execution tool's additional network permission for local sockets.
Default sandbox runs timed out on five existing WebSocket tests; an untouched HEAD archive
with the same installed dependencies and localhost enabled passed **541 tests in 42 files**.
The untouched baseline build/typecheck passed, lint reported **49 warnings, zero errors**,
and format:check passed. Intermediate concurrent runs were not used as final evidence.

## Efficiency

`node --import tsx scripts/benchmark-mcp.ts` uses real SDK in-memory transport and deterministic
fixtures: 134 places across 14 days, 10 listed trips, place/hotel searches, place creation/annotation,
and failure handling. These are UTF-8 serialized byte counts, **not tokenizer or billing counts**.

| Measurement                  |  Baseline |     Final |
| ---------------------------- | --------: | --------: |
| Exposed tools                |        33 |        33 |
| Serialized definitions       |    53,510 |    54,364 |
| Initialization instructions  |     3,773 |     1,166 |
| Definitions + instructions   |    57,283 |    55,530 |
| Trip listing response        |       727 |       727 |
| Multi-day response           |     6,204 |     6,204 |
| Single-day response          |       465 |       465 |
| Detailed trip response       |    19,576 |    19,576 |
| Place search response        |        86 |        86 |
| Hotel search response        |     1,543 |       928 |
| Itinerary add/edit responses | 146 / 120 | 146 / 120 |
| Failure response             |       321 |       321 |

Instructions decreased 69.1%, hotel response 39.9%, and combined definition/instruction bytes
3.06%. Metadata grew to communicate safer tool behavior. All eight other response hashes
are identical. The hotel fixture's parsed semantic hash and reconstructed pretty-envelope hash
establish that only whitespace changed. Every workload still takes one MCP call; no tool-call
or live latency improvement is claimed. Single-day filtering was already available and remains
substantially smaller; it is not counted as a new optimization. Instructions retain important
workflow and journal-consent guidance, but actual model task-success rates were not evaluated.

## Final verification and independent review

Original modernization results: build and typecheck passed; **574 tests passed in 44 files**
(up from 541/42). Lint passed with the same **49 warnings, zero errors**; formatting and
`git diff --check` passed. No dependency/lockfile changes. Benchmark rerun confirmed the
numbers above. Temporary logs and archives are outside tracked source.

New regression coverage includes hotel validation/session isolation/failure release,
credential-safe REST diagnostics and failure envelopes, cookie/header validation, tool result
redaction without corrupting numeric data, scoped WebSocket rejections and malformed diagnostics,
metadata and auth envelopes, and eight compiled transport scenarios. The compiled SDK tests
verify initialize/discovery/calls/auth failures for both transports, HTTP Host/Origin/query-token
rejection and context reuse, plus a complete local REST/WebSocket get-trip → atomic add-note →
get-trip path. They assert accepted versioned ops reach cached reads, followed by ordinary
stdin EOF closing the WebSocket and exiting cleanly without signal escalation.

An independent subagent reviewed code it did not implement. Its findings led to Origin
validation, EOF cleanup, scoped bare-frame rejection handling, and redaction fixes for short
auxiliary cookies and malformed numeric diagnostics. Independent focused runs passed 62,
27, and 32 tests respectively (overlapping suites, not additive totals). No outstanding review defects remained in that review; a fresh adversarial pass below
subsequently identified additional release blockers. Intermediate failures during simultaneous edits included temporary
HTTP TypeScript errors and a newly added sequence regression catching the old loaded code;
these were resolved before the final integrated run.

## Remaining limits and safe live follow-up

- No live Wanderlog API, production vendor prices, real account mutations, or actual Codex/
  Claude application sessions were tested. SDK compatibility does not prove those outcomes.
- The hotel mutex covers one shared REST client/process. Another browser or server using the
  same session may change currency concurrently; avoid sharing the session during validation.
  Existing fallback currency labels for offers without currency remain an API uncertainty.
- Retried ambiguous mutation failures must be checked against fresh trip state first. HTTP
  is stateless MCP with authenticated context reuse, not OAuth or a persistent SSE session.
- Legacy `npm run eval` points to absent ignored eval tooling; it was not run or rebuilt.
  No model task-success or latency benchmark was performed.

After explicit live authorization, use a **disposable test account** and place its cookie in
an untracked `.env`; set WANDERLOG_TRIP_KEY explicitly to a disposable trip, never rely on
fixture default keys. Start with the read-only REST checks:

```bash
node --env-file=.env ./node_modules/vitest/vitest.mjs run tests/integration/rest.test.ts
```

Only with explicit mutation authorization for that disposable account, the isolated mutation
suite creates its own `WANDERDOG_TEST_<timestamp>` trip and attempts to delete it afterward:

```bash
node --env-file=.env ./node_modules/vitest/vitest.mjs run tests/integration/mutations.test.ts
```

Inspect the account afterward for leftover test trips if interrupted. Audit targets/cleanup
in other integration suites before running them; do not run `test:all` or the whole live suite
against normal account data. Hotel searches with `currency` alter session preferences even
when just browsing. Finally configure each real client using README's absolute checkout
entrypoint, inspect discovery and list trips, then verify reads and explicitly authorized edits
only on the disposable trip. Record client versions, transport, observed results, and cleanup.

## Release-preparation review

The fresh review examined the entire diff against original main, rather than accepting the
prior report. GitHub main was still at `02c8165` when checked. Changes remain scoped to shared
MCP transports, diagnostics, mutation reliability, hotel search, regression coverage, and
setup/evidence documentation; no dependency changes or unrelated features were introduced.
All 33 tool names, ordering, and input schemas were compared against baseline through SDK
clients and matched exactly. Deliberate compatibility changes remain Bearer-only HTTP auth,
loopback binding by default, explicit Origin allowlisting, and compact hotel JSON whitespace.

Confirmed blockers corrected in this pass:

- SDK-installed JSON parsing ran before route auth/Origin checks. Express's default error
  handler exposed malformed-body excerpts and filesystem stacks to responses/stderr. A generic
  final error handler preserves 400 parse and 413 size errors without exposing parser details.
  Tests send credential-shaped malformed/oversized bodies, including a disallowed Origin.
  Parsing still precedes route authentication; malformed requests get safe parser errors first.
- A remote insert during rate-limit backoff could shift a block's numeric path. Retrying at
  the new ShareDB version could edit a different block. Retry now aborts when version changes,
  invalidates state, and requires fresh target resolution. Stable-version retries are preserved.
- A remote edit while a submit awaited acknowledgement could make the original local paths
  corrupt the updated cache. The submit helper now detects cache-version movement, invalidates,
  and returns a conflict explaining that the write may already have applied; read before retrying.
  This is conservative conflict detection, not a full operational-transform implementation.

Evidence wording was corrected: CR/LF/NUL validation is not all control-character validation;
benchmark mutation workloads create/annotate a place rather than create/edit a note. The
baseline benchmark was rerun against an untouched archive using the same script/dependencies.
Intentional compact measurements and response hashes are in `docs/benchmark-results.json`;
raw tool output, logs, credentials, dist, node_modules, and temporary archives are excluded.

Release-preparation validation (Node v24.19.0, npm 11.9.0): `npm run build`,
`npm run typecheck`, `npm run test`, `npm run lint`, `npm run format:check`, and
`git diff --check` all exited 0. Full unit suite: **578 passed in 44 files**.
Explicit `npx vitest run tests/unit/mcp-transports.test.ts`: **8 passed**.
Lint remains **49 warnings, zero errors**. The two new investigators cross-reviewed
one another's fixes; independent state/cache suites passed 37 tests in four files,
and combined transport/state suites passed 33 tests in three files (overlapping).
No outstanding actionable review findings remain in the examined scope. These checks
used only localhost services; the live/application requirements above remain pending.

For a reproducible baseline benchmark without changing the review checkout, unpack
`git archive 02c8165daf16591cfe55f5b7ad7029adaaae5846` into a temporary directory,
copy `scripts/benchmark-mcp.ts` there, and use the same installed dependencies and
Node version. Run the script from each source tree. The recorded schema fingerprint
hashes JSON.stringify of `tools.map(({name,inputSchema}) => ({name,inputSchema}))`;
it excludes descriptions/annotations and matches in both runs. The retained JSON contains
only synthetic fixture hashes/counts, with no response content or account data.
