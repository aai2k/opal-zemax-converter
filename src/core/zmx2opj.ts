import { GlassLibrary, glassIndex } from "./agf.ts";
import { f32 } from "./binary.ts";
import { fmtE, fmtG } from "./format.ts";
import { lstsq, pyMax, pyRound, pySum } from "./numeric.ts";
import { type FieldBeams, glassField, INF, newOpj, type OPJ } from "./opj.ts";
import { paraxialMagnification, paraxialTrace } from "./paraxial.ts";
import { opalSagU } from "./surfaces.ts";
import { encodeCp866, transliterate } from "./text.ts";
import { isMirror, type Surface, UNIT_TO_MM, type ZMX } from "./zmx.ts";

export const AIR_RU = "ВОЗДУХ";
export const AIR_EN = "AIR";
export const CAT_MODE_RUSSIAN = 0;
export const CAT_MODE_INTERNATIONAL = 7;

const RUSSIAN_CATALOG_PREFIXES = ["GOST", "LZOS", "OPAL", "SILICA_GOST"];
// longest first
export const RU_PREFIX: [string, string][] = [
  ["STK", "СТК"], ["CTK", "СТК"], ["STF", "СТФ"], ["CTF", "СТФ"], ["TBF", "ТБФ"], ["TFK", "ТФК"],
  ["TK", "ТК"], ["TF", "ТФ"], ["BK", "БК"], ["BF", "БФ"], ["LK", "ЛК"], ["LF", "ЛФ"], ["FK", "ФК"],
  ["KF", "КФ"], ["OK", "ОК"], ["OF", "ОФ"], ["KU", "КУ"], ["KV", "КВ"], ["K", "К"], ["F", "Ф"],
];
export const CRYSTAL_ALIAS: Record<string, string> = {
  GERMANIUM: "GE", SILICON: "SI", F_SILICA: "SILICA", ZNS_BROAD: "ZNS", CLEARTRAN: "ZNS", SAPPHIRE: "SAPPHIRE",
};
const VENDOR_LETTER: [string, string][] = [["SCHOTT", "S"], ["OHARA", "O"], ["HOYA", "H"], ["CDGM", "M"]];

export interface ZmxToOpjOptions {
  catMode: number | null;
  catalogLetters: boolean;
  asphereTol: number;
  maxAsphTerms: number;
  vignFlip: boolean;
  imagePosition: "last" | "gauss";
  afocal: boolean;
}

export const defaultZmxToOpjOptions = (): ZmxToOpjOptions => ({
  catMode: null, catalogLetters: true, asphereTol: 1e-6, maxAsphTerms: 14, vignFlip: false,
  imagePosition: "last", afocal: false,
});

export class Report {
  warnings: string[] = [];
  notes: string[] = [];
  warn(msg: string): void {
    this.warnings.push(msg);
  }
  note(msg: string): void {
    this.notes.push(msg);
  }
}

export class ConversionError extends Error {}

export function russianName(zname: string): string | null {
  let n = zname.toUpperCase();
  if (n.startsWith("LZ_")) n = n.slice(3);
  for (const suf of ["_HERZ", "_SCH", "_SEL", "GOST"]) if (n.endsWith(suf)) n = n.slice(0, -suf.length);
  for (const [lat, cyr] of RU_PREFIX) {
    if (n.startsWith(lat) && (n.length === lat.length || /[0-9]/.test(n[lat.length]))) return cyr + n.slice(lat.length);
  }
  return null;
}

export const isRussianCatalog = (cat: string): boolean =>
  RUSSIAN_CATALOG_PREFIXES.some((p) => cat.toUpperCase().startsWith(p));

export function vendorLetter(cat: string): string {
  const c = cat.toUpperCase();
  for (const [key, letter] of VENDOR_LETTER) if (c.startsWith(key)) return letter;
  return " ";
}

interface Medium {
  key: string;
  display: string;
  letter: string;
  russian: boolean;
  indices: number[];
}

/** Two-term Cauchy model through nd and Vd. */
export function modelGlassIndex(nd: number, vd: number, wl: number): number {
  if (vd <= 0) return nd;
  const dn = (nd - 1.0) / vd;
  const b = dn / (1 / 0.4861327 ** 2 - 1 / 0.6562725 ** 2);
  const a = nd - b / 0.5875618 ** 2;
  return a + b / wl ** 2;
}

type SagInfo = { z: (r: number) => number; poly: [number, number][]; hasPoly: boolean; r2Term: number; odd: boolean };

function sagFunction(s: Surface): SagInfo {
  let c = s.curv;
  let k = s.conic;
  let poly: [number, number][];
  if (s.type === "COORDBRK") {
    c = 0;
    k = 0;
    poly = [];
  } else if (s.type === "STANDARD") poly = [];
  else if (s.type === "EVENASPH") poly = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [2 * i, s.parm.get(i) ?? 0]);
  else if (s.type === "ODDASPH") poly = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, s.parm.get(i) ?? 0]);
  else throw new ConversionError(`surface ${s.num}: type ${s.type} is not supported`);
  const z = (r: number): number => {
    const u = r * r;
    const arg = 1 - (1 + k) * c * c * u;
    if (arg < 0) throw new ConversionError(`surface ${s.num}: sag undefined at r=${fmtG(r)}`);
    let zz = (c * u) / (1 + Math.sqrt(arg));
    for (const [p, a] of poly) zz += a * r ** p;
    return zz;
  };
  return {
    z,
    poly,
    hasPoly: poly.some(([, a]) => a !== 0),
    r2Term: poly.find(([p]) => p === 2)?.[1] ?? 0,
    odd: poly.some(([p, a]) => a !== 0 && p % 2 !== 0),
  };
}

// OPAL stores the coefficients as float32: they are rounded from the highest order down and
// the lower orders re-fitted after each rounding, which cancels most of the rounding error.
function fitQ(c: number, e2: number, ha: number, rs: number[], zt: number[], m: number): number[] {
  const qt = rs.map((r, i) => zt[i] - (c * (r * r + (1 - e2) * zt[i] * zt[i])) / 2);
  const W = rs.map((r) => Array.from({ length: m }, (_, j) => ((r * r) / (ha * ha)) ** (j + 2)));
  const fixed = new Map<number, number>();
  for (let j = m - 1; j >= 0; j--) {
    const free: number[] = [];
    for (let k = 0; k < m; k++) if (!fixed.has(k)) free.push(k);
    const rhs = qt.map((q, i) => q - pySum([...fixed].map(([k, v]) => W[i][k] * v)));
    const sol = lstsq(rs.map((_, i) => free.map((k) => W[i][k])), rhs);
    fixed.set(j, f32(sol[free.indexOf(j)]));
  }
  return Array.from({ length: m }, (_, j) => fixed.get(j)!);
}

// A paraboloid base (k = -1) plus even terms is OPAL's U-type with e2 = 1 and HA = 1, term by term.
function copyParaboloidAsphere(s: Surface, scale: number, info: SagInfo, rep: Report): [number, number, number[]] {
  const c = (s.curv + 2 * info.r2Term) / scale;
  const hi = Math.max(0, ...info.poly.filter(([p, v]) => p >= 4 && v !== 0).map(([p]) => p));
  const coef = new Map(info.poly);
  const a: number[] = [];
  for (let p = 4; p <= hi; p += 2) a.push(f32((coef.get(p) ?? 0) * scale ** (1 - p)));
  if (!a.length) return [c, 2, [1]];
  let msg = `surface ${s.num}: ${s.type} with conic -1 -> OPAL U-type, e2=1, HA=1, ${a.length} terms copied`;
  const semi = s.diam * scale;
  if (semi > 0) {
    const check = [...Array.from({ length: 300 }, (_, i) => semi * Math.sqrt((i + 0.5) / 300)), semi];
    const err = pyMax(check.map((r) => Math.abs(opalSagU(c, 1, 1, a, r) - info.z(r / scale) * scale)));
    msg += ` (max sag error ${fmtE(err, 1)} mm)`;
  }
  rep.note(msg);
  return [c, 2 + 2 * a.length, [1, 1, ...a]];
}

function fitAsphere(s: Surface, scale: number, opts: ZmxToOpjOptions, rep: Report): [number, number, number[]] {
  const info = sagFunction(s);
  const { z: zn, hasPoly, r2Term, odd } = info;
  if (s.type === "COORDBRK") return [0, 0, []];
  if (!hasPoly) {
    if (s.conic === 0) return [s.curv / scale, 0, []];
    return [s.curv / scale, 2, [f32(-s.conic)]];
  }
  if (s.conic === -1 && !odd) return copyParaboloidAsphere(s, scale, info, rep);
  let semi = s.diam * scale;
  if (semi <= 0) {
    semi = 10.0;
    rep.warn(`surface ${s.num}: no semi-diameter, asphere fitted over r<=10 mm`);
  }
  const ck = (1 + s.conic) * s.curv * s.curv;
  if (ck > 0 && semi / scale >= 1 / Math.sqrt(ck)) {
    semi = (0.999 / Math.sqrt(ck)) * scale;
    rep.warn(`surface ${s.num}: semi-diameter exceeds the conic's extent; fit limited to r<=${fmtG(semi, 4)} mm`);
  }
  const z = (rmm: number): number => zn(rmm / scale) * scale;
  const c = (s.curv + 2 * r2Term) / scale;
  const ha = f32(semi);
  if (odd) rep.warn(`surface ${s.num}: odd-order terms approximated by an even polynomial`);
  const npts = 300;
  const rs = Array.from({ length: npts }, (_, i) => semi * Math.sqrt((i + 0.5) / npts));
  const zt = rs.map(z);
  const check = [...rs, semi];
  const zc = check.map(z);

  const evaluate = (e2: number, m: number): [number, number[]] => {
    const a = fitQ(c, e2, ha, rs, zt, m);
    const err = pyMax(check.map((r, i) => Math.abs(opalSagU(c, e2, ha, a, r) - zc[i])));
    return [Number.isNaN(err) ? Infinity : err, a];
  };
  const bestFor = (e2: number): [number, number, number[]] => {
    let best: [number, number, number[]] | null = null;
    for (let m = 1; m <= opts.maxAsphTerms; m++) {
      const [err, a] = evaluate(e2, m);
      if (best === null || err < best[0] * 0.999) best = [err, m, a];
      if (err <= opts.asphereTol) break;
    }
    return best!;
  };
  let e2 = f32(-s.conic);
  let [err, m, a] = bestFor(e2);
  if (err > opts.asphereTol) {
    // a different base conic can leave a smaller polynomial with less float32 loss
    let lo = e2 - 4.0;
    let hi = e2 + 4.0;
    for (let it = 0; it < 30; it++) {
      const m1 = lo + (hi - lo) * 0.382;
      const m2 = lo + (hi - lo) * 0.618;
      if (evaluate(f32(m1), opts.maxAsphTerms)[0] < evaluate(f32(m2), opts.maxAsphTerms)[0]) hi = m2;
      else lo = m1;
    }
    const e2b = f32((lo + hi) / 2);
    const cand = bestFor(e2b);
    if (cand[0] < err) {
      e2 = e2b;
      [err, m, a] = cand;
    }
  }
  if (err > opts.asphereTol) rep.warn(`surface ${s.num}: asphere fit residual ${fmtE(err, 2)} mm exceeds tolerance`);
  rep.note(`surface ${s.num}: ${s.type} -> OPAL U-type, ${m} terms, e2=${fmtG(e2)} (max sag error ${fmtE(err, 1)} mm)`);
  return [c, 2 + 2 * m, [e2, ha, ...a]];
}

/** 8.3 upper-case DOS file name derived from an input file name. */
export function dosName(fileName: string, ext = ".OPJ"): string {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  const keep = [...transliterate(base).toUpperCase()].filter((ch) => /[A-Z0-9_-]/.test(ch)).join("");
  return (keep || "SYSTEM").slice(0, 8) + ext;
}

export function convertZmxToOpj(z: ZMX, lib: GlassLibrary, opts: ZmxToOpjOptions): { opj: OPJ; report: Report } {
  const rep = new Report();
  rep.warnings.push(...z.warnings);
  const scale = UNIT_TO_MM[z.unit];
  if (scale === undefined) throw new ConversionError(`unsupported lens units ${z.unit}`);
  if (z.multiconfig) rep.warn("multi-configuration data ignored (configuration 1 converted)");
  if (Math.abs(z.env[0] - 20.0) > 0.01 || Math.abs(z.env[1] - 1.0) > 1e-6)
    rep.warn(
      `system temperature/pressure ${fmtG(z.env[0])} C / ${fmtG(z.env[1])} atm ignored: indices computed at catalog conditions`,
    );
  const surfs = z.surfaces;
  if (surfs.length < 3) throw new ConversionError("need at least object, one surface and image");
  const objS = surfs[0];
  const imgS = surfs[surfs.length - 1];
  const opt = surfs.slice(1, -1);
  for (const s of surfs) {
    if (s.extra.length)
      throw new ConversionError(`surface ${s.num} has decenter/tilt data (${s.extra[0]}); only centred systems are supported`);
    if (s.type === "COORDBRK") {
      if ([1, 2, 3, 4].some((i) => Math.abs(s.parm.get(i) ?? 0) > 1e-12))
        throw new ConversionError(`surface ${s.num} is a coordinate break with decenter/tilt; only centred systems are supported`);
      if (Math.abs(s.parm.get(5) ?? 0) > 1e-12) rep.warn(`surface ${s.num}: coordinate break rotation about z ignored`);
      rep.note(`surface ${s.num}: empty coordinate break -> plane dummy surface`);
    }
  }
  const nss = opt.length;
  if (nss > 160) throw new ConversionError("OPAL allows at most 160 surfaces");

  if (!z.waves.length) throw new ConversionError("no wavelengths");
  const waves = z.waves;
  const pw = Math.min(Math.max(z.primaryWave, 1), waves.length) - 1;
  let order = [pw, ...waves.map((_, i) => i).filter((i) => i !== pw)];
  if (order.length > 10) {
    rep.warn(`${order.length} wavelengths; OPAL keeps 10`);
    order = order.slice(0, 10);
  }
  const wl = order.map((i) => waves[i][0]);
  const wts = order.map((i) => waves[i][1]);
  const nidx = Math.min(wl.length, 5);

  const mediaTbl: Medium[] = [];
  let anyForeign = false;
  const mediumFor = (glass: string, snum: number): Medium => {
    const g = glass.toUpperCase();
    if (g === "" || g === "AIR") {
      const ex = mediaTbl.find((mm) => mm.key === "AIR");
      if (ex) return ex;
      const mm: Medium = { key: "AIR", display: AIR_EN, letter: " ", russian: true, indices: Array(nidx).fill(1.0) };
      mediaTbl.push(mm);
      return mm;
    }
    const surf = surfs.find((s) => s.num === snum)!;
    if (surf.glassModel) {
      const [nd, vd] = surf.glassModel;
      const key = `MODEL_${fmtG(nd)}_${fmtG(vd)}`;
      const ex = mediaTbl.find((mm) => mm.key === key);
      if (ex) return ex;
      rep.warn(`surface ${snum}: model glass nd=${fmtG(nd)} vd=${fmtG(vd)} approximated (Cauchy)`);
      anyForeign = true;
      const mm: Medium = {
        key, display: "", letter: " ", russian: false, indices: wl.slice(0, nidx).map((w) => modelGlassIndex(nd, vd, w)),
      };
      mediaTbl.push(mm);
      return mm;
    }
    const ex = mediaTbl.find((mm) => mm.key === g);
    if (ex) return ex;
    const gl = lib.find(glass, z.gcat);
    if (gl === null)
      throw new ConversionError(
        `glass ${glass} (surface ${snum}) not found in the loaded catalogs` +
          (z.gcat.length ? ` (the file lists ${z.gcat.join(", ")})` : ""),
      );
    for (const w of wl)
      if (!(gl.ld[0] - 1e-9 <= w && w <= gl.ld[1] + 1e-9))
        rep.warn(`glass ${glass}: wavelength ${w.toFixed(4)} um outside catalog range ${gl.ld[0].toFixed(3)}-${gl.ld[1].toFixed(3)}`);
    let rus = isRussianCatalog(gl.catalog);
    let disp = rus ? russianName(gl.name) : null;
    const alias = CRYSTAL_ALIAS[gl.name.toUpperCase()];
    if (rus && disp === null) rus = false;
    if (!rus) {
      anyForeign = true;
      disp = alias || gl.name.toUpperCase();
    }
    if (encodeCp866(disp!).length > 8) {
      const short = [...disp!].slice(0, 8).join("");
      rep.warn(`glass name ${disp} truncated to ${short} (OPAL allows 8 characters)`);
      disp = short;
    }
    const mm: Medium = {
      key: g, display: disp!, letter: rus ? "R" : vendorLetter(gl.catalog), russian: rus,
      indices: wl.slice(0, nidx).map((w) => glassIndex(gl, w)),
    };
    mediaTbl.push(mm);
    rep.note(`glass ${glass} (${gl.catalog}) -> ${disp}`);
    return mm;
  };

  const seq: [Medium, number][] = [];
  let sign = 1;
  let cur = mediumFor(isMirror(objS) ? "" : objS.glass, objS.num);
  seq.push([cur, sign]);
  for (const s of opt) {
    if (isMirror(s)) sign = -sign;
    else if (s.type !== "COORDBRK") cur = mediumFor(s.glass, s.num);
    seq.push([cur, sign]);
  }

  const catMode = opts.catMode ?? (anyForeign ? CAT_MODE_INTERNATIONAL : CAT_MODE_RUSSIAN);
  const tbl = [...mediaTbl.filter((mm) => mm.key === "AIR"), ...mediaTbl.filter((mm) => mm.key !== "AIR")];
  const names = tbl.map((mm) => {
    if (mm.key === "AIR") return glassField(catMode === CAT_MODE_RUSSIAN ? AIR_RU : AIR_EN, " ");
    // the catalog native to the mode is unlettered: GOST in Russian mode, Schott otherwise
    let letter = opts.catalogLetters ? mm.letter : " ";
    if (catMode === CAT_MODE_RUSSIAN && mm.russian) letter = " ";
    if (catMode !== CAT_MODE_RUSSIAN && letter === "S") letter = " ";
    return glassField(mm.display, letter);
  });

  const o = newOpj();
  o.name = [...(z.name || "")].slice(0, 40).join("");
  o.wavelengths = wl;
  o.thick = opt.map((s) => s.disz * scale);
  o.media = seq.map(([mm, sg]) => sg * (tbl.indexOf(mm) + 1));
  o.indices = tbl.map((mm) => mm.indices);
  o.glassNames = names;

  const asphOrders: number[] = [];
  const asphFloats: number[] = [];
  let anyAsph = false;
  const hsv: number[] = [];
  for (const s of opt) {
    const [c, ord, fl] = fitAsphere(s, scale, opts, rep);
    o.curv.push(c);
    asphOrders.push(ord);
    asphFloats.push(...fl);
    anyAsph = anyAsph || ord !== 0;
    hsv.push(s.diam * scale);
  }
  if (anyAsph) {
    if (asphFloats.length > 100)
      throw new ConversionError(`aspheric data needs ${asphFloats.length} coefficients; OPAL holds 100`);
    o.asphere = {
      head: 0, order: asphOrders, aux: Array(nss).fill(0),
      coef: [...asphFloats, ...Array(100 - asphFloats.length).fill(0)],
    };
  }
  if (hsv.some((h) => h > 0)) o.hsv = hsv.map(f32);

  const nSigned = seq.map(([mm, sg]) => sg * mm.indices[0]);
  let stopI = opt.findIndex((s) => s.stop);
  if (stopI < 0) stopI = 0;
  const atStop = (y1: number, u0: number): number => paraxialTrace(o.curv, o.thick, nSigned, y1, u0).heights[stopI];
  const A = atStop(1.0, 0.0);
  const B = atStop(0.0, 1.0);
  const zEp = A !== 0 ? B / A : 0.0;
  const nuOut = paraxialTrace(o.curv, o.thick, nSigned, 1.0, 0.0).nu;
  const efl = nuOut !== 0 ? -nSigned[nSigned.length - 1] / nuOut : Infinity;

  const obInf = objS.diszInf;
  o.ints = {
    ...o.ints, nd: stopI + 1, ob: obInf ? 0 : 1, im: z.afocal ? 0 : 1, kindo: 1, kindi: 1, siFromLast: 1,
    apType: -1, fieldInImage: 0, catMode,
  };
  o.s0 = obInf ? 0.0 : -objS.disz * scale;
  o.objCurv = objS.curv / scale;
  o.imgCurv = imgS.curv / scale;
  o.sd = 0.0;
  const epdGuess = 2 * Math.max(...opt.slice(0, stopI + 1).map((s) => s.diam), 1.0) * scale;
  const nearlyAfocal = !Number.isFinite(efl) || Math.abs(efl) > 1e6 * epdGuess;
  if (z.afocal || opts.afocal) {
    o.ints.im = 0;
    o.si = 0.0;
    rep.note("image set to infinity (afocal), SI = 0 dptr");
  } else if (nearlyAfocal && nss && o.curv.some((c) => c !== 0)) {
    rep.note(`output beam is collimated (EFL ${fmtG(efl, 3)} mm): consider the afocal option so OPAL evaluates against a plane wave`);
  }
  if (o.ints.im !== 0) {
    if (opts.imagePosition === "gauss") {
      o.ints.siFromLast = 0;
      o.si = 0.0;
      o.thick[o.thick.length - 1] = INF;
      rep.note(`image placed at the paraxial (Gauss) plane; Zemax distance was ${fmtG(opt[opt.length - 1].disz * scale)} mm`);
    } else {
      o.si = opt[opt.length - 1].disz * scale;
    }
  }
  const n0 = Math.abs(nSigned[0]);
  const lObj = obInf ? 0.0 : objS.disz * scale;
  const dObjEp = lObj + zEp;

  const [kind, val, flag] = z.aperture;
  let epd: number | null;
  if (kind === "ENPD") epd = val * scale;
  else if (kind === "FNUM" && flag === 1) epd = null;
  else if (kind === "FNUM") {
    epd = val ? Math.abs(efl) / val : 0.0;
    rep.note(`F/# ${fmtG(val, 4)} -> EPD ${fmtG(epd)} mm (EFL ${fmtG(efl)})`);
  } else if (kind === "OBNA" || kind === "FLOA") epd = null;
  else throw new ConversionError(`unsupported aperture type ${kind}`);
  if (kind === "FNUM" && flag === 1) {
    // Zemax paraxial working F/#: W = 1/(2 n' tan u')
    const nImg = Math.abs(nSigned[nSigned.length - 1]);
    const naImg = nImg * Math.sin(Math.atan(1.0 / (2.0 * nImg * val)));
    o.ints.apType = 1;
    o.aperture = [naImg, naImg];
    rep.note(`paraxial working F/# ${fmtG(val, 4)} -> back aperture ${fmtG(naImg)}`);
  } else if (kind === "FLOA") {
    o.ints.apType = 0;
    const semiStop = opt[stopI].diam * scale;
    o.aperture = [semiStop, semiStop];
  } else if (kind === "OBNA") {
    const na = flag === 1 ? n0 * Math.sin(val * (Math.PI / 180)) : val;
    if (obInf) throw new ConversionError("object-space NA with an object at infinity");
    o.aperture = [na, na];
  } else if (obInf) {
    o.aperture = [epd! / 2, epd! / 2];
  } else {
    const na = n0 * Math.sin(Math.atan2(epd! / 2, dObjEp));
    o.aperture = [na, na];
    rep.note(`EPD ${fmtG(epd!)} mm with finite object -> front NA ${fmtG(na)}`);
  }

  const ftype = z.ftyp.length ? z.ftyp[0] : 0;
  const vignList = z.vign.length ? z.vign : z.fields.map((): [number, number, number, number] => [0, 0, 0, 0]);
  const radial: [number, [number, number, number, number], number][] = [];
  for (let i = 0; i < Math.min(z.fields.length, vignList.length); i++) {
    const [x, y] = z.fields[i];
    if (x !== 0) rep.warn(`field (${fmtG(x)}, ${fmtG(y)}): x component folded into radial field`);
    radial.push([Math.hypot(x, y), vignList[i], y]);
  }
  let offaxis: typeof radial = [];
  for (const t of radial.filter((t) => t[0] > 0).sort((a, b) => b[0] - a[0])) {
    if (offaxis.length && Math.abs(offaxis[offaxis.length - 1][0] - t[0]) <= 1e-9 * t[0]) continue;
    offaxis.push(t);
  }
  if (offaxis.length > 5) {
    rep.warn(`${offaxis.length} off-axis fields; OPAL keeps 5 (largest and evenly chosen)`);
    const L = offaxis.length;
    offaxis = [offaxis[0], ...[1, 2, 3, 4].map((i) => offaxis[pyRound((i * (L - 1)) / 4)])];
  }
  const fmax = offaxis.length ? offaxis[0][0] : 0.0;
  if (ftype === 0 || ftype === 4) {
    if (obInf) o.fieldSize = [fmax * (Math.PI / 180), fmax * (Math.PI / 180)];
    else {
      const h = Math.tan(fmax * (Math.PI / 180)) * dObjEp;
      o.fieldSize = [h, h];
      o.ints.kindo = 0;
      rep.note(`angle field ${fmtG(fmax)} deg with finite object -> object height ${fmtG(h)} mm`);
    }
  } else if (ftype === 1) {
    if (obInf) throw new ConversionError("object height field with an object at infinity");
    o.fieldSize = [fmax * scale, fmax * scale];
  } else if (ftype === 2 || ftype === 3) {
    o.fieldSize = [fmax * scale, fmax * scale];
    o.ints.fieldInImage = 1;
    if (ftype === 3) rep.warn("real image height field mapped to OPAL image size");
  } else throw new ConversionError(`unsupported field type ${ftype}`);
  if (offaxis.length) {
    // OPAL's upper vignetting VB cuts the stop on the side away from the object point,
    // the lower VH on the object side. side: object-space side (+1 above axis) of a +y field.
    let side: number;
    if (ftype === 0 || ftype === 4) side = -1.0;
    else if (ftype === 1) side = 1.0;
    else if (obInf) side = efl > 0 ? -1.0 : 1.0;
    else side = paraxialMagnification(o.curv, o.thick, nSigned, lObj) > 0 ? 1.0 : -1.0;
    const rel: number[] = [];
    const vg: [number, number][] = [];
    for (const [r, [, vdy, , vcy], ysign] of offaxis) {
      rel.push(f32(r / fmax));
      const s = side * (ysign >= 0 ? 1.0 : -1.0);
      // Zemax cuts the pupil at +y by VCY - VDY and at -y by VCY + VDY
      let up = vcy + s * vdy;
      let lo = vcy - s * vdy;
      if (opts.vignFlip) [up, lo] = [lo, up];
      vg.push([f32(up), f32(lo)]);
    }
    const n = rel.length;
    const beams: FieldBeams = { rel, vign: vg, s0: Array(n).fill(o.s0), si: Array(n).fill(o.si), sd: Array(n).fill(o.sd) };
    o.beams = beams;
  }

  o.spectral = {
    lo: wl.length > 1 ? Math.min(...wl) : 0.0,
    hi: wl.length > 1 ? Math.max(...wl) : 0.0,
    weights: [...wts, ...Array(10).fill(1.0)].slice(0, 10),
  };
  rep.note(`stop: surface ${stopI + 1}; entrance pupil ${fmtG(zEp)} mm from surface 1; EFL ${fmtG(efl)} mm`);
  return { opj: o, report: rep };
}
