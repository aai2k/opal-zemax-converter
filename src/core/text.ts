const CP866_HIGH =
  "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№¤■" +
  String.fromCharCode(0xa0);

const CP866_ENCODE = new Map<string, number>();
for (let i = 0; i < 128; i++) CP866_ENCODE.set(CP866_HIGH[i], 128 + i);

export function decodeCp866(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : CP866_HIGH[b - 128];
  return s;
}

export function encodeCp866(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 128) out.push(c);
    else out.push(CP866_ENCODE.get(ch) ?? 0x3f);
  }
  return Uint8Array.from(out);
}

export function canEncodeCp866(text: string): boolean {
  for (const ch of text) if (ch.codePointAt(0)! >= 128 && !CP866_ENCODE.has(ch)) return false;
  return true;
}

// Python's str.isspace() set, so splitting matches the reference implementation
const WS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RE_SPLIT = new RegExp(`[${WS}]+`);
const RE_LSTRIP = new RegExp(`^[${WS}]+`);
const RE_RSTRIP = new RegExp(`[${WS}]+$`);
const RE_LINES = new RegExp("\\r\\n|[\\n\\r\\x0b\\x0c\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]");

export const pyRstrip = (s: string): string => s.replace(RE_RSTRIP, "");
export const pyStrip = (s: string): string => s.replace(RE_LSTRIP, "").replace(RE_RSTRIP, "");

export function pySplit(s: string): string[] {
  const t = pyStrip(s);
  return t === "" ? [] : t.split(RE_SPLIT);
}

export function pySplitMax(s: string, maxsplit: number): string[] {
  const out: string[] = [];
  let rest = s.replace(RE_LSTRIP, "");
  while (rest !== "" && out.length < maxsplit) {
    const m = RE_SPLIT.exec(rest);
    if (!m) break;
    out.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest !== "") out.push(rest);
  return out;
}

export function pySplitLines(s: string): string[] {
  const lines = s.split(RE_LINES);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const RE_FLOAT = /^[+-]?((\d(_?\d)*)?\.(\d(_?\d)*)?|\d(_?\d)*)([eE][+-]?\d(_?\d)*)?$/;

/** Python float(); NaN where Python raises ValueError. */
export function pyFloat(tok: string): number {
  const t = pyStrip(tok);
  const low = t.toLowerCase();
  if (/^[+-]?(inf|infinity)$/.test(low)) return low.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/.test(low)) return Number.NaN;
  if (!RE_FLOAT.test(t) || /^[+-]?\.$/.test(t)) return Number.NaN;
  return Number(t.replace(/_/g, ""));
}

export function pyIntOfFloat(tok: string): number {
  const v = pyFloat(tok);
  return Number.isFinite(v) ? Math.trunc(v) : Number.NaN;
}

export function pyInt(tok: string): number {
  const t = pyStrip(tok);
  return /^[+-]?\d(_?\d)*$/.test(t) ? Number(t.replace(/_/g, "")) : Number.NaN;
}

export function decodeZemaxText(raw: Uint8Array, tryUtf8 = true): string {
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) return new TextDecoder("utf-16le").decode(raw.subarray(2));
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) return new TextDecoder("utf-16be").decode(raw.subarray(2));
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
    return new TextDecoder("utf-8").decode(raw.subarray(3));
  if (tryUtf8) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      // not UTF-8
    }
  }
  return new TextDecoder("windows-1251").decode(raw);
}

/** UTF-16LE with BOM, the encoding OpticStudio uses for its text files. */
export function encodeUtf16Le(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[2 + 2 * i] = c & 0xff;
    out[3 + 2 * i] = c >> 8;
  }
  return out;
}

const CYR2LAT: Record<string, string> = {
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E", Ж: "ZH", З: "Z", И: "I", Й: "J", К: "K", Л: "L",
  М: "M", Н: "N", О: "O", П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "KH", Ц: "C", Ч: "CH", Ш: "SH",
  Щ: "SCH", Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "YU", Я: "YA",
};

export function transliterate(s: string): string {
  let out = "";
  for (const ch of s) {
    const up = ch.toUpperCase();
    const t = CYR2LAT[up];
    if (t === undefined) out += ch;
    else out += ch === up ? t : t.toLowerCase();
  }
  return out;
}
