import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GlassLibrary, parseAgfBytes } from "../src/core/agf.ts";

export const DEFAULT_GLASS_DIRS = [
  join(homedir(), "Documents", "Zemax", "Glasscat"),
  join(homedir(), "Documents", "Ansys Zemax OpticStudio", "Glasscat"),
];

export function libraryFromDirs(dirs: string[]): GlassLibrary {
  const lib = new GlassLibrary();
  for (const d of dirs) {
    let files: string[];
    try {
      if (!statSync(d).isDirectory()) continue;
      files = readdirSync(d);
    } catch {
      continue;
    }
    for (const fn of files) {
      if (!fn.toLowerCase().endsWith(".agf")) continue;
      const name = fn.slice(0, -4).toUpperCase();
      const path = join(d, fn);
      lib.addLazy(name, () => parseAgfBytes(new Uint8Array(readFileSync(path)), name));
    }
  }
  return lib;
}
