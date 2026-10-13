import type { ConvertOptions } from "../core/convert.ts";

interface Props {
  options: ConvertOptions;
  onChange: (o: ConvertOptions) => void;
}

export function SettingsPanel({ options, onChange }: Props) {
  const z = options.zmx2opj;
  const p = options.opj2zmx;
  const setZ = (patch: Partial<ConvertOptions["zmx2opj"]>) => onChange({ ...options, zmx2opj: { ...z, ...patch } });
  const setP = (patch: Partial<ConvertOptions["opj2zmx"]>) => onChange({ ...options, opj2zmx: { ...p, ...patch } });
  const setBoth = (patch: Partial<ConvertOptions["zmx2opj"]> & Partial<ConvertOptions["opj2zmx"]>) =>
    onChange({ ...options, zmx2opj: { ...z, ...patch }, opj2zmx: { ...p, ...patch } });
  return (
    <div className="panel">
      <div className="cols">
        <div>
          <h3>Zemax → OPAL</h3>
          <div className="setting">
            <span>Glass catalog mode</span>
            <select
              value={z.catMode === null ? "auto" : String(z.catMode)}
              onChange={(e) => setZ({ catMode: e.target.value === "auto" ? null : Number(e.target.value) })}
            >
              <option value="auto">automatic</option>
              <option value="0">Russian (ГОСТ, ВОЗДУХ)</option>
              <option value="7">international (AIR)</option>
            </select>
          </div>
          <div className="setting">
            <span>Image position</span>
            <select value={z.imagePosition} onChange={(e) => setZ({ imagePosition: e.target.value as "last" | "gauss" })}>
              <option value="last">distance from the Zemax file</option>
              <option value="gauss">paraxial image plane</option>
            </select>
          </div>
          <div className="setting">
            <span>Image at infinity</span>
            <div>
              <label>
                <input type="checkbox" checked={z.afocal} onChange={(e) => setZ({ afocal: e.target.checked })} />
                force afocal image space
              </label>
              <small>For collimated output such as double-pass null tests.</small>
            </div>
          </div>
          <div className="setting">
            <span>Glass names</span>
            <label>
              <input type="checkbox" checked={z.catalogLetters} onChange={(e) => setZ({ catalogLetters: e.target.checked })} />
              catalog letters (S, O, H, M, R)
            </label>
          </div>
          <div className="setting">
            <span>File names</span>
            <label>
              <input type="checkbox" checked={options.dosNames} onChange={(e) => onChange({ ...options, dosNames: e.target.checked })} />
              DOS 8.3 (DOUBLEGA.OPJ)
            </label>
          </div>
        </div>
        <div>
          <h3>OPAL → Zemax</h3>
          <div className="setting">
            <span>Unmatched glasses</span>
            <div>
              <select value={p.unmatchedGlass} onChange={(e) => setP({ unmatchedGlass: e.target.value as "agf" | "model" })}>
                <option value="agf">companion .AGF (exact indices)</option>
                <option value="model">Zemax model glass (approximate)</option>
              </select>
              <small>Put the .AGF into Documents\Zemax\Glasscat.</small>
            </div>
          </div>
          <div className="setting">
            <span>Catalog match within</span>
            <div>
              <select value={String(p.indexTolerance)} onChange={(e) => setP({ indexTolerance: Number(e.target.value) })}>
                <option value="0">never match (always OPAL indices)</option>
                <option value="0.000001">Δn ≤ 1·10⁻⁶</option>
                <option value="0.000005">Δn ≤ 5·10⁻⁶</option>
                <option value="0.00002">Δn ≤ 2·10⁻⁵</option>
                <option value="0.0001">Δn ≤ 1·10⁻⁴</option>
                <option value="0.0005">Δn ≤ 5·10⁻⁴</option>
              </select>
              <small>A catalog glass replaces an OPAL glass of the same name only within this index difference.</small>
            </div>
          </div>
          <h3 style={{ marginTop: 14 }}>Both</h3>
          <div className="setting">
            <span>Asphere fit</span>
            <select value={String(z.asphereTol)} onChange={(e) => setBoth({ asphereTol: Number(e.target.value) })}>
              <option value="1e-7">sag error ≤ 0.1 nm</option>
              <option value="0.000001">sag error ≤ 1 nm</option>
              <option value="0.00001">sag error ≤ 10 nm</option>
            </select>
          </div>
          <div className="setting">
            <span>Vignetting</span>
            <div>
              <label>
                <input type="checkbox" checked={z.vignFlip} onChange={(e) => setBoth({ vignFlip: e.target.checked })} />
                swap upper and lower
              </label>
              <small>Only for files written with the older OPJ→ZMX tool's inverted convention.</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
