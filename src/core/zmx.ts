import { decodeZemaxText, pyFloat, pyInt, pyIntOfFloat, pySplit, pySplitLines, pySplitMax, pyStrip } from "./text.ts";

export const UNIT_TO_MM: Record<string, number> = { MM: 1.0, CM: 10.0, IN: 25.4, METER: 1000.0, M: 1000.0 };

export interface Surface {
  num: number;
  type: string;
  curv: number;
  disz: number;
  diszInf: boolean;
  glass: string;
  glassModel: [nd: number, vd: number] | null;
  glassMode: number; // 0 fixed, 1 model, 2 pickup, 3 substitute
  glassPickup: number;
  diam: number;
  conic: number;
  parm: Map<number, number>;
  stop: boolean;
  comment: string;
  extra: string[];
  xdat: string[];
}

export const isMirror = (s: Surface): boolean => s.glass.toUpperCase() === "MIRROR";

export interface ZMX {
  name: string;
  notes: string[];
  unit: string;
  gcat: string[];
  aperture: [kind: string, value: number, flag: number];
  afocal: boolean;
  env: [temperature: number, pressure: number];
  ftyp: number[];
  fields: [x: number, y: number][];
  fieldWt: number[];
  vign: [vdx: number, vdy: number, vcx: number, vcy: number][];
  waves: [um: number, weight: number][];
  primaryWave: number;
  surfaces: Surface[];
  multiconfig: boolean;
  warnings: string[];
}

function newSurface(num: number): Surface {
  return {
    num, type: "STANDARD", curv: 0, disz: 0, diszInf: false, glass: "", glassModel: null, glassMode: 0,
    glassPickup: 0, diam: 0, conic: 0, parm: new Map(), stop: false, comment: "", extra: [], xdat: [],
  };
}

class ParseError extends Error {}

function need(tok: string | undefined): string {
  if (tok === undefined) throw new ParseError("missing value");
  return tok;
}

function num(tok: string | undefined): number {
  const t = need(tok);
  const v = pyFloat(t);
  if (Number.isNaN(v) && !/nan/i.test(t)) throw new ParseError(`bad number ${t}`);
  return v;
}

function distance(tok: string | undefined): number {
  const t = need(tok).toUpperCase();
  if (t === "INFINITY" || t === "INF" || t === "1.#INF" || t === "+INF") return Infinity;
  return num(tok);
}

function int(tok: string | undefined): number {
  const v = pyInt(need(tok));
  if (Number.isNaN(v)) throw new ParseError(`bad integer ${tok}`);
  return v;
}

function intOfFloat(tok: string | undefined): number {
  const v = pyIntOfFloat(need(tok));
  if (Number.isNaN(v)) throw new ParseError(`bad number ${tok}`);
  return v;
}

const isDigits = (s: string): boolean => /^[0-9]+$/.test(s);

export function splitExt(base: string): [string, string] {
  const i = base.lastIndexOf(".");
  if (i <= 0 || /^\.+$/.test(base.slice(0, i + 1))) return [base, ""];
  return [base.slice(0, i), base.slice(i)];
}

export const baseName = (path: string): string => path.replace(/^.*[\\/]/, "");

export function parseZmx(text: string, fileName = ""): ZMX {
  const z: ZMX = {
    name: "", notes: [], unit: "MM", gcat: [], aperture: ["ENPD", 0, 0], afocal: false, env: [20, 1],
    ftyp: [0, 0], fields: [], fieldWt: [], vign: [], waves: [], primaryWave: 1, surfaces: [],
    multiconfig: false, warnings: [],
  };
  let cur: Surface | null = null;
  let oldX: number[] = [];
  let oldY: number[] = [];
  let newX = new Map<number, number>();
  let newY = new Map<number, number>();
  const vd: Record<string, Map<number, number>> = {
    VDXN: new Map(), VDYN: new Map(), VCXN: new Map(), VCYN: new Map(),
  };
  const oldVd: Record<string, number[]> = {};
  let wavesOld: number[] = [];
  let wwgtOld: number[] = [];
  const wavesNew = new Map<number, [number, number]>();
  const nums = (p: string[], from = 1): number[] => p.slice(from).map(num);
  const indexed = (vals: number[]): Map<number, number> => new Map(vals.map((v, i) => [i + 1, v]));

  for (const line of pySplitLines(text)) {
    if (!pyStrip(line)) continue;
    const indented = line[0] === " " || line[0] === "\t";
    const p = pySplit(line);
    const k = p[0].toUpperCase();
    if (!indented) cur = null;
    if (k === "SURF") {
      try {
        cur = newSurface(int(p[1]));
        z.surfaces.push(cur);
      } catch {
        z.warnings.push(`could not parse line: ${pyStrip(line)}`);
      }
      continue;
    }
    if (cur !== null && indented) {
      try {
        if (k === "TYPE") cur.type = need(p[1]).toUpperCase();
        else if (k === "CURV") cur.curv = num(p[1]);
        else if (k === "DISZ") {
          const v = distance(p[1]);
          cur.diszInf = v === Infinity || v === -Infinity || Math.abs(v) >= 1e10;
          cur.disz = cur.diszInf ? 0 : v;
        } else if (k === "GLAS") {
          cur.glass = need(p[1]);
          if (p.length >= 4) {
            const m = pyIntOfFloat(p[2]);
            const pk = pyIntOfFloat(p[3]);
            if (!Number.isNaN(m) && !Number.isNaN(pk)) {
              cur.glassMode = m;
              cur.glassPickup = pk;
            }
          }
          // "GLAS S  N-SK5": OPAL catalog letter written as a separate token
          if (p[1].length === 1 && "SROGNHMJFX".includes(p[1].toUpperCase()) && p.length >= 3 &&
              !isDigits(p[2].replace(/\./g, "").replace(/-/g, ""))) {
            cur.glass = p[2];
          }
          const up = p[1].toUpperCase();
          if (up.startsWith("___BLANK") && cur.glassMode === 2) {
            // pickup, resolved below
          } else if (up.startsWith("___BLANK") && p.length >= 6) {
            cur.glassModel = [num(p[4]), num(p[5])];
          } else if (isDigits(p[1]) && p[1].length === 6) {
            cur.glassModel = [1 + Number(p[1].slice(0, 3)) / 1000.0, Number(p[1].slice(3)) / 10.0];
          }
        } else if (k === "DIAM") cur.diam = num(p[1]);
        else if (k === "CONI") cur.conic = num(p[1]);
        else if (k === "PARM") cur.parm.set(int(p[1]), num(p[2]));
        else if (k === "STOP") cur.stop = true;
        else if (k === "COMM") cur.comment = p.length > 1 ? pyStrip(pySplitMax(line, 1)[1]) : "";
        else if (k === "SCBD" || k === "SCAD") {
          if (nums(p, 4).some((v) => Math.abs(v) > 1e-12)) cur.extra.push(pyStrip(line));
        } else if (k === "XDAT") cur.xdat.push(pyStrip(line));
        else if (k === "IGNR" && p.length > 1 && p[1] !== "0") cur.extra.push("surface ignored (IGNR)");
      } catch {
        z.warnings.push(`could not parse line: ${pyStrip(line)}`);
      }
      continue;
    }
    try {
      if (k === "NAME") z.name = p.length > 1 ? pyStrip(pySplitMax(line, 1)[1]) : "";
      else if (k === "NOTE") z.notes.push(p.length > 2 ? pyStrip(pySplitMax(line, 2)[2]) : "");
      else if (k === "UNIT") z.unit = need(p[1]).toUpperCase();
      else if (k === "GCAT") z.gcat = p.slice(1);
      else if (k === "ENPD" || k === "FNUM" || k === "OBNA")
        z.aperture = [k, num(p[1]), p.length > 2 ? intOfFloat(p[2]) : 0];
      else if (k === "FLOA") z.aperture = ["FLOA", 0, 0];
      else if (k === "ENVD") z.env = [num(p[1]), num(p[2])];
      else if (k === "FTYP") z.ftyp = p.slice(1).map(intOfFloat);
      else if (k === "XFLD") oldX = nums(p);
      else if (k === "YFLD") oldY = nums(p);
      else if (k === "FWGT" || k === "FWGN") z.fieldWt = nums(p);
      else if (k === "XFLN") newX = indexed(nums(p));
      else if (k === "YFLN") newY = indexed(nums(p));
      else if (k in vd) vd[k] = indexed(nums(p));
      else if (k === "ZVDX" || k === "ZVDY" || k === "ZVCX" || k === "ZVCY") oldVd[k] = nums(p);
      else if (k === "WAVL") wavesOld = nums(p);
      else if (k === "WWGT") wwgtOld = nums(p);
      else if (k === "WAVM") wavesNew.set(int(p[1]), [num(p[2]), p.length > 3 ? num(p[3]) : 1.0]);
      else if (k === "PWAV") z.primaryWave = int(p[1]);
      else if (k === "MNUM") {
        if (int(p[1]) > 1) z.multiconfig = true;
      }
    } catch {
      z.warnings.push(`could not parse line: ${pyStrip(line)}`);
    }
  }

  // FTYP[6] is the "afocal image space" flag; top-level AFOC lines are multi-config operands
  z.afocal = z.ftyp.length > 6 && z.ftyp[6] === 1;
  if (wavesNew.size) {
    const nw = z.ftyp.length > 3 && z.ftyp[3] > 0 ? z.ftyp[3] : wavesNew.size;
    z.waves = [...wavesNew.keys()].sort((a, b) => a - b).filter((i) => i <= nw).map((i) => wavesNew.get(i)!);
  } else {
    z.waves = wavesOld.map((w, i) => [w, i < wwgtOld.length ? wwgtOld[i] : 1.0]);
  }
  const nf = z.ftyp.length > 2 && z.ftyp[2] > 0 ? z.ftyp[2] : null;
  if (newY.size || newX.size) {
    const n = nf ?? Math.max(...newY.keys(), ...newX.keys());
    for (let i = 1; i <= n; i++) {
      z.fields.push([newX.get(i) ?? 0, newY.get(i) ?? 0]);
      z.vign.push([vd.VDXN.get(i) ?? 0, vd.VDYN.get(i) ?? 0, vd.VCXN.get(i) ?? 0, vd.VCYN.get(i) ?? 0]);
    }
  } else {
    const n = nf ?? Math.max(oldY.length, oldX.length);
    const g = (key: string, i: number): number => oldVd[key]?.[i] ?? 0;
    for (let i = 0; i < n; i++) {
      z.fields.push([oldX[i] ?? 0, oldY[i] ?? 0]);
      z.vign.push([g("ZVDX", i), g("ZVDY", i), g("ZVCX", i), g("ZVCY", i)]);
    }
  }
  z.surfaces.sort((a, b) => a.num - b.num);
  resolveGlassPickups(z);
  if (!z.name) z.name = splitExt(baseName(fileName))[0];
  return z;
}

export function parseZmxBytes(raw: Uint8Array, fileName = ""): ZMX {
  return parseZmx(decodeZemaxText(raw, true), fileName);
}

function resolveGlassPickups(z: ZMX): void {
  const byNum = new Map(z.surfaces.map((s) => [s.num, s]));
  for (const s of z.surfaces) {
    const seen = new Set<number>();
    let cur = s;
    while (cur.glassMode === 2 && cur.glass.toUpperCase().startsWith("___BLANK")) {
      if (seen.has(cur.num) || !byNum.has(cur.glassPickup)) {
        z.warnings.push(`surface ${s.num}: unresolved glass pickup`);
        break;
      }
      seen.add(cur.num);
      cur = byNum.get(cur.glassPickup)!;
    }
    if (cur !== s) {
      s.glass = cur.glass;
      s.glassModel = cur.glassModel;
      s.glassMode = cur.glassMode;
    }
  }
}
