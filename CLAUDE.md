# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run all tests
npm test

# Run a single test file
node --test test/run.test.js

# Lint (syntax check only, no style enforcement)
npm run lint
```

No build step — this is a pure ESM Node.js project (requires Node >= 20).

## Architecture

The entry point is `bin/steam-charts.js`, which calls `src/cli.js` for argument parsing and `src/run.js` for execution.

**Data flow:**
1. `cli.js` — parses `argv` into an options object or a `help`/`version` mode signal
2. `run.js` — orchestrates the full query: resolves app, fetches player count, serializes output
3. `query.js` — classifies the CLI query as `{ kind: 'appid', appid }` or `{ kind: 'name', name }`
4. `resolve-app.js` — finds an app by name in the app list array
5. `app-cache.js` — manages the Steam app list cache at `~/.steam-charts/app-list.json` (24h TTL); falls back to stale cache on refresh failure
6. `steam-api.js` — two fetch calls: `GetNumberOfCurrentPlayers` (no key needed) and `GetAppList` (paginated, key required)
7. `output.js` — serializes a record to CSV or JSON

**Dependency injection pattern:** `runSteamCharts` and most module functions accept `fetchImpl`, `env`, and `now` parameters so tests can inject mocks without HTTP or filesystem side-effects. Tests never hit the real Steam API.

**Test helpers (`test/helpers.js`):**
- `createOutputCollector()` — captures `stdout`/`stderr` writes into a string
- `runCli(args, opts)` — spawns the real binary as a subprocess for end-to-end CLI tests
- `withMockServer(handler, callback)` — starts a local HTTP server for integration tests; override API URLs via `STEAM_CHARTS_CURRENT_PLAYERS_URL` and `STEAM_CHARTS_APP_LIST_URL` env vars

**Cache env overrides (useful in tests):**
- `STEAM_CHARTS_CACHE_DIR` — override the `~/.steam-charts` directory
- `STEAM_CHARTS_CURRENT_PLAYERS_URL` — override the player-count API endpoint
- `STEAM_CHARTS_APP_LIST_URL` — override the app-list API endpoint
