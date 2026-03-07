import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchSteamDbStoreSnapshot, formatStoreSnapshotText, parseSteamDbStoreSnapshot } from '../src/store.js';
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
