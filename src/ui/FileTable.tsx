import { useMemo } from "react";
import { paraxialEfl } from "../core/describe.ts";
import { fmtG } from "../core/format.ts";
import { downloadBytes } from "./files.ts";
import type { Job } from "./useConverter.ts";

function Efl({ job }: { job: Job }) {
  const v = useMemo(() => (job.result?.system ? paraxialEfl(job.result.system) : Number.NaN), [job.result]);
  if (job.result?.system?.ints.im === 0) return <>afocal</>;
  if (!Number.isFinite(v) || Math.abs(v) > 1e8) return <>—</>;
  return <>{fmtG(v, 6)}</>;
}

function Status({ job }: { job: Job }) {
  const r = job.result;
  if (!r || job.busy) return <span className="status-busy">converting…</span>;
  if (r.error) return <span className="status-err">{r.error}</span>;
  const w = r.warnings.length;
  if (w) return <span className="status-warn">{w} warning{w > 1 ? "s" : ""}</span>;
  return <span className="status-ok">ok</span>;
}

interface Props {
  jobs: Job[];
  selected: number | null;
  onSelect: (id: number) => void;
  onRemove: (id: number) => void;
}

export function FileTable({ jobs, selected, onSelect, onRemove }: Props) {
  return (
    <table className="files">
      <thead>
        <tr>
          <th>File</th>
          <th>Direction</th>
          <th>Output</th>
          <th className="num">Surfaces</th>
          <th className="num">EFL, mm</th>
          <th>Status</th>
          <th aria-label="Remove" />
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => {
          const r = j.result;
          const ok = r && !r.error;
          return (
            <tr key={j.id} className={j.id === selected ? "sel" : ""} onClick={() => onSelect(j.id)}>
              <td className="fname">{j.name}</td>
              <td className="dir hide-sm">{r ? (r.direction === "zmx2opj" ? "ZMX → OPJ" : "OPJ → ZMX") : ""}</td>
              <td className="outcell">
                <span className="outs">
                  {ok &&
                    r.outputs.map((o) => (
                      <button
                        key={o.name}
                        className="link"
                        title={`Download ${o.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadBytes(o.name, o.data);
                        }}
                      >
                        {o.name}
                      </button>
                    ))}
                </span>
              </td>
              <td className="num hide-sm">{ok ? r.system?.curv.length : ""}</td>
              <td className="num hide-sm">{ok ? <Efl job={j} /> : ""}</td>
              <td className="statcell">
                <Status job={j} />
              </td>
              <td className="xcell">
                <button
                  className="x"
                  aria-label={`Remove ${j.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(j.id);
                  }}
                >
                  ×
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
