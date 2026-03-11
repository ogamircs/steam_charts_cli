import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHtmlHeaders, loadHtmlPage } from '../src/html-page.js';

test('buildHtmlHeaders returns browser-like headers for html scrapes', () => {
  const headers = buildHtmlHeaders();

  assert.match(headers['user-agent'], /Mozilla\/5\.0/);
  assert.match(headers.accept, /text\/html/);
  assert.equal(headers.connection, 'close');
});

test('loadHtmlPage returns fetch text when fetch succeeds quickly', async () => {
  const html = await loadHtmlPage({
    url: 'https://example.test/page',
    label: 'Example page',
    preferCurl: false,
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.connection, 'close');
      return {
        ok: true,
        async text() {
          return '<html>ok</html>';
        },
      };
    },
  });

  assert.equal(html, '<html>ok</html>');
});

test('loadHtmlPage falls back to curl after a fetch timeout', async () => {
  const html = await loadHtmlPage({
    url: 'https://example.test/page',
    label: 'Example page',
    preferCurl: false,
    timeoutMs: 1,
    fetchImpl: () => new Promise(() => {}),
    curlRunner: async (file, args) => {
      assert.equal(file, 'curl');
      assert.ok(args.includes('https://example.test/page'));
      return {
        stdout: '<html>via curl</html>',
      };
    },
  });

  assert.equal(html, '<html>via curl</html>');
});

test('loadHtmlPage prefers curl when requested', async () => {
  const html = await loadHtmlPage({
    url: 'https://example.test/page',
    label: 'Example page',
    preferCurl: true,
    curlRunner: async () => ({
      stdout: '<html>curl first</html>',
    }),
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    },
  });

  assert.equal(html, '<html>curl first</html>');
});

test('loadHtmlPage normalizes curl failures into short upstream errors', async () => {
  await assert.rejects(() => loadHtmlPage({
    url: 'https://example.com/page',
    label: 'Example page',
    preferCurl: true,
    curlRunner: async () => {
      const error = new Error('curl failed');
      error.stderr = 'curl: (56) The requested URL returned error: 522';
      throw error;
    },
  }), /Example page request failed: The requested URL returned error: 522/);
});

test('loadHtmlPage retries curl on transient upstream errors before succeeding', async () => {
  let attempts = 0;

  const html = await loadHtmlPage({
    url: 'https://example.com/page',
    label: 'Example page',
    preferCurl: true,
    curlRunner: async () => {
      attempts += 1;

      if (attempts === 1) {
        const error = new Error('curl failed');
        error.stderr = 'curl: (22) The requested URL returned error: 521';
        throw error;
      }

      return {
        stdout: '<html>retried</html>',
      };
    },
  });

  assert.equal(attempts, 2);
  assert.equal(html, '<html>retried</html>');
});
