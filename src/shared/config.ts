// Persistent configuration (saved as config.json in the app's data folder) and the live
// controls that the control window changes while streaming.

/** How the transition level is found for an airfield. */
export type TransitionLevelRule =
  /** Always this flight level, e.g. 70 for FL070. */
  | { mode: "fixed"; fl: number }
  /** First row whose qnhMin <= QNH wins; rows are checked from the highest qnhMin down. */
  | { mode: "table"; table: Array<{ qnhMin: number; fl: number }> }
  /** Lowest flight level (in steps of `stepFl`) that is at least `layerFt` above the TA at the current QNH. */
  | { mode: "auto"; layerFt: number; stepFl: number };

export interface Airfield {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  elevationFt: number;
  transitionAltitudeFt: number;
  transitionLevel: TransitionLevelRule;
  /** Aircraft within this radius use this airfield's QNH, TA and TL. */
  altitudeRadiusNm: number;
  /** Aircraft within this radius can be classed as "on the ground" here. */
  groundRadiusNm: number;
}

export interface GroundFilterConfig {
  /** On the ground if less than this many feet above the airfield elevation... */
  marginFt: number;
  /** ...and slower than this. */
  maxGroundSpeed: number;
  /** Also treat EuroScope ground states (STUP, PUSH, TAXI, ...) as on the ground. */
  useGroundState: boolean;
}

export interface MapConfig {
  /** Local .pmtiles file path, or an http(s) URL. Empty: map.pmtiles in the data folder, else the Protomaps demo. */
  pmtiles: string;
  /** Protomaps basemap flavour. */
  flavor: "dark" | "light" | "black" | "white" | "grayscale";
}

export interface AppConfig {
  version: 1;
  pluginUrl: string;
  /** Port of the toolkit's own server that tools (OBS browser sources) load from. */
  serverPort: number;
  /** Used outside every airfield's altitude radius. QNH then comes from the nearest airfield with a METAR. */
  defaultTransition: { transitionAltitudeFt: number; transitionLevel: TransitionLevelRule };
  groundFilter: GroundFilterConfig;
  map: MapConfig;
  airfields: Airfield[];
}

export interface MapView {
  center: [number, number];
  zoom: number;
  bearing: number;
}

export interface MapControls {
  view: MapView;
  /** Callsign to keep centred, or "" for none. */
  follow: string;
  hideGround: boolean;
  showLabels: boolean;
  showTrails: boolean;
  showSids: boolean;
  showStars: boolean;
  /** Only draw SIDs/STARs for the runways EuroScope reports as active. */
  activeRunwaysOnly: boolean;
  /** Only draw procedures for these airports (empty: all). */
  procedureAirports: string[];
  showPois: boolean;
  /** Draw no basemap, only traffic and overlays (for compositing in OBS). */
  transparent: boolean;
  smoothMotion: boolean;
  /** Scales icons and labels, for different stream resolutions. */
  scale: number;
}

export interface Controls {
  map: MapControls;
}

export const DEFAULT_CONTROLS: Controls = {
  map: {
    view: { center: [12.65, 55.62], zoom: 8, bearing: 0 },
    follow: "",
    hideGround: false,
    showLabels: true,
    showTrails: true,
    showSids: false,
    showStars: false,
    activeRunwaysOnly: true,
    procedureAirports: [],
    showPois: true,
    transparent: false,
    smoothMotion: true,
    scale: 1,
  },
};

const auto: TransitionLevelRule = { mode: "auto", layerFt: 1000, stepFl: 10 };

function airfield(icao: string, name: string, lat: number, lon: number, elevationFt: number, ta: number): Airfield {
  return {
    icao, name, lat, lon, elevationFt,
    transitionAltitudeFt: ta,
    transitionLevel: auto,
    altitudeRadiusNm: 40,
    groundRadiusNm: 3,
  };
}

// Starter values only: check elevation, TA and the TL rule against the AIP before streaming.
export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  pluginUrl: "ws://127.0.0.1:8765",
  serverPort: 7878,
  defaultTransition: { transitionAltitudeFt: 5000, transitionLevel: auto },
  groundFilter: { marginFt: 200, maxGroundSpeed: 50, useGroundState: true },
  map: { pmtiles: "", flavor: "dark" },
  airfields: [
    airfield("EKCH", "Copenhagen Kastrup", 55.6181, 12.6561, 17, 5000),
    airfield("EKBI", "Billund", 55.7403, 9.1518, 247, 5000),
    airfield("ESSA", "Stockholm Arlanda", 59.6519, 17.9186, 137, 5000),
    airfield("ESGG", "Göteborg Landvetter", 57.6628, 12.2798, 506, 5000),
    airfield("ENGM", "Oslo Gardermoen", 60.1939, 11.1004, 681, 7000),
    airfield("BIKF", "Keflavík", 63.985, -22.6056, 171, 7000),
  ],
};

/** Fills in anything missing from a saved config (older file, hand edits) with defaults. */
export function normalizeConfig(raw: unknown): AppConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<AppConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...c,
    version: 1,
    defaultTransition: { ...DEFAULT_CONFIG.defaultTransition, ...c.defaultTransition },
    groundFilter: { ...DEFAULT_CONFIG.groundFilter, ...c.groundFilter },
    map: { ...DEFAULT_CONFIG.map, ...c.map },
    airfields: Array.isArray(c.airfields)
      ? c.airfields.map((a) => ({ ...airfield(a.icao, a.name, a.lat, a.lon, a.elevationFt, a.transitionAltitudeFt), ...a }))
      : DEFAULT_CONFIG.airfields,
  };
}

export function normalizeControls(raw: unknown): Controls {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<Controls>;
  return { map: { ...DEFAULT_CONTROLS.map, ...c.map } };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends Array<unknown> ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type ControlsPatch = DeepPartial<Controls>;

export function mergeControls(c: Controls, patch: ControlsPatch): Controls {
  return normalizeControls({ map: { ...c.map, ...patch.map, view: { ...c.map.view, ...patch.map?.view } } });
}
