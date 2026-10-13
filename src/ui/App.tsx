import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Glass, parseAgfBytes } from "../core/agf.ts";
import { type ConvertOptions, directionOf } from "../core/convert.ts";
import { CatalogsPanel } from "./CatalogsPanel.tsx";
import { clearCatalogs, deleteCatalog, loadCatalogs, saveCatalogs, type StoredCatalog } from "./catalogStore.ts";
import { Detail } from "./Detail.tsx";
import { FileTable } from "./FileTable.tsx";
import { downloadBytes, readFiles, zipOutputs } from "./files.ts";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { loadOptions, saveOptions } from "./settings.ts";
import { useConverter } from "./useConverter.ts";

const REPO_URL = import.meta.env.VITE_REPO_URL as string | undefined;

type Panel = "catalogs" | "settings" | null;

export function App() {
  const [options, setOptions] = useState<ConvertOptions>(loadOptions);
  const [catalogs, setCatalogs] = useState<StoredCatalog[]>([]);
  const [catalogsReady, setCatalogsReady] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCatalogs().then((c) => {
      setCatalogs(c.sort((a, b) => a.name.localeCompare(b.name)));
      setCatalogsReady(true);
    });
  }, []);
  useEffect(() => saveOptions(options), [options]);

  const catalogData = useMemo<[string, Glass[]][]>(() => catalogs.map((c) => [c.name, c.glasses]), [catalogs]);
  const { jobs, add, remove, clear } = useConverter(options, catalogData);
  const glassCount = catalogs.reduce((s, c) => s + c.glasses.length, 0);

  const addCatalogs = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const fresh: StoredCatalog[] = (await readFiles(files)).map((f) => {
      const name = f.name.replace(/\.[^.]*$/, "").toUpperCase();
      return { name, fileName: f.name, glasses: [...parseAgfBytes(f.data, name).values()], addedAt: Date.now() };
    });
    await saveCatalogs(fresh);
    setCatalogs((cur) => {
      const map = new Map(cur.map((c) => [c.name, c]));
      for (const c of fresh) map.set(c.name, c);
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  const onFiles = useCallback(
    async (files: File[]) => {
      const agf = files.filter((f) => f.name.toLowerCase().endsWith(".agf"));
      const convertible = files.filter((f) => directionOf(f.name));
      setSkipped(files.filter((f) => !agf.includes(f) && !convertible.includes(f)).map((f) => f.name));
      if (agf.length) await addCatalogs(agf);
      if (convertible.length) add(await readFiles(convertible));
    },
    [add, addCatalogs],
  );

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      onFiles([...e.dataTransfer.files]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [onFiles]);

  useEffect(() => {
    if (selected !== null && !jobs.some((j) => j.id === selected)) setSelected(null);
    if (selected === null) {
      const first = jobs.find((j) => j.result && !j.result.error && !j.busy);
      if (first) setSelected(first.id);
    }
  }, [jobs, selected]);

  const done = jobs.filter((j) => j.result && !j.result.error && !j.busy);
  const current = jobs.find((j) => j.id === selected && j.result && !j.result.error && j.result.system);
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  return (
    <div className="page">
      <header className="masthead">
        <h1>OPAL ⇄ Zemax</h1>
        <nav>
          {REPO_URL && (
            <>
              <a href={REPO_URL}>Source</a>
              <a href={`${REPO_URL}/blob/main/docs/OPJ_FORMAT.md`}>OPJ format</a>
            </>
          )}
        </nav>
        <p>
          <code>.zmx</code> ↔ <code>.OPJ</code>, centred sequential systems. Runs in this page; nothing is uploaded.
        </p>
      </header>

      <div className="toolbar">
        <button className="btn ink" onClick={() => picker.current?.click()}>
          Open files…
        </button>
        <button className={`btn${panel === "catalogs" ? " on" : ""}`} onClick={() => toggle("catalogs")} aria-expanded={panel === "catalogs"}>
          Glass catalogs
          <span className="count">{catalogsReady ? (catalogs.length ? `${catalogs.length} · ${glassCount.toLocaleString("en-US")} glasses` : "none") : "…"}</span>
        </button>
        <button className={`btn${panel === "settings" ? " on" : ""}`} onClick={() => toggle("settings")} aria-expanded={panel === "settings"}>
          Settings
        </button>
        <span className="hint">or drop .zmx, .opj and .agf files anywhere</span>
        <input
          ref={picker}
          type="file"
          multiple
          accept=".zmx,.opj,.agf,.ZMX,.OPJ,.AGF"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) onFiles([...e.target.files]);
            e.target.value = "";
          }}
        />
      </div>

      {panel === "catalogs" && (
        <CatalogsPanel
          catalogs={catalogs}
          onFiles={addCatalogs}
          onRemove={(name) => {
            deleteCatalog(name);
            setCatalogs((cur) => cur.filter((c) => c.name !== name));
          }}
          onClear={() => {
            clearCatalogs();
            setCatalogs([]);
          }}
        />
      )}
      {panel === "settings" && <SettingsPanel options={options} onChange={setOptions} />}
      {skipped.length > 0 && <p className="notice">Not converted (not .zmx, .opj or .agf): {skipped.join(", ")}</p>}

      {jobs.length === 0 ? (
        <div className="intro">
          <section>
            <h2>Zemax → OPAL</h2>
            <p>Load the glass catalogs the lens uses: OPJ files store refractive indices.</p>
          </section>
          <section>
            <h2>OPAL → Zemax</h2>
            <p>
              Glasses not found in the catalogs go to a companion <code>.AGF</code> with the exact OPAL indices.
            </p>
          </section>
        </div>
      ) : (
        <>
          <FileTable jobs={jobs} selected={selected} onSelect={setSelected} onRemove={remove} />
          <div className="files-foot">
            <button
              className="link"
              disabled={!done.length}
              onClick={() => downloadBytes("converted.zip", zipOutputs(done.map((j) => ({ input: j.name, outputs: j.result!.outputs }))))}
            >
              download all as .zip
            </button>
            <button className="link" onClick={clear}>
              clear list
            </button>
          </div>
          {current && <Detail key={current.id} job={current} />}
        </>
      )}

      {dragging && <div className="dropzone-overlay">Drop to convert</div>}
    </div>
  );
}
