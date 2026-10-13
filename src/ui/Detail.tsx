import { useMemo, useState } from "react";
import type { GlassMapping } from "../core/opj2zmx.ts";
import { describeSystem } from "../core/describe.ts";
import { dumpOpj } from "../core/dump.ts";
import { fmtE } from "../core/format.ts";
import { computeLayout, type Pt } from "../core/layout.ts";
import type { OPJ } from "../core/opj.ts";
import type { Job } from "./useConverter.ts";

type View = "prescription" | "glasses" | "messages" | "text";

export function Detail({ job }: { job: Job }) {
  const r = job.result!;
  const o = r.system!;
  const [view, setView] = useState<View>("prescription");
  const views: [View, string][] = [["prescription", "Prescription"]];
  if (r.glasses?.length) views.push(["glasses", "Glasses"]);
  views.push(["messages", `Messages ${r.warnings.length + r.notes.length}`], ["text", r.direction === "opj2zmx" ? "ZMX file" : "OPJ listing"]);
  const current = views.some(([k]) => k === view) ? view : "prescription";
  return (
    <section className="detail" aria-label={`Details of ${job.name}`}>
      <div className="detail-head">
        <h2>
          {job.name} → {r.outputs.map((x) => x.name).join(" + ")}
        </h2>
        {o.name && <span className="sysname">{o.name}</span>}
      </div>
      <Drawing o={o} />
      <div className="views" role="tablist">
        {views.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={current === k} onClick={() => setView(k)}>
            {label}
          </button>
        ))}
      </div>
      {current === "prescription" && <Prescription o={o} />}
      {current === "glasses" && <Glasses glasses={r.glasses ?? []} />}
      {current === "messages" && <Log notes={r.notes} warnings={r.warnings} />}
      {current === "text" && <pre className="text">{r.zmxText ?? dumpOpj(o)}</pre>}
    </section>
  );
}

function Drawing({ o }: { o: OPJ }) {
  const layout = useMemo(() => {
    try {
      return computeLayout(o);
    } catch {
      return null;
    }
  }, [o]);
  if (!layout) return null;
  const b = layout.bounds;
  const w = Math.max(b.zMax - b.zMin, 1e-6);
  const h = Math.max(b.yMax - b.yMin, 1e-6);
  const pad = Math.max(w, h) * 0.035;
  const path = (pts: Pt[]) => pts.map(([z, y], i) => `${i ? "L" : "M"}${z.toPrecision(7)},${(-y).toPrecision(7)}`).join("");
  const hatch = Math.max(w, h) / 160;
  const color = (f: number) => (f === 0 ? "var(--ray-0)" : f < 1 ? "var(--ray-1)" : "var(--ray-2)");
  return (
    <figure className="drawing">
      <svg viewBox={`${b.zMin - pad} ${-(b.yMax + pad)} ${w + 2 * pad} ${h + 2 * pad}`} role="img" aria-label="Lens drawing with traced rays">
        <defs>
          <pattern id="hatch" width={hatch} height={hatch} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={hatch} stroke="var(--hatch)" strokeWidth={hatch * 0.12} />
          </pattern>
        </defs>
        <line className="axis" x1={b.zMin - pad} x2={b.zMax + pad} y1={0} y2={0} />
        {layout.elements.map((e, i) => (
          <path key={`e${i}`} className="element" d={path(e) + "Z"} />
        ))}
        {layout.rays.map((ray, i) => (
          <path key={`r${i}`} className="ray" d={path(ray.points)} stroke={color(ray.field)} />
        ))}
        {layout.surfaces.map((s, i) => (
          <path key={`s${i}`} className={`surface${s.mirror ? " mirror" : ""}`} d={path(s.points)} />
        ))}
        {layout.stop && (
          <>
            <line className="stop" x1={layout.stop.z} x2={layout.stop.z} y1={-layout.stop.h} y2={-layout.stop.h * 1.25} />
            <line className="stop" x1={layout.stop.z} x2={layout.stop.z} y1={layout.stop.h} y2={layout.stop.h * 1.25} />
          </>
        )}
        {layout.image && <path className="image" d={path(layout.image)} />}
      </svg>
      <figcaption>
        <span style={{ color: "var(--ray-0)" }}>
          <i />
          axis
        </span>
        <span style={{ color: "var(--ray-2)" }}>
          <i />
          full field
        </span>
        <span>Real rays through the OPAL surfaces, aimed at the paraxial entrance pupil.</span>
      </figcaption>
    </figure>
  );
}

function Prescription({ o }: { o: OPJ }) {
  const s = useMemo(() => describeSystem(o), [o]);
  return (
    <>
      <dl className="kv">
        {s.info.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="scroll">
        <table className="rx">
          <thead>
            <tr>
              <th className="l">Surf</th>
              <th>Radius</th>
              <th>Thickness</th>
              <th className="l">Glass</th>
              <th>n(λ₁)</th>
              <th>Semi-diameter</th>
              <th className="l">Asphere</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="l">obj</td>
              <td />
              <td />
              <td className="l">{s.objectMedium}</td>
              <td />
              <td />
              <td />
            </tr>
            {s.rows.map((row) => (
              <tr key={row.n} className={row.mirror ? "mirror" : ""}>
                <td className="l">{row.n}</td>
                <td>{row.radius}</td>
                <td>{row.thickness}</td>
                <td className="l">{row.glass}</td>
                <td>{row.index}</td>
                <td>{row.semi}</td>
                <td className="l">{row.asphere}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Glasses({ glasses }: { glasses: GlassMapping[] }) {
  return (
    <div className="scroll">
      <table className="rx">
        <thead>
          <tr>
            <th className="l">OPAL</th>
            <th className="l">Zemax</th>
            <th className="l">Source</th>
            <th>max |Δn|</th>
          </tr>
        </thead>
        <tbody>
          {glasses.map((g, i) => (
            <tr key={i}>
              <td className="l">{g.opal}</td>
              <td className="l">{g.zemax}</td>
              <td className="l">{g.kind === "catalog" ? g.catalog : g.kind === "custom" ? `${g.catalog}.AGF (OPAL indices)` : "model glass"}</td>
              <td>{g.maxError !== undefined ? fmtE(g.maxError, 1) : g.kind === "custom" ? "0" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Log({ notes, warnings }: { notes: string[]; warnings: string[] }) {
  if (!notes.length && !warnings.length) return <p className="status-ok">No messages.</p>;
  return (
    <ul className="log">
      {warnings.map((w, i) => (
        <li key={`w${i}`} className="warn">
          <span className="tag">warning</span>
          {w}
        </li>
      ))}
      {notes.map((n, i) => (
        <li key={`n${i}`}>
          <span className="tag">note</span>
          {n}
        </li>
      ))}
    </ul>
  );
}
