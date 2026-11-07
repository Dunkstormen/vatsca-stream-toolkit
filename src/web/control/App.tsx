import { useEffect, useMemo, useState } from "react";
import { useToolkit } from "./useToolkit";
import type { Airfield, AppConfig, MapControls, TransitionLevelRule } from "../../shared/config";
import type { PoiFeature } from "../../shared/protocol";
import { formatLevel, parseQnh, transitionContext } from "../../shared/altitude";
import { isOnGround } from "../../shared/ground";

type Tk = ReturnType<typeof useToolkit>;
type Tab = "map" | "airfields" | "procedures" | "pois" | "settings";

export function App() {
  const tk = useToolkit();
  const [tab, setTab] = useState<Tab>("map");
  const origin = location.origin;

  return (
    <div className="app">
      <header>
        <h1>VATSCA Stream Toolkit</h1>
        <Status tk={tk} />
      </header>
      <main>
        <section className="preview">
          <div className="frame">
            <iframe src="/map.html?director=1" title="Map preview" />
          </div>
          <div className="obs">
            <span>OBS Browser Source</span>
            <code>{origin}/map.html</code>
            <button onClick={() => navigator.clipboard.writeText(`${origin}/map.html`)}>Copy</button>
            <span className="hint">Move the preview to move the stream map. {tk.clients} page(s) connected.</span>
          </div>
        </section>
        <aside>
          <nav>
            {(["map", "airfields", "procedures", "pois", "settings"] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {{ map: "Map", airfields: "Airfields", procedures: "SIDs/STARs", pois: "POIs", settings: "Settings" }[t]}
              </button>
            ))}
          </nav>
          {!tk.config || !tk.controls ? <p className="hint">Connecting to the toolkit…</p> : (
            <>
              {tab === "map" && <MapTab tk={tk} c={tk.controls.map} />}
              {tab === "airfields" && <AirfieldsTab tk={tk} config={tk.config} />}
              {tab === "procedures" && <ProceduresTab tk={tk} />}
              {tab === "pois" && <PoisTab tk={tk} />}
              {tab === "settings" && <SettingsTab tk={tk} config={tk.config} />}
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

function Status({ tk }: { tk: Tk }) {
  const p = tk.plugin;
  const pluginOk = tk.linkOpen && p?.connected;
  return (
    <div className="status">
      <span className={"dot " + (pluginOk ? "ok" : "bad")} />
      {!tk.linkOpen ? "Toolkit server not reachable"
        : !p?.connected ? `Waiting for EuroScope plugin at ${p?.url ?? ""}${p?.error ? ` (${p.error})` : ""}`
          : `EuroScope ${p.hello?.source ?? ""} · plugin ${p.hello?.version ?? "?"} · ${tk.aircraft.length} aircraft`}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

function MapTab({ tk, c }: { tk: Tk; c: MapControls }) {
  const set = (patch: Partial<MapControls>) => tk.setControls({ map: patch });
  const config = tk.config!;
  const airports = useMemo(() => new Map(tk.airports.map((a) => [a.icao, a])), [tk.airports]);
  const rows = useMemo(() => [...tk.aircraft].sort((a, b) => a.callsign.localeCompare(b.callsign)).map((a) => {
    const ctx = transitionContext(config, airports, a.lat, a.lon);
    const level = formatLevel(a, ctx);
    return { a, level: level.text, ground: isOnGround(a, level.altitudeFt, config) };
  }), [tk.aircraft, airports, config]);

  return (
    <div className="panel">
      <h2>Layers</h2>
      <div className="grid2">
        <Toggle label="Hide traffic on the ground" checked={c.hideGround} onChange={(v) => set({ hideGround: v })} />
        <Toggle label="Labels" checked={c.showLabels} onChange={(v) => set({ showLabels: v })} />
        <Toggle label="Trails" checked={c.showTrails} onChange={(v) => set({ showTrails: v })} />
        <Toggle label="Smooth motion" checked={c.smoothMotion} onChange={(v) => set({ smoothMotion: v })} />
        <Toggle label="SIDs" checked={c.showSids} onChange={(v) => set({ showSids: v })} />
        <Toggle label="STARs" checked={c.showStars} onChange={(v) => set({ showStars: v })} />
        <Toggle label="Active runways only" checked={c.activeRunwaysOnly} onChange={(v) => set({ activeRunwaysOnly: v })} />
        <Toggle label="Points of interest" checked={c.showPois} onChange={(v) => set({ showPois: v })} />
        <Toggle label="Transparent (no basemap)" checked={c.transparent} onChange={(v) => set({ transparent: v })} />
      </div>
      <label className="row">Size
        <input type="range" min={0.6} max={2.5} step={0.1} value={c.scale} onChange={(e) => set({ scale: Number(e.target.value) })} />
        <span>{c.scale.toFixed(1)}×</span>
      </label>

      <h2>Camera</h2>
      <div className="chips">
        {config.airfields.map((f) => (
          <button key={f.icao} onClick={() => set({ follow: "", view: { center: [f.lon, f.lat], zoom: 9.5, bearing: 0 } })}>{f.icao}</button>
        ))}
      </div>
      <label className="row">Follow
        <select value={c.follow} onChange={(e) => set({ follow: e.target.value })}>
          <option value="">Nobody</option>
          {rows.map(({ a }) => <option key={a.callsign} value={a.callsign}>{a.callsign}</option>)}
        </select>
      </label>
      <label className="row">Zoom
        <input type="range" min={3} max={15} step={0.25} value={c.view.zoom} onChange={(e) => set({ view: { ...c.view, zoom: Number(e.target.value) } })} />
        <span>{c.view.zoom.toFixed(1)}</span>
      </label>

      <h2>Traffic</h2>
      <table className="list">
        <thead><tr><th>Callsign</th><th>Level</th><th>GS</th><th>Route</th><th /></tr></thead>
        <tbody>
          {rows.map(({ a, level, ground }) => (
            <tr key={a.callsign} className={c.follow === a.callsign ? "sel" : ""} onClick={() => set({ follow: c.follow === a.callsign ? "" : a.callsign })}>
              <td>{a.callsign}</td><td>{level}</td><td>{a.groundSpeed}</td>
              <td>{a.flightPlan ? `${a.flightPlan.origin}–${a.flightPlan.destination}` : ""}</td>
              <td>{ground ? <span className="tag">GND</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="hint">No traffic yet.</p>}
    </div>
  );
}

function NumberInput({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input type="number" step={step} value={text}
      onChange={(e) => { setText(e.target.value); if (e.target.value !== "" && !isNaN(Number(e.target.value))) onChange(Number(e.target.value)); }} />
  );
}

function useDraft(config: AppConfig) {
  const [draft, setDraft] = useState(config);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setDraft(config); }, [config, dirty]);
  return {
    draft,
    dirty,
    update: (fn: (c: AppConfig) => AppConfig) => { setDraft((d) => fn(structuredClone(d))); setDirty(true); },
    reset: () => { setDraft(config); setDirty(false); },
    done: () => setDirty(false),
  };
}

function SaveBar({ tk, d }: { tk: Tk; d: ReturnType<typeof useDraft> }) {
  const [err, setErr] = useState("");
  if (!d.dirty) return null;
  return (
    <div className="savebar">
      <button className="primary" onClick={async () => {
        const r = await tk.request({ cmd: "setConfig", config: d.draft });
        if (r.ok) { d.done(); setErr(""); } else setErr(r.error ?? "Failed");
      }}>Save</button>
      <button onClick={d.reset}>Discard</button>
      {err && <span className="err">{err}</span>}
    </div>
  );
}

function TlRuleEditor({ rule, onChange }: { rule: TransitionLevelRule; onChange: (r: TransitionLevelRule) => void }) {
  return (
    <div className="tl">
      <select value={rule.mode} onChange={(e) => {
        const m = e.target.value;
        onChange(m === "fixed" ? { mode: "fixed", fl: 70 } : m === "table"
          ? { mode: "table", table: [{ qnhMin: 1013, fl: 60 }, { qnhMin: 978, fl: 70 }, { qnhMin: 0, fl: 80 }] }
          : { mode: "auto", layerFt: 1000, stepFl: 10 });
      }}>
        <option value="auto">Auto</option>
        <option value="fixed">Fixed</option>
        <option value="table">QNH table</option>
      </select>
      {rule.mode === "fixed" && <>FL <NumberInput value={rule.fl} onChange={(fl) => onChange({ ...rule, fl })} /></>}
      {rule.mode === "auto" && <>layer ≥ <NumberInput value={rule.layerFt} step={100} onChange={(layerFt) => onChange({ ...rule, layerFt })} /> ft, steps of FL <NumberInput value={rule.stepFl} onChange={(stepFl) => onChange({ ...rule, stepFl })} /></>}
      {rule.mode === "table" && (
        <div className="tltable">
          {rule.table.map((r, i) => (
            <div key={i}>QNH ≥ <NumberInput value={r.qnhMin} onChange={(v) => { const t = [...rule.table]; t[i] = { ...r, qnhMin: v }; onChange({ ...rule, table: t }); }} />
              → FL <NumberInput value={r.fl} onChange={(v) => { const t = [...rule.table]; t[i] = { ...r, fl: v }; onChange({ ...rule, table: t }); }} />
              <button onClick={() => onChange({ ...rule, table: rule.table.filter((_, j) => j !== i) })}>×</button></div>
          ))}
          <button onClick={() => onChange({ ...rule, table: [...rule.table, { qnhMin: 0, fl: 80 }] })}>Add row</button>
        </div>
      )}
    </div>
  );
}

function AirfieldsTab({ tk, config }: { tk: Tk; config: AppConfig }) {
  const d = useDraft(config);
  const airports = useMemo(() => new Map(tk.airports.map((a) => [a.icao, a])), [tk.airports]);
  const setField = (i: number, patch: Partial<Airfield>) => d.update((c) => { c.airfields[i] = { ...c.airfields[i], ...patch }; return c; });

  return (
    <div className="panel">
      <p className="hint">Starter values: check elevation, TA and TL against the AIP. Tags show <b>Axxx</b> at or below the TA and <b>FLxxx</b> at or above the TL; in between, climbing traffic shows FL and descending traffic shows A. QNH comes from EuroScope's METAR for the airfield.</p>
      <SaveBar tk={tk} d={d} />
      {d.draft.airfields.map((f, i) => {
        const metar = airports.get(f.icao)?.metar ?? "";
        const qnh = metar ? parseQnh(metar) : null;
        const ctx = transitionContext(d.draft, airports, f.lat, f.lon);
        return (
          <div className="card" key={i}>
            <div className="cardhead">
              <input className="icao" value={f.icao} onChange={(e) => setField(i, { icao: e.target.value.toUpperCase() })} />
              <input value={f.name} onChange={(e) => setField(i, { name: e.target.value })} />
              <button onClick={() => d.update((c) => { c.airfields.splice(i, 1); return c; })}>Remove</button>
            </div>
            <div className="fields">
              <label>Lat <NumberInput step={0.0001} value={f.lat} onChange={(lat) => setField(i, { lat })} /></label>
              <label>Lon <NumberInput step={0.0001} value={f.lon} onChange={(lon) => setField(i, { lon })} /></label>
              <label>Elevation ft <NumberInput value={f.elevationFt} onChange={(elevationFt) => setField(i, { elevationFt })} /></label>
              <label>TA ft <NumberInput step={500} value={f.transitionAltitudeFt} onChange={(v) => setField(i, { transitionAltitudeFt: v })} /></label>
              <label>Altitude radius nm <NumberInput value={f.altitudeRadiusNm} onChange={(v) => setField(i, { altitudeRadiusNm: v })} /></label>
              <label>Ground radius nm <NumberInput step={0.5} value={f.groundRadiusNm} onChange={(v) => setField(i, { groundRadiusNm: v })} /></label>
            </div>
            <div className="row">TL <TlRuleEditor rule={f.transitionLevel} onChange={(r) => setField(i, { transitionLevel: r })} /></div>
            <div className="hint">{qnh ? `QNH ${qnh} → TL FL${String(ctx.tl).padStart(3, "0")}` : "No METAR from EuroScope yet"}{metar ? ` · ${metar}` : ""}</div>
          </div>
        );
      })}
      <button onClick={() => d.update((c) => {
        const v = tk.controls!.map.view;
        c.airfields.push({ icao: "XXXX", name: "", lat: v.center[1], lon: v.center[0], elevationFt: 0, transitionAltitudeFt: 5000,
          transitionLevel: { mode: "auto", layerFt: 1000, stepFl: 10 }, altitudeRadiusNm: 40, groundRadiusNm: 3 });
        return c;
      })}>Add airfield at map centre</button>

      <h2>Outside all airfields</h2>
      <div className="fields">
        <label>TA ft <NumberInput step={500} value={d.draft.defaultTransition.transitionAltitudeFt} onChange={(v) => d.update((c) => { c.defaultTransition.transitionAltitudeFt = v; return c; })} /></label>
      </div>
      <div className="row">TL <TlRuleEditor rule={d.draft.defaultTransition.transitionLevel} onChange={(r) => d.update((c) => { c.defaultTransition.transitionLevel = r; return c; })} /></div>

      <h2>Ground filter</h2>
      <div className="fields">
        <label>Below elevation + ft <NumberInput step={50} value={d.draft.groundFilter.marginFt} onChange={(v) => d.update((c) => { c.groundFilter.marginFt = v; return c; })} /></label>
        <label>Slower than kt <NumberInput step={5} value={d.draft.groundFilter.maxGroundSpeed} onChange={(v) => d.update((c) => { c.groundFilter.maxGroundSpeed = v; return c; })} /></label>
      </div>
      <Toggle label="Also use EuroScope ground states (STUP, PUSH, TAXI…)" checked={d.draft.groundFilter.useGroundState} onChange={(v) => d.update((c) => { c.groundFilter.useGroundState = v; return c; })} />
      <SaveBar tk={tk} d={d} />
    </div>
  );
}

function ProceduresTab({ tk }: { tk: Tk }) {
  const [sct, setSct] = useState<File | null>(null);
  const [ese, setEse] = useState<File | null>(null);
  const [replace, setReplace] = useState(true);
  const [msg, setMsg] = useState("");
  const c = tk.controls!.map;
  const byAirport = useMemo(() => {
    const m = new Map<string, { sid: number; star: number }>();
    for (const f of tk.procedures.features) {
      const e = m.get(f.properties.airport) ?? { sid: 0, star: 0 };
      if (f.properties.kind === "SID") e.sid++; else e.star++;
      m.set(f.properties.airport, e);
    }
    return [...m.entries()].sort();
  }, [tk.procedures]);

  async function doImport() {
    if (!sct || !ese) return;
    setMsg("Importing…");
    const r = await tk.request({ cmd: "importSectorFile", sct: await sct.text(), ese: await ese.text(), replace });
    if (!r.ok) return setMsg(r.error ?? "Import failed");
    const info = r.info as { imported: number; skipped: number; missingFixes: Record<string, number> };
    const missing = Object.keys(info.missingFixes);
    setMsg(`Imported ${info.imported} procedures${info.skipped ? `, skipped ${info.skipped}` : ""}${missing.length ? `. Fixes not found: ${missing.slice(0, 15).join(", ")}${missing.length > 15 ? "…" : ""}` : ""}`);
  }

  const toggleAirport = (icao: string) => {
    const set = new Set(c.procedureAirports);
    if (set.has(icao)) set.delete(icao); else set.add(icao);
    tk.setControls({ map: { procedureAirports: [...set] } });
  };

  return (
    <div className="panel">
      <h2>Import from sector file</h2>
      <p className="hint">Pick the .sct and .ese of your sector file (e.g. from the VATSCA package). Procedures are read from the .ese [SIDSSTARS] section and fixes from the .sct.</p>
      <label className="row">.sct <input type="file" accept=".sct,.sct2" onChange={(e) => setSct(e.target.files?.[0] ?? null)} /></label>
      <label className="row">.ese <input type="file" accept=".ese" onChange={(e) => setEse(e.target.files?.[0] ?? null)} /></label>
      <Toggle label="Replace existing procedures" checked={replace} onChange={setReplace} />
      <button className="primary" disabled={!sct || !ese} onClick={doImport}>Import</button>
      {msg && <p className="hint">{msg}</p>}

      <h2>Show</h2>
      <div className="grid2">
        <Toggle label="SIDs" checked={c.showSids} onChange={(v) => tk.setControls({ map: { showSids: v } })} />
        <Toggle label="STARs" checked={c.showStars} onChange={(v) => tk.setControls({ map: { showStars: v } })} />
        <Toggle label="Active runways only" checked={c.activeRunwaysOnly} onChange={(v) => tk.setControls({ map: { activeRunwaysOnly: v } })} />
      </div>
      <p className="hint">Airports (none selected = all):</p>
      <div className="chips">
        {byAirport.map(([icao, n]) => (
          <button key={icao} className={c.procedureAirports.includes(icao) ? "on" : ""} onClick={() => toggleAirport(icao)}>
            {icao} <small>{n.sid} SID · {n.star} STAR</small>
          </button>
        ))}
      </div>
      {!byAirport.length && <p className="hint">No procedures loaded.</p>}
      {byAirport.length > 0 && <button onClick={() => tk.request({ cmd: "setProcedures", procedures: { type: "FeatureCollection", features: [] } })}>Remove all</button>}
    </div>
  );
}

function PoisTab({ tk }: { tk: Tk }) {
  const [list, setList] = useState<PoiFeature[]>(tk.pois.features);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setList(tk.pois.features); }, [tk.pois, dirty]);
  const edit = (i: number, fn: (p: PoiFeature) => void) => {
    setList((l) => { const n = structuredClone(l); fn(n[i]); return n; });
    setDirty(true);
  };
  const save = async () => {
    await tk.request({ cmd: "setPois", pois: { type: "FeatureCollection", features: list } });
    setDirty(false);
  };

  return (
    <div className="panel">
      <p className="hint">Points of interest are drawn as labelled dots. "Add" places one at the centre of the preview.</p>
      {list.map((p, i) => (
        <div className="card" key={p.properties.id}>
          <div className="cardhead">
            <input value={p.properties.name} placeholder="Name" onChange={(e) => edit(i, (x) => { x.properties.name = e.target.value; })} />
            <button onClick={() => { setList((l) => l.filter((_, j) => j !== i)); setDirty(true); }}>Remove</button>
          </div>
          <div className="fields">
            <label>Note <input value={p.properties.note} onChange={(e) => edit(i, (x) => { x.properties.note = e.target.value; })} /></label>
            <label>Lat <NumberInput step={0.0001} value={p.geometry.coordinates[1]} onChange={(v) => edit(i, (x) => { x.geometry.coordinates[1] = v; })} /></label>
            <label>Lon <NumberInput step={0.0001} value={p.geometry.coordinates[0]} onChange={(v) => edit(i, (x) => { x.geometry.coordinates[0] = v; })} /></label>
          </div>
        </div>
      ))}
      <div className="savebar">
        <button onClick={() => {
          const [lon, lat] = tk.controls!.map.view.center;
          setList((l) => [...l, { type: "Feature", properties: { id: Math.random().toString(36).slice(2), name: "New point", note: "" }, geometry: { type: "Point", coordinates: [lon, lat] } }]);
          setDirty(true);
        }}>Add at map centre</button>
        {dirty && <button className="primary" onClick={save}>Save</button>}
        {dirty && <button onClick={() => setDirty(false)}>Discard</button>}
      </div>
    </div>
  );
}

function SettingsTab({ tk, config }: { tk: Tk; config: AppConfig }) {
  const d = useDraft(config);
  return (
    <div className="panel">
      <label className="col">EuroScope plugin URL
        <input value={d.draft.pluginUrl} onChange={(e) => d.update((c) => { c.pluginUrl = e.target.value; return c; })} />
      </label>
      <label className="col">Basemap (.pmtiles file path or URL)
        <input value={d.draft.map.pmtiles} placeholder="Empty: map.pmtiles in the data folder, else the Protomaps demo"
          onChange={(e) => d.update((c) => { c.map.pmtiles = e.target.value; return c; })} />
      </label>
      <p className="hint">Now using: <code>{tk.pmtilesUrl}</code></p>
      <label className="col">Basemap style
        <select value={d.draft.map.flavor} onChange={(e) => d.update((c) => { c.map.flavor = e.target.value as AppConfig["map"]["flavor"]; return c; })}>
          {["dark", "black", "grayscale", "light", "white"].map((f) => <option key={f}>{f}</option>)}
        </select>
      </label>
      <label className="col">Toolkit port (restart the app after changing)
        <NumberInput value={d.draft.serverPort} onChange={(v) => d.update((c) => { c.serverPort = v; return c; })} />
      </label>
      <SaveBar tk={tk} d={d} />
    </div>
  );
}
