import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { defaultCachePath, loadAppList, readAppListCache } from './app-cache.js';
import { serializeRecord } from './output.js';
import { parseQuery } from './query.js';
import { resolveAppByName, searchApps } from './resolve-app.js';
import { fetchCurrentPlayers } from './steam-api.js';
import {
  addObservedGains,
  buildForecastPoints,
  fetchSteamChartsHistory,
  findExtrema,
  formatExtremaText,
  renderTrendChart,
} from './trends.js';
import { fetchStoreSnapshot, formatStoreSnapshotText } from './store.js';

const INSUFFICIENT_HISTORY_WARNING = 'Need at least 3 observed monthly points before generating a forecast.';

export async function runSteamCharts({
  output,
  error,
  options,
  env = process.env,
  fetchImpl = global.fetch,
  now = () => new Date(),
}) {
  const query = parseQuery(options.query);
  const apiKey = await resolveApiKey(options, env);
  const command = options.command ?? 'current';

  if (options.search) {
    return runSearch({ query, apiKey, options, env, fetchImpl, output, error, now });
  }

  switch (command) {
    case 'current':
      return runCurrentLookup({ query, apiKey, options, env, fetchImpl, output, error, now });
    case 'history':
      return runHistory({ query, apiKey, options, env, fetchImpl, output, error, now });
    case 'chart':
      return runChart({ query, apiKey, options, env, fetchImpl, output, error, now });
    case 'store':
      return runStore({ query, apiKey, options, env, fetchImpl, output, error, now });
    case 'highest':
    case 'lowest':
      return runExtrema({ command, query, apiKey, options, env, fetchImpl, output, error, now });
    default:
      throw new Error(`Unsupported command: ${command}`);
  }
}

async function runCurrentLookup({ query, apiKey, options, env, fetchImpl, output, error, now }) {
  const app = await resolveApp({
    query,
    apiKey,
    refreshAppList: options.refreshAppList,
    env,
    fetchImpl,
    error,
    now,
  });
  const currentPlayers = await fetchCurrentPlayers({
    appid: app.appid,
    env,
    fetchImpl,
  });

  const record = {
    appid: app.appid,
    name: app.name ?? '',
    current_players: currentPlayers,
    queried_at: resolveDate(now).toISOString(),
    source: 'steam-web-api',
  };

  const payload = serializeRecord(record, {
    format: options.format,
  });

  await emitPayload({ payload, outputPath: options.outputPath, output });

  return {
    exitCode: 0,
    outputPath: options.outputPath,
    record,
    text: payload,
  };
}

async function runHistory({ query, apiKey, options, env, fetchImpl, output, error, now }) {
  const { app, historyPoints, warnings } = await loadObservedHistoryContext({
    query,
    apiKey,
    options,
    env,
    fetchImpl,
    error,
    now,
  });
  const forecast = await buildForecastPoints({
    observedPoints: historyPoints,
    forecastDays: options.forecastDays,
    now: resolveDate(now),
    preferProphet: env.STEAM_CHARTS_DISABLE_PROPHET !== '1',
  });
  const allWarnings = appendWarning(warnings, forecast.warning);

  const payloadObject = {
    app,
    window: {
      months: options.months,
      forecast_days: options.forecastDays,
      generated_at: resolveDate(now).toISOString(),
    },
    history: {
      points: addObservedGains(historyPoints),
    },
    forecast: {
      points: forecast.points,
    },
    source: {
      history: 'steamcharts',
      forecast: forecast.source,
    },
    warnings: allWarnings,
  };
  const payload = toPrettyJson(payloadObject);

  await emitPayload({ payload, outputPath: options.outputPath, output });

  return {
    exitCode: 0,
    outputPath: options.outputPath,
    text: payload,
  };
}

async function runChart({ query, apiKey, options, env, fetchImpl, output, error, now }) {
  const { app, historyPoints, warnings } = await loadObservedHistoryContext({
    query,
    apiKey,
    options,
    env,
    fetchImpl,
    error,
    now,
  });
  const forecast = await buildForecastPoints({
    observedPoints: historyPoints,
    forecastDays: options.forecastDays,
    now: resolveDate(now),
    preferProphet: env.STEAM_CHARTS_DISABLE_PROPHET !== '1',
  });
  const allWarnings = appendWarning(warnings, forecast.warning);
  const payload = renderTrendChart({
    app,
    historyPoints: addObservedGains(historyPoints),
    forecastPoints: forecast.points,
    months: options.months,
    forecastDays: options.forecastDays,
    warnings: allWarnings,
  });

  output.write(`${payload}\n`);

  return {
    exitCode: 0,
    text: payload,
  };
}

async function runStore({ query, apiKey, options, env, fetchImpl, output, error, now }) {
  const app = await resolveApp({
    query,
    apiKey,
    refreshAppList: options.refreshAppList,
    env,
    fetchImpl,
    error,
    now,
  });
  const snapshot = await fetchStoreSnapshot({
    appid: app.appid,
    env,
    fetchImpl,
  });
  if (snapshot.warning) {
    error.write(`Warning: ${snapshot.warning}\n`);
  }
  const payloadObject = {
    app: buildResolvedApp(app, snapshot.name),
    daily_active_users_rank: snapshot.daily_active_users_rank,
    top_sellers_rank: snapshot.top_sellers_rank,
    wishlist_activity_rank: snapshot.wishlist_activity_rank,
    followers: snapshot.followers,
    reviews: snapshot.reviews,
    captured_at: resolveDate(now).toISOString(),
    source: snapshot.source,
  };
  const payload = formatJsonOrText(options.format, payloadObject, () => formatStoreSnapshotText({
      app: payloadObject.app,
      snapshot: {
        ...payloadObject,
      },
    }));

  await emitPayload({ payload, outputPath: options.outputPath, output });

  return {
    exitCode: 0,
    outputPath: options.outputPath,
    text: payload,
  };
}

async function runExtrema({ command, query, apiKey, options, env, fetchImpl, output, error, now }) {
  const { app, points } = await loadHistorySource({
    query,
    apiKey,
    options,
    env,
    fetchImpl,
    error,
    now,
  });
  const extrema = findExtrema(points, command);
  const payloadObject = {
    app,
    average: extrema.average,
    peak: extrema.peak,
    source: 'steamcharts',
  };
  const payload = formatJsonOrText(options.format, payloadObject, () => formatExtremaText({
      app: payloadObject.app,
      type: command,
      extrema,
    }));

  await emitPayload({ payload, outputPath: options.outputPath, output });

  return {
    exitCode: 0,
    outputPath: options.outputPath,
    text: payload,
  };
}

async function runSearch({ query, apiKey, options, env, fetchImpl, output, error, now }) {
  if (!apiKey) {
    throw new Error('Search requires STEAM_API_KEY or --api-key');
  }

  const warn = createLineWriter(error);

  const searchTerm = query.kind === 'name' ? query.name : String(query.appid);

  const apps = await loadAppList({
    apiKey,
    refresh: options.refreshAppList,
    env,
    fetchImpl,
    warn,
    now: resolveDate(now),
  });

  const results = searchApps(searchTerm, apps);

  if (results.length === 0) {
    warn(`No apps found matching "${searchTerm}".`);
    return { exitCode: 1 };
  }

  for (const app of results) {
    output.write(`${app.appid}\t${app.name}\n`);
  }

  return { exitCode: 0 };
}

async function resolveApp({
  query,
  apiKey,
  refreshAppList,
  env,
  fetchImpl,
  error,
  now,
}) {
  const warn = createLineWriter(error);

  if (query.kind === 'name') {
    if (!apiKey) {
      throw new Error('Text queries require STEAM_API_KEY or --api-key');
    }

    const apps = await loadAppList({
      apiKey,
      refresh: refreshAppList,
      env,
      fetchImpl,
      warn,
      now: resolveDate(now),
    });

    return resolveAppByName(query.name, apps);
  }

  const appid = query.appid;
  const apps = await maybeLoadAppsForAppId({
    apiKey,
    refreshAppList,
    env,
    fetchImpl,
    warn,
    now,
  });

  const match = apps.find((candidate) => candidate.appid === appid) ?? null;

  return {
    appid,
    name: match?.name ?? '',
  };
}

async function maybeLoadAppsForAppId({
  apiKey,
  refreshAppList,
  env,
  fetchImpl,
  warn,
  now,
}) {
  const cachePath = defaultCachePath({ env });
  let cached = null;

  try {
    cached = await readAppListCache({ cachePath });
  } catch (cacheError) {
    warn(`Warning: failed to read Steam app cache at ${cachePath}: ${cacheError.message}`);
  }

  if (cached && !refreshAppList) {
    return cached.apps;
  }

  if (!apiKey) {
    return cached?.apps ?? [];
  }

  return loadAppList({
    apiKey,
    refresh: refreshAppList || !cached,
    env,
    fetchImpl,
    warn,
    now: resolveDate(now),
  });
}

async function loadObservedHistoryContext({ query, apiKey, options, env, fetchImpl, error, now }) {
  const { app, points } = await loadHistorySource({
    query,
    apiKey,
    options,
    env,
    fetchImpl,
    error,
    now,
  });
  const historyPoints = selectObservedHistoryPoints(points, options.months);

  return {
    app,
    historyPoints,
    warnings: buildHistoryWarnings(historyPoints),
  };
}

async function loadHistorySource({ query, apiKey, options, env, fetchImpl, error, now }) {
  const app = await resolveApp({
    query,
    apiKey,
    refreshAppList: options.refreshAppList,
    env,
    fetchImpl,
    error,
    now,
  });
  const history = await fetchSteamChartsHistory({
    appid: app.appid,
    env,
    fetchImpl,
  });

  return {
    app: buildResolvedApp(app, history.app.name),
    points: history.points,
  };
}

function buildResolvedApp(app, fallbackName = '') {
  return {
    appid: app.appid,
    name: app.name || fallbackName || '',
  };
}

function selectObservedHistoryPoints(points, months) {
  return points.slice(-(months + 1));
}

function buildHistoryWarnings(historyPoints) {
  return historyPoints.length < 3 ? [INSUFFICIENT_HISTORY_WARNING] : [];
}

function appendWarning(warnings, warning) {
  return warning ? [...warnings, warning] : warnings;
}

function formatJsonOrText(format, payloadObject, renderText) {
  return format === 'json' ? toPrettyJson(payloadObject) : renderText();
}

function toPrettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function createLineWriter(stream) {
  return (message) => {
    stream.write(`${message}\n`);
  };
}

async function resolveApiKey(options, env) {
  if (options.apiKey) {
    return options.apiKey;
  }

  if ('STEAM_API_KEY' in env) {
    return env.STEAM_API_KEY || null;
  }

  const dotenvKey = await readDotenvKey('STEAM_API_KEY');
  if (dotenvKey) {
    return dotenvKey;
  }

  return null;
}

async function emitPayload({ payload, outputPath, output }) {
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${payload}\n`, 'utf8');
    return;
  }

  output.write(`${payload}\n`);
}

async function readDotenvKey(key) {
  try {
    const raw = await readFile(resolve('.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIndex = trimmed.indexOf('=');
      const k = trimmed.slice(0, eqIndex).trim();
      if (k !== key) continue;
      let v = trimmed.slice(eqIndex + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v || null;
    }
  } catch {
    // no .env file — that's fine
  }
  return null;
}

function resolveDate(now) {
  const value = typeof now === 'function' ? now() : now;
  return value instanceof Date ? value : new Date(value);
}
