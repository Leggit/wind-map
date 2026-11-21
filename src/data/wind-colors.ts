export const WIND_SPEED_COLORS = {
  low: "#0e7490",
  mild: "#2563eb",
  moderate: "#6d28d9",
  strong: "#c026d3",
  severe: "#c2410c",
} as const;

export const DARK_WIND_SPEED_COLORS = {
  low: "#4ade80",
  mild: "#fde047",
  moderate: "#f59e0b",
  strong: "#ef4444",
  severe: "#b91c1c",
} as const;

const WIND_SPEED_COLOR_STOPS = [
  { maxKmh: 15, color: WIND_SPEED_COLORS.low },
  { maxKmh: 30, color: WIND_SPEED_COLORS.mild },
  { maxKmh: 45, color: WIND_SPEED_COLORS.moderate },
  { maxKmh: 60, color: WIND_SPEED_COLORS.strong },
  { maxKmh: Number.POSITIVE_INFINITY, color: WIND_SPEED_COLORS.severe },
] as const;

const DARK_WIND_SPEED_COLOR_STOPS = [
  { maxKmh: 15, color: DARK_WIND_SPEED_COLORS.low },
  { maxKmh: 30, color: DARK_WIND_SPEED_COLORS.mild },
  { maxKmh: 45, color: DARK_WIND_SPEED_COLORS.moderate },
  { maxKmh: 60, color: DARK_WIND_SPEED_COLORS.strong },
  { maxKmh: Number.POSITIVE_INFINITY, color: DARK_WIND_SPEED_COLORS.severe },
] as const;

export function getWindSpeedColor(
  speedKmh: number,
  darkMode = false,
): string {
  const colors = darkMode ? DARK_WIND_SPEED_COLOR_STOPS : WIND_SPEED_COLOR_STOPS;
  for (const stop of colors) {
    if (speedKmh <= stop.maxKmh) {
      return stop.color;
    }
  }
  return colors[colors.length - 1].color;
}

export function getWindSpeedGradient(darkMode = false): string {
  const colors = darkMode ? DARK_WIND_SPEED_COLOR_STOPS : WIND_SPEED_COLOR_STOPS;
  const stops = colors.map(
    ({ color }, index) =>
      `${color} ${(index / (colors.length - 1)) * 100}%`,
  );
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
