export function parseQuery(rawQuery) {
  const normalized = String(rawQuery ?? '').trim();

  if (!normalized) {
    throw new Error('steam-charts requires a game name or app id');
  }

  if (/^\d+$/.test(normalized)) {
    const appid = Number.parseInt(normalized, 10);

    if (!Number.isSafeInteger(appid) || appid <= 0) {
      throw new Error(`Invalid Steam app id: ${normalized}`);
    }

    return {
      kind: 'appid',
      appid,
      raw: normalized,
    };
  }

  return {
    kind: 'name',
    name: normalized,
    raw: normalized,
  };
}
