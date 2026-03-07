import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { fetchAppListPage } from './steam-api.js';

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function defaultCachePath({ env = process.env } = {}) {
  const baseDir = env.STEAM_CHARTS_CACHE_DIR || join(homedir(), '.steam-charts');
  return join(baseDir, 'app-list.json');
}

export function isCacheFresh(cache, { now = new Date(), ttlMs = CACHE_TTL_MS } = {}) {
  const fetchedAt = Date.parse(cache?.fetchedAt ?? '');
  const currentTime = resolveDate(now).getTime();

  if (!Number.isFinite(fetchedAt)) {
    return false;
  }

  return currentTime - fetchedAt < ttlMs;
}

export async function readAppListCache({ cachePath = null, env = process.env } = {}) {
  cachePath = cachePath || defaultCachePath({ env });

  try {
    const raw = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);

    return {
      fetchedAt: parsed.fetchedAt,
      apps: sanitizeApps(parsed.apps),
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function writeAppListCache(apps, {
  cachePath = null,
  now = new Date(),
  env = process.env,
} = {}) {
  cachePath = cachePath || defaultCachePath({ env });

  const payload = {
    fetchedAt: resolveDate(now).toISOString(),
    apps: sanitizeApps(apps),
  };

  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');

  return payload;
}

export async function loadAppList({
  apiKey,
  cachePath = null,
  refresh = false,
  now = new Date(),
  env = process.env,
  fetchImpl = global.fetch,
  fetchPage = fetchAppListPage,
  warn = () => {},
}) {
  cachePath = cachePath || defaultCachePath({ env });
  const cache = await readAppListCache({ cachePath, env });
  const currentTime = resolveDate(now);

  if (cache && !refresh && isCacheFresh(cache, { now: currentTime })) {
    return cache.apps;
  }

  try {
    const apps = await fetchEntireAppList({
      apiKey,
      env,
      fetchImpl,
      fetchPage,
    });

    await writeAppListCache(apps, {
      cachePath,
      now: currentTime,
      env,
    });

    return apps;
  } catch (error) {
    if (cache && cache.apps.length > 0) {
      warn(`Warning: Steam app list refresh failed; using stale cache from ${cache.fetchedAt}. ${error.message}`);
      return cache.apps;
    }

    throw error;
  }
}

async function fetchEntireAppList({
  apiKey,
  env,
  fetchImpl,
  fetchPage,
}) {
  const appsById = new Map();
  let lastAppId = null;
  let hasMore = true;
  let pages = 0;

  while (hasMore) {
    pages += 1;
    if (pages > 1000) {
      throw new Error('Steam app list pagination exceeded 1000 pages');
    }

    const page = await fetchPage({
      apiKey,
      lastAppId,
      env,
      fetchImpl,
    });

    for (const app of sanitizeApps(page.apps)) {
      appsById.set(app.appid, app);
    }

    if (!page.hasMore || page.apps.length === 0) {
      break;
    }

    if (page.lastAppId === null || page.lastAppId === lastAppId) {
      break;
    }

    lastAppId = page.lastAppId;
    hasMore = page.hasMore;
  }

  return [...appsById.values()];
}

function sanitizeApps(apps) {
  if (!Array.isArray(apps)) {
    return [];
  }

  return apps
    .filter((app) => Number.isSafeInteger(app?.appid) && typeof app?.name === 'string')
    .map((app) => ({
      appid: app.appid,
      name: app.name.trim(),
    }))
    .filter((app) => app.name.length > 0);
}

function resolveDate(now) {
  return now instanceof Date ? now : new Date(now);
}
