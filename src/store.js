const STORE_URL_TEMPLATE = 'https://steamdb.info/app/{appid}/graphs/';

import { loadHtmlPage } from './html-page.js';

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

export function parseSteamDbStoreSnapshot(html) {
  const name = extractAppName(html, {
    headlinePattern: /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
    titleSuffix: /\s+Steam Charts and Stats\s*-\s*SteamDB\s*$/i,
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
    `Daily active users rank: #${snapshot.daily_active_users_rank}`,
    `Top sellers rank: #${snapshot.top_sellers_rank}`,
    `Wishlist activity rank: #${snapshot.wishlist_activity_rank}`,
    `Followers: ${formatInteger(snapshot.followers)}`,
    `Reviews: ${formatInteger(snapshot.reviews)}`,
    `Captured at: ${snapshot.captured_at}`,
    `Source: ${snapshot.source}`,
  ].join('\n');
}

function buildTemplateUrl(template, appid) {
  return template.replaceAll('{appid}', String(appid));
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

function extractAppName(html, { headlinePattern, titleSuffix }) {
  const headlineMatch = html.match(headlinePattern);
  if (headlineMatch) {
    return decodeHtmlEntities(headlineMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim()).replace(titleSuffix, '').trim();
  }

  return '';
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
