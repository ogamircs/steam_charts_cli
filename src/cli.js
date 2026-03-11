const ROOT_FORMATS = new Set(['csv', 'json']);
const TEXT_FORMATS = new Set(['text', 'json']);
const DEFAULT_MONTHS = 12;
const DEFAULT_FORECAST_DAYS = 30;

const COMMAND_CONFIG = {
  current: {
    defaultFormat: 'csv',
    supportsFormatOption: true,
    validateFormat(format) {
      if (!ROOT_FORMATS.has(format)) {
        throw new Error('format must be one of: csv, json');
      }
    },
  },
  history: {
    defaultFormat: 'json',
    supportsFormatOption: true,
    validateFormat(format) {
      if (format !== 'json') {
        throw new Error('history only supports --format json');
      }
    },
  },
  chart: {
    defaultFormat: 'text',
    supportsFormatOption: false,
    validateOptions({ outputProvided }) {
      if (outputProvided) {
        throw new Error('chart does not support --output');
      }
    },
  },
  store: createTextCommandConfig('store'),
  highest: createTextCommandConfig('highest'),
  lowest: createTextCommandConfig('lowest'),
};

const SUBCOMMANDS = new Set(Object.keys(COMMAND_CONFIG).filter((command) => command !== 'current'));

export const DEFAULT_OPTIONS = {
  command: 'current',
  query: null,
  format: 'csv',
  outputPath: null,
  apiKey: null,
  refreshAppList: false,
  search: false,
  months: DEFAULT_MONTHS,
  forecastDays: DEFAULT_FORECAST_DAYS,
};

export function formatHelp() {
  return `Usage:
  steam-charts <query> [options]
  steam-charts history <query> [--months <n>] [--forecast-days <n>] [--output <path>]
  steam-charts chart <query> [--months <n>] [--forecast-days <n>]
  steam-charts store <query> [--format <text|json>] [--output <path>]
  steam-charts highest <query> [--format <text|json>] [--output <path>]
  steam-charts lowest <query> [--format <text|json>] [--output <path>]

Commands:
  <query>                 Fetch current Steam player counts as CSV or JSON
  history <query>         Emit observed monthly history plus forecast as JSON
  chart <query>           Render terminal charts for observed and forecast trends
  store <query>           Fetch a SteamDB-style store metrics snapshot
  highest <query>         Show all-time highest observed average and peak values
  lowest <query>          Show all-time lowest observed average and peak values

Arguments:
  <query>                 Steam app id (numeric) or exact game name

Options:
  --search                Search for apps by keyword instead of fetching player counts
  --output <path>         Write the formatted record to a file instead of stdout
  --api-key <key>         Steam Web API key override for name lookups
  --refresh-app-list      Refresh the cached Steam app list before a name lookup
  --format <...>          Command-scoped output format
  --months <n>            Number of calendar months before "Last 30 Days" (default: 12)
  --forecast-days <n>     Forecast horizon for history/chart (default: 30)
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
  let index = 0;
  let command = 'current';

  if (argv[0] && SUBCOMMANDS.has(argv[0])) {
    command = argv[0];
    index = 1;
  }

  const options = {
    ...DEFAULT_OPTIONS,
    command,
    format: defaultFormat(command),
  };
  let formatProvided = false;
  let outputProvided = false;
  let monthsProvided = false;
  let forecastDaysProvided = false;

  for (; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '-h':
      case '--help':
        return { mode: 'help' };
      case '-v':
      case '--version':
        return { mode: 'version' };
      case '--format':
        if (!getCommandConfig(command).supportsFormatOption) {
          throw new Error(`${command} does not support --format`);
        }
        options.format = readOptionValue(argv, ++index, 'format');
        formatProvided = true;
        break;
      case '--output':
        options.outputPath = readOptionValue(argv, ++index, 'output');
        outputProvided = true;
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
      case '--months':
        options.months = parsePositiveInteger(readOptionValue(argv, ++index, 'months'), 'months');
        monthsProvided = true;
        break;
      case '--forecast-days':
        options.forecastDays = parsePositiveInteger(readOptionValue(argv, ++index, 'forecast-days'), 'forecast-days');
        forecastDaysProvided = true;
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

  validateCommandOptions(options, {
    formatProvided,
    outputProvided,
    monthsProvided,
    forecastDaysProvided,
  });

  return { mode: 'run', options };
}

function defaultFormat(command) {
  return getCommandConfig(command).defaultFormat;
}

function validateCommandOptions(options, {
  formatProvided,
  outputProvided,
  monthsProvided,
  forecastDaysProvided,
}) {
  const commandConfig = getCommandConfig(options.command);

  commandConfig.validateFormat?.(options.format);
  commandConfig.validateOptions?.({ outputProvided });

  if (options.search && options.command !== 'current') {
    throw new Error('--search is only supported for the root player lookup command');
  }

  if ((monthsProvided || forecastDaysProvided) && !['history', 'chart'].includes(options.command)) {
    throw new Error('--months and --forecast-days are only supported for history and chart');
  }
}

function getCommandConfig(command) {
  const commandConfig = COMMAND_CONFIG[command];

  if (!commandConfig) {
    throw new Error(`Unsupported command: ${command}`);
  }

  return commandConfig;
}

function createTextCommandConfig(command) {
  return {
    defaultFormat: 'text',
    supportsFormatOption: true,
    validateFormat(format) {
      if (!TEXT_FORMATS.has(format)) {
        throw new Error(`${command} format must be one of: text, json`);
      }
    },
  };
}

function readOptionValue(argv, index, name) {
  const value = argv[index];

  if (value === undefined) {
    throw new Error(`Missing value for --${name}`);
  }

  return value;
}

function parsePositiveInteger(rawValue, name) {
  const normalized = String(rawValue).trim();

  if (!/^\d+$/.test(normalized)) {
    throw new Error(`--${name} must be a positive integer`);
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }

  return parsed;
}
