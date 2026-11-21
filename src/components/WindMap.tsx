import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import type { WindField } from "../data/wind";
import { getWindDirection } from "../data/wind-directions";
import {
  formatWindSpeed,
  getWindSpeedLegend,
  getWindSpeedUnitLabel,
  type WindSpeedUnit,
} from "../data/wind-units";
import { getWindSpeedGradient } from "../data/wind-colors";
import { fetchWindField } from "../data/wind";
import type { MapLocation } from "../types";
import { Icon } from "./Icon";
import { WindParticles } from "./WindParticles";

interface WindMapProps {
  location: MapLocation;
  isPlaying: boolean;
  showPointerSpeed: boolean;
  isDarkMode: boolean;
  speedUnit: WindSpeedUnit;
  onThemeChange: (isDarkMode: boolean) => void;
  onWindUpdate: (
    status: "loading" | "ready" | "error",
    field: WindField | null,
  ) => void;
}

interface PointerReading {
  x: number;
  y: number;
  speed: number;
  direction: number;
  field: WindField;
}

const POINTER_CARD_WIDTH = 136;
const POINTER_CARD_HEIGHT = 68;

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    openstreetmap: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: "openstreetmap",
      type: "raster" as const,
      source: "openstreetmap",
      paint: { "raster-opacity": 0.88 },
    },
  ],
};

const DARK_MAP_STYLE = "https://tiles.openfreemap.org/styles/fiord";

function getVisibleBounds(map: MapLibreMap) {
  const bounds = map.getBounds();
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };
}

export function WindMap({
  location,
  isPlaying,
  showPointerSpeed,
  isDarkMode,
  speedUnit,
  onThemeChange,
  onWindUpdate,
}: WindMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [field, setField] = useState<WindField | null>(null);
  const [mapCenter, setMapCenter] = useState(location.coordinates);
  const [pointerReading, setPointerReading] = useState<PointerReading | null>(
    null,
  );
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) {
      return;
    }

    const instance = new MapLibreMap({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: location.coordinates,
      zoom: 4.1,
      minZoom: 2,
      maxZoom: 12,
      renderWorldCopies: true,
      attributionControl: { compact: true },
    });
    mapRef.current = instance;

    setMap(instance);

    return () => {
      requestRef.current?.abort();
      instance.remove();
      mapRef.current = null;
    };
    // The map is created once; later location updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (map) {
      map.flyTo({ center: location.coordinates, duration: 1100 });
    }
  }, [location.coordinates, map]);

  useEffect(() => {
    if (!map) {
      return;
    }

    let timer: number | undefined;
    let hasLoaded = false;
    const refreshWind = () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      onWindUpdate("loading", null);

      fetchWindField(getVisibleBounds(map), controller.signal)
        .then((nextField) => {
          setField(nextField);
          onWindUpdate("ready", nextField);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setField(null);
          onWindUpdate("error", null);
          console.error("Unable to load wind data.", error);
        });
    };

    const scheduleRefresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refreshWind, 900);
    };
    const handleLoad = () => {
      if (!hasLoaded) {
        hasLoaded = true;
        refreshWind();
      }
    };
    const updateCenter = () => {
      const center = map.getCenter();
      setMapCenter([center.lng, center.lat]);
    };

    map.on("load", handleLoad);
    map.on("moveend", scheduleRefresh);
    map.on("moveend", updateCenter);
    if (map.loaded()) {
      handleLoad();
    }

    return () => {
      window.clearTimeout(timer);
      map.off("load", handleLoad);
      map.off("moveend", scheduleRefresh);
      map.off("moveend", updateCenter);
    };
  }, [map, onWindUpdate]);

  useEffect(() => {
    if (!map || !field || !showPointerSpeed) {
      return;
    }

    const updatePointerReading = (event: MapMouseEvent) => {
      const centerLongitude = map.getCenter().lng;
      let nearestSpeed = 0;
      let nearestDirection = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const sample of field.samples) {
        const longitude =
          sample.longitude +
          360 * Math.round((centerLongitude - sample.longitude) / 360);
        const point = map.project([longitude, sample.latitude]);
        const distance =
          (point.x - event.point.x) ** 2 + (point.y - event.point.y) ** 2;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestSpeed = sample.speed;
          nearestDirection = sample.direction;
        }
      }

      const mapWidth = map.getCanvas().clientWidth;
      const mapHeight = map.getCanvas().clientHeight;
      const left =
        event.point.x + POINTER_CARD_WIDTH + 16 > mapWidth
          ? Math.max(8, event.point.x - POINTER_CARD_WIDTH - 16)
          : event.point.x + 16;
      const top = Math.max(
        8,
        Math.min(
          event.point.y - POINTER_CARD_HEIGHT / 2,
          mapHeight - POINTER_CARD_HEIGHT - 8,
        ),
      );

      setPointerReading({
        x: left,
        y: top,
        speed: nearestSpeed,
        direction: nearestDirection,
        field,
      });
    };
    const hidePointerReading = () => setPointerReading(null);

    map.on("mousemove", updatePointerReading);
    map.on("mouseout", hidePointerReading);
    return () => {
      map.off("mousemove", updatePointerReading);
      map.off("mouseout", hidePointerReading);
    };
  }, [field, map, showPointerSpeed]);

  const zoom = (amount: number) => {
    mapRef.current?.zoomTo(mapRef.current.getZoom() + amount, {
      duration: 350,
    });
  };

  const recenter = () => {
    mapRef.current?.flyTo({
      center: location.coordinates,
      zoom: 4.1,
      duration: 900,
    });
  };
  const toggleMapTheme = () => {
    const nextIsDarkMode = !isDarkMode;
    mapRef.current?.setStyle(nextIsDarkMode ? DARK_MAP_STYLE : MAP_STYLE, {
      diff: false,
    });
    onThemeChange(nextIsDarkMode);
  };
  const legendValues = getWindSpeedLegend(speedUnit);
  const pointerDirectionDegrees =
    pointerReading && Number.isFinite(pointerReading.direction)
      ? pointerReading.direction
      : null;
  const pointerDirection =
    pointerDirectionDegrees === null
      ? null
      : getWindDirection(pointerDirectionDegrees);

  return (
    <section
      aria-label="Interactive wind map"
      className={`map-panel${isDarkMode ? " map-panel--dark" : ""}`}
    >
      <div className="map-canvas" ref={mapContainerRef} />
      <WindParticles
        darkMode={isDarkMode}
        field={field}
        isPlaying={isPlaying}
        map={map}
      />
      {showPointerSpeed && field && pointerReading?.field === field && (
        <div
          aria-label={`Wind speed ${formatWindSpeed(pointerReading.speed, speedUnit)} ${getWindSpeedUnitLabel(speedUnit)}${pointerDirection === null ? ", direction unavailable" : `, from ${pointerDirection}`}`}
          className="wind-pointer-card"
          style={{ left: pointerReading.x, top: pointerReading.y }}
        >
          <span className="wind-pointer-card__label">WIND SPEED</span>
          <strong>
            {formatWindSpeed(pointerReading.speed, speedUnit)}
            <small>{getWindSpeedUnitLabel(speedUnit)}</small>
          </strong>
          <span className="wind-pointer-card__direction">
            {pointerDirection === null ? (
              "Direction unavailable"
            ) : (
              <>
                <span
                  aria-hidden="true"
                  className="wind-pointer-card__arrow"
                  style={{
                    transform: `rotate(${pointerReading.direction + 180}deg)`,
                  }}
                >
                  ↑
                </span>
                from {pointerDirection}
              </>
            )}
          </span>
        </div>
      )}

      <div aria-label="Map controls" className="map-controls">
        <button
          aria-label={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
          aria-pressed={isDarkMode}
          className="map-control-button"
          onClick={toggleMapTheme}
          title={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
          type="button"
        >
          <Icon name={isDarkMode ? "sun" : "moon"} />
        </button>
        <span className="map-controls__divider" />
        <button
          aria-label="Return to selected location"
          className="map-control-button"
          onClick={recenter}
          title="Return to selected location"
          type="button"
        >
          <Icon name="compass" />
        </button>
        <span className="map-controls__divider" />
        <button
          aria-label="Zoom in"
          className="map-control-button"
          onClick={() => zoom(1)}
          title="Zoom in"
          type="button"
        >
          <Icon name="plus" />
        </button>
        <button
          aria-label="Zoom out"
          className="map-control-button"
          onClick={() => zoom(-1)}
          title="Zoom out"
          type="button"
        >
          <Icon name="minus" />
        </button>
      </div>

      <div aria-label="Wind speed legend" className="map-legend">
        <div className="map-legend__top">
          <span className="map-legend__title">WIND SPEED</span>
          <span className="map-legend__unit">
            {getWindSpeedUnitLabel(speedUnit)}
          </span>
        </div>
        <div
          className="legend-gradient"
          style={{ background: getWindSpeedGradient(isDarkMode) }}
        />
        <div className="map-legend__scale">
          {legendValues.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
