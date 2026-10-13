import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { convertFile, defaultOptions } from "../src/core/convert.ts";
import { dumpOpj } from "../src/core/dump.ts";
import { DEFAULT_GLASS_DIRS, libraryFromDirs } from "./node-glass.ts";

const USAGE = `usage: node scripts/cli.ts [options] FILE...

Converts .zmx files to OPAL .OPJ and .opj files to Zemax .zmx (direction by extension).
Outputs are written next to each input unless --out is given.

  --out DIR                     output folder
  --glass-dir DIR               folder with Zemax .AGF catalogs (repeatable; default: Documents/Zemax/Glasscat)
  --catalog-mode MODE           auto | russian | international        (zmx -> opj)
  --afocal                      image at infinity                      (zmx -> opj)
  --image-position POS          last | gauss                           (zmx -> opj)
  --no-catalog-letters          no OPAL catalog letters in glass names (zmx -> opj)
  --asphere-tol MM              asphere fit tolerance (default 1e-6)
  --flip-vignetting             swap upper/lower vignetting
  --long-names                  keep the input name instead of a DOS 8.3 name (zmx -> opj)
  --unmatched MODE              agf | model: glasses not found in the catalogs (opj -> zmx)
  --index-tol X                 max index difference for a catalog glass match (default 1e-4)
  --dump                        print the OPAL system
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    "glass-dir": { type: "string", multiple: true, default: [] },
    "catalog-mode": { type: "string", default: "auto" },
    afocal: { type: "boolean", default: false },
    "image-position": { type: "string", default: "last" },
    "no-catalog-letters": { type: "boolean", default: false },
    "asphere-tol": { type: "string" },
    "flip-vignetting": { type: "boolean", default: false },
    "long-names": { type: "boolean", default: false },
    unmatched: { type: "string", default: "agf" },
    "index-tol": { type: "string" },
    dump: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || !positionals.length) {
  process.stdout.write(USAGE);
  process.exit(values.help ? 0 : 1);
}

const opts = defaultOptions();
const mode = values["catalog-mode"];
opts.zmx2opj.catMode = mode === "russian" ? 0 : mode === "international" ? 7 : null;
opts.zmx2opj.afocal = values.afocal;
opts.zmx2opj.imagePosition = values["image-position"] === "gauss" ? "gauss" : "last";
opts.zmx2opj.catalogLetters = !values["no-catalog-letters"];
opts.zmx2opj.vignFlip = opts.opj2zmx.vignFlip = values["flip-vignetting"];
if (values["asphere-tol"]) opts.zmx2opj.asphereTol = opts.opj2zmx.asphereTol = Number(values["asphere-tol"]);
opts.opj2zmx.unmatchedGlass = values.unmatched === "model" ? "model" : "agf";
if (values["index-tol"]) opts.opj2zmx.indexTolerance = Number(values["index-tol"]);
opts.dosNames = !values["long-names"];

const lib = libraryFromDirs([...values["glass-dir"], ...DEFAULT_GLASS_DIRS]);
let failed = 0;
for (const file of positionals) {
  const r = convertFile(file, new Uint8Array(readFileSync(file)), lib, opts);
  if (r.error) {
    failed++;
    console.error(`${file}: ERROR: ${r.error}`);
    continue;
  }
  const outDir = values.out ? resolve(values.out) : dirname(resolve(file));
  mkdirSync(outDir, { recursive: true });
  for (const out of r.outputs) {
    const path = join(outDir, out.name);
    writeFileSync(path, out.data);
    console.log(`wrote ${path}`);
  }
  for (const n of r.notes) console.log(`  note: ${n}`);
  for (const w of r.warnings) console.log(`  WARNING: ${w}`);
  if (values.dump && r.system) console.log("\n" + dumpOpj(r.system) + "\n");
}
process.exit(failed ? 2 : 0);
