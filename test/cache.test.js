import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CACHE_TTL_MS, isCacheFresh, loadAppList } from '../src/app-cache.js';

test('treats a recent cache as fresh', () => {
  assert.equal(isCacheFresh({
    fetchedAt: '2026-03-07T10:00:00.000Z',
    apps: [],
  }, {
    now: new Date('2026-03-07T12:00:00.000Z'),
    ttlMs: CACHE_TTL_MS,
  }), true);
});

test('reuses stale cache when refresh fails and emits a warning', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-cache-'));
  const cachePath = join(cacheDir, 'app-list.json');
  const warnings = [];

  writeFileSync(cachePath, JSON.stringify({
    fetchedAt: '2026-03-01T00:00:00.000Z',
    apps: [
      { appid: 730, name: 'Counter-Strike 2' },
    ],
  }));

  const apps = await loadAppList({
    apiKey: 'key-123',
    cachePath,
    now: new Date('2026-03-07T12:00:00.000Z'),
    warn: (message) => warnings.push(message),
    fetchPage: async () => {
      throw new Error('steam unavailable');
    },
  });

  assert.deepEqual(apps, [
    { appid: 730, name: 'Counter-Strike 2' },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /using stale cache/i);
});

test('returns a fresh cache without refreshing', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-cache-'));
  const cachePath = join(cacheDir, 'app-list.json');
  let calls = 0;

  writeFileSync(cachePath, JSON.stringify({
    fetchedAt: '2026-03-07T11:30:00.000Z',
    apps: [
      { appid: 730, name: 'Counter-Strike 2' },
    ],
  }));

  const apps = await loadAppList({
    apiKey: 'key-123',
    cachePath,
    now: new Date('2026-03-07T12:00:00.000Z'),
    fetchPage: async () => {
      calls += 1;
      return { apps: [], hasMore: false, lastAppId: null };
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(apps, [
    { appid: 730, name: 'Counter-Strike 2' },
  ]);
});

test('refresh=true ignores a warm cache and reloads the app list', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-cache-'));
  const cachePath = join(cacheDir, 'app-list.json');
  let calls = 0;

  writeFileSync(cachePath, JSON.stringify({
    fetchedAt: '2026-03-07T11:59:00.000Z',
    apps: [
      { appid: 730, name: 'Old Name' },
    ],
  }));

  const apps = await loadAppList({
    apiKey: 'key-123',
    cachePath,
    refresh: true,
    now: new Date('2026-03-07T12:00:00.000Z'),
    fetchPage: async () => {
      calls += 1;
      return {
        apps: [
          { appid: 730, name: 'Counter-Strike 2' },
        ],
        hasMore: false,
        lastAppId: 730,
      };
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(apps, [
    { appid: 730, name: 'Counter-Strike 2' },
  ]);
});

test('loads multiple app-list pages and de-duplicates repeated app ids', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'steam-charts-cache-'));
  const cachePath = join(cacheDir, 'app-list.json');
  const seenLastAppIds = [];

  const apps = await loadAppList({
    apiKey: 'key-123',
    cachePath,
    fetchPage: async ({ lastAppId }) => {
      seenLastAppIds.push(lastAppId);

      if (lastAppId === null) {
        return {
          apps: [
            { appid: 10, name: 'Counter-Strike' },
            { appid: 20, name: 'Half-Life' },
          ],
          hasMore: true,
          lastAppId: 20,
        };
      }

      return {
        apps: [
          { appid: 20, name: 'Half-Life' },
          { appid: 30, name: 'Portal' },
        ],
        hasMore: false,
        lastAppId: 30,
      };
    },
  });

  assert.deepEqual(seenLastAppIds, [null, 20]);
  assert.deepEqual(apps, [
    { appid: 10, name: 'Counter-Strike' },
    { appid: 20, name: 'Half-Life' },
    { appid: 30, name: 'Portal' },
  ]);
});
