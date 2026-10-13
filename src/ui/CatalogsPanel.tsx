import { useEffect, useRef } from "react";
import type { StoredCatalog } from "./catalogStore.ts";

interface Props {
  catalogs: StoredCatalog[];
  onFiles: (files: File[]) => void;
  onRemove: (name: string) => void;
  onClear: () => void;
}

export function CatalogsPanel({ catalogs, onFiles, onRemove, onClear }: Props) {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  useEffect(() => folder.current?.setAttribute("webkitdirectory", ""), []);
  const take = (el: HTMLInputElement) => {
    if (el.files) onFiles([...el.files].filter((f) => f.name.toLowerCase().endsWith(".agf")));
    el.value = "";
  };
  return (
    <div className="panel">
      <h3>Glass catalogs</h3>
      <p style={{ margin: "0 0 10px", color: "var(--ink-2)" }}>
        Add <code>Documents\Zemax\Glasscat</code> once; it is kept in this browser.
      </p>
      <div className="toolbar" style={{ border: "none", padding: 0 }}>
        <button className="btn" onClick={() => folder.current?.click()}>
          Add folder…
        </button>
        <button className="btn" onClick={() => files.current?.click()}>
          Add .AGF files…
        </button>
        {catalogs.length > 0 && (
          <button className="link" style={{ marginLeft: 8 }} onClick={onClear}>
            remove all
          </button>
        )}
      </div>
      <input ref={folder} type="file" multiple className="sr-only" onChange={(e) => take(e.target)} />
      <input ref={files} type="file" multiple accept=".agf,.AGF" className="sr-only" onChange={(e) => take(e.target)} />
      {catalogs.length > 0 && (
        <ul className="catalogs">
          {catalogs.map((c) => (
            <li key={c.name}>
              <span className="name" title={c.fileName}>
                {c.name}
              </span>
              <span className="n">{c.glasses.length}</span>
              <button className="x" aria-label={`Remove ${c.name}`} onClick={() => onRemove(c.name)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
