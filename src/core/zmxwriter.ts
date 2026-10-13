import { fmtR } from "./format.ts";

export interface ZmxGlass {
  name: string;
  model?: { nd: number; vd: number };
  nd?: number;
  vd?: number;
}

export interface ZmxSurfaceOut {
  type: "STANDARD" | "EVENASPH";
  curv: number;
  thick: number | "INFINITY";
  glass: ZmxGlass | "MIRROR" | null;
  semiDiameter?: number;
  conic?: number;
  parm?: number[];
  stop?: boolean;
  comment?: string;
  marginalRaySolve?: boolean;
  obscuration?: number;
}

export interface ZmxField {
  y: number;
  vdy: number;
  vcy: number;
}

export interface ZmxOut {
  name: string;
  notes: string[];
  aperture: { kind: "ENPD" | "FNUM" | "OBNA" | "FLOA"; value: number; flag: number };
  afocal: boolean;
  gcat: string[];
  fieldType: number;
  fields: ZmxField[];
  waves: { um: number; weight: number }[];
  primaryWave: number;
  surfaces: ZmxSurfaceOut[];
}

const SANITIZE = /[\r\n]+/g;

export function writeZmxText(m: ZmxOut): string {
  const L: string[] = [];
  const n = fmtR;
  L.push("VERS 210914 2 113763 L113763");
  L.push("MODE SEQ");
  L.push(`NAME ${m.name.replace(SANITIZE, " ")}`);
  for (const note of m.notes) L.push(`NOTE 0 ${note.replace(SANITIZE, " ")}`);
  L.push("PFIL 0 0 0");
  L.push("LANG 0");
  L.push("UNIT MM X W X CM MR CPMM");
  const ap = m.aperture;
  if (ap.kind === "FLOA") L.push("FLOA");
  else if (ap.kind === "ENPD") L.push(`ENPD ${n(ap.value)}`);
  else L.push(`${ap.kind} ${n(ap.value)} ${ap.flag}`);
  L.push("ENVD 20 1 0");
  L.push("GFAC 0 0");
  L.push(`GCAT ${(m.gcat.length ? m.gcat : ["SCHOTT"]).join(" ")} `);
  L.push("RAIM 0 0 1 1 0 0 0 0 0 1");
  L.push("PUSH 0 0 0 0 0 0");
  L.push("SDMA 0 1 0");
  L.push("OMMA 1 1");
  const nf = m.fields.length;
  L.push(`FTYP ${m.fieldType} 0 ${nf} ${m.waves.length} 0 0 ${m.afocal ? 1 : 0} ${nf}`);
  L.push("ROPD 2");
  L.push("PICB 1");
  L.push(`XFLN ${m.fields.map(() => "0").join(" ")}`);
  L.push(`YFLN ${m.fields.map((f) => n(f.y)).join(" ")}`);
  L.push(`FWGN ${m.fields.map(() => "1").join(" ")}`);
  L.push(`VDXN ${m.fields.map(() => "0").join(" ")}`);
  L.push(`VDYN ${m.fields.map((f) => n(f.vdy)).join(" ")}`);
  L.push(`VCXN ${m.fields.map(() => "0").join(" ")}`);
  L.push(`VCYN ${m.fields.map((f) => n(f.vcy)).join(" ")}`);
  L.push(`VANN ${m.fields.map(() => "0").join(" ")}`);
  m.waves.forEach((w, i) => L.push(`WAVM ${i + 1} ${n(w.um)} ${n(w.weight)}`));
  L.push(`PWAV ${m.primaryWave}`);
  L.push("POLS 1 0 1 0 0 1 0");
  L.push("GLRS 1 0");
  m.surfaces.forEach((s, i) => {
    L.push(`SURF ${i}`);
    if (s.stop) L.push("  STOP");
    L.push(`  TYPE ${s.type}`);
    if (s.comment) L.push(`  COMM ${s.comment.replace(SANITIZE, " ")}`);
    L.push(`  CURV ${n(s.curv)} 0 0 0 0 ""`);
    L.push("  HIDE 0 0 0 0 0 0 0 0 0 0");
    L.push("  MIRR 2 0");
    if (s.type === "EVENASPH") (s.parm ?? []).forEach((v, k) => L.push(`  PARM ${k + 1} ${n(v)}`));
    L.push(`  DISZ ${s.thick === "INFINITY" ? "INFINITY" : n(s.thick)}`);
    if (s.glass === "MIRROR") L.push("  GLAS MIRROR 0 0 0 0 0 0 0 0 0 0 ");
    else if (s.glass?.model) L.push(`  GLAS ___BLANK 1 0 ${n(s.glass.model.nd)} ${n(s.glass.model.vd)} 0 0 0 0 0 0 `);
    else if (s.glass) L.push(`  GLAS ${s.glass.name} 0 0 ${n(s.glass.nd ?? 1.5)} ${n(s.glass.vd ?? 40)} 0 0 0 0 0 0 `);
    if (s.conic) L.push(`  CONI ${n(s.conic)}`);
    if (s.marginalRaySolve) L.push("  MAZH 0 0");
    if (s.semiDiameter !== undefined) L.push(`  DIAM ${n(s.semiDiameter)} 1 0 0 1 ""`);
    else L.push('  DIAM 0 0 0 0 1 ""');
    L.push("  POPS 0 0 0 0 0 0 0 0 1 1 1 1 0 0 0 0");
    if (s.obscuration) L.push(`  OBSC 0 ${n(s.obscuration)} 0`);
  });
  L.push("BLNK ");
  L.push("TOL TOFF   0   0 0.0000000000000000E+00 0.0000000000000000E+00   0 0 0 0 0");
  L.push("MNUM 1 1");
  L.push('MOFF   0   1 "" 0 0 0 1 1 0 0.0 "" 0');
  return L.join("\r\n") + "\r\n";
}
