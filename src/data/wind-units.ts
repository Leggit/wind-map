export const WIND_SPEED_UNITS = [
  { value: "kmh", label: "km/h" },
  { value: "ms", label: "m/s" },
  { value: "mph", label: "mph" },
] as const;

export type WindSpeedUnit = (typeof WIND_SPEED_UNITS)[number]["value"];

export function getWindSpeedUnitLabel(unit: WindSpeedUnit): string {
  switch (unit) {
    case "kmh":
      return "km/h";
    case "ms":
      return "m/s";
    case "mph":
      return "mph";
  }
}

export function formatWindSpeed(speedKmh: number, unit: WindSpeedUnit): string {
  const convertedSpeed =
    unit === "kmh"
      ? speedKmh
      : unit === "ms"
        ? speedKmh / 3.6
        : speedKmh / 1.609344;

  return unit === "kmh"
    ? Math.round(convertedSpeed).toString()
    : convertedSpeed.toFixed(1);
}

export function getWindSpeedLegend(
  unit: WindSpeedUnit,
): [string, string, string, string, string] {
  switch (unit) {
    case "kmh":
      return ["0", "15", "30", "45", "60+"];
    case "ms":
      return ["0", "4", "8", "13", "17+"];
    case "mph":
      return ["0", "9", "19", "28", "37+"];
  }
}
