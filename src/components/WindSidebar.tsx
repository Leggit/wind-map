import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  FORECAST_TIME_COUNT,
  getForecastTime,
} from "../data/wind";
import {
  WIND_SPEED_UNITS,
  type WindSpeedUnit,
} from "../data/wind-units";
import type { MapLocation } from "../types";
import { Icon } from "./Icon";

interface WindSidebarProps {
  showPointerSpeed: boolean;
  speedUnit: WindSpeedUnit;
  forecastIndex: number;
  onLocationChange: (location: MapLocation) => void;
  onPointerSpeedChange: (show: boolean) => void;
  onSpeedUnitChange: (unit: WindSpeedUnit) => void;
  onForecastIndexChange: (index: number) => void;
}

function formatForecastTime(value: string): string {
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
  }).format(new Date(timestamp));
}

export function WindSidebar({
  showPointerSpeed,
  speedUnit,
  forecastIndex,
  onLocationChange,
  onPointerSpeedChange,
  onSpeedUnitChange,
  onForecastIndexChange,
}: WindSidebarProps) {
  const [query, setQuery] = useState("");
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isMobileExpanded) {
      return;
    }

    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileExpanded(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileExpanded]);

  const closeMenu = () => {
    setIsMobileExpanded(false);
    menuButtonRef.current?.focus();
  };

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

  const forecastTime = formatForecastTime(getForecastTime(forecastIndex));

  return (
    <>
      {isMobileExpanded && (
        <button
          aria-label="Close wind menu"
          className="sidebar-backdrop"
          onClick={closeMenu}
          tabIndex={-1}
          type="button"
        />
      )}
      <button
        ref={menuButtonRef}
        aria-controls="wind-sidebar-content"
        aria-expanded={isMobileExpanded}
        aria-label={isMobileExpanded ? "Close wind menu" : "Open wind menu"}
        className="sidebar__open"
        onClick={() => setIsMobileExpanded(true)}
        type="button"
      >
        <Icon name="menu" />
      </button>
      <aside
        aria-label="Wind controls"
        aria-modal={isMobileExpanded || undefined}
        className={`sidebar${isMobileExpanded ? " sidebar--expanded" : ""}`}
        role={isMobileExpanded ? "dialog" : undefined}
      >
        <header className="brand">
          <button
            aria-controls="wind-sidebar-content"
            aria-expanded={isMobileExpanded}
            aria-label="Close wind menu"
            className="sidebar__toggle"
            onClick={closeMenu}
            ref={closeButtonRef}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="sidebar__content" id="wind-sidebar-content">
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

          <section className="animation-section">
            <div className="unit-control">
              <span>Wind speed units</span>
              <div
                aria-label="Wind speed units"
                className="unit-selector"
                role="group"
              >
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

            <div className="forecast-control">
              <div className="section-label">
                <label htmlFor="forecast-time">FORECAST TIME</label>
                <span className="forecast-control__time">{forecastTime}</span>
              </div>
              <input
                aria-label="Forecast time"
                aria-valuetext={forecastTime}
                id="forecast-time"
                max={FORECAST_TIME_COUNT - 1}
                min={0}
                onChange={(event) =>
                  onForecastIndexChange(event.currentTarget.valueAsNumber)
                }
                type="range"
                value={forecastIndex}
              />
              <div aria-hidden="true" className="forecast-control__range">
                <span>Now</span>
                <span>+7d</span>
              </div>
            </div>

            <div className="pointer-setting">
              <div className="pointer-setting__copy">
                <strong>Pointer info</strong>
              </div>
              <button
                aria-checked={showPointerSpeed}
                aria-label="Show wind info beside pointer"
                className={`setting-switch${showPointerSpeed ? " setting-switch--on" : ""}`}
                onClick={() => onPointerSpeedChange(!showPointerSpeed)}
                role="switch"
                type="button"
              >
                <span />
              </button>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
