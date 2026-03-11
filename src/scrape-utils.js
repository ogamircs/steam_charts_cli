export function buildTemplateUrl(template, appid) {
  return template.replaceAll('{appid}', String(appid));
}

export function extractAppName(html, {
  headlinePattern,
  titleSuffix,
  normalizeText,
}) {
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

export function formatInteger(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

export function decodeHtmlEntities(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ');
}
