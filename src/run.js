import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { defaultCachePath, loadAppList, readAppListCache } from './app-cache.js';
import { serializeRecord } from './output.js';
import { parseQuery } from './query.js';
import { resolveAppByName, searchApps } from './resolve-app.js';
import { fetchCurrentPlayers } from './steam-api.js';

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

  if (options.search) {
    return runSearch({ query, apiKey, options, env, fetchImpl, output, error, now });
  }

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

  if (options.outputPath) {
    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${payload}\n`, 'utf8');
  } else {
    output.write(`${payload}\n`);
  }

  return {
    exitCode: 0,
    outputPath: options.outputPath,
    record,
    text: payload,
  };
}

async function runSearch({ query, apiKey, options, env, fetchImpl, output, error, now }) {
  if (!apiKey) {
    throw new Error('Search requires STEAM_API_KEY or --api-key');
  }

  const searchTerm = query.kind === 'name' ? query.name : String(query.appid);

  const apps = await loadAppList({
    apiKey,
    refresh: options.refreshAppList,
    env,
    fetchImpl,
    warn: (message) => error.write(`${message}\n`),
    now: resolveDate(now),
  });

  const results = searchApps(searchTerm, apps);

  if (results.length === 0) {
    error.write(`No apps found matching "${searchTerm}".\n`);
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
  if (query.kind === 'name') {
    if (!apiKey) {
      throw new Error('Text queries require STEAM_API_KEY or --api-key');
    }

    const apps = await loadAppList({
      apiKey,
      refresh: refreshAppList,
      env,
      fetchImpl,
      warn: (message) => error.write(`${message}\n`),
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
    error,
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
  error,
  now,
}) {
  const cachePath = defaultCachePath({ env });
  let cached = null;

  try {
    cached = await readAppListCache({ cachePath });
  } catch (cacheError) {
    error.write(`Warning: failed to read Steam app cache at ${cachePath}: ${cacheError.message}\n`);
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
    warn: (message) => error.write(`${message}\n`),
    now: resolveDate(now),
  });
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
