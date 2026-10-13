import { GlassLibrary } from "./agf.ts";
import { convertOpjToZmx, defaultOpjToZmxOptions, type GlassMapping, type OpjToZmxOptions } from "./opj2zmx.ts";
import { type OPJ, OpjFormatError, readOpj, writeOpj } from "./opj.ts";
import { encodeUtf16Le } from "./text.ts";
import { parseZmxBytes, splitExt, baseName } from "./zmx.ts";
import { ConversionError, convertZmxToOpj, defaultZmxToOpjOptions, dosName, type ZmxToOpjOptions } from "./zmx2opj.ts";

export type Direction = "zmx2opj" | "opj2zmx";

export interface ConvertOptions {
  zmx2opj: ZmxToOpjOptions;
  opj2zmx: OpjToZmxOptions;
  dosNames: boolean;
}

export const defaultOptions = (): ConvertOptions => ({
  zmx2opj: defaultZmxToOpjOptions(),
  opj2zmx: defaultOpjToZmxOptions(),
  dosNames: true,
});

export interface OutputFile {
  name: string;
  data: Uint8Array;
  kind: "opj" | "zmx" | "agf";
}

export interface ConvertResult {
  input: string;
  direction: Direction;
  outputs: OutputFile[];
  notes: string[];
  warnings: string[];
  error?: string;
  system?: OPJ;
  glasses?: GlassMapping[];
  zmxText?: string;
}

export function directionOf(fileName: string): Direction | null {
  const ext = splitExt(baseName(fileName))[1].toLowerCase();
  if (ext === ".zmx") return "zmx2opj";
  if (ext === ".opj") return "opj2zmx";
  return null;
}

export function convertFile(fileName: string, data: Uint8Array, lib: GlassLibrary, options: ConvertOptions): ConvertResult {
  const direction = directionOf(fileName);
  const base = splitExt(baseName(fileName))[0];
  if (!direction) {
    return { input: fileName, direction: "zmx2opj", outputs: [], notes: [], warnings: [], error: "not a .zmx or .opj file" };
  }
  const result: ConvertResult = { input: fileName, direction, outputs: [], notes: [], warnings: [] };
  try {
    if (direction === "zmx2opj") {
      const z = parseZmxBytes(data, fileName);
      const { opj, report } = convertZmxToOpj(z, lib, options.zmx2opj);
      const bytes = writeOpj(opj);
      result.system = readOpj(bytes);
      result.outputs.push({ name: options.dosNames ? dosName(fileName) : `${base}.OPJ`, data: bytes, kind: "opj" });
      result.notes = report.notes;
      result.warnings = report.warnings;
    } else {
      if (data.length >= 4 && String.fromCharCode(...data.subarray(0, 4)) === "CPYA")
        throw new ConversionError("this is an OriginLab project, not an OPAL system file");
      const o = readOpj(data);
      const r = convertOpjToZmx(o, lib, options.opj2zmx, fileName);
      result.system = o;
      result.glasses = r.glasses;
      result.zmxText = r.zmx;
      result.outputs.push({ name: `${base}.zmx`, data: encodeUtf16Le(r.zmx), kind: "zmx" });
      if (r.agf) result.outputs.push({ name: r.agf.fileName, data: encodeUtf16Le(r.agf.text), kind: "agf" });
      result.notes = r.report.notes;
      result.warnings = r.report.warnings;
    }
  } catch (e) {
    if (e instanceof ConversionError || e instanceof OpjFormatError) result.error = e.message;
    else result.error = `internal error: ${(e as Error).message}`;
  }
  return result;
}
