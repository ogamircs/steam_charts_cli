import { readFile } from 'node:fs/promises';

export const PROPHET_SOURCE = 'prophet-wasm';
export const HOLT_SOURCE = 'holt-linear-smoothing';
export const PROPHET_FALLBACK_WARNING = 'Prophet forecast failed; falling back to Holt linear smoothing.';

const DAY_SECONDS = 24 * 60 * 60;
const SYNTHETIC_STEP_DAYS = 30;
const MANUAL_DISABLED_SEASONALITY = { type: 'manual', enabled: false };
const defaultImportModule = (specifier) => import(specifier);

let prophetRuntimePromise = null;

export async function forecastObservedPoints({
  observedPoints,
  forecastDays,
  now = new Date(),
  preferProphet = true,
  initProphet,
  ProphetClass,
  prophetOptimizer,
} = {}) {
  if (!Number.isInteger(forecastDays) || forecastDays <= 0) {
    return {
      points: [],
      source: preferProphet ? PROPHET_SOURCE : HOLT_SOURCE,
      warning: null,
    };
  }

  if (!Array.isArray(observedPoints) || observedPoints.length < 3) {
    return {
      points: [],
      source: preferProphet ? PROPHET_SOURCE : HOLT_SOURCE,
      warning: null,
    };
  }

  if (!preferProphet) {
    return {
      points: buildHoltForecastPoints({ observedPoints, forecastDays, now }),
      source: HOLT_SOURCE,
      warning: null,
    };
  }

  try {
    const runtime = await resolveProphetRuntime({
      initProphet,
      ProphetClass,
      prophetOptimizer,
    });

    return {
      points: buildProphetForecastPoints({
        observedPoints,
        forecastDays,
        now,
        ProphetClass: runtime.ProphetClass,
        prophetOptimizer: runtime.prophetOptimizer,
      }),
      source: PROPHET_SOURCE,
      warning: null,
    };
  } catch {
    return {
      points: buildHoltForecastPoints({ observedPoints, forecastDays, now }),
      source: HOLT_SOURCE,
      warning: PROPHET_FALLBACK_WARNING,
    };
  }
}

export function buildSyntheticTimeline({
  observedPoints,
  now = new Date(),
}) {
  const generatedAt = normalizeUtcDate(now);
  const totalPoints = observedPoints.length;

  return observedPoints.map((point, index) => {
    const daysBack = (totalPoints - index - 1) * SYNTHETIC_STEP_DAYS;
    const date = addUtcDays(generatedAt, -daysBack);

    return {
      ...point,
      ds: formatUtcDate(date),
      timestampSeconds: Math.floor(date.getTime() / 1000),
    };
  });
}

export function resetProphetRuntimeForTests() {
  prophetRuntimePromise = null;
}

async function resolveProphetRuntime({
  initProphet,
  ProphetClass,
  prophetOptimizer,
}) {
  if (initProphet || ProphetClass || prophetOptimizer) {
    if (!initProphet || !ProphetClass || !prophetOptimizer) {
      throw new Error('Injected Prophet runtime requires initProphet, ProphetClass, and prophetOptimizer');
    }

    await initProphet();
    return { ProphetClass, prophetOptimizer };
  }

  return getDefaultProphetRuntime();
}

async function getDefaultProphetRuntime() {
  if (!prophetRuntimePromise) {
    prophetRuntimePromise = loadDefaultProphetRuntime()
      .catch((error) => {
        prophetRuntimePromise = null;
        throw error;
      });
  }

  return prophetRuntimePromise;
}

export async function loadDefaultProphetRuntime({
  resolveAssetUrl = resolvePackageAssetUrl,
  readFileImpl = readFile,
  importModule = defaultImportModule,
} = {}) {
  const prophetWasmUrl = resolveAssetUrl('@bsull/augurs/prophet', './prophet_bg.wasm');
  const [prophetModule, optimizerModule, prophetWasm] = await Promise.all([
    importModule('@bsull/augurs/prophet'),
    importModule('@bsull/augurs-prophet-wasmstan'),
    readFileImpl(prophetWasmUrl),
  ]);
  await prophetModule.default({ module_or_path: prophetWasm });

  return {
    ProphetClass: prophetModule.Prophet,
    prophetOptimizer: optimizerModule.optimizer,
  };
}

function resolvePackageAssetUrl(moduleSpecifier, assetPath) {
  return new URL(assetPath, import.meta.resolve(moduleSpecifier));
}

function buildProphetForecastPoints({
  observedPoints,
  forecastDays,
  now,
  ProphetClass,
  prophetOptimizer,
}) {
  const history = buildSyntheticTimeline({ observedPoints, now });
  const trainingDs = history.map((point) => point.timestampSeconds);
  const futureDs = buildFutureTimestamps({
    generatedAt: normalizeUtcDate(now),
    forecastDays,
  });

  const averageSeries = forecastSeriesWithProphet({
    ProphetClass,
    prophetOptimizer,
    ds: trainingDs,
    y: observedPoints.map((point) => point.average_players),
    futureDs,
  });
  const peakSeries = forecastSeriesWithProphet({
    ProphetClass,
    prophetOptimizer,
    ds: trainingDs,
    y: observedPoints.map((point) => point.peak_players),
    futureDs,
  });

  return futureDs.map((timestampSeconds, index) => ({
    date: formatUtcDate(new Date(timestampSeconds * 1000)),
    average_players: clampForecastValue(averageSeries[index]),
    peak_players: clampForecastValue(peakSeries[index]),
    estimated: true,
  }));
}

function forecastSeriesWithProphet({
  ProphetClass,
  prophetOptimizer,
  ds,
  y,
  futureDs,
}) {
  const prophet = new ProphetClass({
    optimizer: prophetOptimizer,
    growth: 'linear',
    yearlySeasonality: MANUAL_DISABLED_SEASONALITY,
    weeklySeasonality: MANUAL_DISABLED_SEASONALITY,
    dailySeasonality: MANUAL_DISABLED_SEASONALITY,
    uncertaintySamples: 0,
  });

  try {
    return withSuppressedStderr(() => {
      prophet.fit({ ds, y }, { refresh: 0 });
      const predictions = prophet.predict({ ds: futureDs });
      return predictions.yhat.point;
    });
  } finally {
    prophet.free?.();
  }
}

function buildFutureTimestamps({ generatedAt, forecastDays }) {
  return Array.from({ length: forecastDays }, (_value, index) => {
    const date = addUtcDays(generatedAt, index + 1);
    return Math.floor(date.getTime() / 1000);
  });
}

function buildHoltForecastPoints({
  observedPoints,
  forecastDays,
  now = new Date(),
}) {
  if (!Number.isInteger(forecastDays) || forecastDays <= 0) {
    return [];
  }

  if (!Array.isArray(observedPoints) || observedPoints.length < 3) {
    return [];
  }

  const averageModel = fitHoltLinear(observedPoints.map((point) => point.average_players));
  const peakModel = fitHoltLinear(observedPoints.map((point) => point.peak_players));
  const startDate = resolveDate(now);

  return Array.from({ length: forecastDays }, (_value, index) => {
    const day = index + 1;

    return {
      date: addUtcDays(startDate, day).toISOString().slice(0, 10),
      average_players: projectDailyValue(averageModel, day),
      peak_players: projectDailyValue(peakModel, day),
      estimated: true,
    };
  });
}

function fitHoltLinear(values, { alpha = 0.7, beta = 0.3 } = {}) {
  let level = values[0];
  let trend = values[1] - values[0];

  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    const previousLevel = level;
    level = alpha * value + (1 - alpha) * (level + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
  }

  return { level, trend };
}

function projectDailyValue(model, day) {
  const fractionalMonth = day / SYNTHETIC_STEP_DAYS;
  return clampForecastValue(model.level + fractionalMonth * model.trend);
}

function clampForecastValue(value) {
  return Math.max(0, roundTo(2, value));
}

function withSuppressedStderr(callback) {
  const stderr = process?.stderr;
  if (!stderr || typeof stderr.write !== 'function') {
    return callback();
  }

  const originalWrite = stderr.write.bind(stderr);
  stderr.write = () => true;

  try {
    return callback();
  } finally {
    stderr.write = originalWrite;
  }
}

function normalizeUtcDate(now) {
  const value = resolveDate(now);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function resolveDate(now) {
  return now instanceof Date ? now : new Date(now);
}

function roundTo(decimals, value) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
