import { useEffect, useMemo, useState } from "react";
import { Link } from "../common/link";
import type { AppConfig, Controls, ControlsPatch } from "../../shared/config";
import type { Aircraft, AirportInfo } from "../../shared/plugin";
import type { ClientMessage, PluginStatus, PoiCollection, ServerMessage } from "../../shared/protocol";
import type { ProcedureCollection } from "../../shared/sectorfile";

export interface ToolkitState {
  linkOpen: boolean;
  config: AppConfig | null;
  controls: Controls | null;
  plugin: PluginStatus | null;
  pmtilesUrl: string;
  clients: number;
  aircraft: Aircraft[];
  airports: AirportInfo[];
  procedures: ProcedureCollection;
  pois: PoiCollection;
}

const link = new Link();

export function useToolkit() {
  const [s, setS] = useState<ToolkitState>({
    linkOpen: false, config: null, controls: null, plugin: null, pmtilesUrl: "", clients: 0,
    aircraft: [], airports: [],
    procedures: { type: "FeatureCollection", features: [] },
    pois: { type: "FeatureCollection", features: [] },
  });

  useEffect(() => {
    const offStatus = link.onStatus((open) => setS((p) => ({ ...p, linkOpen: open })));
    setS((p) => ({ ...p, linkOpen: link.open })); // may have opened before this effect ran
    const off = link.on((msg: ServerMessage) => {
      setS((p) => {
        switch (msg.type) {
          case "state":
            return { ...p, config: msg.config, controls: p.controls ?? msg.controls, plugin: { ...msg.plugin }, pmtilesUrl: msg.pmtilesUrl, clients: msg.clients };
          case "controls":
            return { ...p, controls: msg.controls };
          case "procedures":
            return { ...p, procedures: msg.procedures };
          case "pois":
            return { ...p, pois: msg.pois };
          case "plugin":
            if (msg.message.type === "aircraft") return { ...p, aircraft: msg.message.aircraft };
            if (msg.message.type === "airports") return { ...p, airports: msg.message.airports };
            return p;
          default:
            return p;
        }
      });
    });
    return () => { off(); offStatus(); };
  }, []);

  const actions = useMemo(() => ({
    setControls: (patch: ControlsPatch) => link.send({ cmd: "setControls", patch, from: link.id }),
    request: (msg: ClientMessage) => link.request(msg),
  }), []);

  return { ...s, ...actions };
}
