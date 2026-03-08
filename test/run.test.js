import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSteamCharts } from '../src/run.js';
import { createOutputCollector, readFixture } from './helpers.js';

test('runSteamCharts resolves a name query, fetches players, and writes csv to stdout', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-run-cache-'));
  const calls = [];

  const result = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      query: 'Counter-Strike 2',
      format: 'csv',
      outputPath: null,
      apiKey: 'key-123',
      refreshAppList: false,
    },
    env: {
      STEAM_CHARTS_CACHE_DIR: cacheDir,
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async (url) => {
      calls.push(String(url));

      if (String(url).includes('GetAppList') || String(url).includes('/app-list')) {
        return makeJsonResponse({
          response: {
            apps: [
              { appid: 730, name: 'Counter-Strike 2' },
            ],
            have_more_results: false,
            last_appid: 730,
          },
        });
      }

      return makeJsonResponse({
        response: {
          player_count: 765432,
          result: 1,
        },
      });
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.record.appid, 730);
  assert.equal(result.record.name, 'Counter-Strike 2');
  assert.equal(result.record.current_players, 765432);
  assert.equal(result.record.queried_at, '2026-03-07T12:00:00.000Z');
  assert.match(stdout.read(), /^appid,name,current_players,queried_at,source\n730,Counter-Strike 2,765432,2026-03-07T12:00:00.000Z,steam-web-api\n$/);
  assert.equal(stderr.read(), '');
  assert.equal(calls.length, 2);
});

test('runSteamCharts uses stale cache when app refresh fails', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-run-cache-'));
  const cachePath = join(cacheDir, 'app-list.json');

  writeFileSync(cachePath, JSON.stringify({
    fetchedAt: '2026-03-01T00:00:00.000Z',
    apps: [
      { appid: 730, name: 'Counter-Strike 2' },
    ],
  }));

  const result = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      query: 'Counter-Strike 2',
      format: 'csv',
      outputPath: null,
      apiKey: 'key-123',
      refreshAppList: false,
    },
    env: {
      STEAM_CHARTS_CACHE_DIR: cacheDir,
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async (url) => {
      if (String(url).includes('GetAppList') || String(url).includes('/app-list')) {
        throw new Error('network exploded');
      }

      return makeJsonResponse({
        response: {
          player_count: 1234,
          result: 1,
        },
      });
    },
  });

  assert.equal(result.exitCode, 0);
  assert.match(stderr.read(), /using stale cache/i);
  assert.match(stdout.read(), /^appid,name,current_players,queried_at,source\n730,Counter-Strike 2,1234,/);
});

test('runSteamCharts writes to an output file when requested', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();
  const outputDir = mkdtempSync(join(tmpdir(), 'steam-charts-run-out-'));
  const outputPath = join(outputDir, 'players.json');

  const result = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      query: '730',
      format: 'json',
      outputPath,
      apiKey: null,
      refreshAppList: false,
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async () => makeJsonResponse({
      response: {
        player_count: 55,
        result: 1,
      },
    }),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(stdout.read(), '');
  assert.equal(stderr.read(), '');
  assert.match(readFileSync(outputPath, 'utf8'), /"appid": 730/);
  assert.match(readFileSync(outputPath, 'utf8'), /"current_players": 55/);
  assert.equal(result.outputPath, outputPath);
});

test('runSteamCharts returns history json with gains and forecast points', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();

  const result = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      command: 'history',
      query: '730',
      format: 'json',
      outputPath: null,
      apiKey: null,
      refreshAppList: false,
      months: 3,
      forecastDays: 2,
    },
    env: {
      STEAM_CHARTS_HISTORY_URL_TEMPLATE: 'https://example.test/history/{appid}',
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://example.test/history/730');
      return makeTextResponse(readFixture('steamcharts-history.html'));
    },
  });

  const payload = JSON.parse(stdout.read());

  assert.equal(result.exitCode, 0);
  assert.equal(stderr.read(), '');
  assert.equal(payload.app.appid, 730);
  assert.equal(payload.app.name, 'Counter-Strike 2');
  assert.deepEqual(payload.history.points.map((point) => point.label), [
    'December 2025',
    'January 2026',
    'February 2026',
    'Last 30 Days',
  ]);
  assert.deepEqual(payload.history.points[0], {
    label: 'December 2025',
    average_players: 900,
    peak_players: 1600,
    average_change: null,
    average_change_pct: null,
    peak_change: null,
    peak_change_pct: null,
    estimated: false,
  });
  assert.deepEqual(payload.history.points.at(-1), {
    label: 'Last 30 Days',
    average_players: 1200,
    peak_players: 2000,
    average_change: 200,
    average_change_pct: 20,
    peak_change: 200,
    peak_change_pct: 11.11,
    estimated: false,
  });
  assert.equal(payload.forecast.points.length, 2);
  assert.deepEqual(payload.forecast.points.map((point) => point.date), ['2026-03-08', '2026-03-09']);
  assert.deepEqual(payload.source, {
    history: 'steamcharts',
    forecast: 'holt-linear-smoothing',
  });
  assert.deepEqual(payload.warnings, []);
});

test('runSteamCharts --months N returns Last 30 Days plus N calendar months', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();

  const result = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      command: 'history',
      query: '730',
      format: 'json',
      outputPath: null,
      apiKey: null,
      refreshAppList: false,
      months: 4,
      forecastDays: 0,
    },
    env: {
      STEAM_CHARTS_HISTORY_URL_TEMPLATE: 'https://example.test/history/{appid}',
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async () => makeTextResponse(readFixture('steamcharts-history.html')),
  });

  const payload = JSON.parse(stdout.read());

  assert.equal(result.exitCode, 0);
  // Fixture has 5 points: Nov, Dec, Jan, Feb, Last 30 Days.
  // --months 4 → 4 calendar months + Last 30 Days = 5 points total.
  assert.deepEqual(payload.history.points.map((p) => p.label), [
    'November 2025',
    'December 2025',
    'January 2026',
    'February 2026',
    'Last 30 Days',
  ]);
});

test('runSteamCharts suppresses forecast when there is insufficient observed history', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();

  const result = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      command: 'history',
      query: '70',
      format: 'json',
      outputPath: null,
      apiKey: null,
      refreshAppList: false,
      months: 12,
      forecastDays: 5,
    },
    env: {
      STEAM_CHARTS_HISTORY_URL_TEMPLATE: 'https://example.test/history/{appid}',
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async () => makeTextResponse(readFixture('steamcharts-history-short.html')),
  });

  const payload = JSON.parse(stdout.read());

  assert.equal(result.exitCode, 0);
  assert.equal(payload.forecast.points.length, 0);
  assert.match(payload.warnings[0], /at least 3 observed monthly points/i);
  assert.equal(stderr.read(), '');
});

test('runSteamCharts renders a terminal trend chart', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();

  const result = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      command: 'chart',
      query: '730',
      format: 'text',
      outputPath: null,
      apiKey: null,
      refreshAppList: false,
      months: 3,
      forecastDays: 2,
    },
    env: {
      STEAM_CHARTS_HISTORY_URL_TEMPLATE: 'https://example.test/history/{appid}',
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async () => makeTextResponse(readFixture('steamcharts-history.html')),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(stderr.read(), '');
  assert.match(stdout.read(), /Average Players/);
  assert.match(stdout.read(), /Peak Players/);
  assert.match(stdout.read(), /Observed: █/);
  assert.match(stdout.read(), /Forecast: ░/);
});

test('runSteamCharts returns a store snapshot as json', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();

  const result = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      command: 'store',
      query: '730',
      format: 'json',
      outputPath: null,
      apiKey: null,
      refreshAppList: false,
      months: 12,
      forecastDays: 30,
    },
    env: {
      STEAM_CHARTS_STORE_URL_TEMPLATE: 'https://example.test/store/{appid}',
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://example.test/store/730');
      return makeTextResponse(readFixture('steamdb-store.html'));
    },
  });

  const payload = JSON.parse(stdout.read());

  assert.equal(result.exitCode, 0);
  assert.equal(stderr.read(), '');
  assert.deepEqual(payload.app, {
    appid: 730,
    name: 'Counter-Strike 2',
  });
  assert.equal(payload.daily_active_users_rank, 154);
  assert.equal(payload.top_sellers_rank, 148);
  assert.equal(payload.wishlist_activity_rank, 3180);
  assert.equal(payload.followers, 736595);
  assert.equal(payload.reviews, 644619);
  assert.equal(payload.source, 'steamdb');
  assert.equal(payload.captured_at, '2026-03-07T12:00:00.000Z');
});

test('runSteamCharts returns extrema summaries as json', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();

  const result = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      command: 'highest',
      query: '730',
      format: 'json',
      outputPath: null,
      apiKey: null,
      refreshAppList: false,
      months: 12,
      forecastDays: 30,
    },
    env: {
      STEAM_CHARTS_HISTORY_URL_TEMPLATE: 'https://example.test/history/{appid}',
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async () => makeTextResponse(readFixture('steamcharts-history.html')),
  });

  const payload = JSON.parse(stdout.read());

  assert.equal(result.exitCode, 0);
  assert.equal(stderr.read(), '');
  assert.deepEqual(payload, {
    app: {
      appid: 730,
      name: 'Counter-Strike 2',
    },
    average: {
      value: 1200,
      label: 'Last 30 Days',
    },
    peak: {
      value: 2000,
      label: 'Last 30 Days',
    },
    source: 'steamcharts',
  });
});

test('runSteamCharts resolves a text query for history via the cached app list', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-history-cache-'));

  const result = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      command: 'history',
      query: 'Counter-Strike 2',
      format: 'json',
      outputPath: null,
      apiKey: 'key-123',
      refreshAppList: false,
      months: 2,
      forecastDays: 2,
    },
    env: {
      STEAM_CHARTS_CACHE_DIR: cacheDir,
      STEAM_CHARTS_APP_LIST_URL: 'https://example.test/app-list',
      STEAM_CHARTS_HISTORY_URL_TEMPLATE: 'https://example.test/history/{appid}',
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async (url) => {
      if (String(url) === 'https://example.test/app-list?key=key-123&max_results=50000&include_games=true&include_dlc=false&include_software=false&include_videos=false&include_hardware=false') {
        return makeJsonResponse({
          response: {
            apps: [
              { appid: 730, name: 'Counter-Strike 2' },
            ],
            have_more_results: false,
            last_appid: 730,
          },
        });
      }

      assert.equal(String(url), 'https://example.test/history/730');
      return makeTextResponse(readFixture('steamcharts-history.html'));
    },
  });

  const payload = JSON.parse(stdout.read());

  assert.equal(result.exitCode, 0);
  assert.equal(payload.app.appid, 730);
  assert.equal(payload.app.name, 'Counter-Strike 2');
  assert.equal(stderr.read(), '');
});

test('runSteamCharts renders text output for store and lowest commands', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();

  const storeResult = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      command: 'store',
      query: '730',
      format: 'text',
      outputPath: null,
      apiKey: null,
      refreshAppList: false,
      months: 12,
      forecastDays: 30,
    },
    env: {
      STEAM_CHARTS_STORE_URL_TEMPLATE: 'https://example.test/store/{appid}',
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async () => makeTextResponse(readFixture('steamdb-store.html')),
  });

  assert.equal(storeResult.exitCode, 0);
  assert.match(stdout.read(), /Daily active users rank:\s+#154/);
  assert.match(stdout.read(), /Source: steamdb/);

  const lowestOut = createOutputCollector();
  const lowestErr = createOutputCollector();
  const lowestResult = await runSteamCharts({
    output: lowestOut.stream,
    error: lowestErr.stream,
    options: {
      command: 'lowest',
      query: '730',
      format: 'text',
      outputPath: null,
      apiKey: null,
      refreshAppList: false,
      months: 12,
      forecastDays: 30,
    },
    env: {
      STEAM_CHARTS_HISTORY_URL_TEMPLATE: 'https://example.test/history/{appid}',
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async () => makeTextResponse(readFixture('steamcharts-history.html')),
  });

  assert.equal(lowestResult.exitCode, 0);
  assert.match(lowestOut.read(), /Lowest average players: 700 \(November 2025\)/);
  assert.match(lowestOut.read(), /Lowest peak players: 1,500 \(November 2025\)/);
  assert.equal(lowestErr.read(), '');
});

test('runSteamCharts warns and falls back when the numeric-query app cache is unreadable', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-run-cache-'));
  const cachePath = join(cacheDir, 'app-list.json');

  writeFileSync(cachePath, '{not-json');

  const result = await runSteamCharts({
    output: stdout.stream,
    error: stderr.stream,
    options: {
      query: '730',
      format: 'csv',
      outputPath: null,
      apiKey: null,
      refreshAppList: false,
    },
    env: {
      STEAM_API_KEY: '',
      STEAM_CHARTS_CACHE_DIR: cacheDir,
    },
    now: () => new Date('2026-03-07T12:00:00.000Z'),
    fetchImpl: async () => makeJsonResponse({
      response: {
        player_count: 55,
        result: 1,
      },
    }),
  });

  assert.equal(result.exitCode, 0);
  assert.match(stderr.read(), /failed to read steam app cache/i);
  assert.match(stdout.read(), /^appid,name,current_players,queried_at,source\n730,,55,/);
});

test('runSteamCharts rejects when the output path cannot be written', async () => {
  const stdout = createOutputCollector();
  const stderr = createOutputCollector();
  const outputDir = mkdtempSync(join(tmpdir(), 'steam-charts-run-out-'));
  const unwritablePath = join(outputDir, 'existing-directory');

  mkdirSync(unwritablePath);

  await assert.rejects(() => {
    return runSteamCharts({
      output: stdout.stream,
      error: stderr.stream,
      options: {
        query: '730',
        format: 'json',
        outputPath: unwritablePath,
        apiKey: null,
        refreshAppList: false,
      },
      now: () => new Date('2026-03-07T12:00:00.000Z'),
      fetchImpl: async () => makeJsonResponse({
        response: {
          player_count: 55,
          result: 1,
        },
      }),
    });
  }, /EISDIR|illegal operation on a directory/i);

  assert.equal(stdout.read(), '');
  assert.equal(stderr.read(), '');
});

function makeJsonResponse(payload, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function makeTextResponse(body, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() {
      return JSON.parse(body);
    },
    async text() {
      return body;
    },
  };
}
