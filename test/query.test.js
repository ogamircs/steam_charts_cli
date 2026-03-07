import test from 'node:test';
import assert from 'node:assert/strict';

import { parseQuery } from '../src/query.js';

test('classifies numeric queries as app ids', () => {
  assert.deepEqual(parseQuery('730'), {
    kind: 'appid',
    appid: 730,
    raw: '730',
  });
});

test('classifies text queries as game names', () => {
  assert.deepEqual(parseQuery('  Counter-Strike 2  '), {
    kind: 'name',
    name: 'Counter-Strike 2',
    raw: 'Counter-Strike 2',
  });
});

test('rejects empty queries', () => {
  assert.throws(() => {
    parseQuery('   ');
  }, /requires a game name or app id/i);
});
