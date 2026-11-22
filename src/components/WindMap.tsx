import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import { interpolateWind, type WindField } from "../data/wind";
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
  forecastIndex: number;
  onThemeChange: (isDarkMode: boolean) => void;
  onWindUpdate: (
    status: "loading" | "ready" | "error",
    field: WindField | null,
  ) => void;
}

interface PointerReading {
  x: number;
  y: number;
  latitude: number;
  longitude: number;
  speed: number;
  direction: number;
  field: WindField;
}

type WindGridFeature = {
  type: "Feature";
  properties: Record<string, string>;
  geometry:
    | { type: "MultiPolygon"; coordinates: [number, number][][][] }
    | { type: "Point"; coordinates: [number, number] };
};

const WIND_GRID_SOURCE_ID = "open-meteo-wind-grid";
const WIND_GRID_FILL_LAYER_ID = "open-meteo-wind-grid-fill";
const WIND_GRID_LABEL_LAYER_ID = "open-meteo-wind-grid-labels";
const POINTER_CARD_WIDTH = 152;
const POINTER_CARD_HEIGHT = 84;

function createWindGridData(field: WindField | null) {
  const features: WindGridFeature[] = [];
  if (!field) {
    return { type: "FeatureCollection" as const, features };
  }

  const halfStep = field.gridStep / 2;
  const addRectangle = (
    polygons: [number, number][][][],
    west: number,
    east: number,
    south: number,
    north: number,
  ) => {
    polygons.push([
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ]);
  };

  for (const sample of field.samples) {
    const south = Math.max(-85, sample.latitude - halfStep);
    const north = Math.min(85, sample.latitude + halfStep);
    const west = sample.longitude - halfStep;
    const east = sample.longitude + halfStep;
    const polygons: [number, number][][][] = [];

    if (west < -180) {
      addRectangle(polygons, west + 360, 180, south, north);
      addRectangle(polygons, -180, east, south, north);
    } else if (east > 180) {
      addRectangle(polygons, west, 180, south, north);
      addRectangle(polygons, -180, east - 360, south, north);
    } else {
      addRectangle(polygons, west, east, south, north);
    }

    features.push({
      type: "Feature",
      properties: { kind: "cell" },
      geometry: { type: "MultiPolygon", coordinates: polygons },
    });
    features.push({
      type: "Feature",
      properties: {
        kind: "label",
        label: `${formatWindSpeed(sample.speed, "kmh")} km/h\n${getWindDirection(sample.direction)}`,
      },
      geometry: {
        type: "Point",
        coordinates: [sample.longitude, sample.latitude],
      },
    });
  }

  return { type: "FeatureCollection" as const, features };
}

function formatPointerCoordinate(latitude: number, longitude: number) {
  const latitudeDirection = latitude >= 0 ? "N" : "S";
  const longitudeDirection = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(3)}°${latitudeDirection}, ${Math.abs(longitude).toFixed(3)}°${longitudeDirection}`;
}

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    openstreetmap: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: "openstreetmap",
      type: "raster" as const,
      source: "openstreetmap",
      //paint: { "raster-opacity": 0.88 },
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
  forecastIndex,
  onThemeChange,
  onWindUpdate,
}: WindMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [field, setField] = useState<WindField | null>(null);
  const [pointerReading, setPointerReading] = useState<PointerReading | null>(
    null,
  );
  const [isTopographyEnabled, setIsTopographyEnabled] = useState(false);
  const [is3DEnabled, setIs3DEnabled] = useState(false);
  const [isWindGridEnabled, setIsWindGridEnabled] = useState(false);
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
      maxZoom: 18,
      maxPitch: 85,
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

      fetchWindField(
        getVisibleBounds(map),
        forecastIndex,
        map.getZoom(),
        controller.signal,
      )
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
        timer = window.setTimeout(refreshWind, 300);
      }
    };
    map.on("load", handleLoad);
    map.on("moveend", scheduleRefresh);
    if (map.loaded()) {
      handleLoad();
    }

    return () => {
      window.clearTimeout(timer);
      requestRef.current?.abort();
      map.off("load", handleLoad);
      map.off("moveend", scheduleRefresh);
    };
  }, [forecastIndex, map, onWindUpdate]);

  useEffect(() => {
    if (!map) {
      return;
    }

    const configureTerrain = () => {
      if (!map.isStyleLoaded()) {
        return;
      }

      if (!map.getSource("terrainSource")) {
        map.addSource("terrainSource", {
          type: "raster-dem",
          url: "https://tiles.mapterhorn.com/tilejson.json",
        });
      }

      if (!map.getSource("hillshadeSource")) {
        map.addSource("hillshadeSource", {
          type: "raster-dem",
          url: "https://tiles.mapterhorn.com/tilejson.json",
        });
      }

      if (!map.getLayer("topography-hillshade")) {
        const firstSymbolLayer = map
          .getStyle()
          .layers?.find((layer) => layer.type === "symbol");
        map.addLayer(
          {
            id: "topography-hillshade",
            type: "hillshade",
            source: "hillshadeSource",
            paint: {
              "hillshade-shadow-color": "#473b24",
            },
            layout: {
              visibility: isTopographyEnabled ? "visible" : "none",
            },
          },
          firstSymbolLayer?.id,
        );
      } else {
        map.setLayoutProperty(
          "topography-hillshade",
          "visibility",
          isTopographyEnabled ? "visible" : "none",
        );
      }

      map.setSky({});
      const activeTerrainSource = map.getTerrain()?.source;
      if (is3DEnabled && activeTerrainSource !== "terrainSource") {
        map.setTerrain({ source: "terrainSource", exaggeration: 1 });
      } else if (!is3DEnabled && activeTerrainSource) {
        map.setTerrain(null);
      }
    };

    map.on("style.load", configureTerrain);
    configureTerrain();
    return () => {
      map.off("style.load", configureTerrain);
    };
  }, [is3DEnabled, isTopographyEnabled, map]);

  useEffect(() => {
    if (!map) {
      return;
    }

    const configureWindGrid = () => {
      if (!map.isStyleLoaded()) {
        return;
      }

      const data = createWindGridData(field);
      const source = map.getSource(WIND_GRID_SOURCE_ID) as
        | GeoJSONSource
        | undefined;
      if (source) {
        source.setData(data);
      } else {
        map.addSource(WIND_GRID_SOURCE_ID, {
          type: "geojson",
          data,
        });
      }

      const firstSymbolLayer = map
        .getStyle()
        .layers?.find((layer) => layer.type === "symbol")?.id;
      if (!map.getLayer(WIND_GRID_FILL_LAYER_ID)) {
        map.addLayer(
          {
            id: WIND_GRID_FILL_LAYER_ID,
            type: "fill",
            source: WIND_GRID_SOURCE_ID,
            filter: ["==", ["get", "kind"], "cell"],
            paint: {
              "fill-color": isDarkMode ? "#82b8d5" : "#438a7b",
              "fill-opacity": 0.1,
              "fill-outline-color": isDarkMode
                ? "rgba(185, 220, 237, 0.4)"
                : "rgba(46, 113, 101, 0.4)",
            },
          },
          firstSymbolLayer,
        );
      }
      if (!map.getLayer(WIND_GRID_LABEL_LAYER_ID)) {
        map.addLayer(
          {
            id: WIND_GRID_LABEL_LAYER_ID,
            type: "symbol",
            source: WIND_GRID_SOURCE_ID,
            filter: ["==", ["get", "kind"], "label"],
            layout: {
              "text-field": ["get", "label"],
              "text-size": 11,
              "text-anchor": "center",
              "text-justify": "center",
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: {
              "text-color": isDarkMode ? "#f5fafc" : "#17352d",
              "text-halo-color": isDarkMode ? "#17232b" : "#ffffff",
              "text-halo-width": 1.4,
              "text-halo-blur": 0.3,
            },
          },
          firstSymbolLayer,
        );
      }

      const visibility = isWindGridEnabled ? "visible" : "none";
      map.setLayoutProperty(WIND_GRID_FILL_LAYER_ID, "visibility", visibility);
      map.setLayoutProperty(WIND_GRID_LABEL_LAYER_ID, "visibility", visibility);
    };

    map.on("style.load", configureWindGrid);
    configureWindGrid();
    return () => {
      map.off("style.load", configureWindGrid);
    };
  }, [field, isDarkMode, isWindGridEnabled, map]);

  useEffect(() => {
    if (!map || !field || !showPointerSpeed) {
      return;
    }

    const updatePointerReading = (event: MapMouseEvent) => {
      const wind = interpolateWind(
        field.samples,
        event.lngLat.lat,
        event.lngLat.lng,
      );

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
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
        speed: wind?.speed ?? 0,
        direction: wind?.direction ?? 0,
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
  const toggleTopography = () => {
    setIsTopographyEnabled((enabled) => !enabled);
  };
  const toggleWindGrid = () => {
    setIsWindGridEnabled((enabled) => !enabled);
  };
  const toggle3D = () => {
    const nextIs3DEnabled = !is3DEnabled;
    setIs3DEnabled(nextIs3DEnabled);
    mapRef.current?.easeTo({
      pitch: nextIs3DEnabled ? 52 : 0,
      duration: 900,
    });
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
  const pointerCoordinates = pointerReading
    ? formatPointerCoordinate(
        pointerReading.latitude,
        pointerReading.longitude,
      )
    : null;

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
          aria-label={`Wind speed ${formatWindSpeed(pointerReading.speed, speedUnit)} ${getWindSpeedUnitLabel(speedUnit)}${pointerDirection === null ? ", direction unavailable" : `, from ${pointerDirection}`}, at ${pointerCoordinates}`}
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
          <span className="wind-pointer-card__coordinates">
            {pointerCoordinates}
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
          aria-label={`${isWindGridEnabled ? "Hide" : "Show"} Open-Meteo wind grid`}
          aria-pressed={isWindGridEnabled}
          className={`map-control-button${isWindGridEnabled ? " map-control-button--active" : ""}`}
          onClick={toggleWindGrid}
          title={`${isWindGridEnabled ? "Hide" : "Show"} Open-Meteo wind grid`}
          type="button"
        >
          <Icon name="grid" />
        </button>
        <button
          aria-label={`${isTopographyEnabled ? "Hide" : "Show"} topography layer`}
          aria-pressed={isTopographyEnabled}
          className={`map-control-button${isTopographyEnabled ? " map-control-button--active" : ""}`}
          onClick={toggleTopography}
          title={`${isTopographyEnabled ? "Hide" : "Show"} topography layer`}
          type="button"
        >
          <Icon name="terrain" />
        </button>
        <button
          aria-label={`Switch ${is3DEnabled ? "off" : "on"} 3D terrain`}
          aria-pressed={is3DEnabled}
          className={`map-control-button${is3DEnabled ? " map-control-button--active" : ""}`}
          onClick={toggle3D}
          title={`Switch ${is3DEnabled ? "off" : "on"} 3D terrain`}
          type="button"
        >
          <Icon name="cube" />
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
