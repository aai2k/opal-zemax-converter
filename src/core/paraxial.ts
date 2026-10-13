/** y-nu trace from surface 1. nidx[i] is the signed index after surface i (nidx[0]: object space).
 * Returns the heights at the surfaces and n'u' after the last surface. */
export function paraxialTrace(
  curv: number[],
  thick: number[],
  nidx: number[],
  y: number,
  u: number,
): { heights: number[]; nu: number } {
  const heights: number[] = [];
  let n = nidx[0];
  let nu = n * u;
  for (let i = 0; i < curv.length; i++) {
    heights.push(y);
    const n2 = nidx[i + 1];
    nu = nu - y * curv[i] * (n2 - n);
    n = n2;
    if (i < thick.length) y = y + (thick[i] * nu) / n;
  }
  return { heights, nu };
}

/** Lateral magnification for an object lObj to the left of surface 1. */
export function paraxialMagnification(curv: number[], thick: number[], nidx: number[], lObj: number): number {
  const last = (y1: number, u0: number): [number, number] => {
    const { heights, nu } = paraxialTrace(curv, thick, nidx, y1, u0);
    return [heights[heights.length - 1], nu / nidx[nidx.length - 1]];
  };
  const [ya, ua] = last(1.0, 0.0);
  const [yb, ub] = last(1.0 + lObj, 1.0);
  if (ub === ua) return 0.0;
  const t = (ya - yb) / (ub - ua);
  return ya + t * ua;
}

/** Height and slope after the last surface (before any transfer past it). */
export function traceToLast(curv: number[], thick: number[], nidx: number[], y: number, u: number): [number, number] {
  const { heights, nu } = paraxialTrace(curv, thick, nidx, y, u);
  return [heights[heights.length - 1], nu / nidx[nidx.length - 1]];
}
