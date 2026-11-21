const COMPASS_POINTS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

export function getWindDirection(degrees: number): string {
  const normalizedDegrees = ((degrees % 360) + 360) % 360;
  return COMPASS_POINTS[
    Math.round(normalizedDegrees / 22.5) % COMPASS_POINTS.length
  ];
}
