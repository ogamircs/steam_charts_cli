const STORE_URL_TEMPLATE = 'https://steamdb.info/app/{appid}/graphs/';
const OFFICIAL_APPDETAILS_URL_TEMPLATE = 'https://store.steampowered.com/api/appdetails?appids={appid}&filters=basic,recommendations';
const OFFICIAL_REVIEWS_URL_TEMPLATE = 'https://store.steampowered.com/appreviews/{appid}?json=1&language=all&purchase_type=steam&num_per_page=0';
export const STORE_FALLBACK_WARNING = 'SteamDB store data is unavailable from this environment; using partial official Steam store data.';
export const STORE_PARTIAL_SOURCE = 'steam-store-partial';

import { loadHtmlPage } from './html-page.js';
import { buildTemplateUrl, decodeHtmlEntities, extractAppName, formatInteger } from './scrape-utils.js';

export async function fetchSteamDbStoreSnapshot({
  appid,
  env = process.env,
  fetchImpl = global.fetch,
  curlRunner,
  preferCurl,
  timeoutMs,
}) {
  const url = buildTemplateUrl(env.STEAM_CHARTS_STORE_URL_TEMPLATE || STORE_URL_TEMPLATE, appid);
  const html = await loadHtmlPage({
    url,
    label: 'SteamDB store',
    fetchImpl,
    curlRunner,
    preferCurl,
    timeoutMs,
  });
  return parseSteamDbStoreSnapshot(html);
}

export async function fetchStoreSnapshot({
  appid,
  env = process.env,
  fetchImpl = global.fetch,
  curlRunner,
  preferCurl,
  timeoutMs,
}) {
  try {
    const snapshot = await fetchSteamDbStoreSnapshot({
      appid,
      env,
      fetchImpl,
      curlRunner,
      preferCurl,
      timeoutMs,
    });

    return {
      ...snapshot,
      source: 'steamdb',
      warning: null,
    };
  } catch (error) {
    try {
      const snapshot = await fetchOfficialSteamStoreSnapshot({
        appid,
        env,
        fetchImpl,
      });

      return {
        ...snapshot,
        source: STORE_PARTIAL_SOURCE,
        warning: STORE_FALLBACK_WARNING,
      };
    } catch (fallbackError) {
      throw new Error(`${error.message}; official Steam fallback also failed: ${fallbackError.message}`);
    }
  }
}

export function parseSteamDbStoreSnapshot(html) {
  const name = extractAppName(html, {
    headlinePattern: /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
    titleSuffix: /\s+Steam Charts and Stats\s*-\s*SteamDB\s*$/i,
    normalizeText: normalizeAppName,
  });
  const text = normalizeText(html);

  return {
    name,
    daily_active_users_rank: readNumber(text, /#([\d,]+)\s+in daily active users/i, 'daily active users rank'),
    top_sellers_rank: readNumber(text, /#([\d,]+)\s+in top sellers/i, 'top sellers rank'),
    wishlist_activity_rank: readNumber(text, /#([\d,]+)\s+in wishlist activity/i, 'wishlist activity rank'),
    followers: readNumber(text, /([\d,]+)\s+followers/i, 'followers'),
    reviews: readNumber(text, /([\d,]+)\s+reviews/i, 'reviews'),
  };
}

export function formatStoreSnapshotText({ app, snapshot }) {
  return [
    `${app.name || 'Unknown App'} (${app.appid})`,
    `Daily active users rank: ${formatOptionalRank(snapshot.daily_active_users_rank)}`,
    `Top sellers rank: ${formatOptionalRank(snapshot.top_sellers_rank)}`,
    `Wishlist activity rank: ${formatOptionalRank(snapshot.wishlist_activity_rank)}`,
    `Followers: ${formatOptionalInteger(snapshot.followers)}`,
    `Reviews: ${formatOptionalInteger(snapshot.reviews)}`,
    `Captured at: ${snapshot.captured_at}`,
    `Source: ${snapshot.source}`,
  ].join('\n');
}

async function fetchOfficialSteamStoreSnapshot({
  appid,
  env = process.env,
  fetchImpl = global.fetch,
}) {
  const appdetailsUrl = buildTemplateUrl(
    env.STEAM_CHARTS_OFFICIAL_STORE_APPDETAILS_URL_TEMPLATE || OFFICIAL_APPDETAILS_URL_TEMPLATE,
    appid,
  );
  const response = await fetchImpl(appdetailsUrl);
  if (!response.ok) {
    throw new Error(`Steam official store appdetails request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await readJson(response);
  const record = payload?.[String(appid)] ?? payload?.[appid];
  const data = record?.data ?? {};
  const reviewsFromRecommendations = data?.recommendations?.total;
  const reviews = Number.isFinite(reviewsFromRecommendations)
    ? reviewsFromRecommendations
    : await fetchOfficialSteamReviewCount({ appid, env, fetchImpl });

  if (!Number.isFinite(reviews)) {
    throw new Error(`Steam official store data did not contain a usable review count for app ${appid}`);
  }

  return {
    name: typeof data?.name === 'string' ? data.name.trim() : '',
    daily_active_users_rank: null,
    top_sellers_rank: null,
    wishlist_activity_rank: null,
    followers: null,
    reviews,
  };
}

async function fetchOfficialSteamReviewCount({
  appid,
  env = process.env,
  fetchImpl = global.fetch,
}) {
  const reviewsUrl = buildTemplateUrl(
    env.STEAM_CHARTS_OFFICIAL_STORE_REVIEWS_URL_TEMPLATE || OFFICIAL_REVIEWS_URL_TEMPLATE,
    appid,
  );
  const response = await fetchImpl(reviewsUrl);
  if (!response.ok) {
    throw new Error(`Steam official store reviews request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await readJson(response);
  const totalReviews = payload?.query_summary?.total_reviews;

  if (!Number.isFinite(totalReviews)) {
    throw new Error(`Steam official store reviews response did not contain a usable review count for app ${appid}`);
  }

  return totalReviews;
}

function readNumber(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`SteamDB store page did not contain ${label}`);
  }

  return Number.parseInt(match[1].replaceAll(',', ''), 10);
}

function normalizeText(html) {
  return decodeHtmlEntities(
    String(html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|section|p|li|tr|h1|h2|h3)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function normalizeAppName(value) {
  return decodeHtmlEntities(
    String(value ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function formatOptionalRank(value) {
  return Number.isFinite(value) ? `#${value}` : 'Unavailable';
}

function formatOptionalInteger(value) {
  return Number.isFinite(value) ? formatInteger(value) : 'Unavailable';
}

async function readJson(response) {
  if (typeof response.json === 'function') {
    return response.json();
  }

  const text = await response.text();
  return JSON.parse(text);
}
