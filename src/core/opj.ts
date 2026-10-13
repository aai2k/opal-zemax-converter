// OPAL-PC optical system file (*.OPJ). Format: docs/OPJ_FORMAT.md

import { ByteReader, ByteWriter } from "./binary.ts";
import { decodeCp866, encodeCp866, pyRstrip } from "./text.ts";

export const INF = 1e20;

export type FlagKey = readonly [word: number, bit: number];

// record order of OPAL's writer
export const BLOCK_ORDER: readonly FlagKey[] = [
  [0, 0x4000], [0, 0x2000], [0, 0x1000], [0, 0x0800], [0, 0x0400],
  [0, 0x0200], [0, 0x0100],
  [1, 0x8000], [1, 0x4000], [1, 0x2000], [1, 0x0400], [1, 0x0200], [1, 0x1000],
  [0, 0x0040], [0, 0x0080], [1, 0x0800], [3, 0x8000], [2, 0x8000],
];

export const F_ASPH: FlagKey = [0, 0x4000];
export const F_HSV: FlagKey = [0, 0x2000];
export const F_FIELD: FlagKey = [0, 0x1000];
export const F_SCREEN: FlagKey = [0, 0x0800];
export const F_SPECTRAL: FlagKey = [0, 0x0400];

const keyOf = (k: FlagKey): string => `${k[0]}:${k[1].toString(16).padStart(4, "0")}`;
const sameKey = (a: FlagKey, b: FlagKey): boolean => a[0] === b[0] && a[1] === b[1];

export const RAW_BLOCK_INFO: Record<string, string> = {
  "0:0200": "undecoded data (w0 0x0200)",
  "0:0100": "gradient-index media",
  "1:8000": "zoom / multi-position data",
  "1:4000": "zoom / multi-position data",
  "1:2000": "zoom / multi-position data",
  "1:0400": "zoom / multi-position data",
  "1:0200": "zoom / multi-position data",
  "1:1000": "zoom / multi-position data",
  "0:0040": "undecoded data (w0 0x0040)",
  "0:0080": "analysis settings (w0 0x0080)",
  "1:0800": "undecoded data (w1 0x0800)",
  "3:8000": "undecoded data (w3 0x8000)",
  "2:8000": "undecoded data (w2 0x8000)",
};

export const HDR_INTS = [
  "nss", "nla", "ngl", "nd", "ob", "im", "kindo", "kindi",
  "siFromLast", "apType", "fieldInImage", "catMode",
] as const;
export type HdrInt = (typeof HDR_INTS)[number];
export type HdrInts = Record<HdrInt, number>;

/** order[k]: 0 sphere, ±2 conic only, +N U-type polynomial, -N Z-type polynomial. */
export interface Asphere {
  head: number;
  order: number[];
  aux: number[];
  coef: number[];
}

export interface FieldBeams {
  rel: number[];
  vign: [upper: number, lower: number][];
  s0: number[];
  si: number[];
  sd: number[];
}

export interface Spectral {
  lo: number;
  hi: number;
  weights: number[];
}

export interface OPJ {
  flags: number[];
  name: string;
  ints: HdrInts;
  s0: number;
  si: number;
  aperture: [number, number];
  sd: number;
  fieldSize: [number, number];
  objCurv: number;
  imgCurv: number;
  parF1: number;
  parF2: number;
  wavelengths: number[];
  curv: number[];
  thick: number[];
  media: number[];
  indices: number[][];
  glassNames: Uint8Array[];
  trailer: number;
  asphere?: Asphere;
  hsv?: number[];
  beams?: FieldBeams;
  screen?: Uint8Array;
  spectral?: Spectral;
  rawBlocks: Map<string, Uint8Array>;
}

export function emptyInts(): HdrInts {
  return Object.fromEntries(HDR_INTS.map((k) => [k, 0])) as HdrInts;
}

export function newOpj(): OPJ {
  return {
    flags: [0x8400, 0, 0, 0],
    name: "",
    ints: emptyInts(),
    s0: 0, si: 0, aperture: [0, 0], sd: 0, fieldSize: [0, 0], objCurv: 0, imgCurv: 0,
    parF1: 0, parF2: 0,
    wavelengths: [], curv: [], thick: [], media: [], indices: [], glassNames: [], trailer: 0,
    rawBlocks: new Map(),
  };
}

export const surfaceCount = (o: OPJ): number => o.curv.length;

export function hasFlag(o: OPJ, k: FlagKey): boolean {
  return (o.flags[k[0]] & k[1]) !== 0;
}

function setFlag(o: OPJ, k: FlagKey, on: boolean): void {
  o.flags[k[0]] = on ? o.flags[k[0]] | k[1] : o.flags[k[0]] & ~k[1] & 0xffff;
}

export function nfloats(order: number): number {
  if (order === 0) return 0;
  if (Math.abs(order) === 2) return 1;
  if (order > 2) return 2 + Math.trunc((order - 2) / 2);
  return 2 + (-order - 2);
}

export const screenNe = (raw: Uint8Array): number => new ByteReader(raw).i32(0);
export const screenEk = (raw: Uint8Array): number => new ByteReader(raw).f32(4);

export class OpjFormatError extends Error {}

function records(data: Uint8Array): Uint8Array[] {
  const r = new ByteReader(data);
  const out: Uint8Array[] = [];
  let p = 0;
  while (p < data.length) {
    if (p + 4 > data.length) throw new OpjFormatError(`truncated record header at ${p}`);
    const n = r.u32(p);
    const end = p + 4 + 2 * n;
    if (end > data.length) throw new OpjFormatError(`record at ${p} overruns file (${n} words)`);
    out.push(data.subarray(p + 4, end));
    p = end;
  }
  return out;
}

function parseMain(o: OPJ, m: Uint8Array): void {
  const r = new ByteReader(m);
  if (m.length < 0x98) throw new OpjFormatError("main block too short");
  o.flags = [r.u16(0), r.u16(2), r.u16(4), r.u16(6)];
  o.name = pyRstrip(decodeCp866(m.subarray(8, 48)));
  const ints = emptyInts();
  HDR_INTS.forEach((k, i) => (ints[k] = r.i16(0x30 + 2 * i)));
  o.ints = ints;
  const d = r.f64s(0x48, 9);
  o.s0 = d[0];
  o.si = d[1];
  o.aperture = [d[2], d[3]];
  o.sd = d[4];
  o.fieldSize = [d[5], d[6]];
  o.objCurv = d[7];
  o.imgCurv = d[8];
  o.parF1 = r.f32(0x90);
  o.parF2 = r.f32(0x94);
  const n = ints.nss;
  const nla = ints.nla;
  if (n < 0 || nla < 0) throw new OpjFormatError("negative surface or wavelength count");
  let p = 0x98;
  o.wavelengths = r.f32s(p, nla);
  p += 4 * nla;
  o.curv = r.f64s(p, n);
  p += 8 * n;
  o.thick = r.f64s(p, n);
  p += 8 * n;
  o.media = r.i16s(p, n + 1);
  p += 2 * (n + 1);
  const ngl = Math.max(0, ...o.media.map(Math.abs));
  const nidx = Math.min(nla, 5);
  o.indices = [];
  for (let g = 0; g < ngl; g++) {
    o.indices.push(r.f64s(p, nidx));
    p += 8 * nidx;
  }
  if (p + 8 * ngl > m.length) throw new OpjFormatError("main block too short for glass names");
  o.glassNames = [];
  for (let g = 0; g < ngl; g++) o.glassNames.push(m.slice(p + 8 * g, p + 8 * g + 8));
  p += 8 * ngl;
  if (m.length - p !== 2) throw new OpjFormatError(`main block size mismatch (${m.length - p} bytes left)`);
  o.trailer = r.u16(p);
}

function parseAsphere(o: OPJ, b: Uint8Array): Asphere {
  const n = surfaceCount(o);
  const r = new ByteReader(b);
  const a: Asphere = {
    head: r.i32(0),
    order: r.i16s(4, n),
    aux: r.i16s(4 + 2 * n, n),
    coef: r.f32s(4 + 4 * n, 100),
  };
  if (b.length !== 404 + 4 * n) throw new OpjFormatError("asphere block size");
  return a;
}

function parseBeams(b: Uint8Array): FieldBeams {
  const r = new ByteReader(b);
  const n = r.i32(0);
  if (b.length !== 4 + 36 * n) throw new OpjFormatError("field block size");
  let p = 4;
  const rel = r.f32s(p, n);
  p += 4 * n;
  const v = r.f32s(p, 2 * n);
  p += 8 * n;
  const vign: [number, number][] = [];
  for (let k = 0; k < n; k++) vign.push([v[2 * k], v[2 * k + 1]]);
  const s0 = r.f64s(p, n);
  p += 8 * n;
  const si = r.f64s(p, n);
  p += 8 * n;
  const sd = r.f64s(p, n);
  return { rel, vign, s0, si, sd };
}

export function readOpj(data: Uint8Array): OPJ {
  const recs = records(data);
  if (!recs.length) throw new OpjFormatError("empty file");
  const o = newOpj();
  try {
    parseMain(o, recs[0]);
  } catch (e) {
    if (e instanceof RangeError) throw new OpjFormatError("main block too short");
    throw e;
  }
  let i = 1;
  for (const key of BLOCK_ORDER) {
    if (!hasFlag(o, key)) continue;
    if (i >= recs.length) throw new OpjFormatError(`missing record for flag ${keyOf(key)}`);
    const b = recs[i++];
    try {
      if (sameKey(key, F_ASPH)) o.asphere = parseAsphere(o, b);
      else if (sameKey(key, F_HSV)) {
        if (b.length !== 4 * surfaceCount(o)) throw new OpjFormatError("HSV block size");
        o.hsv = new ByteReader(b).f32s(0, surfaceCount(o));
      } else if (sameKey(key, F_FIELD)) o.beams = parseBeams(b);
      else if (sameKey(key, F_SCREEN)) o.screen = b.slice();
      else if (sameKey(key, F_SPECTRAL)) {
        if (b.length !== 48) throw new OpjFormatError("spectral block size");
        const v = new ByteReader(b).f32s(0, 12);
        o.spectral = { lo: v[0], hi: v[1], weights: v.slice(2) };
      } else o.rawBlocks.set(keyOf(key), b.slice());
    } catch (e) {
      if (e instanceof RangeError) throw new OpjFormatError(`block ${keyOf(key)} too short`);
      throw e;
    }
  }
  if (i !== recs.length) throw new OpjFormatError(`${recs.length - i} unexpected trailing record(s)`);
  return o;
}

function packMain(o: OPJ): Uint8Array {
  const n = o.curv.length;
  if (o.thick.length !== n || o.media.length !== n + 1) throw new Error("curv/thick/media length mismatch");
  const nla = o.wavelengths.length;
  const ngl = Math.max(0, ...o.media.map(Math.abs));
  if (o.glassNames.length !== ngl || o.indices.length !== ngl)
    throw new Error("glass table must have exactly max|media| entries");
  const nidx = Math.min(nla, 5);
  const ints: HdrInts = { ...o.ints, nss: n, nla, ngl };
  const w = new ByteWriter();
  for (const f of o.flags) w.u16(f);
  const nm = encodeCp866(o.name).subarray(0, 40);
  w.bytes(nm);
  for (let i = nm.length; i < 40; i++) w.bytes(Uint8Array.of(0x20));
  for (const k of HDR_INTS) w.i16(Math.trunc(ints[k] ?? 0));
  for (const v of [o.s0, o.si, o.aperture[0], o.aperture[1], o.sd, o.fieldSize[0], o.fieldSize[1], o.objCurv, o.imgCurv])
    w.f64(v);
  w.f32(o.parF1).f32(o.parF2);
  for (const v of o.wavelengths) w.f32(v);
  for (const v of o.curv) w.f64(v);
  for (const v of o.thick) w.f64(v);
  for (const v of o.media) w.i16(v);
  for (const row of o.indices) {
    if (row.length !== nidx) throw new Error(`each glass needs min(NLA,5)=${nidx} indices`);
    for (const v of row) w.f64(v);
  }
  for (const g of o.glassNames) {
    if (g.length !== 8) throw new Error("glass names are 8 bytes");
    w.bytes(g);
  }
  w.u16(o.trailer);
  return w.result();
}

function packAsphere(o: OPJ): Uint8Array {
  const a = o.asphere!;
  const n = surfaceCount(o);
  if (a.order.length !== n || a.aux.length !== n || a.coef.length !== 100)
    throw new Error("asphere arrays must have NSS entries and 100 coefficients");
  const w = new ByteWriter().i32(a.head);
  for (const v of a.order) w.i16(v);
  for (const v of a.aux) w.i16(v);
  for (const v of a.coef) w.f32(v);
  return w.result();
}

function packBeams(fb: FieldBeams): Uint8Array {
  const n = fb.rel.length;
  if (n < 1 || n > 5) throw new Error("1..5 off-axis beams");
  const w = new ByteWriter().i32(n);
  for (const v of fb.rel) w.f32(v);
  for (const [up, lo] of fb.vign) w.f32(up).f32(lo);
  for (const arr of [fb.s0, fb.si, fb.sd]) for (const v of arr) w.f64(v);
  return w.result();
}

export function writeOpj(o: OPJ): Uint8Array {
  setFlag(o, F_ASPH, o.asphere !== undefined);
  setFlag(o, F_HSV, o.hsv !== undefined);
  setFlag(o, F_FIELD, o.beams !== undefined);
  setFlag(o, F_SCREEN, o.screen !== undefined);
  setFlag(o, F_SPECTRAL, o.spectral !== undefined);
  o.flags[0] |= 0x8000;
  const recs: Uint8Array[] = [packMain(o)];
  for (const key of BLOCK_ORDER) {
    if (!hasFlag(o, key)) continue;
    if (sameKey(key, F_ASPH)) recs.push(packAsphere(o));
    else if (sameKey(key, F_HSV)) {
      if (o.hsv!.length !== surfaceCount(o)) throw new Error("HSV needs NSS entries");
      const w = new ByteWriter();
      for (const v of o.hsv!) w.f32(v);
      recs.push(w.result());
    } else if (sameKey(key, F_FIELD)) recs.push(packBeams(o.beams!));
    else if (sameKey(key, F_SCREEN)) recs.push(o.screen!);
    else if (sameKey(key, F_SPECTRAL)) {
      const s = o.spectral!;
      const w = new ByteWriter().f32(s.lo).f32(s.hi);
      for (const v of [...s.weights, ...Array(10).fill(1)].slice(0, 10)) w.f32(v);
      recs.push(w.result());
    } else {
      const raw = o.rawBlocks.get(keyOf(key));
      if (!raw) throw new Error(`flag ${keyOf(key)} set but no data`);
      recs.push(raw);
    }
  }
  const out = new ByteWriter();
  for (const r of recs) {
    if (r.length % 2) throw new Error("odd record length");
    out.u32(r.length / 2).bytes(r);
  }
  return out.result();
}

/** Catalog letter in column 0, name right-aligned; 8-character names fill the field. */
export function glassField(name: string, catalog = " "): Uint8Array {
  const nm = encodeCp866(name);
  if (nm.length > 8) throw new Error(`glass name longer than 8 characters: ${name}`);
  if (nm.length === 8) return nm;
  const cat = encodeCp866(catalog || " ").subarray(0, 1);
  const out = new Uint8Array(8).fill(0x20);
  out.set(cat.length ? cat : Uint8Array.of(0x20), 0);
  out.set(nm, 8 - nm.length);
  return out;
}
