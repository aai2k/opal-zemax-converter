import { cyrToLatLookalike, type Glass, GlassLibrary, glassIndex, hasCyrillic, OPAL_TO_ZEMAX, PREFERRED } from "./agf.ts";
import { fmtE, fmtG } from "./format.ts";
import { solveSquare } from "./numeric.ts";
import { decodeCp866, transliterate } from "./text.ts";

export const WL_D = 0.5875618;
export const WL_F = 0.4861327;
export const WL_C = 0.6562725;

export interface OpalGlassName {
  raw: string;
  letter: string;
  name: string;
  alternatives: { letter: string; name: string }[];
}

const AIR_NAMES = new Set(["ВОЗДУХ", "AIR", "VOZDUH", "VOZDUKH"]);

export function parseGlassField(field: Uint8Array): OpalGlassName {
  const raw = decodeCp866(field);
  const alternatives: { letter: string; name: string }[] = [];
  if (raw[0] !== " " && raw[1] === " ") alternatives.push({ letter: raw[0], name: raw.slice(1).trim() });
  else if (raw[0] === " ") alternatives.push({ letter: " ", name: raw.trim() });
  else {
    // 8 characters: either an 8-character name or a catalog letter followed by a 7-character name
    alternatives.push({ letter: " ", name: raw.trim() });
    alternatives.push({ letter: raw[0], name: raw.slice(1).trim() });
  }
  return { raw, ...alternatives[0], alternatives };
}

export function isAirName(name: string): boolean {
  return AIR_NAMES.has(name.replace(/^-+/, "").toUpperCase());
}

/** Upper-case candidate spellings of an OPAL glass name in Zemax catalogs. */
export function zemaxCandidates(name: string): string[] {
  const n = name.replace(/^-+/, "").toUpperCase();
  const out: string[] = [];
  const add = (s: string): void => {
    if (s && !out.includes(s)) out.push(s);
  };
  const bases = [n];
  if (hasCyrillic(n)) {
    const look = cyrToLatLookalike(n);
    bases.push(look, look.replace(/CT/g, "ST"), transliterate(n).toUpperCase());
  }
  for (const b of bases) {
    add(b);
    for (const a of OPAL_TO_ZEMAX[b] ?? []) add(a);
    add("LZ_" + b);
    add(b + "GOST");
    if (b.endsWith("GOST")) add(b.slice(0, -4));
  }
  return out;
}

const LETTER_CATALOGS: Record<string, string[]> = {
  S: ["SCHOTT"],
  G: ["SCHOTT"],
  O: ["OHARA"],
  H: ["HOYA"],
  M: ["CDGM"],
  R: ["LZOS", "GOST", "OPAL"],
};
const RUSSIAN_ORDER = ["LZOS", "GOST", "OPAL"];

function catalogRank(cat: string, letter: string, russian: boolean): number {
  const c = cat.toUpperCase();
  const order = [...(LETTER_CATALOGS[letter.toUpperCase()] ?? []), ...(russian ? RUSSIAN_ORDER : []), ...PREFERRED];
  const i = order.findIndex((p) => c === p);
  if (i >= 0) return i;
  const j = order.findIndex((p) => c.startsWith(p));
  return j >= 0 ? 100 + j : 1000;
}

export interface GlassHit {
  glass: Glass;
  maxError: number;
  inRange: boolean;
}

export interface GlassResolution {
  kind: "air" | "catalog" | "custom";
  opalName: OpalGlassName;
  indices: number[];
  hit?: GlassHit;
  closest?: GlassHit;
}

export function maxIndexError(g: Glass, wls: number[], indices: number[]): number {
  let m = 0;
  for (let i = 0; i < indices.length; i++) {
    let n: number;
    try {
      n = glassIndex(g, wls[i]);
    } catch {
      return Infinity;
    }
    if (!Number.isFinite(n)) return Infinity;
    m = Math.max(m, Math.abs(n - indices[i]));
  }
  return m;
}

export const coversWavelengths = (g: Glass, wls: number[]): boolean =>
  wls.every((w) => g.ld[0] - 1e-6 <= w && w <= g.ld[1] + 1e-6);

/** wls: the stored wavelengths (one per index); allWls: every system wavelength. */
export function resolveOpalGlass(
  field: Uint8Array,
  indices: number[],
  wls: number[],
  lib: GlassLibrary,
  tol: number,
  allWls: number[] = wls,
): GlassResolution {
  const opalName = parseGlassField(field);
  if (indices.every((n) => Math.abs(n - 1) <= 1e-7) && (opalName.name === "" || opalName.alternatives.some((a) => isAirName(a.name))))
    return { kind: "air", opalName, indices };
  const hits: { hit: GlassHit; rank: number }[] = [];
  const seen = new Set<Glass>();
  for (const alt of opalName.alternatives) {
    if (!alt.name) continue;
    const russian = hasCyrillic(alt.name) || alt.letter === "R";
    for (const cand of zemaxCandidates(alt.name)) {
      for (const cat of lib.names) {
        const g = lib.catalog(cat).get(cand);
        if (!g || seen.has(g)) continue;
        seen.add(g);
        hits.push({
          hit: { glass: g, maxError: maxIndexError(g, wls, indices), inRange: coversWavelengths(g, allWls) },
          rank: catalogRank(cat, alt.letter, russian),
        });
      }
    }
  }
  const good = hits
    .filter((h) => h.hit.maxError <= tol && h.hit.inRange)
    .sort((a, b) => a.rank - b.rank || a.hit.maxError - b.hit.maxError);
  if (good.length) return { kind: "catalog", opalName, indices, hit: good[0].hit };
  const closest = hits.sort((a, b) => a.hit.maxError - b.hit.maxError)[0]?.hit;
  return { kind: "custom", opalName, indices, closest };
}

/** Schott-formula fit through the stored indices: n^2 = a0 + a1 L^2 + a2 L^-2 + a3 L^-4 + a4 L^-6. */
export function fitDispersion(wls: number[], indices: number[]): number[] {
  const pts: [number, number][] = [];
  for (let i = 0; i < indices.length; i++) {
    if (!pts.some(([w]) => Math.abs(w - wls[i]) < 1e-9)) pts.push([wls[i], indices[i]]);
  }
  const termOrder = [0, 2, 1, 3, 4];
  const basis = (t: number, w: number): number => {
    const w2 = w * w;
    return [1, w2, 1 / w2, 1 / (w2 * w2), 1 / (w2 * w2 * w2)][t];
  };
  for (let k = pts.length; k >= 1; k--) {
    const terms = termOrder.slice(0, k);
    const sol = solveSquare(
      pts.slice(0, k).map(([w]) => terms.map((t) => basis(t, w))),
      pts.slice(0, k).map(([, n]) => n * n),
    );
    if (sol && sol.every(Number.isFinite)) {
      const cd = [0, 0, 0, 0, 0, 0];
      terms.forEach((t, i) => (cd[t] = sol[i]));
      return cd;
    }
  }
  return [indices[0] * indices[0], 0, 0, 0, 0, 0];
}

export function schottIndex(cd: number[], wl: number): number {
  return glassIndex({ name: "", catalog: "", formula: 1, nd: 0, vd: 0, cd, ld: [0, 100] }, wl);
}

export function ndVd(cd: number[]): [number, number] {
  const nd = schottIndex(cd, WL_D);
  const dn = schottIndex(cd, WL_F) - schottIndex(cd, WL_C);
  return [nd, Math.abs(dn) > 1e-12 ? (nd - 1) / dn : 0];
}

const RESERVED = new Set(["AIR", "MIRROR", "VACUUM", "ABSORB", "___BLANK"]);

export function zemaxGlassName(opalName: string, fallback: string): string {
  const t = transliterate(opalName.replace(/^-+/, "")).toUpperCase().replace(/[^A-Z0-9_.+-]/g, "");
  if (!t) return fallback;
  return RESERVED.has(t) || isAirName(t) ? `${t}_${fallback}` : t;
}

export interface CustomGlass {
  name: string;
  comment: string;
  cd: number[];
  ld: [number, number];
}

export function agfText(catalogComment: string, glasses: CustomGlass[]): string {
  const e = (x: number): string => fmtE(x, 15).toUpperCase();
  const lines = [`CC ${catalogComment}`];
  for (const g of glasses) {
    const [nd, vd] = ndVd(g.cd);
    lines.push(`NM ${g.name} 1 0 ${fmtG(nd, 7)} ${fmtG(vd, 7)} 0 0 0`);
    lines.push(`GC ${g.comment}`);
    lines.push("ED 0 0 0 0 0");
    lines.push(`CD ${[...g.cd, 0, 0, 0, 0].slice(0, 10).map(e).join(" ")}`);
    lines.push("TD 0 0 0 0 0 0 20");
    lines.push("OD -1 -1 -1 -1 -1 -1");
    lines.push(`LD ${e(g.ld[0])} ${e(g.ld[1])}`);
    lines.push(`IT ${e(g.ld[0])} 1 10`);
    lines.push(`IT ${e(g.ld[1])} 1 10`);
  }
  return lines.join("\r\n") + "\r\n";
}

export function describeHit(h: GlassHit): string {
  const range = h.inRange ? "" : `, catalog data only for ${fmtG(h.glass.ld[0], 4)}-${fmtG(h.glass.ld[1], 4)} um`;
  return `${h.glass.name} (${h.glass.catalog}, max index difference ${fmtE(h.maxError, 1)}${range})`;
}
