import { pySum } from "./numeric.ts";
import { nfloats, type OPJ } from "./opj.ts";

/** OPAL U-type surface z - c(u + (1-e2) z^2)/2 - Q(u) = 0, Q = sum a_j (u/HA^2)^j, j >= 2. */
export function opalSagU(c: number, e2: number, ha: number, coefs: number[], r: number): number {
  const u = r * r;
  const w = u / (ha * ha);
  const q = pySum(coefs.map((a, j) => a * w ** (j + 2)));
  if (c === 0) return q;
  const cu = c * u + 2 * q;
  const arg = 1 - (1 - e2) * c * cu;
  if (arg < 0) return Number.NaN;
  return cu / (1 + Math.sqrt(arg));
}

/** OPAL Z-type surface z - c(u + (1-e2) z^2)/2 - sum b_j (z/HA)^j = 0, j >= 3 (Newton, continued in r). */
export function opalSagZ(c: number, e2: number, ha: number, b: number[]): (r: number) => number {
  let last = 0;
  let lastR = -1;
  return (r: number): number => {
    let z = r >= lastR && Number.isFinite(last) ? last : 0;
    const u = r * r;
    for (let it = 0; it < 100; it++) {
      let q = 0;
      let dq = 0;
      for (let j = 0; j < b.length; j++) {
        const p = j + 3;
        q += b[j] * (z / ha) ** p;
        dq += (p * b[j] * (z / ha) ** (p - 1)) / ha;
      }
      const F = z - (c * (u + (1 - e2) * z * z)) / 2 - q;
      const dF = 1 - c * (1 - e2) * z - dq;
      if (dF === 0) return Number.NaN;
      const step = F / dF;
      z -= step;
      if (Math.abs(step) <= 1e-15 * Math.max(1, Math.abs(z))) {
        last = z;
        lastR = r;
        return z;
      }
    }
    return Number.NaN;
  };
}

export function conicSag(c: number, e2: number, r: number): number {
  const arg = 1 - (1 - e2) * c * c * r * r;
  return arg < 0 ? Number.NaN : (c * r * r) / (1 + Math.sqrt(arg));
}

/** Sag function of OPAL surface k (0-based). */
export function opjSurfaceSag(o: OPJ, k: number): (r: number) => number {
  const c = o.curv[k];
  const a = o.asphere;
  if (!a || !a.order[k]) return (r) => conicSag(c, 0, r);
  let p = 0;
  for (let q = 0; q < k; q++) p += nfloats(a.order[q]);
  const ord = a.order[k];
  const fl = a.coef.slice(p, p + nfloats(ord));
  if (Math.abs(ord) === 2 || Math.abs(ord) > 100) return (r) => conicSag(c, Math.abs(ord) === 2 ? fl[0] : 0, r);
  const ha = fl[1] || 1;
  if (ord > 0) return (r) => opalSagU(c, fl[0], ha, fl.slice(2), r);
  return opalSagZ(c, fl[0], ha, fl.slice(2));
}
