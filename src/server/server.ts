// The toolkit's local server: serves the tool pages (for OBS browser sources and the control
// window), the basemap file, and a websocket hub on /ws that fans out plugin data, config and
// live controls to every page.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  type AppConfig, type Controls, mergeControls, normalizeConfig, normalizeControls,
} from "../shared/config";
import type { AircraftMessage, AirportsMessage, ControllersMessage, PluginMessage } from "../shared/plugin";
import type { ClientMessage, PoiCollection, ServerMessage } from "../shared/protocol";
import { importProcedures, type ProcedureCollection } from "../shared/sectorfile";
import { PluginClient } from "./pluginClient";
import { Store } from "./store";

export const DEMO_PMTILES = "https://demo-bucket.protomaps.com/v4.pmtiles";
const LOCAL_TILES_PATH = "/tiles/map.pmtiles";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".pmtiles": "application/octet-stream", ".pbf": "application/x-protobuf", ".woff2": "font/woff2",
};

export interface ToolkitOptions {
  dataDir: string;
  /** Built web pages (dist/web). */
  webRoot: string;
  /** Bundled basemap glyphs (assets/basemap). */
  assetsDir: string;
  /** Override the port from config. */
  port?: number;
  host?: string;
}

export class Toolkit {
  readonly store: Store;
  config: AppConfig;
  controls: Controls;
  procedures: ProcedureCollection;
  pois: PoiCollection;
  readonly plugin: PluginClient;
  private server: http.Server;
  private wss: WebSocketServer;
  private latest: { aircraft?: AircraftMessage; airports?: AirportsMessage; controllers?: ControllersMessage } = {};
  private saveControlsTimer: NodeJS.Timeout | null = null;
  port = 0;

  constructor(private opts: ToolkitOptions) {
    this.store = new Store(opts.dataDir);
    this.config = normalizeConfig(this.store.read("config.json", {}));
    this.controls = normalizeControls(this.store.read("controls.json", {}));
    this.procedures = this.store.read<ProcedureCollection>("procedures.geojson", { type: "FeatureCollection", features: [] });
    this.pois = this.store.read<PoiCollection>("pois.geojson", { type: "FeatureCollection", features: [] });
    this.store.write("config.json", this.config); // so there is a file to hand-edit

    this.plugin = new PluginClient(this.config.pluginUrl);
    this.plugin.on("message", (m: PluginMessage) => this.onPluginMessage(m));
    this.plugin.on("status", () => this.broadcastState());

    this.server = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.server, path: "/ws", maxPayload: 256 * 1024 * 1024 });
    this.wss.on("connection", (ws) => this.onClient(ws));
  }

  async start(): Promise<string> {
    const port = this.opts.port ?? this.config.serverPort;
    const host = this.opts.host ?? "127.0.0.1";
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => resolve());
    });
    this.port = (this.server.address() as { port: number }).port;
    this.plugin.start();
    return `http://localhost:${this.port}`;
  }

  async stop(): Promise<void> {
    this.plugin.stop();
    if (this.saveControlsTimer) { clearTimeout(this.saveControlsTimer); this.store.write("controls.json", this.controls); }
    for (const c of this.wss.clients) c.terminate();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  /** URL the pages should load the basemap from. */
  pmtilesUrl(): string {
    const p = this.config.map.pmtiles.trim();
    if (/^https?:\/\//i.test(p)) return p;
    if (this.localPmtilesFile()) return LOCAL_TILES_PATH;
    return DEMO_PMTILES;
  }

  private localPmtilesFile(): string | null {
    const p = this.config.map.pmtiles.trim();
    const candidate = p && !/^https?:\/\//i.test(p) ? p : this.store.file("map.pmtiles");
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
  }

  // ---- plugin data ----

  private onPluginMessage(m: PluginMessage): void {
    if (m.type === "aircraft" || m.type === "airports" || m.type === "controllers") {
      this.latest[m.type] = m as never;
      this.broadcast({ type: "plugin", message: m });
    }
  }

  // ---- websocket hub ----

  private onClient(ws: WebSocket): void {
    this.send(ws, this.stateMessage());
    this.send(ws, { type: "procedures", procedures: this.procedures });
    this.send(ws, { type: "pois", pois: this.pois });
    for (const m of [this.latest.airports, this.latest.controllers, this.latest.aircraft])
      if (m) this.send(ws, { type: "plugin", message: m });
    this.broadcastState();

    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      try {
        const info = this.handleClient(msg);
        this.send(ws, { type: "result", id: msg.id, ok: true, info });
      } catch (e) {
        this.send(ws, { type: "result", id: msg.id, ok: false, error: (e as Error).message });
      }
    });
    ws.on("close", () => this.broadcastState());
  }

  private handleClient(msg: ClientMessage): unknown {
    switch (msg.cmd) {
      case "setControls":
        this.controls = mergeControls(this.controls, msg.patch ?? {});
        this.broadcast({ type: "controls", controls: this.controls, from: msg.from ?? "" });
        this.scheduleSaveControls();
        return undefined;
      case "setConfig": {
        this.config = normalizeConfig(msg.config);
        this.store.write("config.json", this.config);
        this.plugin.setUrl(this.config.pluginUrl);
        this.broadcastState();
        return undefined;
      }
      case "setPois":
        this.pois = msg.pois;
        this.store.write("pois.geojson", this.pois);
        this.broadcast({ type: "pois", pois: this.pois });
        return undefined;
      case "setProcedures":
        this.setProcedures(msg.procedures);
        return { count: msg.procedures.features.length };
      case "importSectorFile": {
        const r = importProcedures(msg.sct, msg.ese);
        const features = msg.replace ? r.procedures.features : [...this.procedures.features, ...r.procedures.features];
        this.setProcedures({ type: "FeatureCollection", features });
        return { imported: r.procedures.features.length, skipped: r.skipped, missingFixes: r.missingFixes };
      }
      default:
        throw new Error("unknown cmd");
    }
  }

  private setProcedures(p: ProcedureCollection): void {
    this.procedures = p;
    this.store.write("procedures.geojson", p);
    this.broadcast({ type: "procedures", procedures: p });
  }

  private scheduleSaveControls(): void {
    if (this.saveControlsTimer) return;
    this.saveControlsTimer = setTimeout(() => {
      this.saveControlsTimer = null;
      this.store.write("controls.json", this.controls);
    }, 1000);
  }

  private stateMessage(): ServerMessage {
    return {
      type: "state", config: this.config, controls: this.controls, plugin: this.plugin.status,
      pmtilesUrl: this.pmtilesUrl(), clients: this.wss.clients.size,
    };
  }

  private broadcastState(): void {
    this.broadcast(this.stateMessage());
  }

  private broadcast(msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const c of this.wss.clients) if (c.readyState === WebSocket.OPEN) c.send(text);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ---- http ----

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    let file: string | null;
    if (url.pathname === LOCAL_TILES_PATH) {
      file = this.localPmtilesFile();
    } else if (url.pathname.startsWith("/basemap/fonts/")) {
      const root = path.resolve(this.opts.assetsDir, "fonts");
      const resolved = path.resolve(root, "." + decodeURIComponent(url.pathname.slice("/basemap/fonts".length)));
      if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
        // An empty protobuf is a valid, empty glyph range: unusual scripts just don't render.
        res.writeHead(200, { "Content-Type": "application/x-protobuf", "Content-Length": 0 }).end();
        return;
      }
      file = resolved;
    } else if (url.pathname === "/") {
      res.writeHead(302, { Location: "/control.html" }).end();
      return;
    } else {
      const root = path.resolve(this.opts.webRoot);
      const resolved = path.resolve(root, "." + decodeURIComponent(url.pathname));
      file = resolved.startsWith(root + path.sep) ? resolved : null;
    }
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    serveFile(req, res, file);
  }
}

/** Static file with HTTP range support (PMTiles reads the archive in ranges). */
function serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
  const size = fs.statSync(file).size;
  const headers: Record<string, string | number> = {
    "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
  };
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { ...headers, "Content-Length": size });
    if (req.method === "HEAD") return void res.end();
    fs.createReadStream(file).pipe(res);
    return;
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start: number, end: number;
  if (!m || (!m[1] && !m[2])) start = end = -1;
  else if (m[1]) { start = Number(m[1]); end = Math.min(m[2] ? Number(m[2]) : size - 1, size - 1); }
  else { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  if (start < 0 || start > end || start >= size) {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` }).end();
    return;
  }
  res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
  if (req.method === "HEAD") return void res.end();
  fs.createReadStream(file, { start, end }).pipe(res);
}
