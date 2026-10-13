/** Python's built-in sum() of floats (Neumaier summation, Python >= 3.12). */
export function pySum(xs: Iterable<number>): number {
  let f = 0;
  let c = 0;
  for (const x of xs) {
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
    else c += x - t + f;
    f = t;
  }
  if (c !== 0 && Number.isFinite(c)) f += c;
  return f;
}

/** Python's max(): NaN wins only when it comes first. */
export function pyMax(xs: Iterable<number>): number {
  let first = true;
  let m = 0;
  for (const x of xs) {
    if (first) {
      m = x;
      first = false;
    } else if (x > m) m = x;
  }
  if (first) throw new Error("max() of empty sequence");
  return m;
}

/** Python round(): half to even. */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Least squares by Householder QR. */
export function lstsq(A: number[][], b: number[]): number[] {
  const m = A.length;
  const n = A[0].length;
  const R = A.map((row) => row.slice());
  const q = b.slice();
  for (let j = 0; j < n; j++) {
    const colSq: number[] = [];
    for (let i = j; i < m; i++) colSq.push(R[i][j] * R[i][j]);
    const norm = Math.sqrt(pySum(colSq));
    if (norm === 0) continue;
    const alpha = R[j][j] > 0 ? -norm : norm;
    const v = new Array<number>(m).fill(0);
    v[j] = R[j][j] - alpha;
    for (let i = j + 1; i < m; i++) v[i] = R[i][j];
    const vsq: number[] = [];
    for (let i = j; i < m; i++) vsq.push(v[i] * v[i]);
    const vv = pySum(vsq);
    if (vv === 0) continue;
    for (let col = j; col < n; col++) {
      const prods: number[] = [];
      for (let i = j; i < m; i++) prods.push(v[i] * R[i][col]);
      const s = (pySum(prods) * 2) / vv;
      for (let i = j; i < m; i++) R[i][col] -= s * v[i];
    }
    const prods: number[] = [];
    for (let i = j; i < m; i++) prods.push(v[i] * q[i]);
    const s = (pySum(prods) * 2) / vv;
    for (let i = j; i < m; i++) q[i] -= s * v[i];
  }
  const x = new Array<number>(n).fill(0);
  for (let j = n - 1; j >= 0; j--) {
    const terms: number[] = [];
    for (let k = j + 1; k < n; k++) terms.push(R[j][k] * x[k]);
    const acc = q[j] - pySum(terms);
    x[j] = R[j][j] !== 0 ? acc / R[j][j] : 0;
  }
  return x;
}

/** Gaussian elimination with partial pivoting; null if singular. */
export function solveSquare(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (M[p][c] === 0) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}
