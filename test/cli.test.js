import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseArgs } from '../src/cli.js';
import { runCli, withMockServer } from './helpers.js';

test('prints help text', async () => {
  const result = await runCli(['--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: steam-charts <query>/);
  assert.match(result.stdout, /--refresh-app-list/);
  assert.match(result.stdout, /--format/);
});

test('rejects a missing query', async () => {
  const result = await runCli([]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout.trim(), '');
  assert.match(result.stderr, /steam-charts requires a game name or app id/i);
});

test('parses the new steam-specific CLI contract', () => {
  const parsed = parseArgs(['Counter-Strike 2', '--format', 'json', '--refresh-app-list']);

  assert.equal(parsed.mode, 'run');
  assert.equal(parsed.options.query, 'Counter-Strike 2');
  assert.equal(parsed.options.format, 'json');
  assert.equal(parsed.options.refreshAppList, true);
});

test('steam-charts 730 succeeds without an api key and prints csv', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-cli-cache-'));

  await withMockServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    assert.equal(url.pathname, '/current-players');
    assert.equal(url.searchParams.get('appid'), '730');

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      response: {
        player_count: 999999,
        result: 1,
      },
    }));
  }, async ({ origin }) => {
    const result = await runCli(['730'], {
      env: {
        STEAM_API_KEY: '',
        STEAM_CHARTS_CACHE_DIR: cacheDir,
        STEAM_CHARTS_CURRENT_PLAYERS_URL: `${origin}/current-players`,
      },
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /^appid,name,current_players,queried_at,source\n730,,999999,/);
    assert.match(result.stdout, /steam-web-api/);
  });
});

test('steam-charts name lookup refreshes a cold cache when an api key is available', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-cli-cache-'));

  await withMockServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/app-list') {
      assert.equal(url.searchParams.get('key'), 'test-key');
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        response: {
          apps: [
            { appid: 10, name: 'Counter-Strike' },
            { appid: 730, name: 'Counter-Strike 2' },
          ],
          have_more_results: false,
          last_appid: 730,
        },
      }));
      return;
    }

    if (url.pathname === '/current-players') {
      assert.equal(url.searchParams.get('appid'), '730');
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        response: {
          player_count: 777777,
          result: 1,
        },
      }));
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  }, async ({ origin, requests }) => {
    const result = await runCli(['Counter-Strike 2'], {
      env: {
        STEAM_API_KEY: 'test-key',
        STEAM_CHARTS_CACHE_DIR: cacheDir,
        STEAM_CHARTS_APP_LIST_URL: `${origin}/app-list`,
        STEAM_CHARTS_CURRENT_PLAYERS_URL: `${origin}/current-players`,
      },
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /^appid,name,current_players,queried_at,source\n730,Counter-Strike 2,777777,/);
    assert.equal(requests.length, 2);
  });
});

test('warm-cache name lookup skips the app-list refresh', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-cli-cache-'));
  const appListPath = join(cacheDir, 'app-list.json');

  writeFileSync(appListPath, JSON.stringify({
    fetchedAt: '2099-03-07T00:00:00.000Z',
    apps: [
      { appid: 730, name: 'Counter-Strike 2' },
    ],
  }));

  await withMockServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    assert.equal(url.pathname, '/current-players');
    assert.equal(url.searchParams.get('appid'), '730');

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      response: {
        player_count: 123456,
        result: 1,
      },
    }));
  }, async ({ origin, requests }) => {
    const result = await runCli(['Counter-Strike 2'], {
      env: {
        STEAM_API_KEY: 'test-key',
        STEAM_CHARTS_CACHE_DIR: cacheDir,
        STEAM_CHARTS_APP_LIST_URL: `${origin}/app-list`,
        STEAM_CHARTS_CURRENT_PLAYERS_URL: `${origin}/current-players`,
      },
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /^appid,name,current_players,queried_at,source\n730,Counter-Strike 2,123456,/);
    assert.equal(requests.length, 1);
  });
});

test('refresh-app-list forces a refresh even when the cache is warm', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-cli-cache-'));
  const appListPath = join(cacheDir, 'app-list.json');

  writeFileSync(appListPath, JSON.stringify({
    fetchedAt: '2099-03-07T00:00:00.000Z',
    apps: [
      { appid: 730, name: 'Old Cached Name' },
    ],
  }));

  await withMockServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/app-list') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        response: {
          apps: [
            { appid: 730, name: 'Counter-Strike 2' },
          ],
          have_more_results: false,
          last_appid: 730,
        },
      }));
      return;
    }

    assert.equal(url.pathname, '/current-players');
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      response: {
        player_count: 987654,
        result: 1,
      },
    }));
  }, async ({ origin, requests }) => {
    const result = await runCli(['Counter-Strike 2', '--refresh-app-list'], {
      env: {
        STEAM_API_KEY: 'test-key',
        STEAM_CHARTS_CACHE_DIR: cacheDir,
        STEAM_CHARTS_APP_LIST_URL: `${origin}/app-list`,
        STEAM_CHARTS_CURRENT_PLAYERS_URL: `${origin}/current-players`,
      },
    });

    assert.equal(result.code, 0);
    assert.equal(requests.length, 2);
    assert.match(result.stdout, /^appid,name,current_players,queried_at,source\n730,Counter-Strike 2,987654,/);
  });
});

test('writes csv to --output and suppresses stdout payload', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-cli-cache-'));
  const outputPath = join(cacheDir, 'players.csv');

  await withMockServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    assert.equal(url.pathname, '/current-players');
    assert.equal(url.searchParams.get('appid'), '730');

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      response: {
        player_count: 42,
        result: 1,
      },
    }));
  }, async ({ origin }) => {
    const result = await runCli(['730', '--output', outputPath], {
      env: {
        STEAM_API_KEY: '',
        STEAM_CHARTS_CACHE_DIR: cacheDir,
        STEAM_CHARTS_CURRENT_PLAYERS_URL: `${origin}/current-players`,
      },
    });

    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.match(readFileSync(outputPath, 'utf8'), /^appid,name,current_players,queried_at,source\n730,,42,/);
  });
});

test('exits non-zero when the steam player request fails', async () => {
  await withMockServer(async (_req, res) => {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'unavailable' }));
  }, async ({ origin }) => {
    const result = await runCli(['730'], {
      env: {
        STEAM_CHARTS_CURRENT_PLAYERS_URL: `${origin}/current-players`,
      },
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /steam current players request failed: 503/i);
  });
});

test('requires an api key for text queries', async () => {
  const result = await runCli(['Counter-Strike 2'], {
    env: { STEAM_API_KEY: '' },
  });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /steam_api_key|--api-key/i);
});
