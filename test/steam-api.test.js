import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchAppListPage, fetchCurrentPlayers } from '../src/steam-api.js';

test('fetchCurrentPlayers throws when the payload is missing player_count', async () => {
  await assert.rejects(() => {
    return fetchCurrentPlayers({
      appid: 730,
      fetchImpl: async () => makeResponse({
        response: {
          result: 1,
        },
      }),
    });
  }, /did not contain a valid player count/i);
});

test('fetchCurrentPlayers can parse text-only json responses', async () => {
  const playerCount = await fetchCurrentPlayers({
    appid: 730,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      async text() {
        return JSON.stringify({
          response: {
            player_count: 424242,
            result: 1,
          },
        });
      },
    }),
  });

  assert.equal(playerCount, 424242);
});

test('fetchAppListPage includes last_appid and sanitizes invalid rows', async () => {
  let requestedUrl = null;

  const page = await fetchAppListPage({
    apiKey: 'key-123',
    lastAppId: 20,
    fetchImpl: async (url) => {
      requestedUrl = new URL(String(url));
      return makeResponse({
        response: {
          apps: [
            { appid: 30, name: 'Portal' },
            { appid: 'bad', name: 'bad' },
            { appid: 40, name: '   ' },
          ],
          have_more_results: false,
          last_appid: 30,
        },
      });
    },
  });

  assert.equal(requestedUrl.searchParams.get('last_appid'), '20');
  assert.deepEqual(page, {
    apps: [
      { appid: 30, name: 'Portal' },
    ],
    hasMore: false,
    lastAppId: 30,
  });
});

test('fetchAppListPage throws on non-ok responses', async () => {
  await assert.rejects(() => {
    return fetchAppListPage({
      apiKey: 'key-123',
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        statusText: 'Unavailable',
      }),
    });
  }, /Steam app list request failed: 503 Unavailable/);
});

function makeResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}
