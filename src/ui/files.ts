import { zipSync } from "fflate";
import type { OutputFile } from "../core/convert.ts";

export function downloadBytes(name: string, data: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function zipOutputs(groups: { input: string; outputs: OutputFile[] }[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const taken = new Set<string>();
  for (const g of groups) {
    for (const out of g.outputs) {
      let name = out.name;
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = out.name.replace(/(\.[^.]*)?$/, `_${i}$1`);
      taken.add(name.toLowerCase());
      entries[name] = out.data;
    }
  }
  return zipSync(entries, { level: 6 });
}

export async function readFiles(files: Iterable<File>): Promise<{ name: string; data: Uint8Array }[]> {
  return Promise.all([...files].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
}
