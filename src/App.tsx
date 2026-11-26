import { useState } from "react";
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
  const [isPlaying, setIsPlaying] = useState(true);
  const [showPointerSpeed, setShowPointerSpeed] = useState(true);
  const [speedUnit, setSpeedUnit] = useState<WindSpeedUnit>("kmh");
  const [isDarkMode, setIsDarkMode] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [forecastIndex, setForecastIndex] = useState(0);

  return (
    <main className={`app-shell${isDarkMode ? " app-shell--dark" : ""}`}>
      <WindSidebar
        showPointerSpeed={showPointerSpeed}
        speedUnit={speedUnit}
        forecastIndex={forecastIndex}
        onPointerSpeedChange={setShowPointerSpeed}
        onSpeedUnitChange={setSpeedUnit}
        onForecastIndexChange={setForecastIndex}
      />
      <WindMap
        location={location}
        onLocationChange={setLocation}
        isPlaying={isPlaying}
        showPointerSpeed={showPointerSpeed}
        isDarkMode={isDarkMode}
        speedUnit={speedUnit}
        forecastIndex={forecastIndex}
        onThemeChange={setIsDarkMode}
        onPlaybackChange={setIsPlaying}
      />
    </main>
  );
}

export default App;
