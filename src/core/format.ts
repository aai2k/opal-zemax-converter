function special(x: number): string | null {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  return null;
}

function expPart(e: number): string {
  const a = Math.abs(e);
  return (e < 0 ? "-" : "+") + (a < 10 ? "0" + a : String(a));
}

/** C printf %.pe */
export function fmtE(x: number, p = 6): string {
  const s = special(x);
  if (s) return s;
  const [m, e] = x.toExponential(p).split("e");
  return m + "e" + expPart(Number(e));
}

/** C printf %.pf */
export function fmtF(x: number, p = 6): string {
  return special(x) ?? x.toFixed(p);
}

/** C printf %.pg */
export function fmtG(x: number, p = 6): string {
  const s = special(x);
  if (s) return s;
  if (p === 0) p = 1;
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const t = x.toExponential(p - 1);
  const e = Number(t.split("e")[1]);
  if (e < -4 || e >= p) {
    let [m] = t.split("e");
    if (m.includes(".")) m = m.replace(/0+$/, "").replace(/\.$/, "");
    return m + "e" + expPart(e);
  }
  let f = x.toFixed(Math.max(0, p - 1 - e));
  if (f.includes(".")) f = f.replace(/0+$/, "").replace(/\.$/, "");
  return f;
}

/** Shortest round-trip text for Zemax files. */
export function fmtR(x: number): string {
  if (Number.isNaN(x)) return "0";
  if (!Number.isFinite(x)) return x > 0 ? "1e+20" : "-1e+20";
  if (Object.is(x, -0)) return "0";
  return String(x);
}
