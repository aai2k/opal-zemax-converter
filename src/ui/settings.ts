import { type ConvertOptions, defaultOptions } from "../core/convert.ts";

const KEY = "opal-zemax-converter.options.v1";

export function loadOptions(): ConvertOptions {
  const d = defaultOptions();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<ConvertOptions>;
    return {
      zmx2opj: { ...d.zmx2opj, ...s.zmx2opj },
      opj2zmx: { ...d.opj2zmx, ...s.opj2zmx },
      dosNames: s.dosNames ?? d.dosNames,
    };
  } catch {
    return d;
  }
}

export function saveOptions(o: ConvertOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    // storage unavailable
  }
}
