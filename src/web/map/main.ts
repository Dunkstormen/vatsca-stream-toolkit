// Traffic map tool. Loaded by OBS as a browser source (http://localhost:7878/map.html) and by
// the control window as a preview. With ?director=1 the page is interactive and moving it moves
// every other map page; without it the page only follows the controls.
//
// URL parameters: director=1, status=1 (show connection problems on the page), server=ws://...

import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 loads its worker from a separate module; let Vite emit it and point MapLibre at it.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { Protocol } from "pmtiles";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { Link } from "../common/link";
import type { AppConfig, Controls } from "../../shared/config";
import { DEFAULT_CONFIG, DEFAULT_CONTROLS } from "../../shared/config";
import type { Aircraft, AirportInfo } from "../../shared/plugin";
import type { PoiCollection } from "../../shared/protocol";
import type { ProcedureCollection } from "../../shared/sectorfile";
import { formatLevel, transitionContext, type LevelMode } from "../../shared/altitude";
import { isOnGround } from "../../shared/ground";
import { MotionTracker } from "../../shared/motion";
import { aircraftIcon } from "./icons";
import { filterProcedures, procedureFixes } from "./procedures";

const params = new URLSearchParams(location.search);
const director = params.get("director") === "1";
const showStatus = params.get("status") === "1";
document.body.classList.toggle("director", director);

// Glyphs are bundled with the app (assets/basemap) so labels work offline.
const GLYPHS = `${location.origin}/basemap/fonts/{fontstack}/{range}.pbf`;
const TRAIL_POINTS = 12;
const FRAME_MS = 50;

maplibregl.setWorkerUrl(new URL(workerUrl, location.href).href);

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// ---- state ----
let config: AppConfig = DEFAULT_CONFIG;
let controls: Controls = DEFAULT_CONTROLS;
let pmtilesUrl = "";
let aircraft: Aircraft[] = [];
const airports = new Map<string, AirportInfo>();
let procedures: ProcedureCollection = { type: "FeatureCollection", features: [] };
let pois: PoiCollection = { type: "FeatureCollection", features: [] };
const levelModes = new Map<string, LevelMode>();
const trails = new Map<string, Array<[number, number]>>();
const motion = new MotionTracker();
let styleKey = "";

const map = new maplibregl.Map({
  container: "map",
  style: emptyStyle(),
  center: controls.map.view.center,
  zoom: controls.map.view.zoom,
  attributionControl: { compact: true },
  interactive: director,
  fadeDuration: 0,
});
if (director) map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
map.on("error", (e) => console.warn("map:", e.error?.message ?? e));

function emptyStyle(): StyleSpecification {
  return { version: 8, glyphs: GLYPHS, sources: {}, layers: [] };
}

function basemapStyle(): StyleSpecification {
  const flavor = config.map.flavor;
  if (controls.map.transparent || !pmtilesUrl) return emptyStyle();
  const url = pmtilesUrl.startsWith("/") ? location.origin + pmtilesUrl : pmtilesUrl;
  return {
    version: 8,
    glyphs: GLYPHS,
    sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavor}`,
    sources: {
      protomaps: {
        type: "vector",
        url: "pmtiles://" + url,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
      },
    },
    layers: layers("protomaps", namedFlavor(flavor), { lang: "en" }),
  };
}

/** Re-applies the basemap when anything that affects it changed (setStyle drops our layers, which style.load re-adds). */
function applyStyle(): void {
  const key = JSON.stringify([pmtilesUrl, config.map.flavor, controls.map.transparent]);
  if (key === styleKey) return;
  styleKey = key;
  document.body.classList.toggle("transparent", controls.map.transparent);
  map.setStyle(basemapStyle(), { diff: false });
}

const empty = () => ({ type: "FeatureCollection" as const, features: [] });
const dark = () => ["dark", "black", "grayscale"].includes(config.map.flavor) || controls.map.transparent;

function addOverlayLayers(): void {
  const s = controls.map.scale;
  const text = dark() ? "#f2f4f7" : "#111418";
  const halo = dark() ? "rgba(10,12,16,0.9)" : "rgba(255,255,255,0.9)";
  const icons = {
    "ac": aircraftIcon("#f2f4f7", "#0b0d10"),
    "ac-mine": aircraftIcon("#4fc3f7", "#0b0d10"),
    "ac-follow": aircraftIcon("#ff9e3d", "#0b0d10"),
  };
  for (const [name, img] of Object.entries(icons)) if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });

  // Ids are prefixed: the Protomaps basemap has its own "pois" layer.
  for (const id of ["tk-procedures", "tk-fixes", "tk-pois", "tk-trails", "tk-aircraft"])
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: empty() });
  // style.load can fire more than once for the same style while the first state arrives.
  if (map.getLayer("tk-aircraft")) return;

  map.addLayer({
    id: "tk-procedures", type: "line", source: "tk-procedures",
    paint: {
      "line-color": ["match", ["get", "kind"], "SID", "#5ad18c", "#d685ff"],
      "line-width": 1.6 * s, "line-opacity": 0.8,
      "line-dasharray": ["match", ["get", "kind"], "SID", ["literal", [1, 0]], ["literal", [3, 2]]],
    },
  });
  map.addLayer({
    id: "tk-fixes", type: "symbol", source: "tk-fixes", minzoom: 7,
    layout: {
      "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 10 * s,
      "text-offset": [0, 0.9], "icon-allow-overlap": true,
    },
    paint: { "text-color": ["match", ["get", "kind"], "SID", "#5ad18c", "#d685ff"], "text-halo-color": halo, "text-halo-width": 1.2 },
  });
  map.addLayer({
    id: "tk-fix-dots", type: "circle", source: "tk-fixes", minzoom: 7,
    paint: { "circle-radius": 2.5 * s, "circle-color": ["match", ["get", "kind"], "SID", "#5ad18c", "#d685ff"] },
  });
  map.addLayer({
    id: "tk-pois", type: "circle", source: "tk-pois",
    paint: { "circle-radius": 5 * s, "circle-color": "#ffd166", "circle-stroke-color": "#0b0d10", "circle-stroke-width": 1.5 },
  });
  map.addLayer({
    id: "tk-poi-labels", type: "symbol", source: "tk-pois",
    layout: {
      "text-field": ["format", ["get", "name"], { "font-scale": 1 }, "\n", {}, ["get", "note"], { "font-scale": 0.8 }],
      "text-font": ["Noto Sans Medium"], "text-size": 13 * s, "text-anchor": "top", "text-offset": [0, 0.8],
    },
    paint: { "text-color": "#ffd166", "text-halo-color": halo, "text-halo-width": 1.5 },
  });
  map.addLayer({
    id: "tk-trails", type: "line", source: "tk-trails",
    paint: { "line-color": text, "line-width": 1.5 * s, "line-opacity": 0.35 },
  });
  map.addLayer({
    id: "tk-aircraft", type: "symbol", source: "tk-aircraft",
    layout: {
      "icon-image": ["case", ["get", "follow"], "ac-follow", ["get", "mine"], "ac-mine", "ac"],
      "icon-size": 0.9 * s,
      "icon-rotate": ["get", "hdg"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-field": [
        "format",
        ["get", "callsign"], { "text-font": ["literal", ["Noto Sans Medium"]] },
        "\n", {},
        ["get", "line2"], { "font-scale": 0.9, "text-font": ["literal", ["Noto Sans Regular"]] },
      ],
      "text-font": ["Noto Sans Medium"],
      "text-size": 13 * s,
      "text-anchor": "left",
      "text-justify": "left",
      "text-offset": [1.3, 0],
      "text-allow-overlap": true,
      "text-optional": true,
    },
    paint: { "text-color": text, "text-halo-color": halo, "text-halo-width": 1.6 },
  });
  applyVisibility();
  updateProcedures();
  updatePois();
}

map.on("style.load", addOverlayLayers);

function setVisible(id: string, on: boolean): void {
  if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

function applyVisibility(): void {
  const c = controls.map;
  setVisible("tk-trails", c.showTrails);
  setVisible("tk-pois", c.showPois);
  setVisible("tk-poi-labels", c.showPois);
}

const OVERLAY_LAYERS = ["tk-procedures", "tk-fixes", "tk-fix-dots", "tk-pois", "tk-poi-labels", "tk-trails", "tk-aircraft"];

/** Sizes are baked into the layers, so a scale change rebuilds them (sources and data stay). */
function rebuildOverlays(): void {
  for (const id of OVERLAY_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  addOverlayLayers();
}

function onControls(next: Controls, fromSelf: boolean): void {
  const prev = controls;
  controls = next;
  applyStyle();
  if (map.getLayer("tk-aircraft")) {
    if (next.map.scale !== prev.map.scale) rebuildOverlays();
    applyVisibility();
    updateProcedures();
  }
  if (!fromSelf && !next.map.follow) {
    const v = next.map.view;
    const p = prev.map.view;
    if (v.center[0] !== p.center[0] || v.center[1] !== p.center[1] || v.zoom !== p.zoom || v.bearing !== p.bearing)
      map.easeTo({ center: v.center, zoom: v.zoom, bearing: v.bearing, duration: director ? 0 : 1200 });
  } else if (!fromSelf && next.map.view.zoom !== prev.map.view.zoom) {
    map.easeTo({ zoom: next.map.view.zoom, bearing: next.map.view.bearing, duration: director ? 0 : 1200 });
  }
}

// ---- director: user moves the map -> everyone follows ----
if (director) {
  map.on("moveend", (e) => {
    if (!(e as { originalEvent?: unknown }).originalEvent) return; // our own easeTo/jumpTo
    const c = map.getCenter();
    const view = { center: [round(c.lng, 5), round(c.lat, 5)] as [number, number], zoom: round(map.getZoom(), 2), bearing: round(map.getBearing(), 1) };
    controls = { map: { ...controls.map, view } };
    link.send({ cmd: "setControls", patch: { map: { view } }, from: link.id });
  });
}
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

// ---- data from the toolkit ----
const link = new Link();
const statusEl = document.getElementById("status")!;
let pluginConnected = false;
function showConn(): void {
  const problem = !link.open ? "Toolkit not reachable" : !pluginConnected ? "EuroScope plugin not connected" : "";
  statusEl.textContent = problem;
  statusEl.style.display = showStatus && problem ? "block" : "none";
}
link.onStatus(showConn);

link.on((msg) => {
  switch (msg.type) {
    case "state": {
      const firstState = pmtilesUrl === "";
      config = msg.config;
      pmtilesUrl = msg.pmtilesUrl;
      pluginConnected = msg.plugin.connected;
      showConn();
      if (firstState) {
        controls = msg.controls;
        const v = controls.map.view;
        map.jumpTo({ center: v.center, zoom: v.zoom, bearing: v.bearing });
      }
      applyStyle();
      break;
    }
    case "controls":
      onControls(msg.controls, msg.from === link.id);
      break;
    case "procedures":
      procedures = msg.procedures;
      updateProcedures();
      break;
    case "pois":
      pois = msg.pois;
      updatePois();
      break;
    case "plugin": {
      const m = msg.message;
      if (m.type === "aircraft") onAircraft(m.aircraft);
      else if (m.type === "airports") {
        airports.clear();
        for (const a of m.airports) airports.set(a.icao, a);
        updateProcedures();
      }
      break;
    }
  }
});

function onAircraft(list: Aircraft[]): void {
  aircraft = list;
  const now = performance.now();
  const alive = new Set<string>();
  for (const a of list) {
    alive.add(a.callsign);
    motion.update(a.callsign, a.lat, a.lon, a.groundSpeed, a.heading, now);
    const t = trails.get(a.callsign) ?? [];
    const last = t[t.length - 1];
    if (!last || last[0] !== a.lon || last[1] !== a.lat) t.push([a.lon, a.lat]);
    if (t.length > TRAIL_POINTS) t.shift();
    trails.set(a.callsign, t);
  }
  motion.retain(alive);
  for (const k of [...trails.keys()]) if (!alive.has(k)) trails.delete(k);
  for (const k of [...levelModes.keys()]) if (!alive.has(k)) levelModes.delete(k);
}

function updateProcedures(): void {
  const src = map.getSource("tk-procedures") as GeoJSONSource | undefined;
  const fixes = map.getSource("tk-fixes") as GeoJSONSource | undefined;
  if (!src || !fixes) return;
  const shown = filterProcedures(procedures, controls.map, airports);
  src.setData(shown);
  fixes.setData(procedureFixes(shown));
}

function updatePois(): void {
  (map.getSource("tk-pois") as GeoJSONSource | undefined)?.setData(pois);
}

// ---- per-frame aircraft rendering ----
let lastFrame = 0;
function frame(t: number): void {
  requestAnimationFrame(frame);
  if (t - lastFrame < FRAME_MS) return;
  lastFrame = t;
  const src = map.getSource("tk-aircraft") as GeoJSONSource | undefined;
  if (!src) return;
  const c = controls.map;
  const features: GeoJSON.Feature[] = [];
  const trailFeatures: GeoJSON.Feature[] = [];
  let followPos: [number, number] | null = null;
  for (const a of aircraft) {
    const ctx = transitionContext(config, airports, a.lat, a.lon);
    const level = formatLevel(a, ctx, levelModes.get(a.callsign));
    levelModes.set(a.callsign, level.mode);
    if (c.hideGround && isOnGround(a, level.altitudeFt, config)) continue;
    const shown = c.smoothMotion ? motion.shown(a.callsign, t) : null;
    const lon = shown?.lon ?? a.lon;
    const lat = shown?.lat ?? a.lat;
    const follow = c.follow !== "" && a.callsign === c.follow;
    if (follow) followPos = [lon, lat];
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        callsign: c.showLabels ? a.callsign : "",
        line2: c.showLabels ? `${level.text}  ${String(a.groundSpeed).padStart(3, "0")}` : "",
        hdg: shown?.hdg ?? a.heading,
        mine: !!a.flightPlan?.trackedByMe,
        follow,
      },
    });
    const trail = trails.get(a.callsign);
    if (c.showTrails && trail && trail.length > 1)
      trailFeatures.push({ type: "Feature", geometry: { type: "LineString", coordinates: [...trail, [lon, lat]] }, properties: {} });
  }
  src.setData({ type: "FeatureCollection", features });
  (map.getSource("tk-trails") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: trailFeatures });
  if (followPos) map.jumpTo({ center: followPos });
}
requestAnimationFrame(frame);
