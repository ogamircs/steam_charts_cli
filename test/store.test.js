import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchSteamDbStoreSnapshot,
  fetchStoreSnapshot,
  formatStoreSnapshotText,
  parseSteamDbStoreSnapshot,
} from '../src/store.js';
import { readFixture } from './helpers.js';

test('parseSteamDbStoreSnapshot extracts store metrics from a SteamDB-style page', () => {
  const snapshot = parseSteamDbStoreSnapshot(readFixture('steamdb-store.html'));

  assert.deepEqual(snapshot, {
    name: 'Counter-Strike 2',
    daily_active_users_rank: 154,
    top_sellers_rank: 148,
    wishlist_activity_rank: 3180,
    followers: 736595,
    reviews: 644619,
  });
});

test('formatStoreSnapshotText renders a readable terminal summary', () => {
  const text = formatStoreSnapshotText({
    app: { appid: 730, name: 'Counter-Strike 2' },
    snapshot: {
      daily_active_users_rank: 154,
      top_sellers_rank: 148,
      wishlist_activity_rank: 3180,
      followers: 736595,
      reviews: 644619,
      captured_at: '2026-03-07T12:00:00.000Z',
      source: 'steamdb',
    },
  });

  assert.match(text, /Counter-Strike 2 \(730\)/);
  assert.match(text, /Daily active users rank:\s+#154/);
  assert.match(text, /Top sellers rank:\s+#148/);
  assert.match(text, /Wishlist activity rank:\s+#3180/);
  assert.match(text, /Followers:\s+736,595/);
  assert.match(text, /Reviews:\s+644,619/);
});

test('formatStoreSnapshotText renders unavailable placeholders for missing fallback fields', () => {
  const text = formatStoreSnapshotText({
    app: { appid: 1085660, name: 'Destiny 2' },
    snapshot: {
      daily_active_users_rank: null,
      top_sellers_rank: null,
      wishlist_activity_rank: null,
      followers: null,
      reviews: 123456,
      captured_at: '2026-03-11T04:00:00.000Z',
      source: 'steam-store-partial',
    },
  });

  assert.match(text, /Daily active users rank:\s+Unavailable/);
  assert.match(text, /Top sellers rank:\s+Unavailable/);
  assert.match(text, /Wishlist activity rank:\s+Unavailable/);
  assert.match(text, /Followers:\s+Unavailable/);
  assert.match(text, /Reviews:\s+123,456/);
  assert.match(text, /Source:\s+steam-store-partial/);
});

test('parseSteamDbStoreSnapshot fails clearly when a required metric is missing', () => {
  assert.throws(() => parseSteamDbStoreSnapshot('<html><body><h1>Counter-Strike 2</h1></body></html>'), /did not contain daily active users rank/i);
});

test('fetchSteamDbStoreSnapshot sends browser-like headers and surfaces non-ok responses', async () => {
  await assert.rejects(() => fetchSteamDbStoreSnapshot({
    appid: 1085660,
    env: {
      STEAM_CHARTS_STORE_URL_TEMPLATE: 'https://example.test/store/{appid}',
    },
    preferCurl: false,
    fetchImpl: async (url, init) => {
      assert.equal(String(url), 'https://example.test/store/1085660');
      assert.match(init.headers['user-agent'], /Mozilla\/5\.0/);
      assert.equal(init.headers.connection, 'close');
      return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        async text() {
          return 'forbidden';
        },
      };
    },
  }), /403 Forbidden/);
});

test('fetchStoreSnapshot falls back to official Steam store data when SteamDB is unavailable', async () => {
  const snapshot = await fetchStoreSnapshot({
    appid: 1085660,
    env: {
      STEAM_CHARTS_STORE_URL_TEMPLATE: 'https://example.test/store/{appid}',
      STEAM_CHARTS_OFFICIAL_STORE_APPDETAILS_URL_TEMPLATE: 'https://example.test/appdetails/{appid}',
    },
    preferCurl: false,
    fetchImpl: async (url) => {
      const value = String(url);

      if (value === 'https://example.test/store/1085660') {
        return {
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          async text() {
            return 'forbidden';
          },
        };
      }

      if (value === 'https://example.test/appdetails/1085660') {
        return {
          ok: true,
          async json() {
            return {
              1085660: {
                success: true,
                data: {
                  name: 'Destiny 2',
                  recommendations: {
                    total: 123456,
                  },
                },
              },
            };
          },
        };
      }

      throw new Error(`Unexpected URL: ${value}`);
    },
  });

  assert.deepEqual(snapshot, {
    name: 'Destiny 2',
    daily_active_users_rank: null,
    top_sellers_rank: null,
    wishlist_activity_rank: null,
    followers: null,
    reviews: 123456,
    source: 'steam-store-partial',
    warning: 'SteamDB store data is unavailable from this environment; using partial official Steam store data.',
  });
});
