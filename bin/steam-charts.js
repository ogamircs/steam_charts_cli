#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { formatHelp, parseArgs } from '../src/cli.js';
import { runSteamCharts } from '../src/run.js';

const PACKAGE_JSON_URL = new URL('../package.json', import.meta.url);

const exitCode = await main();
process.exitCode = exitCode;

async function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));

    if (parsed.mode === 'help') {
      process.stdout.write(`${formatHelp()}\n`);
      return 0;
    }

    if (parsed.mode === 'version') {
      process.stdout.write(`${readPackageVersion()}\n`);
      return 0;
    }

    const result = await runSteamCharts({
      output: process.stdout,
      error: process.stderr,
      options: parsed.options,
    });

    return result.exitCode;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_URL, 'utf8'));
  return packageJson.version;
}
