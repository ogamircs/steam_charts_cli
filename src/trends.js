const HISTORY_URL_TEMPLATE = 'https://steamcharts.com/app/{appid}';
const OBSERVED_BAR = '█';
const FORECAST_BAR = '░';

import { loadHtmlPage } from './html-page.js';

export async function fetchSteamChartsHistory({
  appid,
  env = process.env,
  fetchImpl = global.fetch,
  curlRunner,
  preferCurl,
  timeoutMs,
}) {
  const url = buildTemplateUrl(env.STEAM_CHARTS_HISTORY_URL_TEMPLATE || HISTORY_URL_TEMPLATE, appid);
  const html = await loadHtmlPage({
    url,
    label: 'Steam Charts history',
    fetchImpl,
    curlRunner,
    preferCurl,
    timeoutMs,
  });
  return parseSteamChartsHistory(html);
}

export function parseSteamChartsHistory(html) {
  const appName = extractAppName(html, {
    headlinePattern: /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
    titleSuffix: /\s*-\s*Steam Charts\s*$/i,
  });

  const tbodyMatch = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) {
    throw new Error('Steam Charts history table not found');
  }

  const rows = [...tbodyMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const points = rows
    .map((row) => extractHistoryRow(row[1]))
    .filter(Boolean)
    .reverse();

  if (points.length === 0) {
    throw new Error('Steam Charts history table did not contain any monthly player rows');
  }

  return {
    app: {
      name: appName,
    },
    points,
  };
}

export function addObservedGains(points) {
  return points.map((point, index) => {
    if (index === 0) {
      return {
        ...point,
        average_change: null,
        average_change_pct: null,
        peak_change: null,
        peak_change_pct: null,
      };
    }

    const previous = points[index - 1];

    return {
      ...point,
      average_change: roundTo(2, point.average_players - previous.average_players),
      average_change_pct: computePercentChange(previous.average_players, point.average_players),
      peak_change: roundTo(2, point.peak_players - previous.peak_players),
      peak_change_pct: computePercentChange(previous.peak_players, point.peak_players),
    };
  });
}

export function buildForecastPoints({
  observedPoints,
  forecastDays,
  now = new Date(),
}) {
  if (!Number.isInteger(forecastDays) || forecastDays <= 0) {
    return [];
  }

  if (!Array.isArray(observedPoints) || observedPoints.length < 3) {
    return [];
  }

  const averageModel = fitHoltLinear(observedPoints.map((point) => point.average_players));
  const peakModel = fitHoltLinear(observedPoints.map((point) => point.peak_players));
  const startDate = resolveDate(now);

  return Array.from({ length: forecastDays }, (_value, index) => {
    const day = index + 1;

    return {
      date: addUtcDays(startDate, day).toISOString().slice(0, 10),
      average_players: projectDailyValue(averageModel, day),
      peak_players: projectDailyValue(peakModel, day),
      estimated: true,
    };
  });
}

export function findExtrema(points, type) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('Cannot calculate extrema without observed history');
  }

  const comparator = type === 'lowest'
    ? (candidate, current) => candidate.value < current.value
    : (candidate, current) => candidate.value > current.value;

  return {
    average: findSeriesExtrema(points, 'average_players', comparator),
    peak: findSeriesExtrema(points, 'peak_players', comparator),
  };
}

export function renderTrendChart({
  app,
  historyPoints,
  forecastPoints,
  months,
  forecastDays,
  warnings,
}) {
  const lines = [
    `${app.name || 'Unknown App'} (${app.appid})`,
    `Window: ${months} month(s) observed, ${forecastDays} day(s) forecast`,
    '',
    renderSeriesChart('Average Players', historyPoints, forecastPoints, 'average_players'),
    '',
    renderSeriesChart('Peak Players', historyPoints, forecastPoints, 'peak_players'),
    '',
    `Observed: ${OBSERVED_BAR}`,
    `Forecast: ${FORECAST_BAR}`,
  ];

  if (warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join('\n');
}

export function formatExtremaText({ app, type, extrema }) {
  const label = type === 'lowest' ? 'Lowest' : 'Highest';
  return [
    `${app.name || 'Unknown App'} (${app.appid})`,
    `${label} average players: ${formatInteger(extrema.average.value)} (${extrema.average.label})`,
    `${label} peak players: ${formatInteger(extrema.peak.value)} (${extrema.peak.label})`,
    'Source: steamcharts',
  ].join('\n');
}

function extractHistoryRow(rowHtml) {
  const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((match) => normalizeText(match[1]));

  if (cells.length < 5) {
    return null;
  }

  const label = cells[0];
  const averagePlayers = parseNumericValue(cells[1]);
  const peakPlayers = parseNumericValue(cells[4]);

  if (!label || averagePlayers === null || peakPlayers === null) {
    return null;
  }

  return {
    label,
    average_players: averagePlayers,
    peak_players: peakPlayers,
    estimated: false,
  };
}

function findSeriesExtrema(points, key, comparator) {
  let selected = {
    value: points[0][key],
    label: points[0].label,
  };

  for (const point of points.slice(1)) {
    const candidate = {
      value: point[key],
      label: point.label,
    };

    if (comparator(candidate, selected)) {
      selected = candidate;
    }
  }

  return selected;
}

function renderSeriesChart(title, historyPoints, forecastPoints, key) {
  const observed = historyPoints.map((point) => ({
    label: point.label,
    value: point[key],
    bar: OBSERVED_BAR,
  }));
  const forecast = forecastPoints.map((point) => ({
    label: point.date,
    value: point[key],
    bar: FORECAST_BAR,
  }));
  const allPoints = [...observed, ...forecast];
  const maxValue = allPoints.reduce((max, point) => Math.max(max, point.value), 0);

  const lines = [title];

  for (const point of observed) {
    lines.push(formatChartLine(point, maxValue));
  }

  if (forecast.length > 0) {
    lines.push('--- Forecast ---');
    for (const point of forecast) {
      lines.push(formatChartLine(point, maxValue));
    }
  }

  return lines.join('\n');
}

function formatChartLine(point, maxValue) {
  const width = 24;
  const ratio = maxValue === 0 ? 0 : point.value / maxValue;
  const barLength = point.value === 0 ? 0 : Math.max(1, Math.round(ratio * width));
  const label = point.label.padEnd(14).slice(0, 14);
  return `${label} ${point.bar.repeat(barLength)} ${formatInteger(point.value)}`;
}

function fitHoltLinear(values, { alpha = 0.7, beta = 0.3 } = {}) {
  let level = values[0];
  let trend = values[1] - values[0];

  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    const previousLevel = level;
    level = alpha * value + (1 - alpha) * (level + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
  }

  return { level, trend };
}

function projectDailyValue(model, day) {
  const fractionalMonth = day / 30;
  return Math.max(0, roundTo(2, model.level + fractionalMonth * model.trend));
}

function computePercentChange(previousValue, nextValue) {
  if (previousValue === 0) {
    return null;
  }

  return roundTo(2, ((nextValue - previousValue) / previousValue) * 100);
}

function parseNumericValue(value) {
  const normalized = String(value ?? '').replaceAll(',', '').trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return roundTo(2, parsed);
}

function normalizeText(value) {
  return decodeHtmlEntities(
    String(value ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function extractAppName(html, { headlinePattern, titleSuffix }) {
  const headlineMatch = html.match(headlinePattern);
  if (headlineMatch) {
    return normalizeText(headlineMatch[1]);
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return normalizeText(titleMatch[1]).replace(titleSuffix, '').trim();
  }

  return '';
}

function buildTemplateUrl(template, appid) {
  return template.replaceAll('{appid}', String(appid));
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function resolveDate(now) {
  return now instanceof Date ? now : new Date(now);
}

function roundTo(decimals, value) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatInteger(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ');
}
