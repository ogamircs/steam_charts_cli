export function resolveAppByName(query, apps) {
  const normalizedQuery = normalize(query);
  const exactMatches = apps.filter((app) => normalize(app.name) === normalizedQuery);

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  const candidates = exactMatches.length > 1
    ? exactMatches
    : rankCandidates(normalizedQuery, apps);

  const lines = [
    `No exact Steam app match found for "${query}".`,
  ];

  if (candidates.length > 0) {
    lines.push('Candidates:');
    for (const candidate of candidates.slice(0, 5)) {
      lines.push(`- ${candidate.name} (${candidate.appid})`);
    }
  }

  throw new Error(lines.join('\n'));
}

export function searchApps(query, apps, { limit = 25 } = {}) {
  const normalizedQuery = normalize(query);
  return rankCandidates(normalizedQuery, apps).slice(0, limit);
}

function rankCandidates(normalizedQuery, apps) {
  return apps
    .filter((app) => normalize(app.name).includes(normalizedQuery))
    .sort((left, right) => {
      const leftName = normalize(left.name);
      const rightName = normalize(right.name);
      const leftStarts = leftName.startsWith(normalizedQuery) ? 0 : 1;
      const rightStarts = rightName.startsWith(normalizedQuery) ? 0 : 1;

      if (leftStarts !== rightStarts) {
        return leftStarts - rightStarts;
      }

      if (leftName.length !== rightName.length) {
        return leftName.length - rightName.length;
      }

      return leftName.localeCompare(rightName);
    });
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}
