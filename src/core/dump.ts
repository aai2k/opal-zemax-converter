import { fmtG } from "./format.ts";
import { nfloats, type OPJ, RAW_BLOCK_INFO, screenEk, screenNe } from "./opj.ts";
import { decodeCp866 } from "./text.ts";

export const MEASURES: Record<number, string> = { 0: "tg", 1: "angle", 2: "sin", 3: "2sin(a/2)" };

export function degMinSec(rad: number): string {
  const d = (Math.abs(rad) * 180) / Math.PI;
  let deg = Math.trunc(d);
  let m = (d - deg) * 60;
  let mi = Math.trunc(m);
  let s = Math.round((m - mi) * 60 * 100) / 100;
  if (s >= 60) {
    s -= 60;
    mi += 1;
  }
  if (mi >= 60) {
    mi -= 60;
    deg += 1;
  }
  m = mi;
  return `${rad < 0 ? "-" : ""}${deg}°${String(m).padStart(2, "0")}'${s.toFixed(2).padStart(5, "0")}"`;
}

const pad = (s: string, n: number): string => s.padStart(n);
const padR = (s: string, n: number): string => s.padEnd(n);

export function dumpOpj(o: OPJ): string {
  const L: string[] = [];
  const i = o.ints;
  const names = o.glassNames.map(decodeCp866);
  L.push(`Name      : ${o.name}`);
  L.push(`Flags     : ${o.flags.map((f) => f.toString(16).padStart(4, "0")).join(" ")}`);
  L.push(`Counts    : NSS=${o.curv.length} NLA=${o.wavelengths.length} NGL=${o.glassNames.length}`);
  L.push(`Wavelength: ${o.wavelengths.map((w) => fmtG(w, 5)).join(", ")} um (first = main)`);
  L.push("");
  L.push("  N        Radius       Thick     Semi-D  Glass      n(L1..)");
  const m0 = o.media[0];
  if (names.length) L.push(pad(`[${m0 < 0 ? "-" : ""}${names[Math.abs(m0) - 1].trim()}]`, 62));
  let p = 0;
  for (let k = 0; k < o.curv.length; k++) {
    const c = o.curv[k];
    const r = c ? pad((1 / c).toFixed(5), 12) : pad("plane", 12);
    const t = o.thick[k];
    const ts = Math.abs(t) < 1e19 ? pad(t.toFixed(5), 11) : pad("1e20", 11);
    const h = o.hsv ? pad(o.hsv[k] < 1e19 ? o.hsv[k].toFixed(3) : "-", 9) : pad("-", 9);
    const m = o.media[k + 1];
    const g = names[Math.abs(m) - 1] ?? "?";
    const n = o.indices[Math.abs(m) - 1] ?? [];
    let a = "";
    if (o.asphere && o.asphere.order[k]) a = ` A(order ${o.asphere.order[k]})`;
    L.push(`${pad(String(k + 1), 3)} ${r} ${ts} ${h}  ${m < 0 ? "-" : " "}${padR(g, 8)} ${n.map((x) => (m > 0 ? x : -x).toFixed(6)).join(" ")}${a}`);
  }
  L.push("");
  let fld: string;
  let s0: string;
  if (i.ob) {
    fld = `Y=${fmtG(o.fieldSize[0])} mm`;
    s0 = `S0=${fmtG(o.s0)} mm from surface 1`;
  } else {
    fld = `W=${degMinSec(o.fieldSize[0])} (${fmtG(o.fieldSize[0])} rad)`;
    s0 = `S0=${fmtG(o.s0)} dptr`;
  }
  if (i.fieldInImage) fld = `image size Y'=${fmtG(o.fieldSize[0])}`;
  L.push(`Object    : ${i.ob ? "finite" : "infinite"}, ${fld}, ${s0}, measure=${MEASURES[i.kindo] ?? i.kindo}, curvature ${fmtG(o.objCurv)}`);
  const lastT = o.thick.length ? (o.thick[o.thick.length - 1] > 1e19 ? "1e20" : fmtG(o.thick[o.thick.length - 1])) : "-";
  L.push(
    `Image     : ${i.im ? "finite" : "infinite"}, SI=${fmtG(o.si)} (${i.siFromLast ? "from last surface" : "from Gauss plane"}), curvature ${fmtG(o.imgCurv)}, last thickness ${lastT}`,
  );
  const ap = ({ "-1": "front aperture", "1": "back aperture", "0": "semi-height at stop" } as Record<string, string>)[String(i.apType)] ?? String(i.apType);
  L.push(`Stop      : ${i.nd === 99 ? "entrance pupil (ND=99)" : `ND=${i.nd}`} SD=${fmtG(o.sd)}, ${ap}=${fmtG(o.aperture[0])}`);
  L.push(`Catalog   : mode ${i.catMode}`);
  if (o.beams) {
    const b = o.beams;
    L.push(`Beams     : rel ${b.rel.map((x) => x.toFixed(4)).join(" ")}`);
    L.push(`            vign upper ${b.vign.map((v) => v[0].toFixed(4)).join(" ")} | lower ${b.vign.map((v) => v[1].toFixed(4)).join(" ")}`);
  }
  if (o.spectral) {
    const s = o.spectral;
    L.push(`Spectral  : ${fmtG(s.lo, 5)}..${fmtG(s.hi, 5)} um, weights ${s.weights.slice(0, Math.max(1, o.wavelengths.length)).map((w) => fmtG(w, 4)).join(" ")}`);
  }
  if (o.asphere) {
    const a = o.asphere;
    a.order.forEach((od, k) => {
      const nf = nfloats(od);
      if (!nf) return;
      const v = a.coef.slice(p, p + nf);
      if (Math.abs(od) === 2) L.push(`Asphere s${padR(String(k + 1), 3)} conic: e2=${fmtG(v[0], 7)}`);
      else
        L.push(
          `Asphere s${padR(String(k + 1), 3)} ${od > 0 ? "U" : "Z"}-type order ${Math.abs(od)}: e2=${fmtG(v[0], 7)} H=${fmtG(v[1], 7)} coef ${v.slice(2).map((x) => fmtG(x, 7)).join(" ")}`,
        );
      p += nf;
    });
  }
  if (o.screen) L.push(`Obscur.   : NE=${screenNe(o.screen)} EK=${fmtG(screenEk(o.screen), 4)}`);
  if (o.rawBlocks.size)
    L.push(`Other     : ${[...o.rawBlocks].map(([k, v]) => `${RAW_BLOCK_INFO[k] ?? k} (${v.length} bytes)`).join(", ")}`);
  return L.join("\n");
}
