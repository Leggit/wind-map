import { useCallback, useState } from "react";
import type { WindField } from "./data/wind";
import type { WindSpeedUnit } from "./data/wind-units";
import { WindMap } from "./components/WindMap";
import { WindSidebar } from "./components/WindSidebar";
import type { MapLocation } from "./types";
import "./App.css";

const INITIAL_LOCATION: MapLocation = {
  name: "Central Europe",
  coordinates: [10, 48],
};

function App() {
  const [location, setLocation] = useState(INITIAL_LOCATION);
  const [windField, setWindField] = useState<WindField | null>(null);
  const [windStatus, setWindStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [isPlaying, setIsPlaying] = useState(true);
  const [showPointerSpeed, setShowPointerSpeed] = useState(true);
  const [speedUnit, setSpeedUnit] = useState<WindSpeedUnit>("kmh");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [forecastIndex, setForecastIndex] = useState(0);

  const handleWindUpdate = useCallback(
    (status: "loading" | "ready" | "error", field: WindField | null) => {
      setWindStatus(status);
      setWindField(field);
    },
    [],
  );

  return (
    <main className={`app-shell${isDarkMode ? " app-shell--dark" : ""}`}>
      <WindSidebar
        location={location}
        windField={windField}
        windStatus={windStatus}
        isPlaying={isPlaying}
        showPointerSpeed={showPointerSpeed}
        speedUnit={speedUnit}
        forecastIndex={forecastIndex}
        onLocationChange={setLocation}
        onPlaybackChange={setIsPlaying}
        onPointerSpeedChange={setShowPointerSpeed}
        onSpeedUnitChange={setSpeedUnit}
        onForecastIndexChange={setForecastIndex}
      />
      <WindMap
        location={location}
        isPlaying={isPlaying}
        showPointerSpeed={showPointerSpeed}
        isDarkMode={isDarkMode}
        speedUnit={speedUnit}
        forecastIndex={forecastIndex}
        onThemeChange={setIsDarkMode}
        onWindUpdate={handleWindUpdate}
      />
    </main>
  );
}

export default App;
