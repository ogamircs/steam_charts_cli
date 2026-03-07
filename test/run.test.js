import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSteamCharts } from '../src/run.js';
import { createOutputCollector } from './helpers.js';

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
