import test from 'node:test';
import assert from 'node:assert/strict';

import { serializeRecord } from '../src/output.js';

const record = {
  appid: 730,
  name: 'Counter-Strike 2',
  current_players: 777777,
  queried_at: '2026-03-07T12:00:00.000Z',
  source: 'steam-web-api',
};

test('serializes a record as deterministic csv', () => {
  assert.equal(
    serializeRecord(record, { format: 'csv' }),
    'appid,name,current_players,queried_at,source\n730,Counter-Strike 2,777777,2026-03-07T12:00:00.000Z,steam-web-api',
  );
});

test('serializes a record as deterministic json', () => {
  assert.equal(
    serializeRecord(record, { format: 'json' }),
    `${JSON.stringify(record, null, 2)}`,
  );
});

test('escapes commas and quotes in csv fields', () => {
  assert.equal(
    serializeRecord({
      ...record,
      name: 'He said, "buy"',
    }, { format: 'csv' }),
    'appid,name,current_players,queried_at,source\n730,"He said, ""buy""",777777,2026-03-07T12:00:00.000Z,steam-web-api',
  );
});
