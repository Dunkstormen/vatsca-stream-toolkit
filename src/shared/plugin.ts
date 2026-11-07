// Messages sent by the EuroScope WebSocket Data plugin (protocol 2).
// See https://github.com/Dunkstormen/euroscope-ws-plugin/blob/main/docs/protocol.md

export interface FlightPlan {
  origin: string;
  destination: string;
  alternate: string;
  aircraftType: string;
  wakeCategory: string;
  flightRules: string;
  sid: string;
  star: string;
  departureRunway: string;
  arrivalRunway: string;
  requestedAltitude: number;
  clearedAltitude: number;
  assignedSquawk: string;
  groundState: string;
  trackingController: string;
  trackedByMe: boolean;
  state: string;
  [key: string]: unknown;
}

export interface Aircraft {
  callsign: string;
  lat: number;
  lon: number;
  /** ft, pressure altitude as EuroScope computes it (QNH corrected). */
  altitude: number;
  /** ft, standard pressure (1013.25 hPa) altitude. */
  flightLevel: number;
  groundSpeed: number;
  heading: number;
  verticalSpeed: number;
  squawk: string;
  modeC: boolean;
  ident: boolean;
  flightPlan: FlightPlan | null;
}

export interface HelloMessage {
  type: "hello";
  time: number;
  protocol: number;
  plugin: string;
  version: string;
  source: string;
  topics: string[];
  defaultTopics: string[];
  commands: boolean;
  tokenRequired: boolean;
}

export interface AircraftMessage {
  type: "aircraft";
  time: number;
  source: string;
  count: number;
  aircraft: Aircraft[];
}

export interface AirportInfo {
  icao: string;
  metar: string;
  departureRunways: string[];
  arrivalRunways: string[];
}

export interface AirportsMessage {
  type: "airports";
  time: number;
  count: number;
  airports: AirportInfo[];
}

export interface ControllersMessage {
  type: "controllers";
  time: number;
  me: { callsign: string; connectionType: string; asel: string };
  count: number;
  controllers: Array<{ callsign: string; frequency: number; facility: string; isMe: boolean; [k: string]: unknown }>;
}

export interface EventMessage {
  type: "event";
  event: string;
  time: number;
  [key: string]: unknown;
}

export type PluginMessage = HelloMessage | AircraftMessage | AirportsMessage | ControllersMessage | EventMessage;
