# VATSCA Stream Toolkit

Stream tools for VATSIM Scandinavia, fed live from EuroScope through the
[EuroScope WebSocket Data plugin](https://github.com/Dunkstormen/euroscope-ws-plugin).

The app is an Electron window with the controls. Inside it runs a small local server
(`http://localhost:7878`) that serves each tool as a web page, so you add a tool to OBS as a **Browser Source**.
Everything you change in the control window (camera, layers, filters) is pushed live to every open tool page.

```
EuroScope + plugin ──ws://127.0.0.1:8765──▶ Toolkit (Electron)
                                              ├─ control window
                                              └─ http://localhost:7878 ──▶ OBS browser sources (/map.html, …)
```

## Tools

### Traffic map (`/map.html`)

- Aircraft tags: callsign, then level and ground speed (`A045  210`, `FL240  430`).
- **Altitude or level**: at or below the airfield's transition altitude the tag shows `Axxx` (QNH altitude in
  hundreds of feet). At or above the transition level it shows `FLxxx`. In the transition layer, climbing traffic
  shows FL and descending traffic shows A, and level traffic keeps what it showed before. QNH comes from the METAR
  EuroScope has for the governing airfield (the nearest configured airfield within its altitude radius). Outside
  every airfield, the default TA/TL apply with the nearest METAR's QNH. Without any METAR, EuroScope's own altitude is used.
- **Transition level** per airfield: fixed, a QNH table, or auto (lowest FL at least *n* ft above the TA at the current QNH).
- **Ground filter**: hides traffic within an airfield's ground radius that is below elevation + margin and slower
  than the limit, or that EuroScope has in a ground state (STUP, PUSH, TAXI…).
- **SIDs/STARs**: imported from your sector file (.sct + .ese). They can be shown for the active runways only, and filtered by airport.
- **Points of interest**: labelled points you add in the control window.
- Smooth motion between radar updates, trails, follow an aircraft, size slider, and a transparent mode (no basemap) for compositing.

Moving the preview in the control window moves the stream map.

## Use it

1. Load the plugin in EuroScope (see its README). It listens on `ws://127.0.0.1:8765`.
2. Start the toolkit (see below). The header turns green once it's connected.
3. In OBS add a Browser Source with URL `http://localhost:7878/map.html` at your canvas size (e.g. 1920×1080).
4. Check the starter airfield values under **Airfields** (elevation, TA, TL rule) against the AIP.
5. Import SIDs/STARs under **SIDs/STARs**: pick the `.sct` and `.ese` of your sector file.

### Basemap

The map uses a [Protomaps](https://protomaps.com) `.pmtiles` file. Without one it falls back to Protomaps' public
demo file, which works for testing. For streaming, cut out a local file once:

```
pmtiles extract https://build.protomaps.com/20261101.pmtiles map.pmtiles --bbox=-25,53,33,72 --maxzoom=12
```

Put `map.pmtiles` in the toolkit's data folder, or enter its path under **Settings**. Map label fonts are bundled.

### Data folder

Settings live as JSON next to each other and can be hand-edited (restart after editing):
`config.json` (plugin URL, airfields, ground filter, basemap), `controls.json` (last live controls),
`procedures.geojson`, `pois.geojson`. In the Electron app the folder is the app's user data folder
(`%APPDATA%\vatsca-stream-toolkit` on Windows). With `npm run serve` it is `.data/`.

## Develop

```
npm install        # npm 12 runs only the install scripts listed in package.json "allowScripts" (electron, esbuild)
npm start          # build and open the Electron app
npm run serve      # same server without Electron: http://localhost:7878
npm run dev        # rebuild on change + headless server
npm test           # altitude/TL rules, ground filter, sector file import
npm run typecheck
```

Without EuroScope, run the plugin's `fake_feed` (`fake_feed 8765 12`), which serves the same protocol with simulated traffic.

Layout:

| Path | |
|---|---|
| `src/shared/` | Logic used by server and pages: plugin types, config, altitude/TL rules, ground filter, sector file import, motion smoothing |
| `src/server/` | Plugin connection, local HTTP + websocket hub, data folder (`cli.ts` runs it without Electron) |
| `src/electron/` | Electron entry: starts the server and opens the control window |
| `src/web/` | Pages: `control.html` (React) and `map.html` (MapLibre) |
| `assets/basemap/` | Bundled Noto Sans glyphs (OFL) |

Adding a tool means adding a page under `src/web/` (and to `vite.config.ts`), plus its controls in `src/shared/config.ts`.
