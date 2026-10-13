import { GlassLibrary, glassIndex } from "./agf.ts";
import { fmtE, fmtG } from "./format.ts";
import {
  agfText, type CustomGlass, describeHit, fitDispersion, type GlassResolution, ndVd, resolveOpalGlass, zemaxGlassName,
} from "./glassmatch.ts";
import { lstsq } from "./numeric.ts";
import { nfloats, type OPJ, RAW_BLOCK_INFO, screenEk, screenNe } from "./opj.ts";
import { paraxialMagnification, paraxialTrace } from "./paraxial.ts";
import { Report, ConversionError } from "./zmx2opj.ts";
import { opalSagU, opalSagZ } from "./surfaces.ts";
import { type ZmxField, type ZmxGlass, type ZmxOut, type ZmxSurfaceOut, writeZmxText } from "./zmxwriter.ts";

export interface OpjToZmxOptions {
  unmatchedGlass: "agf" | "model";
  indexTolerance: number;
  asphereTol: number;
  vignFlip: boolean;
}

export const defaultOpjToZmxOptions = (): OpjToZmxOptions => ({
  unmatchedGlass: "agf", indexTolerance: 2e-5, asphereTol: 1e-6, vignFlip: false,
});

export interface GlassMapping {
  opal: string;
  zemax: string;
  kind: "catalog" | "custom" | "model";
  catalog?: string;
  maxError?: number;
}

/** First-order data of the converted system at the primary wavelength (mm, degrees). */
export interface ParaxialData {
  efl: number; // 1/power, Infinity when afocal
  bfd: number; // paraxial image from OPAL's last surface
  imageDistance: number; // image plane as converted, from OPAL's last surface; NaN when afocal
  epd: number;
  fno: number; // paraxial working F/#
  naObject: number; // 0 for an object at infinity
  naImage: number;
  fieldType: number; // 0 angle, 1 object height, 2 paraxial image height
  field: number; // largest field value
  fov: number; // full object-space field angle seen from the entrance pupil
  imageHeight: number; // full height on the paraxial image plane; NaN when afocal
  magnification: number; // lateral for a finite object, angular when afocal, else NaN
}

export interface OpjToZmxResult {
  zmx: string;
  model: ZmxOut;
  agf?: { catalog: string; fileName: string; text: string };
  glasses: GlassMapping[];
  report: Report;
  paraxial: ParaxialData;
}

/** Shortest decimal that rounds to the same float32 (values OPAL stored in single precision). */
export function shortF32(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  for (let p = 1; p <= 9; p++) {
    const v = Number(x.toPrecision(p));
    if (Math.fround(v) === x) return v;
  }
  return x;
}

const deg = (rad: number): number => rad * (180 / Math.PI);

function fromMeasure(kind: number, rel: number, wmax: number): number {
  switch (kind) {
    case 1:
      return rel * wmax;
    case 2:
      return Math.asin(Math.min(1, rel * Math.sin(wmax)));
    case 3:
      return 2 * Math.asin(Math.min(1, rel * Math.sin(wmax / 2)));
    default:
      return Math.atan(rel * Math.tan(wmax));
  }
}

function conicSag(c: number, k: number, r: number): number {
  const arg = 1 - (1 + k) * c * c * r * r;
  return arg < 0 ? Number.NaN : (c * r * r) / (1 + Math.sqrt(arg));
}

interface EvenAsphereFit {
  conic: number;
  parm: number[];
  err: number;
  terms: number;
}

function fitEvenAsphere(sag: (r: number) => number, c: number, k0: number, h: number, tol: number): EvenAsphereFit {
  const npts = 300;
  const rs = Array.from({ length: npts }, (_, i) => h * Math.sqrt((i + 0.5) / npts));
  const zt = rs.map(sag);
  const check = [...rs, h];
  const zc = [...zt, sag(h)];
  if (zc.some((v) => !Number.isFinite(v))) return { conic: k0, parm: Array(8).fill(0), err: Infinity, terms: 0 };
  const evaluate = (k: number, terms: number): EvenAsphereFit => {
    const base = check.map((r) => conicSag(c, k, r));
    if (base.some((v) => !Number.isFinite(v))) return { conic: k, parm: Array(8).fill(0), err: Infinity, terms };
    const A = rs.map((r) => Array.from({ length: terms }, (_, i) => ((r * r) / (h * h)) ** (i + 2)));
    const beta = terms ? lstsq(A, rs.map((_, i) => zt[i] - base[i])) : [];
    const parm = Array(8).fill(0);
    beta.forEach((v, i) => (parm[i + 1] = v / h ** (2 * (i + 2))));
    let err = 0;
    check.forEach((r, i) => {
      let z = base[i];
      for (let j = 1; j < 8; j++) z += parm[j] * r ** (2 * (j + 1));
      err = Math.max(err, Math.abs(z - zc[i]));
    });
    return { conic: k, parm, err, terms };
  };
  const bestFor = (k: number): EvenAsphereFit => {
    let best = evaluate(k, 0);
    for (let t = 1; t <= 7 && best.err > tol; t++) {
      const f = evaluate(k, t);
      if (f.err < best.err * 0.999) best = f;
    }
    return best;
  };
  let best = bestFor(k0);
  if (best.err > tol) {
    for (const k of [0, -1]) {
      const cand = bestFor(k);
      if (cand.err < best.err) best = cand;
    }
  }
  if (best.err > tol) {
    let lo = best.conic - 4;
    let hi = best.conic + 4;
    for (let it = 0; it < 40; it++) {
      const m1 = lo + (hi - lo) * 0.382;
      const m2 = lo + (hi - lo) * 0.618;
      if (evaluate(m1, 7).err < evaluate(m2, 7).err) hi = m2;
      else lo = m1;
    }
    const cand = bestFor((lo + hi) / 2);
    if (cand.err < best.err) best = cand;
  }
  return best;
}

// U-type with e2 = 1 is a paraboloid plus even terms: EVENASPH with k = -1 holds it exactly up to r^16.
function paraboloidParms(ha: number, coefs: number[]): number[] | null {
  let n = coefs.length;
  while (n && coefs[n - 1] === 0) n--;
  if (n > 7) return null;
  const h = shortF32(ha);
  const parm = Array(8).fill(0);
  for (let q = 0; q < n; q++) parm[q + 1] = shortF32(coefs[q]) / h ** (2 * (q + 2));
  return parm;
}

interface OptSurf {
  opj: number;
  curv: number;
  thick: number;
  medium: number;
  mirror: boolean;
  hsv?: number;
  asphOrder: number;
  asphFloats: number[];
  stop?: boolean;
  dummy?: string;
}

export function sanitizeCatalogName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  const t = base.toUpperCase().replace(/[^A-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return "OPAL_" + (t || "SYSTEM").slice(0, 24);
}

/** The same system mirrored along z (OPAL allows light to start in -z; Zemax does not). */
export function mirrorZ(o: OPJ): OPJ {
  const neg = (a: number[]): number[] => a.map((v) => -v);
  const f: OPJ = {
    ...o,
    curv: neg(o.curv), thick: neg(o.thick), media: neg(o.media),
    s0: -o.s0, si: -o.si, sd: -o.sd, objCurv: -o.objCurv, imgCurv: -o.imgCurv,
  };
  if (o.beams) f.beams = { ...o.beams, s0: neg(o.beams.s0), si: neg(o.beams.si), sd: neg(o.beams.sd) };
  if (o.asphere) {
    const coef = o.asphere.coef.slice();
    let p = 0;
    for (const order of o.asphere.order) {
      const nf = nfloats(order);
      // U-type: Q(u) changes sign; Z-type: b_j -> (-1)^(j+1) b_j with j = i + 3
      if (order > 2) for (let i = p + 2; i < p + nf; i++) coef[i] = -coef[i];
      else if (order < -2) for (let i = 0; i < nf - 2; i++) if (i % 2) coef[p + 2 + i] = -coef[p + 2 + i];
      p += nf;
    }
    f.asphere = { ...o.asphere, coef };
  }
  return f;
}

export function convertOpjToZmx(
  o: OPJ, lib: GlassLibrary, opts: OpjToZmxOptions, fileName = "system.opj", catalogName = sanitizeCatalogName(fileName),
): OpjToZmxResult {
  const rep = new Report();
  if (o.media.length && o.media[0] < 0) {
    o = mirrorZ(o);
    rep.note("light travels in -z in the OPAL object space: the system is mirrored along z");
  }
  const N = o.curv.length;
  if (N < 1) throw new ConversionError("the system has no surfaces");
  const nla = o.wavelengths.length;
  if (nla < 1) throw new ConversionError("the system has no wavelengths");
  const nidx = Math.min(nla, 5);
  const ints = o.ints;
  const wl = o.wavelengths.map(shortF32);

  for (const key of o.rawBlocks.keys()) {
    const info = RAW_BLOCK_INFO[key] ?? `block ${key}`;
    if (key.startsWith("1:")) rep.warn(`${info} not converted: the current state of the system is converted`);
    else if (key === "0:0100") rep.warn("gradient-index media are not converted");
    else if (key !== "0:0080") rep.note(`${info} ignored`);
  }
  const b = o.beams;
  if (b && (b.s0.some((v) => v !== o.s0) || b.si.some((v) => v !== o.si) || b.sd.some((v) => v !== o.sd)))
    rep.warn("per-beam object, image or stop positions differ from the axial ones; the axial values are used");

  // glasses
  const resolutions = new Map<number, GlassResolution>();
  const zGlass = new Map<number, ZmxGlass | null>();
  const customs: CustomGlass[] = [];
  const glassMap: GlassMapping[] = [];
  const wlStored = wl.slice(0, nidx);
  const ldRange: [number, number] = [Math.max(0.1, Math.min(...wl) - 0.01), Math.max(...wl) + 0.01];
  const media = [...new Set(o.media.map(Math.abs))].sort((x, y) => x - y);
  const labelOf = (g: number): string => resolutions.get(g)!.opalName.raw.trim() || `(index-only medium ${g})`;
  for (const g of media) {
    if (g < 1 || g > o.glassNames.length) throw new ConversionError(`medium ${g} is not in the glass table`);
    const indices = o.indices[g - 1];
    const res = resolveOpalGlass(o.glassNames[g - 1], indices, wlStored, lib, opts.indexTolerance, wl);
    resolutions.set(g, res);
    if (res.kind !== "air" && indices.some((n) => !(n > 0)))
      throw new ConversionError(`glass "${labelOf(g)}" has no valid refractive index`);
  }
  // Zemax takes a glass from the first GCAT catalog holding its name: order the catalogs so that
  // no catalog shadows a glass taken from a later one; glasses caught in a conflict become custom
  let gcat: string[] = [];
  for (;;) {
    const used = media.filter((g) => resolutions.get(g)!.kind === "catalog");
    const cats: string[] = [];
    for (const g of used) {
      const c = resolutions.get(g)!.hit!.glass.catalog;
      if (!cats.includes(c)) cats.push(c);
    }
    const after = new Map(cats.map((c) => [c, new Set<string>()]));
    const blame = new Map<string, number[]>();
    for (const g of used) {
      const gl = resolutions.get(g)!.hit!.glass;
      for (const other of cats)
        if (other !== gl.catalog && lib.catalog(other).has(gl.name.toUpperCase())) {
          after.get(gl.catalog)!.add(other);
          blame.set(`${gl.catalog}>${other}`, [...(blame.get(`${gl.catalog}>${other}`) ?? []), g]);
        }
    }
    const order: string[] = [];
    const left = new Set(cats);
    while (left.size) {
      const free = cats.find((c) => left.has(c) && ![...left].some((d) => d !== c && after.get(d)!.has(c)));
      if (!free) break;
      order.push(free);
      left.delete(free);
    }
    if (!left.size) {
      gcat = order;
      break;
    }
    const [edge] = [...blame].filter(([k]) => left.has(k.split(">")[0]) && left.has(k.split(">")[1]));
    for (const g of edge[1]) {
      const r = resolutions.get(g)!;
      rep.note(`glass "${labelOf(g)}": ${r.hit!.glass.name} is also in another catalog of this file; written as a custom glass`);
      r.closest = r.hit;
      r.hit = undefined;
      r.kind = "custom";
    }
  }
  const usedNames = new Set<string>();
  for (const g of media) {
    const r = resolutions.get(g)!;
    if (r.kind === "catalog") usedNames.add(r.hit!.glass.name.toUpperCase());
  }
  for (const g of media) {
    const res = resolutions.get(g)!;
    const label = labelOf(g);
    const indices = o.indices[g - 1];
    if (res.kind === "air") {
      zGlass.set(g, null);
      continue;
    }
    if (res.kind === "catalog") {
      const gl = res.hit!.glass;
      zGlass.set(g, { name: gl.name, nd: gl.nd, vd: gl.vd });
      glassMap.push({ opal: label, zemax: gl.name, kind: "catalog", catalog: gl.catalog, maxError: res.hit!.maxError });
      continue;
    }
    const cd = fitDispersion(wlStored, indices);
    const closest = res.closest ? `; closest catalog glass ${describeHit(res.closest)}` : "";
    if (opts.unmatchedGlass === "model") {
      const [nd, vd] = ndVd(cd);
      zGlass.set(g, { name: "___BLANK", model: { nd, vd } });
      glassMap.push({ opal: label, zemax: `model nd=${fmtG(nd, 6)} vd=${fmtG(vd, 4)}`, kind: "model" });
      rep.warn(`glass "${label}" not found in the loaded catalogs${closest}: written as a model glass (approximate dispersion)`);
    } else {
      const stem = zemaxGlassName(res.opalName.name, `GLASS${g}`);
      const known = (n: string): boolean => usedNames.has(n) || lib.names.some((c) => lib.catalog(c).has(n));
      let name = known(stem) ? `${stem}_OPAL` : stem;
      for (let i = 2; known(name); i++) name = `${stem}_OPAL${i}`;
      usedNames.add(name);
      customs.push({ name, comment: `OPAL glass "${label}", indices fitted to ${nidx} wavelength(s)`, cd, ld: ldRange });
      zGlass.set(g, { name, nd: ndVd(cd)[0], vd: ndVd(cd)[1] });
      glassMap.push({ opal: label, zemax: name, kind: "custom", catalog: catalogName });
      if (res.closest && res.closest.maxError < 1e-2)
        rep.note(`glass "${label}": closest catalog glass ${describeHit(res.closest)}; the OPAL indices are kept in ${catalogName}.AGF`);
    }
  }
  {
    const n1 = (g: number): number => {
      const r = resolutions.get(g)!;
      return r.kind === "catalog" ? glassIndex(r.hit!.glass, wl[0]) : o.indices[g - 1][0];
    };
    const efl = (idx: (g: number) => number): number => {
      const n = o.media.map((m) => Math.sign(m) * idx(Math.abs(m)));
      const r = paraxialTrace(o.curv, o.thick.map((x) => (Math.abs(x) > 1e19 ? 0 : x)), n, 1, 0);
      return r.nu ? -n[n.length - 1] / r.nu : Infinity;
    };
    const e0 = efl((g) => o.indices[g - 1][0]);
    const e1 = efl(n1);
    const change = Number.isFinite(e0) && Number.isFinite(e1) ? Math.abs(e1 - e0) / Math.abs(e0) : 0;
    if (change > 1e-4)
      rep.warn(`the catalog glasses change the paraxial focal length by ${fmtG(change * 100, 3)}% (${fmtG(e0, 7)} -> ${fmtG(e1, 7)} mm); lower the index tolerance to keep OPAL's exact indices`);
  }
  if (customs.length) {
    gcat.unshift(catalogName);
    if (nla > 5) rep.note(`indices of glasses in ${catalogName}.AGF at wavelengths 6-${nla} are extrapolated (OPAL stores indices for 5 wavelengths)`);
  }

  // optical surfaces
  const asph = o.asphere;
  let p = 0;
  const opt: OptSurf[] = [];
  for (let k = 0; k < N; k++) {
    const mBefore = o.media[k];
    const mAfter = o.media[k + 1];
    const mirror = Math.sign(mBefore) !== Math.sign(mAfter);
    if (mirror && Math.abs(mBefore) !== Math.abs(mAfter))
      rep.warn(`surface ${k + 1}: reflection into a different medium; the medium before the mirror is kept`);
    const order = asph ? asph.order[k] : 0;
    const nf = nfloats(order);
    const floats = asph ? asph.coef.slice(p, p + nf) : [];
    p += nf;
    if (asph && (asph.aux[k] !== 0 || Math.abs(order) > 100 || (asph.head !== 0 && order !== 0)))
      rep.warn(`surface ${k + 1}: cylindrical/toroidal/holographic data is not converted (vertex curvature kept)`);
    const h = o.hsv?.[k];
    opt.push({
      opj: k + 1, curv: o.curv[k], thick: o.thick[k], medium: mirror ? Math.abs(mBefore) : Math.abs(mAfter), mirror,
      hsv: h !== undefined && h > 0 && h < 1e19 ? shortF32(h) : undefined,
      asphOrder: Math.abs(order) > 100 ? 0 : order, asphFloats: floats,
    });
  }
  const index0 = (g: number): number => o.indices[g - 1][0];
  const objMedium = Math.abs(o.media[0]);
  const n0 = index0(objMedium);

  // stop / entrance pupil
  const obInf = ints.ob === 0;
  let stopBefore: number | null = null;
  let stopAfter: { k: number; sd: number } | null = null;
  const nd = ints.nd;
  if (nd === 99) {
    if (obInf) stopBefore = o.sd;
    else if (o.sd !== 0) stopBefore = o.s0 + 1000 / o.sd;
    else {
      rep.warn("telecentric entrance pupil (SD = 0 dptr) is not converted: the stop is placed at surface 1");
      opt[0].stop = true;
    }
    if (stopBefore !== null) rep.note(`entrance pupil given in OPAL: a dummy stop surface is placed ${fmtG(stopBefore)} mm from surface 1`);
  } else if (nd === 0) {
    if (o.sd === 0) opt[0].stop = true;
    else stopBefore = o.sd;
  } else if (nd >= 1 && nd <= N) {
    if (o.sd === 0) opt[nd - 1].stop = true;
    else stopAfter = { k: nd, sd: o.sd };
  } else {
    rep.warn(`stop position ND=${nd} is outside the system; the stop is placed at surface 1`);
    opt[0].stop = true;
  }

  // surface list in Zemax order (without object/image)
  const list: OptSurf[] = [];
  if (stopBefore !== null)
    list.push({ opj: 0, curv: 0, thick: -stopBefore, medium: objMedium, mirror: false, asphOrder: 0, asphFloats: [], stop: true, dummy: "stop" });
  for (const s of opt) {
    list.push(s);
    if (stopAfter && s.opj === stopAfter.k) {
      list.push({ opj: 0, curv: 0, thick: s.thick - stopAfter.sd, medium: s.medium, mirror: false, asphOrder: 0, asphFloats: [], stop: true, dummy: "stop" });
      s.thick = stopAfter.sd;
    }
  }
  const M = list.length;
  const C = list.map((s) => s.curv);
  const sgn = (k: number): number => Math.sign(o.media[k]) || 1;
  // signed index after each listed surface (primary wavelength)
  const Nn: number[] = [Math.sign(o.media[0] || 1) * n0];
  {
    let k = 0;
    for (const s of list) {
      if (s.dummy) Nn.push(Nn[Nn.length - 1]);
      else {
        k = s.opj;
        Nn.push(sgn(k) * index0(Math.abs(o.media[k])));
      }
    }
  }
  const T = list.map((s) => s.thick);
  const stopIdx = list.findIndex((s) => s.stop);
  const lastIdx = M - 1;

  const zFirst = stopBefore ?? 0;
  const trace = (y1: number, u0: number) => paraxialTrace(C, T, Nn, y1, u0);
  const atStop = (y1: number, u0: number): number => trace(y1, u0).heights[stopIdx];
  const A = atStop(1, 0);
  const B = atStop(0, 1);
  const zEpRel = A !== 0 ? B / A : 0;
  const zEp = zFirst + zEpRel;

  let objThick: number | "INFINITY" = "INFINITY";
  let dObj = 0;
  if (!obInf) {
    dObj = zFirst - o.s0;
    objThick = dObj;
  } else if (o.s0 !== 0) {
    const zObj = zEp + 1000 / o.s0;
    dObj = zFirst - zObj;
    objThick = dObj;
    rep.note(`object at ${fmtG(1000 / o.s0)} mm from the entrance pupil (S0 = ${fmtG(o.s0)} dptr)`);
  }
  const finiteObj = objThick !== "INFINITY";
  const marginal = (scale: number): { heights: number[]; nu: number } =>
    finiteObj ? trace(dObj * scale, scale) : trace(scale, 0);

  // image, measured from OPAL's last surface
  const iN = list.findIndex((s) => s.opj === N);
  const mOut = marginal(1);
  const uL = mOut.nu / Nn[M];
  const bfd = uL !== 0 ? -mOut.heights[iN] / uL : Infinity;
  let imgThick = 0;
  let solve = false;
  if (ints.im === 1) {
    if (ints.siFromLast === 1) imgThick = o.si;
    else {
      if (Number.isFinite(bfd)) {
        imgThick = bfd + o.si;
        solve = o.si === 0;
      } else {
        imgThick = Math.abs(o.thick[N - 1]) < 1e10 ? o.thick[N - 1] : 0;
        rep.warn("the paraxial image is at infinity although OPAL expects a finite image; consider the afocal image space");
      }
    }
  } else {
    if (o.si !== 0) rep.warn(`image vergence ${fmtG(o.si)} dptr is not converted: afocal image space is used`);
    const t = o.thick[N - 1];
    imgThick = Math.abs(t) < 1e10 ? t : 0;
  }
  if (stopAfter && stopAfter.k === N) {
    list[lastIdx].thick = imgThick - stopAfter.sd;
    T[lastIdx] = list[lastIdx].thick;
  } else {
    list[lastIdx].thick = imgThick;
    T[lastIdx] = imgThick;
  }

  // aperture
  const nImg = Math.abs(Nn[M]);
  const apVal = Math.abs(o.aperture[0]);
  let aperture: ZmxOut["aperture"];
  if (ints.apType === 0) {
    aperture = { kind: "FLOA", value: 0, flag: 0 };
    list[stopIdx].hsv = apVal;
  } else if (ints.apType === 1 && ints.im === 1) {
    const s = Math.min(apVal / nImg, 0.999999);
    if (apVal >= nImg) rep.warn(`back aperture ${fmtG(apVal)} exceeds the image-space index`);
    aperture = { kind: "FNUM", value: 1 / (2 * nImg * Math.tan(Math.asin(s))), flag: 1 };
  } else if (ints.apType === 1) {
    // OPAL: n' x marginal-ray height on the exit pupil
    const cr = trace(-zEpRel, 1);
    const yc = cr.heights[lastIdx];
    const uc = cr.nu / Nn[M];
    const zXp = uc !== 0 && Number.isFinite(yc / uc) ? -yc / uc : 0;
    const mr = marginal(1);
    const out = Math.abs(mr.heights[lastIdx] + (mr.nu / Nn[M]) * zXp);
    if (out === 0) throw new ConversionError("cannot convert the back aperture: no paraxial marginal ray");
    const k = apVal / nImg / out;
    if (finiteObj) aperture = { kind: "OBNA", value: n0 * Math.sin(Math.atan(k)), flag: 0 };
    else aperture = { kind: "ENPD", value: 2 * k, flag: 0 };
    rep.note(`back aperture ${fmtG(apVal)} (exit pupil height x n') converted through the paraxial marginal ray`);
  } else if (finiteObj && apVal < n0 && ints.ob === 1) {
    aperture = { kind: "OBNA", value: apVal, flag: 0 };
  } else {
    if (ints.ob === 1) rep.warn(`front aperture ${fmtG(apVal)} is not a valid NA; used as entrance pupil height`);
    aperture = { kind: "ENPD", value: (2 * apVal) / n0, flag: 0 };
  }

  // marginal ray scaled to the actual aperture, for clear-aperture estimates and obscuration
  let mScale = 1;
  {
    const hStop = Math.abs(atStop(finiteObj ? dObj : 1, finiteObj ? 1 : 0));
    if (aperture.kind === "FLOA") mScale = hStop ? apVal / hStop : 1;
    else if (aperture.kind === "ENPD") mScale = finiteObj ? aperture.value / 2 / Math.abs(zEp - (zFirst - dObj)) : aperture.value / 2;
    else if (aperture.kind === "OBNA") mScale = Math.tan(Math.asin(Math.min(aperture.value / n0, 0.999999)));
    else {
      const u = 1 / (2 * nImg * aperture.value);
      mScale = Math.abs(uL) ? u / Math.abs(uL) : 1;
    }
  }
  const mHeights = marginal(mScale).heights.map(Math.abs);

  // fields
  const nuOut = trace(1, 0).nu;
  const efl = nuOut !== 0 ? -Nn[0] / nuOut : Infinity;
  const rels = b ? b.rel.map(shortF32) : [];
  const vigns = b ? b.vign.map(([u, l]) => [shortF32(u), shortF32(l)] as [number, number]) : [];
  const fsize = Math.abs(o.fieldSize[0]);
  if (!b && fsize > 0) {
    rels.push(1);
    vigns.push([0, 0]);
    rep.note("no off-axis beams in the OPAL file: the full field is added as a Zemax field");
  }
  let fieldType: number;
  let values: number[];
  let side: number;
  if (ints.fieldInImage === 0) {
    if (obInf) {
      fieldType = 0;
      values = rels.map((r) => deg(fromMeasure(ints.kindo, r, fsize)));
      side = -1;
    } else {
      fieldType = 1;
      values = rels.map((r) => r * fsize);
      side = 1;
    }
  } else if (ints.im === 1) {
    fieldType = 2;
    values = rels.map((r) => r * fsize);
    if (obInf && o.s0 === 0) side = efl > 0 ? -1 : 1;
    else side = paraxialMagnification(C, T, Nn, finiteObj ? dObj : 0) > 0 ? 1 : -1;
  } else {
    const chief = (yObjOrAngle: number): number => {
      const r = finiteObj
        ? trace(yObjOrAngle + (-yObjOrAngle / (zEp - (zFirst - dObj))) * dObj, -yObjOrAngle / (zEp - (zFirst - dObj)))
        : trace(-zEpRel * yObjOrAngle, yObjOrAngle);
      return r.nu / Nn[M];
    };
    let g = chief(1);
    if (!g || !Number.isFinite(g)) {
      g = 1;
      rep.warn("the image-space field could not be converted through the paraxial chief ray; image-space values are used as object-space values");
    }
    if (finiteObj) {
      fieldType = 1;
      values = rels.map((r) => Math.abs(Math.tan(fromMeasure(ints.kindi, r, fsize)) / g));
      side = 1;
    } else {
      fieldType = 0;
      values = rels.map((r) => deg(Math.atan(Math.abs(Math.tan(fromMeasure(ints.kindi, r, fsize)) / g))));
      side = -1;
    }
    rep.note("image-space field converted to the object space through the paraxial chief ray");
  }
  const fields: ZmxField[] = [{ y: 0, vdy: 0, vcy: 0 }];
  rels.forEach((_, i) => {
    let [up, lo] = vigns[i];
    if (opts.vignFlip) [up, lo] = [lo, up];
    const y = Math.abs(values[i]);
    if (!(y > 0) || fields.some((f) => Math.abs(f.y - y) <= 1e-12 * y)) return;
    fields.push({ y, vcy: (up + lo) / 2, vdy: (side * (up - lo)) / 2 });
  });
  fields.sort((a, f) => a.y - f.y);

  // aspheres and clear apertures
  const zsurfs: ZmxSurfaceOut[] = [];
  const chiefScale = (() => {
    const yMax = Math.max(0, ...fields.map((f) => f.y));
    if (!yMax) return null;
    const viaAngle = (tw: number) => trace(-zEpRel * tw, tw);
    const viaHeight = (y0: number) => {
      const u = -y0 / (zEp - (zFirst - dObj));
      return trace(y0 + u * dObj, u);
    };
    if (fieldType === 0) return viaAngle(Math.tan((yMax * Math.PI) / 180));
    if (fieldType === 1) return viaHeight(yMax);
    if (!finiteObj) return Number.isFinite(efl) && efl ? viaAngle(yMax / efl) : null;
    const m = paraxialMagnification(C, T, Nn, dObj);
    return m ? viaHeight(yMax / m) : null;
  })();
  const estimate = (i: number): number => mHeights[i] + (chiefScale ? Math.abs(chiefScale.heights[i]) : 0);

  list.forEach((s, i) => {
    const surf: ZmxSurfaceOut = { type: "STANDARD", curv: s.curv, thick: s.thick, glass: null };
    if (s.stop) surf.stop = true;
    if (s.mirror) surf.glass = "MIRROR";
    else surf.glass = zGlass.get(s.medium) ?? null;
    if (s.hsv !== undefined) surf.semiDiameter = s.hsv;
    if (s.dummy) surf.comment = nd === 99 ? "entrance pupil" : "aperture stop";
    else {
      const res = resolutions.get(s.medium);
      if (!s.mirror && res && res.kind !== "air") {
        const zn = surf.glass && surf.glass !== "MIRROR" ? surf.glass.name : "";
        if (res.opalName.raw.trim() !== zn) surf.comment = `OPAL ${res.opalName.raw.trim() || "index-only medium"}`;
      }
    }
    const ord = s.asphOrder;
    const fl = s.asphFloats;
    if (Math.abs(ord) === 2) surf.conic = -shortF32(fl[0]);
    const exact = ord > 0 && fl.length >= 2 && fl[0] === 1 ? paraboloidParms(fl[1] || 1, fl.slice(2)) : null;
    if (exact) {
      surf.type = "EVENASPH";
      surf.conic = -1;
      surf.parm = exact;
      const ha = fl[1] || 1;
      rep.note(`surface ${s.opj}: OPAL U-type asphere with e²=1 -> EVENASPH, conic -1, coefficients copied` + (ha !== 1 ? ` and divided by HA^2j (HA=${fmtG(shortF32(ha))})` : ""));
    } else if (ord !== 0 && fl.length >= 2) {
      const e2 = fl[0];
      const ha = fl[1] || 1;
      const coefs = fl.slice(2);
      const sag = ord > 0 ? (r: number) => opalSagU(s.curv, e2, ha, coefs, r) : opalSagZ(s.curv, e2, ha, coefs);
      const hMax = s.curv ? 0.95 / Math.abs(s.curv) : 1e4;
      let h = Math.max(s.hsv ?? 0, estimate(i) * 1.05);
      if (!(h > 0) || !Number.isFinite(h) || h > hMax) {
        h = s.hsv ?? Math.min(hMax, 0.5 / Math.abs(s.curv || 0.1));
        rep.warn(`surface ${s.opj}: clear aperture unknown; asphere fitted over r <= ${fmtG(h, 4)} mm`);
      }
      if (!Number.isFinite(sag(h))) {
        let lo = 0;
        let hi = h;
        for (let it = 0; it < 60; it++) {
          const mid = (lo + hi) / 2;
          if (Array.from({ length: 50 }, (_, q) => sag((mid * (q + 1)) / 50)).every(Number.isFinite)) lo = mid;
          else hi = mid;
        }
        if (lo > 0) {
          rep.warn(`surface ${s.opj}: the OPAL asphere is defined only for r <= ${fmtG(lo, 4)} mm (clear aperture ${fmtG(h, 4)} mm); fitted up to there`);
          h = lo * 0.95;
        }
      }
      const fit = fitEvenAsphere(sag, s.curv, -e2, h, opts.asphereTol);
      surf.type = "EVENASPH";
      surf.conic = fit.conic;
      surf.parm = fit.parm;
      if (!Number.isFinite(fit.err)) rep.warn(`surface ${s.opj}: the OPAL asphere is undefined within r <= ${fmtG(h, 4)} mm; not converted`);
      else if (fit.err > opts.asphereTol)
        rep.warn(`surface ${s.opj}: asphere fit residual ${fmtE(fit.err, 1)} mm over r <= ${fmtG(h, 4)} mm`);
      rep.note(
        `surface ${s.opj}: OPAL ${ord > 0 ? "U" : "Z"}-type asphere -> EVENASPH, ${fit.terms} terms` +
          (fit.conic !== -e2 ? `, conic ${fmtG(fit.conic)}` : "") + ` (max sag error ${fmtE(fit.err, 1)} mm over r <= ${fmtG(h, 4)} mm)`,
      );
    }
    zsurfs.push(surf);
  });

  // obscuration
  if (o.screen) {
    const ne = screenNe(o.screen);
    const ek = screenEk(o.screen);
    let idx = ne > 0 ? list.findIndex((s) => s.opj === ne) : -1;
    if (idx < 0) idx = stopIdx;
    const r = ek * mHeights[idx];
    if (ek > 0 && r > 0) {
      zsurfs[idx].obscuration = r;
      rep.note(`central obscuration EK=${fmtG(ek, 4)} (NE=${ne}) -> circular obscuration of radius ${fmtG(r, 6)} mm on surface ${idx + 1}`);
    }
  }

  const objSurf: ZmxSurfaceOut = {
    type: "STANDARD", curv: finiteObj ? o.objCurv : 0, thick: objThick,
    glass: zGlass.get(objMedium) ?? null,
  };
  const imgSurf: ZmxSurfaceOut = { type: "STANDARD", curv: ints.im === 1 ? o.imgCurv : 0, thick: 0, glass: null };
  if (solve) zsurfs[lastIdx].marginalRaySolve = true;

  const weights = Array.from({ length: nla }, (_, i) => shortF32(o.spectral?.weights[i] ?? 1));
  const model: ZmxOut = {
    name: o.name,
    notes: [`Converted from OPAL-PC file ${fileName.replace(/^.*[\\/]/, "")}`],
    aperture,
    afocal: ints.im === 0,
    gcat,
    fieldType,
    fields,
    waves: wl.map((um, i) => ({ um, weight: weights[i] })),
    primaryWave: 1,
    surfaces: [objSurf, ...zsurfs, imgSurf],
  };
  rep.note(
    `stop: surface ${stopIdx + 1}; entrance pupil ${fmtG(zEp)} mm from OPAL surface 1; EFL ${fmtG(efl)} mm` +
      (ints.im === 1 && Number.isFinite(bfd) ? `; paraxial image ${fmtG(bfd)} mm after the last surface` : ""),
  );
  const paraxial = ((): ParaxialData => {
    const uImg = Math.abs(mScale * uL);
    const pupilDist = finiteObj ? Math.abs(zEp - (zFirst - dObj)) : 0;
    const field = Math.max(0, ...fields.map((f) => f.y));
    let fov: number;
    if (fieldType === 0) fov = 2 * field;
    else if (fieldType === 1) fov = 2 * deg(Math.atan(field / pupilDist));
    else if (!finiteObj) fov = Number.isFinite(efl) && efl ? 2 * deg(Math.atan(field / Math.abs(efl))) : Number.NaN;
    else {
      const m = paraxialMagnification(C, T, Nn, dObj);
      fov = m ? 2 * deg(Math.atan(field / Math.abs(m) / pupilDist)) : Number.NaN;
    }
    let imageHeight = Number.NaN;
    if (ints.im === 1) {
      if (fieldType === 2) imageHeight = 2 * field;
      else if (chiefScale) imageHeight = 2 * Math.abs(chiefScale.heights[iN] + (chiefScale.nu / Nn[M]) * bfd);
      else imageHeight = 0;
    }
    let magnification = Number.NaN;
    if (finiteObj) magnification = paraxialMagnification(C, T, Nn, dObj);
    else if (ints.im === 0) magnification = trace(-zEpRel, 1).nu / Nn[M];
    return {
      efl: nuOut ? -1 / nuOut : Infinity,
      bfd,
      imageDistance: ints.im === 1 ? imgThick : Number.NaN,
      epd: 2 * (finiteObj ? mScale * pupilDist : mScale),
      fno: uImg ? 1 / (2 * nImg * uImg) : Infinity,
      naObject: finiteObj ? n0 * Math.sin(Math.atan(mScale)) : 0,
      naImage: nImg * Math.sin(Math.atan(uImg)),
      fieldType,
      field,
      fov,
      imageHeight,
      magnification,
    };
  })();
  const result: OpjToZmxResult = { zmx: writeZmxText(model), model, glasses: glassMap, report: rep, paraxial };
  if (customs.length)
    result.agf = {
      catalog: catalogName,
      fileName: `${catalogName}.AGF`,
      text: agfText(`Glasses of OPAL-PC file ${fileName.replace(/^.*[\\/]/, "")} (indices from the OPJ file)`, customs),
    };
  return result;
}
