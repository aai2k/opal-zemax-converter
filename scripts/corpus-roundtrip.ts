// node scripts/corpus-roundtrip.ts <folder>   read and re-write every .OPJ below <folder>
import { readFileSync } from "node:fs";
import { readOpj, writeOpj } from "../src/core/opj.ts";
import { walk } from "./util.ts";

const root = process.argv[2] ?? ".";
let ok = 0;
const failures: [string, string][] = [];
for (const f of walk(root)) {
  if (!f.toLowerCase().endsWith(".opj")) continue;
  const d = new Uint8Array(readFileSync(f));
  try {
    const w = writeOpj(readOpj(d));
    if (w.length === d.length && w.every((b, i) => b === d[i])) {
      ok++;
      continue;
    }
    failures.push([f, "differs"]);
  } catch (e) {
    failures.push([f, String((e as Error).message).slice(0, 60)]);
  }
}
console.log(`identical: ${ok}   failed: ${failures.length}`);
for (const [f, why] of failures) console.log("  ", f, "-", why);
