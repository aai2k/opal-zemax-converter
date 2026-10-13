import { decodeZemaxText, pyFloat, pyIntOfFloat, pySplit, pySplitLines } from "./text.ts";

export interface Glass {
  name: string;
  catalog: string;
  formula: number;
  nd: number;
  vd: number;
  cd: number[];
  ld: [number, number];
}

export const FORMULA_NAMES: Record<number, string> = {
  1: "Schott", 2: "Sellmeier 1", 3: "Herzberger", 4: "Sellmeier 2", 5: "Conrady", 6: "Sellmeier 3",
  7: "Handbook of Optics 1", 8: "Handbook of Optics 2", 9: "Sellmeier 4", 10: "Extended", 11: "Sellmeier 5",
  12: "Extended 2", 13: "Extended 3",
};

/** Index relative to air at catalog conditions; wl in micrometres. */
export function glassIndex(g: Glass, wl: number): number {
  const c = [...g.cd, ...Array(12).fill(0)];
  const w2 = wl * wl;
  switch (g.formula) {
    case 1:
      return Math.sqrt(c[0] + c[1] * w2 + c[2] / w2 + c[3] / w2 ** 2 + c[4] / w2 ** 3 + c[5] / w2 ** 4);
    case 2:
      return Math.sqrt(1 + (c[0] * w2) / (w2 - c[1]) + (c[2] * w2) / (w2 - c[3]) + (c[4] * w2) / (w2 - c[5]));
    case 3: {
      const L = 1.0 / (w2 - 0.028);
      return c[0] + c[1] * L + c[2] * L * L + c[3] * w2 + c[4] * w2 ** 2 + c[5] * w2 ** 3;
    }
    case 4:
      return Math.sqrt(1 + c[0] + (c[1] * w2) / (w2 - c[2] ** 2) + c[3] / (w2 - c[4] ** 2));
    case 5:
      return c[0] + c[1] / wl + c[2] / wl ** 3.5;
    case 6: {
      let n2 = 1;
      for (let i = 0; i < 4; i++) n2 += (c[2 * i] * w2) / (w2 - c[2 * i + 1]);
      return Math.sqrt(n2);
    }
    case 7:
      return Math.sqrt(c[0] + c[1] / (w2 - c[2]) - c[3] * w2);
    case 8:
      return Math.sqrt(c[0] + (c[1] * w2) / (w2 - c[2]) - c[3] * w2);
    case 9:
      return Math.sqrt(c[0] + (c[1] * w2) / (w2 - c[2]) + (c[3] * w2) / (w2 - c[4]));
    case 10:
      return Math.sqrt(
        c[0] + c[1] * w2 + c[2] / w2 + c[3] / w2 ** 2 + c[4] / w2 ** 3 + c[5] / w2 ** 4 + c[6] / w2 ** 5 + c[7] / w2 ** 6,
      );
    case 11: {
      let n2 = 1;
      for (let i = 0; i < 5; i++) n2 += (c[2 * i] * w2) / (w2 - c[2 * i + 1]);
      return Math.sqrt(n2);
    }
    case 12:
      return Math.sqrt(
        c[0] + c[1] * w2 + c[2] / w2 + c[3] / w2 ** 2 + c[4] / w2 ** 3 + c[5] / w2 ** 4 + c[6] * w2 ** 2 + c[7] * w2 ** 3,
      );
    case 13:
      return Math.sqrt(
        c[0] + c[1] * w2 + c[2] * w2 ** 2 + c[3] / w2 + c[4] / w2 ** 2 + c[5] / w2 ** 3 + c[6] / w2 ** 4 + c[7] / w2 ** 5 +
          c[8] / w2 ** 6,
      );
    default:
      throw new Error(`unsupported dispersion formula ${g.formula} for ${g.name}`);
  }
}

export type Catalog = Map<string, Glass>;

export function parseAgf(text: string, catalogName: string): Catalog {
  const out: Catalog = new Map();
  let cur: Glass | null = null;
  for (const line of pySplitLines(text)) {
    const p = pySplit(line);
    if (!p.length) continue;
    if (p[0] === "NM" && p.length >= 3) {
      const num = (i: number): number => {
        const v = i < p.length ? pyFloat(p[i]) : 0;
        return Number.isNaN(v) ? 0 : v;
      };
      const formula = pyIntOfFloat(p[2]);
      if (Number.isNaN(formula)) {
        cur = null;
        continue;
      }
      cur = { name: p[1], catalog: catalogName, formula, nd: num(4), vd: num(5), cd: [], ld: [0, 100] };
      out.set(cur.name.toUpperCase(), cur);
    } else if (p[0] === "CD" && cur !== null) {
      const vals = p.slice(1).map(pyFloat);
      if (vals.some((v) => Number.isNaN(v))) {
        out.delete(cur.name.toUpperCase());
        cur = null;
      } else cur.cd = vals;
    } else if (p[0] === "LD" && cur !== null && p.length >= 3) {
      const a = pyFloat(p[1]);
      const b = pyFloat(p[2]);
      if (!Number.isNaN(a) && !Number.isNaN(b)) cur.ld = [a, b];
    }
  }
  return out;
}

export function parseAgfBytes(raw: Uint8Array, catalogName: string): Catalog {
  return parseAgf(decodeZemaxText(raw, false), catalogName);
}

// OPAL material names -> Zemax names
export const OPAL_TO_ZEMAX: Record<string, string[]> = {
  SI: ["SILICON"],
  GE: ["GERMANIUM"],
  SILICA: ["F_SILICA", "SILICA"],
  ZNS: ["ZNS_BROAD", "CLEARTRAN", "ZNS"],
};

// searched in this order when the ZMX catalog list does not hold a glass
export const PREFERRED = [
  "SCHOTT", "OHARA", "HOYA", "CDGM", "SUMITA", "HIKARI", "NHG", "CORNING",
  "HERAEUS", "INFRARED", "MISC", "GOST", "LZOS", "OPAL", "BIREFRINGENT",
];

const CYR = "АВЕКМНОРСТХБФЛДГИПЖЗУ";
const LAT = "ABEKMHOPCTXBFLDGIPJZU";

/** Letter-for-letter transliteration, as Zemax catalogs spell Russian glass names. */
export function cyrToLatLookalike(s: string): string {
  let out = "";
  for (const ch of s) {
    const i = CYR.indexOf(ch);
    out += i >= 0 ? LAT[i] : ch;
  }
  return out;
}

export const hasCyrillic = (s: string): boolean => /[А-яЁё]/.test(s);

export class GlassLibrary {
  private cache = new Map<string, Catalog>();
  private loaders = new Map<string, () => Catalog>();

  constructor(catalogs?: Iterable<[string, Catalog]>) {
    if (catalogs) for (const [name, cat] of catalogs) this.add(name, cat);
  }

  add(name: string, cat: Catalog): void {
    const k = name.toUpperCase();
    if (!this.loaders.has(k) && !this.cache.has(k)) this.cache.set(k, cat);
  }

  addLazy(name: string, load: () => Catalog): void {
    const k = name.toUpperCase();
    if (!this.loaders.has(k) && !this.cache.has(k)) this.loaders.set(k, load);
  }

  get names(): string[] {
    return [...new Set([...this.cache.keys(), ...this.loaders.keys()])].sort();
  }

  has(name: string): boolean {
    const k = name.toUpperCase();
    return this.cache.has(k) || this.loaders.has(k);
  }

  catalog(name: string): Catalog {
    const k = name.toUpperCase();
    let c = this.cache.get(k);
    if (!c) {
      const load = this.loaders.get(k);
      c = load ? load() : new Map();
      this.cache.set(k, c);
      this.loaders.delete(k);
    }
    return c;
  }

  find(glass: string, gcat: string[]): Glass | null {
    const g = glass.trim().toUpperCase();
    const cands = [g];
    if (hasCyrillic(g)) {
      const lat = cyrToLatLookalike(g);
      cands.push(lat, lat.replace("CT", "ST"));
    }
    cands.push(...(OPAL_TO_ZEMAX[g] ?? []));
    if (g.length > 1 && "SROGNHMJFX".includes(g[0])) {
      cands.push(g.slice(1).trim());
      if (g[1] === "-") cands.push("N" + g.slice(1));
    }
    for (const c of cands) {
      const hit = this.findExact(c, gcat);
      if (hit) return hit;
    }
    return null;
  }

  findExact(g: string, gcat: string[]): Glass | null {
    const order = gcat.map((c) => c.toUpperCase());
    for (const c of PREFERRED) if (!order.includes(c)) order.push(c);
    for (const c of order) {
      const hit = this.catalog(c).get(g);
      if (hit) return hit;
    }
    for (const c of this.names) {
      const hit = this.catalog(c).get(g);
      if (hit) return hit;
    }
    return null;
  }

  *all(): Generator<Glass> {
    for (const c of this.names) yield* this.catalog(c).values();
  }
}
