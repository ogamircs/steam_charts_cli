import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function loadHtmlPage({
  url,
  label,
  fetchImpl = global.fetch,
  curlRunner = execFileAsync,
  preferCurl = null,
  timeoutMs = 5000,
}) {
  const useCurlFirst = preferCurl ?? shouldPreferCurl(url);

  if (useCurlFirst) {
    try {
      return await loadViaCurl({
        url,
        curlRunner,
      });
    } catch (curlError) {
      if (!shouldFallbackToFetch(curlError)) {
        throw new Error(`${label} request failed: ${curlError.message}`);
      }
    }
  }

  try {
    return await loadViaFetch({
      url,
      label,
      fetchImpl,
      timeoutMs,
    });
  } catch (fetchError) {
    if (!shouldFallbackToCurl(fetchError)) {
      throw fetchError;
    }

    try {
      return await loadViaCurl({
        url,
        curlRunner,
      });
    } catch (curlError) {
      throw new Error(`${label} request failed after fetch timeout and curl fallback: ${curlError.message}`);
    }
  }
}

export function buildHtmlHeaders() {
  return {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    connection: 'close',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  };
}

async function loadViaFetch({
  url,
  label,
  fetchImpl,
  timeoutMs,
}) {
  const controller = new AbortController();
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(url, {
        headers: buildHtmlHeaders(),
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);

    if (!response.ok) {
      throw new Error(`${label} request failed: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadViaCurl({ url, curlRunner }) {
  try {
    const { stdout } = await curlRunner('curl', [
      '-L',
      '--compressed',
      '--silent',
      '--show-error',
      '--fail',
      '-A',
      buildHtmlHeaders()['user-agent'],
      '-H',
      `Accept: ${buildHtmlHeaders().accept}`,
      '-H',
      `Accept-Language: ${buildHtmlHeaders()['accept-language']}`,
      String(url),
    ]);

    return stdout;
  } catch (error) {
    throw new Error(normalizeCurlError(error));
  }
}

function shouldFallbackToCurl(error) {
  if (error?.name === 'AbortError') {
    return true;
  }

  return typeof error?.message === 'string' && error.message.includes('timed out');
}

function shouldFallbackToFetch(error) {
  return error?.code === 'ENOENT';
}

function shouldPreferCurl(url) {
  try {
    const parsed = new URL(String(url));
    return !['example.test', 'localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return true;
  }
}

function normalizeCurlError(error) {
  const stderr = String(error?.stderr ?? '').trim();
  if (stderr.length > 0) {
    const lastLine = stderr.split('\n').at(-1) ?? stderr;
    return lastLine.replace(/^curl:\s+\(\d+\)\s*/, '');
  }

  return error?.message ?? 'curl request failed';
}
