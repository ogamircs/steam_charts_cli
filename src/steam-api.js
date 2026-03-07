const CURRENT_PLAYERS_URL = 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/';
const APP_LIST_URL = 'https://api.steampowered.com/IStoreService/GetAppList/v1/';

export async function fetchCurrentPlayers({
  appid,
  env = process.env,
  fetchImpl = global.fetch,
}) {
  const url = new URL(env.STEAM_CHARTS_CURRENT_PLAYERS_URL || CURRENT_PLAYERS_URL);
  url.searchParams.set('appid', String(appid));

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Steam current players request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await readJson(response);
  const playerCount = payload?.response?.player_count;

  if (!Number.isFinite(playerCount)) {
    throw new Error(`Steam current players response did not contain a valid player count for app ${appid}`);
  }

  return playerCount;
}

export async function fetchAppListPage({
  apiKey,
  lastAppId = null,
  maxResults = 50000,
  env = process.env,
  fetchImpl = global.fetch,
}) {
  const url = new URL(env.STEAM_CHARTS_APP_LIST_URL || APP_LIST_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('max_results', String(maxResults));
  url.searchParams.set('include_games', 'true');
  url.searchParams.set('include_dlc', 'false');
  url.searchParams.set('include_software', 'false');
  url.searchParams.set('include_videos', 'false');
  url.searchParams.set('include_hardware', 'false');

  if (lastAppId !== null) {
    url.searchParams.set('last_appid', String(lastAppId));
  }

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Steam app list request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await readJson(response);
  const responseBody = payload?.response ?? payload ?? {};
  const apps = Array.isArray(responseBody.apps) ? responseBody.apps : [];
  const sanitizedApps = apps
    .filter((app) => Number.isSafeInteger(app?.appid) && typeof app?.name === 'string' && app.name.trim().length > 0)
    .map((app) => ({
      appid: app.appid,
      name: app.name.trim(),
    }));

  const lastSeenAppId = Number.isSafeInteger(responseBody.last_appid)
    ? responseBody.last_appid
    : sanitizedApps.at(-1)?.appid ?? null;

  return {
    apps: sanitizedApps,
    hasMore: Boolean(responseBody.have_more_results) || sanitizedApps.length === maxResults,
    lastAppId: lastSeenAppId,
  };
}

async function readJson(response) {
  if (typeof response.json === 'function') {
    return response.json();
  }

  const text = await response.text();
  return JSON.parse(text);
}
