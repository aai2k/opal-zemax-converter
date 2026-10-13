import { degMinSec, MEASURES } from "./dump.ts";
import { fmtG } from "./format.ts";
import { nfloats, type OPJ, screenEk, screenNe } from "./opj.ts";
import { decodeCp866 } from "./text.ts";
import { mirrorZ } from "./opj2zmx.ts";
import { paraxialTrace } from "./paraxial.ts";

/** Paraxial focal length at the main wavelength (Infinity for afocal systems). */
export function paraxialEfl(src: OPJ): number {
  if (!src.curv.length || !src.wavelengths.length) return Number.NaN;
  const o = src.media[0] < 0 ? mirrorZ(src) : src;
  const n = o.media.map((m) => Math.sign(m) * (o.indices[Math.abs(m) - 1]?.[0] ?? 1));
  const r = paraxialTrace(o.curv, o.thick.map((x) => (Math.abs(x) > 1e19 ? 0 : x)), n, 1, 0);
  return r.nu ? -n[n.length - 1] / r.nu : Infinity;
}

export interface SurfaceRow {
  n: number;
  radius: string;
  thickness: string;
  glass: string;
  index: string;
  semi: string;
  asphere: string;
  mirror: boolean;
}

export interface SystemInfo {
  name: string;
  rows: SurfaceRow[];
  objectMedium: string;
  info: [label: string, value: string][];
}

const num = (x: number, p = 6): string => (Math.abs(x) >= 1e19 ? "∞" : fmtG(x, p));

export function describeSystem(o: OPJ): SystemInfo {
  const i = o.ints;
  const names = o.glassNames.map((g) => decodeCp866(g).trim());
  const glassOf = (m: number): string => names[Math.abs(m) - 1] || "(index only)";
  let p = 0;
  const rows: SurfaceRow[] = o.curv.map((c, k) => {
    const m = o.media[k + 1];
    const idx = o.indices[Math.abs(m) - 1]?.[0];
    let asphere = "";
    const ord = o.asphere?.order[k] ?? 0;
    if (ord) {
      const fl = o.asphere!.coef.slice(p, p + nfloats(ord));
      p += nfloats(ord);
      if (Math.abs(ord) === 2) asphere = `e² ${fmtG(fl[0], 6)}`;
      else if (Math.abs(ord) > 100) asphere = `type ${ord}`;
      else asphere = `${ord > 0 ? "U" : "Z"}${Math.abs(ord)} e² ${fmtG(fl[0], 5)}`;
    }
    const mirror = Math.sign(o.media[k]) !== Math.sign(m);
    const last = k === o.curv.length - 1;
    return {
      n: k + 1,
      radius: c ? fmtG(1 / c, 8) : "∞",
      thickness: last && Math.abs(o.thick[k]) >= 1e19 ? "" : num(o.thick[k], 8),
      glass: mirror ? `mirror` : glassOf(m),
      index: idx === undefined ? "" : (m < 0 ? -idx : idx).toFixed(6),
      semi: o.hsv && o.hsv[k] > 0 && o.hsv[k] < 1e19 ? fmtG(o.hsv[k], 6) : "",
      asphere,
      mirror,
    };
  });
  const info: [string, string][] = [];
  info.push(["Wavelengths", `${o.wavelengths.map((w) => fmtG(w, 6)).join(", ")} µm`]);
  if (i.ob) info.push(["Object", `finite, ${fmtG(-o.s0)} mm before surface 1`]);
  else info.push(["Object", o.s0 ? `${fmtG(o.s0)} dptr from the entrance pupil` : "at infinity"]);
  let field: string;
  if (i.fieldInImage) field = i.im ? `image height ${fmtG(o.fieldSize[0])} mm` : `image angle ${degMinSec(o.fieldSize[0])}`;
  else field = i.ob ? `object height ${fmtG(o.fieldSize[0])} mm` : `${degMinSec(o.fieldSize[0])} (measure ${MEASURES[i.kindo] ?? i.kindo})`;
  if (o.beams) field += `, beams ${o.beams.rel.map((r) => fmtG(r, 4)).join(" / ")}`;
  info.push(["Field", field]);
  if (i.im) info.push(["Image", i.siFromLast ? `${fmtG(o.si)} mm after the last surface` : o.si ? `${fmtG(o.si)} mm from the paraxial image` : "paraxial image plane"]);
  else info.push(["Image", "at infinity" + (o.si ? ` (${fmtG(o.si)} dptr)` : "")]);
  const ap = i.apType === 0 ? `stop semi-height ${fmtG(o.aperture[0])} mm`
    : i.apType === 1 ? `back aperture ${fmtG(o.aperture[0])}` : `front aperture ${fmtG(o.aperture[0])}`;
  let stop: string;
  if (i.nd === 99) stop = i.ob ? `entrance pupil ${fmtG(o.sd)} dptr from the object` : `entrance pupil ${fmtG(o.sd)} mm from surface 1`;
  else if (i.nd === 0) stop = o.sd ? `stop ${fmtG(Math.abs(o.sd))} mm ${o.sd < 0 ? "before" : "behind"} surface 1` : "stop at surface 1";
  else stop = o.sd ? `stop ${fmtG(o.sd)} mm after surface ${i.nd}` : `stop at surface ${i.nd}`;
  info.push(["Aperture", `${ap}; ${stop}`]);
  if (o.beams?.vign.some(([a, b]) => a || b))
    info.push(["Vignetting", o.beams.vign.map(([a, b]) => `${fmtG(a, 3)}/${fmtG(b, 3)}`).join("  ")]);
  if (o.screen) info.push(["Obscuration", `surface ${screenNe(o.screen)}, ratio ${fmtG(screenEk(o.screen), 4)}`]);
  info.push(["Catalog mode", i.catMode === 0 ? "Russian (ГОСТ)" : i.catMode === 7 ? "international" : String(i.catMode)]);
  const m0 = o.media[0];
  return { name: o.name, rows, objectMedium: m0 ? glassOf(m0) : "", info };
}
