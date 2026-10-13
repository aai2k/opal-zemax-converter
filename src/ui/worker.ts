import { type Glass, GlassLibrary } from "../core/agf.ts";
import { type ConvertOptions, convertFile } from "../core/convert.ts";

export type WorkerRequest =
  | { type: "catalogs"; catalogs: [string, Glass[]][] }
  | { type: "convert"; id: number; gen: number; name: string; data: Uint8Array; options: ConvertOptions };

let lib = new GlassLibrary();

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === "catalogs") {
    lib = new GlassLibrary();
    for (const [name, glasses] of msg.catalogs) lib.add(name, new Map(glasses.map((g) => [g.name.toUpperCase(), g])));
    return;
  }
  const t0 = performance.now();
  const result = convertFile(msg.name, msg.data, lib, msg.options);
  (self as unknown as Worker).postMessage({ id: msg.id, gen: msg.gen, result, ms: performance.now() - t0 });
};
