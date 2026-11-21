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

interface OpenMeteoLocation {
  current?: {
    time?: unknown;
    wind_speed_10m?: unknown;
    wind_direction_10m?: unknown;
  };
}

interface CachedReading {
  sample: WindSample;
  cachedAt: number;
  observedAt: string;
}

interface WindGrid {
  points: Array<[number, number]>;
  step: number;
}

const STORAGE_KEY = "zephyr.wind-cache.v1";
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 600;
const CACHE_GRID_POINTS_PER_SIDE = 6;

const memoryCache = new Map<string, CachedReading>();
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

function isWindSample(value: unknown): value is WindSample {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    "latitude" in value &&
    typeof value.latitude === "number" &&
    "longitude" in value &&
    typeof value.longitude === "number" &&
    "speed" in value &&
    typeof value.speed === "number" &&
    "direction" in value &&
    typeof value.direction === "number" &&
    "east" in value &&
    typeof value.east === "number" &&
    "north" in value &&
    typeof value.north === "number"
  );
}

function isCachedReading(value: unknown): value is CachedReading {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    "sample" in value &&
    isWindSample(value.sample) &&
    "cachedAt" in value &&
    typeof value.cachedAt === "number" &&
    "observedAt" in value &&
    typeof value.observedAt === "string"
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
      if (isCachedReading(value)) {
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
    "current" in value &&
    typeof value.current === "object" &&
    value.current !== null
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
): Promise<void> {
  const params = new URLSearchParams({
    latitude: points.map(([latitude]) => latitude.toFixed(3)).join(","),
    longitude: points.map(([, longitude]) => longitude.toFixed(3)).join(","),
    current: "wind_speed_10m,wind_direction_10m",
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
  for (let index = 0; index < locations.length; index += 1) {
    const location = locations[index];
    const speed = location.current?.wind_speed_10m;
    const direction = location.current?.wind_direction_10m;
    if (
      typeof speed !== "number" ||
      typeof direction !== "number" ||
      !Number.isFinite(speed) ||
      !Number.isFinite(direction)
    ) {
      throw new Error("The weather service returned an invalid wind reading.");
    }

    const [latitude, longitude] = points[index];
    const radians = (direction * Math.PI) / 180;
    const sample: WindSample = {
      latitude,
      longitude,
      speed,
      direction,
      east: -Math.sin(radians) * speed,
      north: -Math.cos(radians) * speed,
    };
    memoryCache.set(coordinateKey(latitude, longitude), {
      sample,
      cachedAt,
      observedAt:
        typeof location.current?.time === "string"
          ? location.current.time
          : new Date().toISOString(),
    });
  }

  saveCache();
  console.info("[wind-cache] readings cached", {
    gridId,
    savedPoints: locations.length,
    totalEntries: memoryCache.size,
  });
}

function createField(
  points: Array<[number, number]>,
  bounds: GeographicBounds,
): WindField {
  const readings = points.map(([latitude, longitude]) =>
    memoryCache.get(coordinateKey(latitude, longitude)),
  );
  const availableReadings = readings.filter(
    (reading): reading is CachedReading => reading !== undefined,
  );
  if (availableReadings.length !== points.length) {
    throw new Error("Wind readings are not available for this map area.");
  }

  const samples = availableReadings.map((reading) => reading.sample);
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
  const observedAt =
    availableReadings.find((reading) => reading.observedAt)?.observedAt ??
    new Date().toISOString();

  return {
    samples,
    centerSample,
    observedAt,
    isStale: availableReadings.some(
      (reading) => Date.now() - reading.cachedAt >= CACHE_TTL_MS,
    ),
  };
}

export async function fetchWindField(
  bounds: GeographicBounds,
  signal: AbortSignal,
): Promise<WindField> {
  loadCache();
  const grid = createGrid(bounds);
  const { points } = grid;
  const gridId = getGridId(points);
  const now = Date.now();
  const freshHits = points.filter((point) => {
    const reading = memoryCache.get(coordinateKey(point[0], point[1]));
    return reading !== undefined && now - reading.cachedAt < CACHE_TTL_MS;
  }).length;
  const staleHits = points.filter((point) => {
    const reading = memoryCache.get(coordinateKey(point[0], point[1]));
    return reading !== undefined && now - reading.cachedAt >= CACHE_TTL_MS;
  }).length;
  const missingPoints = points.filter((point) => {
    const reading = memoryCache.get(coordinateKey(point[0], point[1]));
    return !reading || now - reading.cachedAt >= CACHE_TTL_MS;
  });

  console.info("[wind-cache] grid lookup", {
    gridId,
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
      return createField(points, bounds);
    }

    try {
      await fetchReadings(missingPoints, signal, gridId);
    } catch (error) {
      if (signal.aborted) {
        console.info("[wind-cache] lookup cancelled", { gridId });
        throw error;
      }
      const hasCachedGrid = points.every((point) =>
        memoryCache.has(coordinateKey(point[0], point[1])),
      );
      if (!hasCachedGrid) {
        throw error;
      }
      console.warn(
        "[wind-cache] using stale saved readings after refresh failed",
        { gridId, stalePoints: staleHits, error },
      );
    }
  }

  return createField(points, bounds);
}
