const VALID_FORMATS = new Set(['csv', 'json']);

export const DEFAULT_OPTIONS = {
  query: null,
  format: 'csv',
  outputPath: null,
  apiKey: null,
  refreshAppList: false,
  search: false,
};

export function formatHelp() {
  return `Usage: steam-charts <query> [options]

Fetch current Steam player counts for one app and emit a single CSV or JSON record.

Arguments:
  <query>                 Steam app id (numeric) or exact game name

Options:
  --search                Search for apps by keyword instead of fetching player counts
  --output <path>         Write the formatted record to a file instead of stdout
  --api-key <key>         Steam Web API key override for name lookups
  --refresh-app-list      Refresh the cached Steam app list before a name lookup
  --format <csv|json>     Output format (default: csv)
  -h, --help              Show help
  -v, --version           Show version

Environment:
  STEAM_API_KEY           Default API key for name lookups

Notes:
  - Numeric queries do not require an API key.
  - Text queries require STEAM_API_KEY or --api-key.
  - App list cache path defaults to ~/.steam-charts/app-list.json`;
}

export function parseArgs(argv) {
  const options = {
    ...DEFAULT_OPTIONS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '-h':
      case '--help':
        return { mode: 'help' };
      case '-v':
      case '--version':
        return { mode: 'version' };
      case '--format':
        options.format = parseFormat(readOptionValue(argv, ++index, 'format'));
        break;
      case '--output':
        options.outputPath = readOptionValue(argv, ++index, 'output');
        break;
      case '--api-key':
        options.apiKey = readOptionValue(argv, ++index, 'api-key');
        break;
      case '--refresh-app-list':
        options.refreshAppList = true;
        break;
      case '--search':
        options.search = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }

        if (options.query !== null) {
          throw new Error('Only one game query may be provided');
        }

        options.query = arg;
    }
  }

  if (options.query === null) {
    throw new Error('steam-charts requires a game name or app id');
  }

  return { mode: 'run', options };
}

function parseFormat(rawValue) {
  if (!VALID_FORMATS.has(rawValue)) {
    throw new Error('format must be one of: csv, json');
  }

  return rawValue;
}

function readOptionValue(argv, index, name) {
  const value = argv[index];

  if (value === undefined) {
    throw new Error(`Missing value for --${name}`);
  }

  return value;
}
