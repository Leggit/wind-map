export interface GeographicBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface WindSample {
  latitude: number;
  longitude: number;
  speed: number;
  direction: number;
  east: number;
  north: number;
}

export interface WindField {
  samples: WindSample[];
  centerSample: WindSample;
  observedAt: string;
  isStale: boolean;
}

interface OpenMeteoHourly {
  time?: unknown;
  wind_speed_10m?: unknown;
  wind_direction_10m?: unknown;
}

interface OpenMeteoLocation {
  hourly?: OpenMeteoHourly;
}

interface ForecastReading {
  observedAt: string;
  speed: number;
  direction: number;
}

interface CachedForecast {
  readings: ForecastReading[];
  cachedAt: number;
}

interface WindGrid {
  points: Array<[number, number]>;
  step: number;
}

export const FORECAST_HOURLY_HOURS = 24;
export const FORECAST_HORIZON_HOURS = 7 * 24;
export const FORECAST_STEP_HOURS = 3;
export const FORECAST_TIME_COUNT =
  FORECAST_HOURLY_HOURS +
  (FORECAST_HORIZON_HOURS - FORECAST_HOURLY_HOURS) /
    FORECAST_STEP_HOURS +
  1;

const STORAGE_KEY = "zephyr.wind-cache.v3";
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;
const CACHE_GRID_POINTS_PER_SIDE = 6;

const memoryCache = new Map<string, CachedForecast>();
let cacheLoaded = false;
let rateLimitedUntil = 0;

function coordinateKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

function getGridId(points: Array<[number, number]>): string {
  const coordinates = points.map(([latitude, longitude]) =>
    coordinateKey(latitude, longitude),
  );
  let hash = 2166136261;
  for (const character of coordinates.join("|")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `grid-${(hash >>> 0).toString(36)}`;
}

function isForecastReading(value: unknown): value is ForecastReading {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    "observedAt" in value &&
    typeof value.observedAt === "string" &&
    "speed" in value &&
    typeof value.speed === "number" &&
    Number.isFinite(value.speed) &&
    "direction" in value &&
    typeof value.direction === "number" &&
    Number.isFinite(value.direction)
  );
}

function isCachedForecast(value: unknown): value is CachedForecast {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    "readings" in value &&
    Array.isArray(value.readings) &&
    value.readings.every(isForecastReading) &&
    "cachedAt" in value &&
    typeof value.cachedAt === "number" &&
    Number.isFinite(value.cachedAt)
  );
}

function loadCache(): void {
  if (cacheLoaded) {
    return;
  }
  cacheLoaded = true;

  if (typeof window === "undefined") {
    return;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return;
    }

    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("The stored wind cache has an invalid format.");
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (isCachedForecast(value)) {
        memoryCache.set(key, value);
      }
    }
    console.info("[wind-cache] restored browser cache", {
      entries: memoryCache.size,
    });
  } catch (error) {
    console.warn("Unable to read the saved wind cache.", error);
  }
}

function saveCache(): void {
  if (typeof window === "undefined") {
    return;
  }

  const recentEntries = [...memoryCache.entries()]
    .sort(([, first], [, second]) => second.cachedAt - first.cachedAt)
    .slice(0, MAX_CACHE_ENTRIES);
  memoryCache.clear();
  for (const [key, reading] of recentEntries) {
    memoryCache.set(key, reading);
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(memoryCache)),
    );
  } catch (error) {
    console.warn("Unable to save the wind cache.", error);
  }
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 540) % 360) - 180;
}

function createGrid(bounds: GeographicBounds): WindGrid {
  const south = Math.max(-80, Math.min(80, bounds.south));
  const north = Math.max(-80, Math.min(80, bounds.north));
  const latitudeSpan = Math.max(0.25, north - south);
  const longitudeSpan = Math.max(0.25, bounds.east - bounds.west);
  const step = Math.max(
    0.25,
    2 **
      Math.ceil(
        Math.log2(
          Math.max(latitudeSpan, longitudeSpan) / CACHE_GRID_POINTS_PER_SIDE,
        ),
      ),
  );
  const firstLatitude = Math.floor(south / step) * step;
  const lastLatitude = Math.ceil(north / step) * step;
  const firstLongitude = Math.floor(bounds.west / step) * step;
  const lastLongitude = Math.ceil(bounds.east / step) * step;
  const points: Array<[number, number]> = [];
  const seen = new Set<string>();

  for (
    let latitude = firstLatitude;
    latitude <= lastLatitude;
    latitude += step
  ) {
    const safeLatitude = Math.max(-80, Math.min(80, latitude));
    for (
      let longitude = firstLongitude;
      longitude <= lastLongitude;
      longitude += step
    ) {
      const safeLongitude = normalizeLongitude(longitude);
      const key = coordinateKey(safeLatitude, safeLongitude);
      if (!seen.has(key)) {
        seen.add(key);
        points.push([safeLatitude, safeLongitude]);
      }
    }
  }

  return { points, step };
}

function isOpenMeteoLocation(value: unknown): value is OpenMeteoLocation {
  return (
    typeof value === "object" &&
    value !== null &&
    "hourly" in value &&
    typeof value.hourly === "object" &&
    value.hourly !== null
  );
}

function getForecastHourOffset(forecastIndex: number): number {
  if (
    !Number.isInteger(forecastIndex) ||
    forecastIndex < 0 ||
    forecastIndex >= FORECAST_TIME_COUNT
  ) {
    throw new RangeError("The selected forecast time is outside the 7-day range.");
  }
  return forecastIndex < FORECAST_HOURLY_HOURS
    ? forecastIndex
    : FORECAST_HOURLY_HOURS +
        (forecastIndex - FORECAST_HOURLY_HOURS) * FORECAST_STEP_HOURS;
}

function formatForecastTime(hourOffset: number, now: number): string {
  const currentHour = Math.floor(now / 3_600_000) * 3_600_000;
  return new Date(currentHour + hourOffset * 3_600_000)
    .toISOString()
    .slice(0, 16);
}

export function getForecastTime(forecastIndex: number): string {
  return formatForecastTime(getForecastHourOffset(forecastIndex), Date.now());
}

function getForecastTimes(now: number): string[] {
  return Array.from({ length: FORECAST_TIME_COUNT }, (_, forecastIndex) =>
    formatForecastTime(getForecastHourOffset(forecastIndex), now),
  );
}

function retryAfterTimestamp(response: Response): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Date.now() + Math.max(1, seconds) * 1000;
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return date;
    }
  }
  return Date.now() + 60_000;
}

async function fetchReadings(
  points: Array<[number, number]>,
  signal: AbortSignal,
  gridId: string,
  requestedForecastTimes: ReadonlySet<string>,
): Promise<void> {
  const params = new URLSearchParams({
    latitude: points.map(([latitude]) => latitude.toFixed(3)).join(","),
    longitude: points.map(([, longitude]) => longitude.toFixed(3)).join(","),
    hourly: "wind_speed_10m,wind_direction_10m",
    forecast_hours: String(FORECAST_HORIZON_HOURS + 1),
    wind_speed_unit: "kmh",
    timezone: "GMT",
  });
  const requestStartedAt = Date.now();
  console.info("[wind-cache] Open-Meteo request", {
    gridId,
    missingPoints: points.length,
    cachedEntries: memoryCache.size,
  });

  let response: Response;
  try {
    response = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
      { signal },
    );
  } catch (error) {
    console.warn("[wind-cache] Open-Meteo request failed", {
      gridId,
      durationMs: Date.now() - requestStartedAt,
      error,
    });
    throw error;
  }

  console.info("[wind-cache] Open-Meteo response", {
    gridId,
    status: response.status,
    durationMs: Date.now() - requestStartedAt,
  });

  if (response.status === 429) {
    rateLimitedUntil = retryAfterTimestamp(response);
    console.warn("[wind-cache] rate limit received", {
      gridId,
      retryInSeconds: Math.ceil((rateLimitedUntil - Date.now()) / 1000),
    });
    throw new Error("Open-Meteo is rate-limiting wind requests.");
  }
  if (!response.ok) {
    throw new Error(`Wind data request failed (${response.status}).`);
  }

  const payload: unknown = await response.json();
  const locations = Array.isArray(payload)
    ? payload.filter(isOpenMeteoLocation)
    : isOpenMeteoLocation(payload)
      ? [payload]
      : [];
  if (locations.length !== points.length) {
    throw new Error("The weather service returned an incomplete wind grid.");
  }

  const cachedAt = Date.now();
  const forecasts: Array<[string, CachedForecast]> = [];
  for (let index = 0; index < locations.length; index += 1) {
    const location = locations[index];
    const times = location.hourly?.time;
    const speeds = location.hourly?.wind_speed_10m;
    const directions = location.hourly?.wind_direction_10m;
    if (
      !Array.isArray(times) ||
      !Array.isArray(speeds) ||
      !Array.isArray(directions) ||
      times.length === 0 ||
      times.length !== speeds.length ||
      times.length !== directions.length
    ) {
      throw new Error("The weather service returned an invalid wind forecast.");
    }

    const [latitude, longitude] = points[index];
    const readings: ForecastReading[] = [];
    for (let readingIndex = 0; readingIndex < times.length; readingIndex += 1) {
      const time = times[readingIndex];
      if (typeof time !== "string") {
        throw new Error("The weather service returned an invalid forecast time.");
      }
      if (!requestedForecastTimes.has(time)) {
        continue;
      }

      const speed = speeds[readingIndex];
      const direction = directions[readingIndex];
      if (
        typeof speed !== "number" ||
        typeof direction !== "number" ||
        !Number.isFinite(speed) ||
        !Number.isFinite(direction)
      ) {
        throw new Error(
          "The weather service returned an invalid wind forecast reading.",
        );
      }
      readings.push({ observedAt: time, speed, direction });
    }
    if (
      readings.length !== requestedForecastTimes.size ||
      [...requestedForecastTimes].some(
        (time) => !readings.some((reading) => reading.observedAt === time),
      )
    ) {
      throw new Error("The weather service returned an incomplete forecast horizon.");
    }
    forecasts.push([
      coordinateKey(latitude, longitude),
      { readings, cachedAt },
    ]);
  }

  for (const [key, forecast] of forecasts) {
    memoryCache.set(key, forecast);
  }

  saveCache();
  console.info("[wind-cache] readings cached", {
    gridId,
    savedPoints: forecasts.length,
    totalEntries: memoryCache.size,
  });
}

function createField(
  points: Array<[number, number]>,
  bounds: GeographicBounds,
  forecastTime: string,
): WindField {
  const readings = points.map(([latitude, longitude]) => {
    const forecast = memoryCache.get(coordinateKey(latitude, longitude));
    const reading = forecast?.readings.find(
      (candidate) => candidate.observedAt === forecastTime,
    );
    return forecast && reading
      ? { ...reading, cachedAt: forecast.cachedAt }
      : undefined;
  });
  const availableReadings = readings.filter(
    (reading): reading is ForecastReading & { cachedAt: number } =>
      reading !== undefined,
  );
  if (availableReadings.length !== points.length) {
    throw new Error("Wind forecasts are not available for this map area.");
  }

  const samples = points.map(([latitude, longitude], index) => {
    const reading = availableReadings[index];
    const radians = (reading.direction * Math.PI) / 180;
    return {
      latitude,
      longitude,
      speed: reading.speed,
      direction: reading.direction,
      east: -Math.sin(radians) * reading.speed,
      north: -Math.cos(radians) * reading.speed,
    };
  });
  const centerLatitude = (bounds.south + bounds.north) / 2;
  const centerLongitude = (bounds.west + bounds.east) / 2;
  const centerSample = samples.reduce((nearest, sample) => {
    const longitudeDifference = normalizeLongitude(
      sample.longitude - centerLongitude,
    );
    const nearestLongitudeDifference = normalizeLongitude(
      nearest.longitude - centerLongitude,
    );
    const distance =
      (sample.latitude - centerLatitude) ** 2 + longitudeDifference ** 2;
    const nearestDistance =
      (nearest.latitude - centerLatitude) ** 2 +
      nearestLongitudeDifference ** 2;
    return distance < nearestDistance ? sample : nearest;
  });
  return {
    samples,
    centerSample,
    observedAt: forecastTime,
    isStale: availableReadings.some(
      (reading) => Date.now() - reading.cachedAt >= CACHE_TTL_MS,
    ),
  };
}

export async function fetchWindField(
  bounds: GeographicBounds,
  forecastIndex: number,
  signal: AbortSignal,
): Promise<WindField> {
  loadCache();
  const forecastTimes = getForecastTimes(Date.now());
  const forecastTime = forecastTimes[forecastIndex];
  if (forecastTime === undefined) {
    throw new RangeError("The selected forecast time is outside the 7-day range.");
  }
  const grid = createGrid(bounds);
  const { points } = grid;
  const gridId = getGridId(points);
  const now = Date.now();
  const freshHits = points.filter((point) => {
    const forecast = memoryCache.get(coordinateKey(point[0], point[1]));
    const reading = forecast?.readings.find(
      (candidate) => candidate.observedAt === forecastTime,
    );
    return (
      forecast !== undefined &&
      reading !== undefined &&
      now - forecast.cachedAt < CACHE_TTL_MS
    );
  }).length;
  const staleHits = points.filter((point) => {
    const forecast = memoryCache.get(coordinateKey(point[0], point[1]));
    return (
      forecast?.readings.some(
        (candidate) => candidate.observedAt === forecastTime,
      ) === true &&
      now - forecast.cachedAt >= CACHE_TTL_MS
    );
  }).length;
  const missingPoints = points.filter((point) => {
    const forecast = memoryCache.get(coordinateKey(point[0], point[1]));
    return (
      forecast === undefined ||
      !forecast.readings.some(
        (candidate) => candidate.observedAt === forecastTime,
      ) ||
      now - forecast.cachedAt >= CACHE_TTL_MS
    );
  });

  console.info("[wind-cache] grid lookup", {
    gridId,
    forecastTime,
    stepDegrees: grid.step,
    points: points.length,
    freshHits,
    staleHits,
    misses: points.length - freshHits - staleHits,
    hitRate: `${Math.round((freshHits / points.length) * 100)}%`,
    cachedEntries: memoryCache.size,
  });

  if (missingPoints.length > 0) {
    if (now < rateLimitedUntil) {
      console.info("[wind-cache] request skipped during rate-limit cooldown", {
        gridId,
        missingPoints: missingPoints.length,
      });
      return createField(points, bounds, forecastTime);
    }

    try {
      await fetchReadings(
        missingPoints,
        signal,
        gridId,
        new Set(forecastTimes),
      );
    } catch (error) {
      if (signal.aborted) {
        console.info("[wind-cache] lookup cancelled", { gridId });
        throw error;
      }
      const hasCachedGrid = points.every((point) => {
        const forecast = memoryCache.get(coordinateKey(point[0], point[1]));
        return forecast?.readings.some(
          (candidate) => candidate.observedAt === forecastTime,
        );
      });
      if (!hasCachedGrid) {
        throw error;
      }
      console.warn(
        "[wind-cache] using stale saved readings after refresh failed",
        { gridId, stalePoints: staleHits, error },
      );
    }
  }

  return createField(points, bounds, forecastTime);
}
