import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addObservedGains,
  buildForecastPoints,
  fetchSteamChartsHistory,
  findExtrema,
  parseSteamChartsHistory,
  renderTrendChart,
} from '../src/trends.js';
import { readFixture } from './helpers.js';

test('parseSteamChartsHistory extracts app metadata and ascending monthly points', () => {
  const parsed = parseSteamChartsHistory(readFixture('steamcharts-history.html'));

  assert.equal(parsed.app.name, 'Counter-Strike 2');
  assert.equal(parsed.points.length, 5);
  assert.deepEqual(parsed.points[0], {
    label: 'November 2025',
    average_players: 700,
    peak_players: 1500,
    estimated: false,
  });
  assert.deepEqual(parsed.points.at(-1), {
    label: 'Last 30 Days',
    average_players: 1200,
    peak_players: 2000,
    estimated: false,
  });
});

test('addObservedGains appends numeric gain and percent fields to observed history', () => {
  const { points } = parseSteamChartsHistory(readFixture('steamcharts-history.html'));
  const gained = addObservedGains(points.slice(-3));

  assert.deepEqual(gained, [
    {
      label: 'January 2026',
      average_players: 800,
      peak_players: 1700,
      average_change: null,
      average_change_pct: null,
      peak_change: null,
      peak_change_pct: null,
      estimated: false,
    },
    {
      label: 'February 2026',
      average_players: 1000,
      peak_players: 1800,
      average_change: 200,
      average_change_pct: 25,
      peak_change: 100,
      peak_change_pct: 5.88,
      estimated: false,
    },
    {
      label: 'Last 30 Days',
      average_players: 1200,
      peak_players: 2000,
      average_change: 200,
      average_change_pct: 20,
      peak_change: 200,
      peak_change_pct: 11.11,
      estimated: false,
    },
  ]);
});

test('buildForecastPoints generates requested daily forecast points and returns prophet metadata', async () => {
  const forecast = await buildForecastPoints({
    observedPoints: [
      { label: 'January 2026', average_players: 100, peak_players: 200, estimated: false },
      { label: 'February 2026', average_players: 50, peak_players: 100, estimated: false },
      { label: 'Last 30 Days', average_players: 0, peak_players: 0, estimated: false },
    ],
    forecastDays: 3,
    now: new Date('2026-03-07T12:00:00.000Z'),
    preferProphet: false,
  });

  assert.equal(forecast.source, 'holt-linear-smoothing');
  assert.equal(forecast.warning, null);
  assert.equal(forecast.points.length, 3);
  assert.deepEqual(forecast.points.map((point) => point.date), ['2026-03-08', '2026-03-09', '2026-03-10']);
  assert.ok(forecast.points.every((point) => point.average_players >= 0));
  assert.ok(forecast.points.every((point) => point.peak_players >= 0));
  assert.ok(forecast.points.every((point) => point.estimated === true));
});

test('findExtrema returns highest and lowest observed average and peak values', () => {
  const { points } = parseSteamChartsHistory(readFixture('steamcharts-history.html'));

  assert.deepEqual(findExtrema(points, 'highest'), {
    average: { value: 1200, label: 'Last 30 Days' },
    peak: { value: 2000, label: 'Last 30 Days' },
  });

  assert.deepEqual(findExtrema(points, 'lowest'), {
    average: { value: 700, label: 'November 2025' },
    peak: { value: 1500, label: 'November 2025' },
  });
});

test('renderTrendChart renders stacked average and peak sections with a legend', async () => {
  const { app, points } = parseSteamChartsHistory(readFixture('steamcharts-history.html'));
  const historyPoints = addObservedGains(points.slice(-3));
  const forecast = await buildForecastPoints({
    observedPoints: points.slice(-3),
    forecastDays: 2,
    now: new Date('2026-03-07T12:00:00.000Z'),
    preferProphet: false,
  });

  const chart = renderTrendChart({
    app: { appid: 730, name: app.name },
    historyPoints,
    forecastPoints: forecast.points,
    months: 3,
    forecastDays: 2,
    warnings: [],
  });

  assert.match(chart, /Counter-Strike 2 \(730\)/);
  assert.match(chart, /Average Players/);
  assert.match(chart, /Peak Players/);
  assert.match(chart, /Observed: █/);
  assert.match(chart, /Forecast: ░/);
});

test('parseSteamChartsHistory fails clearly when the history table is missing', () => {
  assert.throws(() => parseSteamChartsHistory('<html><body><h1>No Table</h1></body></html>'), /history table not found/i);
});

test('renderTrendChart leaves bars empty for zero-valued points', () => {
  const chart = renderTrendChart({
    app: { appid: 999, name: 'Zero Game' },
    historyPoints: [
      {
        label: 'January 2026',
        average_players: 0,
        peak_players: 0,
        average_change: null,
        average_change_pct: null,
        peak_change: null,
        peak_change_pct: null,
        estimated: false,
      },
    ],
    forecastPoints: [
      {
        date: '2026-03-08',
        average_players: 0,
        peak_players: 0,
        estimated: true,
      },
    ],
    months: 1,
    forecastDays: 1,
    warnings: [],
  });

  assert.doesNotMatch(chart, /January 2026\s+█/);
  assert.doesNotMatch(chart, /2026-03-08\s+░/);
});

test('fetchSteamChartsHistory sends browser-like headers and parses the response body', async () => {
  const result = await fetchSteamChartsHistory({
    appid: 1085660,
    env: {
      STEAM_CHARTS_HISTORY_URL_TEMPLATE: 'https://example.test/history/{appid}',
    },
    preferCurl: false,
    fetchImpl: async (url, init) => {
      assert.equal(String(url), 'https://example.test/history/1085660');
      assert.match(init.headers['user-agent'], /Mozilla\/5\.0/);
      assert.match(init.headers.accept, /text\/html/);
      assert.equal(init.headers.connection, 'close');
      return {
        ok: true,
        async text() {
          return readFixture('steamcharts-history.html');
        },
      };
    },
  });

  assert.equal(result.app.name, 'Counter-Strike 2');
  assert.equal(result.points.length, 5);
});
