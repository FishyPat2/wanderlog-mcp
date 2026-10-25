# wanderlog-mcp

[![npm](https://img.shields.io/npm/v/wanderlog-mcp)](https://www.npmjs.com/package/wanderlog-mcp)
[![npm downloads](https://img.shields.io/npm/dm/wanderlog-mcp)](https://www.npmjs.com/package/wanderlog-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![Coverage Status](https://coveralls.io/repos/github/shaikhspeare/wanderlog-mcp/badge.svg?branch=main)](https://coveralls.io/github/shaikhspeare/wanderlog-mcp?branch=main)

An MCP server that lets Codex, Claude, and other MCP-compatible agents view and build [Wanderlog](https://wanderlog.com) trip itineraries through conversation.

Instead of clicking through the Wanderlog UI to plan a trip, you just ask:

> _"Create a 14-day Japan Golden Route trip — Tokyo, Hakone, Kyoto, Nara, and Osaka."_

The agent calls the tools, interleaves places and notes for each day, adds hotel blocks, ferries, buses, trains, rental cars, and checklists, and you end up with a fully populated Wanderlog trip in a few minutes.

**See a real example:** [14-day Japan Golden Route](https://wanderlog.com/view/dmvegdhqsa/japan-golden-route--tokyo--hakone--kyoto--nara--osaka) — built entirely by an AI agent using this MCP server.

## What's New (Unreleased)

- Custom-list lifecycle operations now reject duplicate or ambiguous section headings instead of silently changing the first match.
- `wanderlog_search_hotels` — search Wanderlog's hotel aggregator across airbnb, expedia, google, and kayak. Returns ranked offers with per-vendor price comparison and faceted filter discovery so the LLM never has to memorise Wanderlog's internal enum values.
- A failed startup authentication probe now gets one shared retry on the first tool call, allowing valid sessions to recover from a transient network or proxy error without restarting the server.
- `wanderlog_add_place` accepts an optional `place_id`, so `wanderlog_search_places` (`response_format: "detailed"`) now has somewhere to send its results — pass the id straight through to add the exact candidate when a name matches multiple branches or the wrong city, instead of hoping the top autocomplete match is right.
- `wanderlog_annotate_place` now replaces a place's existing note instead of appending the new text to it, including notes that contain images.
- Place lookups no longer fail with "Place not found" when Wanderlog's autocomplete returns an entry with no place ID ahead of the real result. This affected adding places, hotels, journal stops and transit endpoints, and `wanderlog_search_places` listed those entries as `undefined`.

## What's New in v0.3.1

- Wanderlog rate-limits rapid edits — burst mutations (an LLM building a full itinerary) now retry automatically with backoff instead of failing with an opaque "Submit op timeout".
- Rate-limit rejections that can't be retried surface as a clear error instead of a 10-second hang.
- New day sections created by `wanderlog_update_trip_dates` now match Wanderlog's native section shape exactly.

## What's New in v0.3.0

- `wanderlog_search_guides` + `wanderlog_get_guide` — discover and read user-written Wanderlog travel guides. The LLM can ask "what guides exist for Vietnam?" and pull full itineraries to use as inspiration.
- `wanderlog_remove_note` — remove standalone note blocks by natural-language reference.
- `wanderlog_edit_note` — find-and-replace across note blocks, place annotations, and checklist titles/items.
- Detailed mode no longer truncates place notes or note blocks — guides and itineraries render their full commentary.
- Fixes: notes containing embeds no longer render as `[object Object]`; place references now match across hyphen/dash differences (e.g. `"Roppongi Hills - Tokyo City View"`).

## What's New in v0.2.0

- `wanderlog_rename_day` — replace auto-generated day headings (e.g. `"Barcelona"`) with descriptive ones (`"Arrival — Feria de Abril"`). Pass `""` to reset back to the default.
- Tools table now documents `wanderlog_annotate_place` and `wanderlog_add_expense` (shipped previously, missing from v0.1.0 docs).

## What's New in v0.1.0

- Full itinerary building: places, notes, hotels, and checklists in a single conversation
- `wanderlog_search_places` — find real-world places near any destination using Wanderlog's place database
- `wanderlog_add_note` — interleave transit tips, booking info, and local advice between places
- `wanderlog_add_checklist` — pre-trip and per-day checklists (visa, currency, timed-entry tickets)
- MCP server instructions injected at startup so Claude builds complete itineraries automatically
- Startup auth probe — catches expired cookies immediately instead of failing mid-conversation

## Example Prompts

```
"What trips do I have in Wanderlog?"
```

```
"Create a 7-day itinerary for Lisbon starting June 1 — include restaurants, day trips,
and a hotel near the waterfront."
```

```
"Add a day trip to Sintra on day 3 of my Lisbon trip."
```

```
"I'm spending 5 days in Tokyo — build me a full itinerary with museum visits, ramen spots,
and a ryokan in Shinjuku."
```

```
"Look at my Barcelona trip and add practical notes for getting between each place."
```

```
"Add a pre-trip checklist to my Paris trip — visa, currency, offline maps, travel insurance."
```

```
"Move my Rome trip back by two weeks."
```

```
"Give me the shareable link to my Kyoto itinerary."
```

```
"Remove the Colosseum from day 2 of my Rome trip."
```

## Tools

| Tool                                  | What it does                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `wanderlog_list_trips`                | List trips in your account                                                                        |
| `wanderlog_get_trip`                  | View a full itinerary, or filter to a single day                                                  |
| `wanderlog_get_trip_url`              | Get a shareable wanderlog.com link                                                                |
| `wanderlog_get_trip_forwarding_email` | Get a trip's `trip+<id>@wanderlog.com` import address                                             |
| `wanderlog_search_places`             | Find real-world places near a trip's destination                                                  |
| `wanderlog_search_guides`             | List user-written travel guides for a destination, with fallback suggestions when none exist      |
| `wanderlog_get_guide`                 | Read the full content of a public Wanderlog guide (sections, places, notes)                       |
| `wanderlog_search_hotels`             | Search Wanderlog's hotel aggregator (airbnb/expedia/google/kayak) with per-vendor deal comparison |
| `wanderlog_create_trip`               | Create a new trip with destination + date range                                                   |
| `wanderlog_add_place`                 | Add a place to a specific day or general list                                                     |
| `wanderlog_add_note`                  | Add a note (transit tips, booking info, local advice)                                             |
| `wanderlog_edit_note`                 | Find-and-replace text in notes, place annotations, and checklists                                 |
| `wanderlog_remove_note`               | Remove a standalone note block by natural-language reference                                      |
| `wanderlog_add_hotel`                 | Add a hotel booking with check-in/check-out dates                                                 |
| `wanderlog_add_transit`               | Add a ferry, bus, or train leg (carrier, from/to, dates/times) to the shared Transit section      |
| `wanderlog_add_car_rental`            | Add a rental car with pick-up/drop-off locations and times                                        |
| `wanderlog_add_checklist`             | Add a pre-trip or per-day checklist                                                               |
| `wanderlog_add_expense`               | Log a budget expense (amount, category, currency), optionally linked to a place                   |
| `wanderlog_list_expenses`             | List budget expenses, optionally filtered by description / date / amount / currency               |
| `wanderlog_remove_expense`            | Remove a budget expense by description (with optional date / amount / currency filters)           |
| `wanderlog_edit_expense`              | Change a budget expense's description, amount, currency, category, or date                        |
| `wanderlog_annotate_place`            | Update an existing place with a note, start/end time, or both                                     |
| `wanderlog_remove_place`              | Remove a place by natural-language reference                                                      |
| `wanderlog_move_block`                | Move an existing place or reservation block within its current section                            |
| `wanderlog_update_trip_dates`         | Change a trip's date range                                                                        |
| `wanderlog_rename_day`                | Rename a day's heading (e.g. `"Barcelona"` → `"Arrival — Feria de Abril"`)                        |
| `wanderlog_add_section`               | Create a uniquely named custom list, optionally after another section                             |
| `wanderlog_update_section`            | Rename a custom list while preventing duplicate headings                                          |
| `wanderlog_delete_section`            | Permanently delete a custom list and all blocks inside it                                         |
| `wanderlog_list_journal`              | List journal (travelogue) stops, optionally filtered by title or date                             |
| `wanderlog_add_journal`               | Add a journal stop: a place + date/time + text entry                                              |
| `wanderlog_edit_journal`              | Edit a journal stop's title, text, or date/time (or the journal summary)                          |
| `wanderlog_remove_journal`            | Remove a journal stop by title (with an optional date filter)                                     |

### Managing custom lists

Custom sections are undated lists outside Wanderlog's protected default/system sections.
Create one with `wanderlog_add_section`, rename it with `wanderlog_update_section`, and delete
it with `wanderlog_delete_section`. Deleting is destructive: every block in that section is
removed. Section headings used by these tools must be unique (matching ignores case); ambiguous
or duplicate targets return errors without submitting a mutation.

## Prerequisites

- **Node.js 22 or newer**
- **A [Wanderlog](https://wanderlog.com) account**
- An MCP-compatible client: Claude Code, Claude Desktop, OpenAI Codex, Cursor, VS Code, or any stdio MCP host

## Setup

### Step 1 — Get your Wanderlog session cookie

Wanderlog doesn't have a public API, so wanderlog-mcp authenticates using your browser session cookie (`connect.sid`). It's valid for roughly a year and is sent to Wanderlog for authentication (and to your trusted host when using HTTP).

**Treat it like a password** — it grants the same access you have in the Wanderlog UI.

#### Chrome / Edge

1. Go to [wanderlog.com](https://wanderlog.com) and log in
2. Press `F12` to open DevTools
3. Click the **Application** tab
4. In the left sidebar expand **Storage → Cookies → https://wanderlog.com**
5. Find the row where **Name** is `connect.sid`
6. Click the row, then double-click the **Value** cell and copy the full string — it starts with `s%3A` and is ~100 characters long

#### Firefox

1. Go to [wanderlog.com](https://wanderlog.com) and log in
2. Press `F12` to open DevTools
3. Click the **Storage** tab
4. In the left sidebar expand **Cookies → https://wanderlog.com**
5. Find `connect.sid` in the table, click it, and copy the **Value**

> **Why can't I use `document.cookie` in the console?**
> Wanderlog sets `connect.sid` with the `HttpOnly` flag, which deliberately blocks JavaScript from reading it (XSS protection). DevTools bypasses this restriction — that's why it works and the console doesn't.

### Step 2 — Configure your MCP client

#### Claude Code

```bash
claude mcp add wanderlog-mcp npx wanderlog-mcp \
  --env WANDERLOG_COOKIE="s%3A...your value here..."
```

#### Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wanderlog": {
      "command": "npx",
      "args": ["wanderlog-mcp"],
      "env": {
        "WANDERLOG_COOKIE": "s%3A...your value here..."
      }
    }
  }
}
```

Restart Claude Desktop after saving.

#### Cursor

Settings → MCP → Add server, or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "wanderlog": {
      "command": "npx",
      "args": ["wanderlog-mcp"],
      "env": {
        "WANDERLOG_COOKIE": "s%3A...your value here..."
      }
    }
  }
}
```

#### VS Code (GitHub Copilot)

Add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "wanderlog": {
      "type": "stdio",
      "command": "npx",
      "args": ["wanderlog-mcp"],
      "env": {
        "WANDERLOG_COOKIE": "s%3A...your value here..."
      }
    }
  }
}
```

#### OpenAI Codex

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.wanderlog]
command = "npx"
args = ["wanderlog-mcp"]

[mcp_servers.wanderlog.env]
WANDERLOG_COOKIE = "s%3A...your value here..."
```

Run `/mcp` inside Codex to confirm the server loaded.

#### Development checkout (Codex and Claude)

The npm examples above install the published upstream package, which may not include
this fork's unreleased changes. To run this checkout, install with `npm ci`, then
`npm run build` (Node.js 22+). Configure either client to launch `node` with the
absolute path `/absolute/path/wanderlog-mcp/dist/index.js` and set `WANDERLOG_COOKIE`
in that client's environment configuration. The working directory need not be the repo.
For Claude Code: `claude mcp add --transport stdio wanderlog -- node /absolute/path/wanderlog-mcp/dist/index.js`
with `WANDERLOG_COOKIE` supplied securely in its environment. Claude Desktop uses the
same `command: "node"`, absolute `args`, and `env` JSON layout shown above.
Codex CLI and app use the same `[mcp_servers.wanderlog]` config with `command = "node"`
and `args = ["/absolute/path/wanderlog-mcp/dist/index.js"]`.
Restart the client after rebuilding or changing credentials. Never put cookies in command-line arguments.
`npm run dev` loads `.env`; plain `node dist/index.js` does not load `.env` automatically.

#### Optional Streamable HTTP

After building, run `npm run start:http`. This loads `.env` and listens on
`http://127.0.0.1:3000/mcp`; `/health` reports process health, not Wanderlog authentication.
Each request requires `Authorization: Bearer <connect.sid value>`; query-string tokens
are rejected because URLs leak into logs/history. The transport is stateless MCP;
GET/DELETE behavior is delegated to the SDK (no persistent SSE session).

Codex configuration:

```toml
[mcp_servers.wanderlog]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "WANDERLOG_COOKIE"
```

Set that variable in the Codex process environment. Claude Code supports
`claude mcp add --transport http wanderlog http://127.0.0.1:3000/mcp`
with an Authorization header configured securely in its local MCP configuration.
Prefer stdio for Claude Desktop: direct HTTP/header support depends on its version.

Remote hosting must explicitly set `HOST=0.0.0.0`, terminate TLS, and restrict access.
Set `MCP_ALLOWED_HOSTS` to a comma-separated list of trusted hostnames for DNS rebinding
protection when binding beyond loopback. Requests with an Origin header are rejected
unless that exact origin is listed in `MCP_ALLOWED_ORIGINS` (comma-separated); native
clients normally omit Origin, so leave this unset unless needed. The Fly configuration opts into external binding;
for Docker pass `-e HOST=0.0.0.0`. Hosts must redact Authorization headers in their logs.
This is direct cookie authentication, not an OAuth authorization server.

Compiled stdio and HTTP are tested with the MCP SDK and local fixtures. Actual Codex
and Claude application sessions and Wanderlog live behavior have **not** been validated
in this environment; protocol success alone does not establish application success.

#### Smithery (one-click install)

```bash
npx @smithery/cli install wanderlog-mcp --client claude
```

### Step 3 — Verify

Ask your agent: _"What trips do I have in Wanderlog?"_

It should call `wanderlog_list_trips` and return your account's trips. If it fails, see [Troubleshooting](#troubleshooting) below.

## Refreshing your cookie

The cookie lasts about a year but can die sooner if you log out of wanderlog.com, change your password, or Wanderlog revokes the session. When that happens every tool call returns:

> **Wanderlog session invalid or expired** — Capture a fresh connect.sid cookie from wanderlog.com DevTools and update WANDERLOG_COOKIE in your MCP config.

Repeat Step 1 above, update your config, and restart your MCP client.

## Troubleshooting

**Server starts but list_trips returns an auth error**
Your cookie is expired or wrong. Re-capture it from DevTools and update your config.

**`npx wanderlog-mcp` hangs or does nothing**
The server speaks stdio MCP — it's designed to be launched by an MCP host, not run directly in a terminal. Run it through Claude Code or Claude Desktop as described above.

**Tools work but the agent ignores notes/checklists**
The server supplies client-neutral workflow guidance in the MCP `initialize` response. Ask explicitly for notes, times, or checklists when needed; agent behavior varies by client.

## Security

- The cookie is stored only in your MCP client config, never committed or logged
- Local stdio runs on your machine. Optional HTTP hosting sends credentials to that host; use only a trusted server over TLS.
- The startup auth probe validates your cookie without printing its value
- To revoke access: log out of wanderlog.com (invalidates all sessions), then re-capture

## Contributing

Pull requests are welcome. Before submitting:

```bash
npm run build && npm run test
```

Run the offline checks and protocol fixtures described in [engineering evidence](docs/engineering-evidence.md). `npm run test:integration` is a **live, potentially mutating** suite: use only an explicitly authorized disposable account/trip.

## Disclaimer

wanderlog-mcp is an unofficial third-party tool, not affiliated with or endorsed by Wanderlog. It works by calling Wanderlog's private web-client API, which may change without notice. Use at your own risk.

## License

MIT — see [LICENSE](LICENSE)

---

Made by [shaikhspeare](https://github.com/shaikhspeare)
