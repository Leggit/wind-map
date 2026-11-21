import { useState, type FormEvent } from "react";
import type { WindField } from "../data/wind";
import {
  formatWindSpeed,
  getWindSpeedUnitLabel,
  WIND_SPEED_UNITS,
  type WindSpeedUnit,
} from "../data/wind-units";
import type { MapLocation } from "../types";
import { Icon } from "./Icon";

interface WindSidebarProps {
  location: MapLocation;
  windField: WindField | null;
  windStatus: "loading" | "ready" | "error";
  isPlaying: boolean;
  showPointerSpeed: boolean;
  speedUnit: WindSpeedUnit;
  onLocationChange: (location: MapLocation) => void;
  onPlaybackChange: (isPlaying: boolean) => void;
  onPointerSpeedChange: (show: boolean) => void;
  onSpeedUnitChange: (unit: WindSpeedUnit) => void;
}

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

function getDirection(degrees: number): string {
  return COMPASS_POINTS[Math.round(degrees / 22.5) % COMPASS_POINTS.length];
}

function formatTime(value: string | undefined): string {
  if (!value) {
    return "Updated just now";
  }
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(timestamp);
  return `Updated ${new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date)}`;
}

export function WindSidebar({
  location,
  windField,
  windStatus,
  isPlaying,
  showPointerSpeed,
  speedUnit,
  onLocationChange,
  onPlaybackChange,
  onPointerSpeedChange,
  onSpeedUnitChange,
}: WindSidebarProps) {
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "error">(
    "idle",
  );

  const searchLocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const searchTerm = query.trim();
    if (!searchTerm) {
      return;
    }

    setSearchState("loading");
    try {
      const params = new URLSearchParams({
        q: searchTerm,
        format: "jsonv2",
        limit: "1",
      });
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(`Location search failed (${response.status}).`);
      }

      const results: Array<{
        lat: string;
        lon: string;
        name: string;
        display_name: string;
      }> = await response.json();
      const result = results[0];
      if (!result) {
        setSearchState("error");
        return;
      }

      onLocationChange({
        name: result.name || result.display_name.split(",")[0],
        coordinates: [Number(result.lon), Number(result.lat)],
      });
      setQuery("");
      setSearchState("idle");
    } catch (error) {
      console.error("Unable to search for this location.", error);
      setSearchState("error");
    }
  };

  const primaryWind = windField?.centerSample;
  const windSpeed =
    primaryWind === undefined
      ? null
      : formatWindSpeed(primaryWind.speed, speedUnit);
  const windDirection = primaryWind
    ? getDirection(primaryWind.direction)
    : "—";

  return (
    <aside aria-label="Wind conditions" className="sidebar">
      <header className="brand">
        <div aria-hidden="true" className="brand__mark">
          <Icon name="wind" />
        </div>
        <span className="brand__name">zephyr</span>
        <span className="brand__tag">WEATHER AT A GLANCE</span>
      </header>

      <form className="location-search" onSubmit={searchLocation}>
        <Icon className="location-search__icon" name="search" />
        <input
          aria-label="Search a place"
          onChange={(event) => {
            setQuery(event.target.value);
            if (searchState === "error") setSearchState("idle");
          }}
          placeholder="Search any place..."
          value={query}
        />
        <button
          aria-label="Search"
          disabled={searchState === "loading"}
          type="submit"
        >
          {searchState === "loading" ? "…" : "↵"}
        </button>
      </form>
      {searchState === "error" && (
        <p className="search-error" role="status">
          No place found. Try another search.
        </p>
      )}

      <section className="conditions">
        <div className="section-label">
          <span>WIND CONDITIONS</span>
          <span
            className={`status-pill status-pill--${windStatus}`}
            role="status"
          >
            <span className="status-pill__dot" />
            {windStatus === "loading"
              ? "LOADING"
              : windStatus === "error"
                ? "OFFLINE"
                : windField?.isStale
                  ? "CACHED"
                  : "LIVE"}
          </span>
        </div>

        <div className="place-name">
          <Icon name="pin" />
          <span>{location.name}</span>
        </div>

        <div className="speed-card">
          <div className="speed-card__header">
            <span className="speed-card__label">Wind speed at map center</span>
            <div aria-label="Wind speed units" className="unit-selector" role="group">
              {WIND_SPEED_UNITS.map((unit) => (
                <button
                  aria-pressed={speedUnit === unit.value}
                  className={
                    speedUnit === unit.value ? "unit-selector__active" : ""
                  }
                  key={unit.value}
                  onClick={() => onSpeedUnitChange(unit.value)}
                  type="button"
                >
                  {unit.label}
                </button>
              ))}
            </div>
          </div>
          <div className="speed-card__value">
            {windSpeed === null ? (
              <span className="speed-placeholder">—</span>
            ) : (
              windSpeed
            )}
            <span className="speed-card__unit">
              {getWindSpeedUnitLabel(speedUnit)}
            </span>
          </div>
          <div aria-hidden="true" className="speed-card__decoration">
            <span />
            <span />
            <span />
          </div>
        </div>

        <div className="direction-row">
          <div className="direction-icon">
            <span
              className="direction-icon__arrow"
              style={{
                transform: `translate(-50%, -50%) rotate(${(primaryWind?.direction ?? 0) + 180}deg)`,
              }}
            >
              ↑
            </span>
            <span className="direction-icon__north">N</span>
          </div>
          <div className="direction-copy">
            <span className="direction-copy__label">WIND DIRECTION</span>
            <strong>{windDirection}</strong>
            <span>
              {primaryWind
                ? `${Math.round(primaryWind.direction)}° · from ${windDirection}`
                : "Waiting for readings"}
            </span>
          </div>
          <Icon className="direction-row__wind" name="wind" />
        </div>

        <div className="data-timestamp">
          <Icon name={windStatus === "error" ? "refresh" : "wind"} />
          <span>
            {windStatus === "error"
              ? "Could not reach the weather service"
              : formatTime(windField?.observedAt)}
          </span>
        </div>
      </section>

      <section className="animation-section">
        <div className="section-label">
          <span>MAP OVERLAY</span>
          <span className="overlay-tag">PARTICLES</span>
        </div>
        <div className="overlay-row">
          <div className="overlay-row__icon">
            <Icon name="wind" />
          </div>
          <div className="overlay-row__copy">
            <strong>Wind flow</strong>
            <span>Animated surface winds</span>
          </div>
          <button
            aria-label={isPlaying ? "Pause wind animation" : "Play wind animation"}
            aria-pressed={isPlaying}
            className={`play-toggle${isPlaying ? " play-toggle--active" : ""}`}
            onClick={() => onPlaybackChange(!isPlaying)}
            type="button"
          >
            <Icon name={isPlaying ? "pause" : "play"} />
          </button>
        </div>
        <div className="pointer-setting">
          <div className="pointer-setting__copy">
            <strong>Pointer speed</strong>
            <span>Show nearest reading on hover</span>
          </div>
          <button
            aria-checked={showPointerSpeed}
            aria-label="Show wind speed beside pointer"
            className={`setting-switch${showPointerSpeed ? " setting-switch--on" : ""}`}
            onClick={() => onPointerSpeedChange(!showPointerSpeed)}
            role="switch"
            type="button"
          >
            <span />
          </button>
        </div>
      </section>

      <div className="sidebar-footer">
        <span className="footer-symbol">◎</span>
        <span>
          WIND DATA BY{" "}
          <a href="https://open-meteo.com/" rel="noreferrer" target="_blank">
            OPEN-METEO
          </a>
        </span>
      </div>
    </aside>
  );
}
