# Wind Map Agent Guide

## Purpose

Wind Map is a responsive browser application for exploring live surface winds on an interactive map. It combines MapLibre GL map tiles, wind readings from Open-Meteo, unit and direction formatting, hover readings, light/dark themes, playback controls, and a WebGL particle-flow overlay.

Keep changes focused on this wind-map experience. Preserve the existing Central Europe default, map controls, sidebar workflow, and graceful handling of weather-service failures.

## Tech Stack

- React 19 with functional components and hooks
- TypeScript 6 in ES2023 targets
- Vite 8 with `@vitejs/plugin-react`
- MapLibre GL 6
- WebGL 1 for the wind-particle canvas
- Open-Meteo for wind data
- OpenStreetMap/Nominatim for map tiles and place search
- OpenFreeMap for the dark map style
- Plain CSS for styling; no CSS framework
- ESLint 10 with JavaScript, TypeScript, React Hooks, and React Refresh rules

## Repository Structure

- `src/main.tsx`: application entry point and React root
- `src/App.tsx`: top-level state and layout; coordinates sidebar and map props
- `src/App.css` and `src/index.css`: application and global styles
- `src/components/WindMap.tsx`: MapLibre lifecycle, map refresh, hover readings, controls, and legend
- `src/components/WindParticles.tsx`: projected wind interpolation, particle animation, and WebGL shaders
- `src/components/WindSidebar.tsx`: location search, wind summary, units, playback, and pointer settings
- `src/components/Icon.tsx`: shared icon component
- `src/data/wind.ts`: geographic grid creation, Open-Meteo fetching, cache, and stale-data fallback
- `src/data/wind-units.ts`: speed-unit conversions and legend values
- `src/data/wind-directions.ts`: meteorological compass directions
- `src/data/wind-colors.ts`: shared light/dark wind speed color scales
- `src/types.ts`: shared application types
- `public/`: static assets
- `dist/`: generated build output; do not edit or commit manually

## Development

Run from the repository root:

```powershell
npm install
npm run dev
npm run lint
npm run build
npm run preview
```

Use `npm run build` to verify both TypeScript project references and Vite production compilation. There is currently no test runner or test directory, so run the smallest relevant lint/build check for changes and report that limitation if no focused test exists.

## Coding Standards

- Use TypeScript for source code. Avoid `any`, and prefer explicit interfaces/types for component props and API payload data.
- Follow the existing double-quote, semicolon, two-space-indentation style.
- Keep components functional and prefer hooks. Derive values from props/state instead of duplicating state.
- Use `import type` for type-only imports because `verbatimModuleSyntax` is enabled.
- Preserve strict compiler and lint behavior: no unused locals or parameters.
- Keep React effects focused. Clean up MapLibre listeners, animation frames, WebGL resources, timers, and `AbortController` instances.
- Use stable callback identities where effects depend on callbacks, and account for React Strict Mode lifecycle behavior.
- Keep controls keyboard accessible: provide labels, `aria-*` state, visible focus styles, and `button[type="button"]` unless a button submits a form.
- Preserve responsive behavior and the existing 320px minimum viewport assumption.
- Use the existing wind color scales and unit helpers instead of introducing separate conversions or thresholds.
- Place reusable domain logic in `src/data/`; place rendering and interaction logic in `src/components/`.
- Add or update documentation only when behavior or setup changes materially.

## Map and Wind Data Conventions

- MapLibre coordinates use `[longitude, latitude]`.
- Wind speed is stored in km/h throughout the weather-data layer. Convert only at display boundaries using `src/data/wind-units.ts`.
- Wind direction is meteorological: it describes the direction winds come from.
- Preserve the existing vector conventions: `east` and `north` are used by particle rendering and pointer interpolation.
- `WindField` and `WindSample` are the common data contracts between fetching, sidebar, map, and particle code.
- Use `AbortSignal` for wind requests and ignore cancellation/abort errors rather than presenting them as data failures.
- Use the existing local-storage/memory cache behavior in `src/data/wind.ts`; do not add a second cache or directly cache React state.
- When changing grid size, cache limits, refresh intervals, API URLs, or weather payload handling, also consider API rate limits and stale-data fallback behavior.
- External services are runtime dependencies. Do not add API secrets or tokens to source or environment files.
- The particle renderer should remain safe when MapLibre, WebGL, or wind data is unavailable. Log useful errors and leave the UI usable.

## Styling

- Reuse existing CSS classes and naming patterns before creating variants.
- Keep light and dark styles coordinated across sidebar, map, legend, and particle colors.
- Avoid inline layout values unless they represent dynamic computed positions or state.
- When changing map or sidebar dimensions, verify desktop and mobile layouts.
- Motion can be toggled by the existing playback state; do not start a second particle animation loop.

## Change Workflow

1. Inspect the relevant component, data helper, and CSS before editing.
2. Make the smallest complete change; avoid unrelated cleanup.
3. Preserve existing public behavior unless the request explicitly changes it.
4. Run `npm run lint` and `npm run build` after source changes.
5. For visual or map behavior, run `npm run dev` and verify the affected desktop/mobile UI when practical.
6. Summarize changed files and validation results in the final response.
