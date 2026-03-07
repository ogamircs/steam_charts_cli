import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAppByName } from '../src/resolve-app.js';

const apps = [
  { appid: 10, name: 'Counter-Strike' },
  { appid: 730, name: 'Counter-Strike 2' },
  { appid: 227300, name: 'Euro Truck Simulator 2' },
];

test('resolves a unique exact match case-insensitively', () => {
  assert.deepEqual(resolveAppByName('counter-strike 2', apps), {
    appid: 730,
    name: 'Counter-Strike 2',
  });
});

test('fails without guessing when there is no unique exact match', () => {
  assert.throws(() => {
    resolveAppByName('counter', apps);
  }, /no exact steam app match found for "counter"/i);
});

test('includes candidate names and app ids in lookup errors', () => {
  assert.throws(() => {
    resolveAppByName('truck', apps);
  }, /Euro Truck Simulator 2 \(227300\)/);
});

test('fails when more than one exact match exists', () => {
  assert.throws(() => {
    resolveAppByName('Portal', [
      { appid: 400, name: 'Portal' },
      { appid: 401, name: 'Portal' },
    ]);
  }, /Portal \(400\)[\s\S]*Portal \(401\)/);
});
