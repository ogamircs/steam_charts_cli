import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROPHET_FALLBACK_WARNING,
  buildSyntheticTimeline,
  forecastObservedPoints,
  resetProphetRuntimeForTests,
} from '../src/forecast.js';

test('buildSyntheticTimeline maps observed points onto 30-day steps ending at generated_at', () => {
  const timeline = buildSyntheticTimeline({
    observedPoints: [
      { label: 'January 2026', average_players: 100, peak_players: 200, estimated: false },
      { label: 'February 2026', average_players: 120, peak_players: 240, estimated: false },
      { label: 'Last 30 Days', average_players: 150, peak_players: 300, estimated: false },
    ],
    now: new Date('2026-03-07T12:34:56.000Z'),
  });

  assert.deepEqual(timeline.map((point) => point.ds), [
    '2026-01-06',
    '2026-02-05',
    '2026-03-07',
  ]);
  assert.deepEqual(timeline.map((point) => point.timestampSeconds), [
    1767657600,
    1770249600,
    1772841600,
  ]);
});

test('forecastObservedPoints returns prophet forecasts and prophet-wasm source on success', async () => {
  const forecast = await forecastObservedPoints({
    observedPoints: [
      { label: 'January 2026', average_players: 100, peak_players: 200, estimated: false },
      { label: 'February 2026', average_players: 120, peak_players: 240, estimated: false },
      { label: 'Last 30 Days', average_players: 150, peak_players: 300, estimated: false },
    ],
    forecastDays: 3,
    now: new Date('2026-03-07T12:00:00.000Z'),
    preferProphet: true,
    initProphet: async () => {},
    ProphetClass: class FakeProphet {
      constructor() {}
      fit(data) {
        this.training = data;
      }
      predict(data) {
        assert.equal(this.training.ds.length, 3);
        return {
          yhat: {
            point: data.ds.map((_value, index) => (index === 0 ? 180 : index === 1 ? -5 : 220)),
          },
        };
      }
    },
    prophetOptimizer: { optimize() {} },
  });

  assert.equal(forecast.source, 'prophet-wasm');
  assert.equal(forecast.warning, null);
  assert.deepEqual(forecast.points, [
    { date: '2026-03-08', average_players: 180, peak_players: 180, estimated: true },
    { date: '2026-03-09', average_players: 0, peak_players: 0, estimated: true },
    { date: '2026-03-10', average_players: 220, peak_players: 220, estimated: true },
  ]);
});

test('forecastObservedPoints initializes the real Prophet/WASM runtime for a noisy monthly series', async () => {
  const forecast = await forecastObservedPoints({
    observedPoints: [
      { label: 'August 2025', average_players: 650, peak_players: 1400, estimated: false },
      { label: 'September 2025', average_players: 740, peak_players: 1520, estimated: false },
      { label: 'October 2025', average_players: 710, peak_players: 1490, estimated: false },
      { label: 'November 2025', average_players: 830, peak_players: 1610, estimated: false },
      { label: 'December 2025', average_players: 900, peak_players: 1720, estimated: false },
      { label: 'January 2026', average_players: 860, peak_players: 1690, estimated: false },
      { label: 'February 2026', average_players: 1020, peak_players: 1850, estimated: false },
      { label: 'Last 30 Days', average_players: 1180, peak_players: 2010, estimated: false },
    ],
    forecastDays: 2,
    now: new Date('2026-03-07T12:00:00.000Z'),
  });

  assert.equal(forecast.source, 'prophet-wasm');
  assert.equal(forecast.warning, null);
  assert.deepEqual(forecast.points.map((point) => point.date), ['2026-03-08', '2026-03-09']);
  assert.ok(forecast.points.every((point) => point.average_players >= 0));
  assert.ok(forecast.points.every((point) => point.peak_players >= 0));
});

test('forecastObservedPoints falls back to Holt when Prophet initialization fails', async () => {
  const forecast = await forecastObservedPoints({
    observedPoints: [
      { label: 'January 2026', average_players: 100, peak_players: 200, estimated: false },
      { label: 'February 2026', average_players: 120, peak_players: 240, estimated: false },
      { label: 'Last 30 Days', average_players: 150, peak_players: 300, estimated: false },
    ],
    forecastDays: 2,
    now: new Date('2026-03-07T12:00:00.000Z'),
    preferProphet: true,
    initProphet: async () => {
      throw new Error('boom');
    },
  });

  assert.equal(forecast.source, 'holt-linear-smoothing');
  assert.equal(forecast.warning, PROPHET_FALLBACK_WARNING);
  assert.equal(forecast.points.length, 2);
  assert.deepEqual(forecast.points.map((point) => point.date), ['2026-03-08', '2026-03-09']);
});

test('forecastObservedPoints returns no forecast for insufficient observed history', async () => {
  const forecast = await forecastObservedPoints({
    observedPoints: [
      { label: 'February 2026', average_players: 80, peak_players: 120, estimated: false },
      { label: 'Last 30 Days', average_players: 90, peak_players: 140, estimated: false },
    ],
    forecastDays: 5,
    now: new Date('2026-03-07T12:00:00.000Z'),
  });

  assert.equal(forecast.source, 'prophet-wasm');
  assert.equal(forecast.warning, null);
  assert.deepEqual(forecast.points, []);
});

test.afterEach(() => {
  resetProphetRuntimeForTests();
});
