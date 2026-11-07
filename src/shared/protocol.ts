// Messages between the toolkit's server and its pages (control window and tools) on /ws.

import type { AppConfig, Controls, ControlsPatch } from "./config";
import type { AircraftMessage, AirportsMessage, ControllersMessage, HelloMessage } from "./plugin";
import type { ProcedureCollection } from "./sectorfile";

export interface PoiProperties {
  id: string;
  name: string;
  /** Optional second line under the name. */
  note: string;
}

export interface PoiFeature {
  type: "Feature";
  properties: PoiProperties;
  geometry: { type: "Point"; coordinates: [number, number] };
}

export interface PoiCollection { type: "FeatureCollection"; features: PoiFeature[] }

export interface PluginStatus {
  connected: boolean;
  url: string;
  error: string;
  hello: HelloMessage | null;
  lastMessageAt: number;
}

/** Server -> page. */
export type ServerMessage =
  | { type: "state"; config: AppConfig; controls: Controls; plugin: PluginStatus; pmtilesUrl: string; clients: number }
  | { type: "controls"; controls: Controls; from: string }
  | { type: "procedures"; procedures: ProcedureCollection }
  | { type: "pois"; pois: PoiCollection }
  | { type: "plugin"; message: AircraftMessage | AirportsMessage | ControllersMessage }
  | { type: "result"; id?: number; ok: boolean; error?: string; info?: unknown };

/** Page -> server. `from` identifies the sending page so it can ignore its own echoes. */
export type ClientMessage =
  | { cmd: "setControls"; patch: ControlsPatch; from?: string; id?: number }
  | { cmd: "setConfig"; config: AppConfig; id?: number }
  | { cmd: "setPois"; pois: PoiCollection; id?: number }
  | { cmd: "setProcedures"; procedures: ProcedureCollection; id?: number }
  | { cmd: "importSectorFile"; sct: string; ese: string; replace: boolean; id?: number };
