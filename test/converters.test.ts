import assert from "node:assert/strict";
import { test } from "node:test";
import { GlassLibrary, glassIndex, parseAgf } from "../src/core/agf.ts";
import { convertFile, defaultOptions } from "../src/core/convert.ts";
import { paraxialEfl } from "../src/core/describe.ts";
import { convertOpjToZmx, defaultOpjToZmxOptions, mirrorZ } from "../src/core/opj2zmx.ts";
import { glassField, readOpj, writeOpj, type OPJ } from "../src/core/opj.ts";
import { opjSurfaceSag } from "../src/core/surfaces.ts";
import { decodeCp866, encodeCp866, encodeUtf16Le } from "../src/core/text.ts";
import { parseZmx } from "../src/core/zmx.ts";
import { convertZmxToOpj, defaultZmxToOpjOptions } from "../src/core/zmx2opj.ts";
import { DOUBLET_ZMX, testLibrary } from "./fixtures.ts";

const doublet = (): OPJ => convertZmxToOpj(parseZmx(DOUBLET_ZMX, "doublet.zmx"), testLibrary(), defaultZmxToOpjOptions()).opj;
const close = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("CP866 text round trip", () => {
  const s = "ВОЗДУХ ТК14 СТК19 ё №";
  assert.equal(decodeCp866(encodeCp866(s)), s);
  assert.deepEqual([...glassField("К8", "R")], [...encodeCp866("R     К8")]);
  assert.deepEqual([...glassField("BK10GOST")], [...encodeCp866("BK10GOST")]);
});

test("OPJ writer output reads back and re-writes byte for byte", () => {
  const bytes = writeOpj(doublet());
  const again = writeOpj(readOpj(bytes));
  assert.deepEqual([...again], [...bytes]);
});

test("ZMX -> OPJ keeps the prescription", () => {
  const o = doublet();
  assert.equal(o.curv.length, 3);
  assert.deepEqual(o.wavelengths.map((w) => Math.fround(w)), [0.5875618, 0.4861327, 0.6562725].map(Math.fround));
  close(o.curv[0], 0.016, 1e-15);
  close(o.thick[1], 2.5, 1e-15);
  const lib = testLibrary();
  const bk7 = lib.catalog("TESTCAT").get("N-BK7")!;
  close(o.indices[Math.abs(o.media[1]) - 1][0], glassIndex(bk7, 0.5875618), 1e-12);
  close(o.indices[Math.abs(o.media[1]) - 1][0], 1.5168, 1e-4);
  assert.equal(o.ints.nd, 1);
  close(o.aperture[0], 10, 1e-12);
  close(o.fieldSize[0], (5 * Math.PI) / 180, 1e-12);
  // +5 deg Zemax field: the object is below the axis, so VB = VCY - VDY and VH = VCY + VDY
  const v = o.beams!.vign[0];
  close(v[0], 0.1, 1e-7);
  close(v[1], 0.3, 1e-7);
  close(o.spectral!.weights[2], 0.5, 1e-7);
});

test("fitted OPAL asphere reproduces the Zemax even asphere", () => {
  const o = doublet();
  const sag = opjSurfaceSag(o, 1);
  const c = -0.02, k = -1.2;
  for (const r of [1, 4, 7, 10, 11]) {
    const z = (c * r * r) / (1 + Math.sqrt(1 - (1 + k) * c * c * r * r)) + 2e-6 * r ** 4 - 1e-9 * r ** 6;
    close(sag(r), z, 2e-6);
  }
});

test("conic -1 even asphere is copied to OPAL U-type e2=1, HA=1 and back", () => {
  const src = DOUBLET_ZMX.replace("CONI -1.2", "CONI -1").replace("PARM 1 0", "PARM 1 1e-4");
  const { opj: o, report } = convertZmxToOpj(parseZmx(src, "p.zmx"), testLibrary(), defaultZmxToOpjOptions());
  assert.equal(o.asphere!.order[1], 6);
  assert.deepEqual(o.asphere!.coef.slice(0, 4), [1, 1, Math.fround(2e-6), Math.fround(-1e-9)]);
  close(o.curv[1], -0.0198, 1e-15);
  assert.ok(report.notes.some((n) => /terms copied \(max sag error [0-9.]+e-1\d mm\)/.test(n)), report.notes.join("\n"));
  const back = parseZmx(convertOpjToZmx(o, testLibrary(), defaultOpjToZmxOptions(), "P.OPJ").zmx, "q.zmx");
  const s = back.surfaces.find((x) => x.type === "EVENASPH")!;
  assert.equal(s.conic, -1);
  assert.deepEqual([1, 2, 3, 4].map((i) => s.parm.get(i) ?? 0), [0, 2e-6, -1e-9, 0]);
  close(s.curv, -0.0198, 1e-15);
});

test("OPJ -> ZMX -> OPJ with an exact companion catalog", () => {
  const a = doublet();
  const r = convertOpjToZmx(a, new GlassLibrary(), defaultOpjToZmxOptions(), "DOUBLET.OPJ");
  assert.ok(r.agf, "unmatched glasses go to a companion catalog");
  const lib = new GlassLibrary([[r.agf.catalog, parseAgf(r.agf.text, r.agf.catalog)]]);
  const b = convertZmxToOpj(parseZmx(r.zmx, "x.zmx"), lib, defaultZmxToOpjOptions()).opj;
  assert.equal(b.curv.length, a.curv.length);
  a.curv.forEach((c, i) => close(b.curv[i], c, 1e-15));
  a.thick.forEach((t, i) => close(b.thick[i], t, 1e-12));
  for (let k = 0; k < a.media.length; k++) {
    const ia = a.indices[Math.abs(a.media[k]) - 1];
    const ib = b.indices[Math.abs(b.media[k]) - 1];
    ia.forEach((n, j) => close(ib[j], n, 1e-12));
  }
  close(paraxialEfl(b), paraxialEfl(a), 1e-9);
  close(b.aperture[0], a.aperture[0], 1e-12);
  assert.deepEqual(b.beams!.vign, a.beams!.vign);
  const sa = opjSurfaceSag(a, 1), sb = opjSurfaceSag(b, 1);
  for (const r of [2, 6, 10]) close(sb(r), sa(r), 2e-6);
});

test("OPJ -> ZMX matches catalog glasses by name and index", () => {
  const r = convertOpjToZmx(doublet(), testLibrary(), defaultOpjToZmxOptions(), "DOUBLET.OPJ");
  assert.equal(r.agf, undefined);
  assert.deepEqual(r.glasses.map((g) => [g.zemax, g.kind]), [["N-BK7", "catalog"], ["N-SF5", "catalog"]]);
  assert.match(r.zmx, /^GCAT TESTCAT /m);
});

test("light travelling in -z is mirrored for Zemax", () => {
  const o = doublet();
  const m = mirrorZ(mirrorZ(o));
  assert.deepEqual(m.curv, o.curv);
  const f = mirrorZ(o);
  f.curv.forEach((c, i) => close(c, -o.curv[i], 0));
  const sag = opjSurfaceSag(o, 1), sagF = opjSurfaceSag(f, 1);
  for (const r of [3, 8]) close(sagF(r), -sag(r), 1e-12);
});

test("convertFile dispatches on the extension and names outputs", () => {
  const opts = defaultOptions();
  const z = convertFile("My lens.zmx", new TextEncoder().encode(DOUBLET_ZMX), testLibrary(), opts);
  assert.equal(z.error, undefined);
  assert.equal(z.outputs[0].name, "MYLENS.OPJ");
  const back = convertFile("MYLENS.OPJ", z.outputs[0].data, testLibrary(), opts);
  assert.equal(back.error, undefined);
  assert.equal(back.outputs[0].name, "MYLENS.zmx");
  const utf16 = convertFile("u.zmx", encodeUtf16Le(DOUBLET_ZMX), testLibrary(), opts);
  assert.equal(utf16.error, undefined);
  assert.match(convertFile("x.txt", new Uint8Array(4), testLibrary(), opts).error ?? "", /not a .zmx or .opj/);
});
