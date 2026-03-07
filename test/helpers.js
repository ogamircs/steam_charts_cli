import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';

const BIN_PATH = new URL('../bin/steam-charts.js', import.meta.url);

export function runCli(args = [], { env = {}, input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN_PATH.pathname, ...args], {
      stdio: 'pipe',
      env: {
        ...process.env,
        ...env,
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    if (input.length > 0) {
      child.stdin.write(input);
    }

    child.stdin.end();
  });
}

export function createOutputCollector() {
  const chunks = [];

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk).toString());
      callback();
    },
  });

  return {
    stream,
    read() {
      return chunks.join('');
    },
  };
}

export async function withMockServer(handler, callback) {
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
    });

    try {
      await handler(req, res, requests);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        error: error.message,
      }));
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    return await callback({
      origin,
      requests,
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

export function readFixture(name) {
  const fixtureUrl = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(fixtureUrl), 'utf8');
}
