import { type OPJ } from "./opj.ts";
import { mirrorZ } from "./opj2zmx.ts";
import { opjSurfaceSag } from "./surfaces.ts";

export type Pt = [z: number, y: number];

export interface LayoutSurface {
  points: Pt[];
  mirror: boolean;
  stop: boolean;
}

export interface Layout {
  surfaces: LayoutSurface[];
  elements: Pt[][];
  rays: { field: number; points: Pt[] }[];
  image: Pt[] | null;
  stop: { z: number; h: number } | null;
  bounds: { zMin: number; zMax: number; yMin: number; yMax: number };
}

interface Para {
  c: number[];
  t: number[];
  n: number[];
}

function trace(p: Para, z0: number, y0: number, u0: number): { ys: number[]; nus: number[] } {
  let y = y0 - z0 * u0;
  let nu = p.n[0] * u0;
  const ys: number[] = [];
  const nus: number[] = [];
  for (let k = 0; k < p.c.length; k++) {
    ys.push(y);
    nu -= y * p.c[k] * (p.n[k + 1] - p.n[k]);
    nus.push(nu);
    if (k < p.c.length - 1) y += (p.t[k] * nu) / p.n[k + 1];
  }
  return { ys, nus };
}

function stopHeight(o: OPJ, p: Para, z0: number, y0: number, u0: number): number {
  const nd = o.ints.nd;
  if (nd === 99) {
    const zp = o.ints.ob === 0 ? o.sd : o.sd ? o.s0 + 1000 / o.sd : 0;
    return y0 + (zp - z0) * u0;
  }
  if (nd <= 0 || nd > p.c.length) return y0 + ((nd === 0 ? o.sd : 0) - z0) * u0;
  const r = trace(p, z0, y0, u0);
  return r.ys[nd - 1] + (o.sd * r.nus[nd - 1]) / p.n[nd];
}

function fieldAngle(kind: number, rel: number, w: number): number {
  if (kind === 1) return rel * w;
  if (kind === 2) return Math.asin(Math.min(1, rel * Math.sin(w)));
  if (kind === 3) return 2 * Math.asin(Math.min(1, rel * Math.sin(w / 2)));
  return Math.atan(rel * Math.tan(w));
}

export function computeLayout(src: OPJ, fields = [0, 1]): Layout | null {
  const o = src.media.length && src.media[0] < 0 ? mirrorZ(src) : src;
  const N = o.curv.length;
  if (!N || !o.wavelengths.length) return null;
  const n = o.media.map((m) => Math.sign(m) * (o.indices[Math.abs(m) - 1]?.[0] ?? 1));
  const t = o.thick.map((x, k) => (k === N - 1 || Math.abs(x) > 1e10 ? 0 : x));
  const p: Para = { c: o.curv, t, n };
  const zs: number[] = [0];
  for (let k = 1; k < N; k++) zs.push(zs[k - 1] + t[k - 1]);
  const sags = Array.from({ length: N }, (_, k) => opjSurfaceSag(o, k));
  const ob = o.ints.ob === 1;
  const ax = ob ? { z0: o.s0, y0: 0, u0: 1 } : { z0: 0, y0: 1, u0: 0 };

  const h1 = stopHeight(o, p, 0, 1, 0);
  const h2 = stopHeight(o, p, 0, 0, 1);
  const zEp = h1 ? h2 / h1 : 0;
  const hAx = Math.abs(stopHeight(o, p, ax.z0, ax.y0, ax.u0));
  const A = Math.abs(o.aperture[0]);
  const n0 = Math.abs(n[0]);
  const nN = Math.abs(n[N]);
  const last = trace(p, ax.z0, ax.y0, ax.u0);
  const uOut = last.nus[N - 1] / n[N];
  let H: number;
  if (o.ints.apType === 0) H = A;
  else if (o.ints.apType === -1) H = ob && A < n0 ? Math.tan(Math.asin(A / n0)) * hAx : (A / n0) * hAx;
  else if (o.ints.im === 1) H = uOut ? (Math.tan(Math.asin(Math.min(A / nN, 0.999))) / Math.abs(uOut)) * hAx : hAx;
  else H = last.ys[N - 1] ? ((A / nN) / Math.abs(last.ys[N - 1])) * hAx : hAx;
  if (!Number.isFinite(H) || H <= 0) H = 1;
  const rEp = ob ? (H / hAx) * Math.abs(zEp - o.s0) : h1 ? H / Math.abs(h1) : H;

  const W = Math.abs(o.fieldSize[0]);
  const efl = (() => {
    const r = trace(p, 0, 1, 0);
    return r.nus[N - 1] ? -n[N] / r.nus[N - 1] : Infinity;
  })();
  const objectField = (rel: number): { angle?: number; height?: number } => {
    if (!o.ints.fieldInImage) return ob ? { height: rel * W } : { angle: fieldAngle(o.ints.kindo, rel, W) };
    if (o.ints.im === 1) {
      if (!ob) return { angle: Number.isFinite(efl) ? Math.atan((rel * W) / Math.abs(efl)) : 0 };
      const mag = (() => {
        const a = trace(p, o.s0, 1, 0);
        const b = trace(p, o.s0, 0, 1);
        const ya = a.ys[N - 1], ua = a.nus[N - 1] / n[N], yb = b.ys[N - 1], ub = b.nus[N - 1] / n[N];
        return ub ? ya - (ua * yb) / ub : 0;
      })();
      return { height: mag ? (rel * W) / Math.abs(mag) : 0 };
    }
    return ob ? { height: 0 } : { angle: 0 };
  };

  const step = (y: number, z: number, dy: number, dz: number, k: number): [number, number, number, number] | null => {
    const s = sags[k];
    const sag = (yy: number): number => s(Math.abs(yy));
    let tt = (zs[k] - z) / dz;
    for (let it = 0; it < 40; it++) {
      const yy = y + tt * dy;
      const g = z + tt * dz - zs[k] - sag(yy);
      const e = 1e-6 * Math.max(1, Math.abs(yy));
      const ds = (sag(yy + e) - sag(yy - e)) / (2 * e);
      const dg = dz - ds * dy;
      if (!Number.isFinite(g) || !Number.isFinite(dg) || dg === 0) return null;
      const d = g / dg;
      tt -= d;
      if (Math.abs(d) < 1e-10) break;
    }
    const yy = y + tt * dy;
    const zz = z + tt * dz;
    const e = 1e-6 * Math.max(1, Math.abs(yy));
    const slope = (sag(yy + e) - sag(yy - e)) / (2 * e);
    if (!Number.isFinite(zz) || !Number.isFinite(slope)) return null;
    let ny = -slope;
    let nz = 1;
    const nl = Math.hypot(ny, nz);
    ny /= nl;
    nz /= nl;
    let cosI = dy * ny + dz * nz;
    if (Math.sign(n[k]) !== Math.sign(n[k + 1])) return [yy, zz, dy - 2 * cosI * ny, dz - 2 * cosI * nz];
    if (cosI < 0) {
      ny = -ny;
      nz = -nz;
      cosI = -cosI;
    }
    const mu = Math.abs(n[k]) / Math.abs(n[k + 1]);
    const kk = 1 - mu * mu * (1 - cosI * cosI);
    if (kk < 0) return null;
    const f = Math.sqrt(kk) - mu * cosI;
    return [yy, zz, mu * dy + f * ny, mu * dz + f * nz];
  };

  const lengthScale = Math.max(1, Math.abs(zs[N - 1]), ...t.map(Math.abs));
  let zImg: number | null = null;
  if (o.ints.im === 1) {
    if (o.ints.siFromLast) zImg = zs[N - 1] + o.si;
    else if (uOut) zImg = zs[N - 1] - last.ys[N - 1] / uOut + o.si;
  }
  const rays: Layout["rays"] = [];
  let virtualImage = false;
  const heights = Array(N).fill(0);
  let imgH = 0;
  for (const rel of fields) {
    const f = objectField(rel);
    for (const pu of [-1, 0, 1]) {
      let y: number, z: number, dy: number, dz: number;
      if (ob) {
        const yo = -(f.height ?? 0);
        z = o.s0;
        y = yo;
        const ty = pu * rEp - yo;
        const tz = zEp - o.s0 || 1e-9;
        const l = Math.hypot(ty, tz);
        dy = ty / l;
        dz = tz / l;
        if (tz < 0) {
          dy = -dy;
          dz = -dz;
        }
      } else {
        const a = f.angle ?? 0;
        dy = Math.sin(a);
        dz = Math.cos(a);
        z = Math.min(0, zEp) - 0.15 * lengthScale;
        y = pu * rEp + (z - zEp) * Math.tan(a);
      }
      const pts: Pt[] = [[z, y]];
      let ok = true;
      for (let k = 0; k < N; k++) {
        const r = step(y, z, dy, dz, k);
        if (!r) {
          ok = false;
          break;
        }
        [y, z, dy, dz] = r;
        pts.push([z, y]);
        heights[k] = Math.max(heights[k], Math.abs(y));
      }
      if (ok) {
        let tt = dz && zImg !== null ? (zImg - z) / dz : Number.NaN;
        const real = Number.isFinite(tt) && tt > 0 && tt < 1e4 * lengthScale;
        if (!real) {
          tt = 0.25 * lengthScale;
          virtualImage = true;
        }
        pts.push([z + tt * dz, y + tt * dy]);
        if (real) imgH = Math.max(imgH, Math.abs(y + tt * dy));
      }
      rays.push({ field: rel, points: pts });
    }
  }

  const surfaces: LayoutSurface[] = [];
  const semi: number[] = [];
  for (let k = 0; k < N; k++) {
    const hs = o.hsv?.[k];
    let h = hs !== undefined && hs > 0 && hs < 1e19 ? hs : heights[k] * 1.05;
    if (!(h > 0)) h = 0.1 * lengthScale;
    const pts: Pt[] = [];
    for (let i = 0; i <= 40; i++) {
      const y = -h + (2 * h * i) / 40;
      const zz = zs[k] + sags[k](Math.abs(y));
      if (Number.isFinite(zz)) pts.push([zz, y]);
    }
    semi.push(h);
    surfaces.push({ points: pts, mirror: Math.sign(n[k]) !== Math.sign(n[k + 1]), stop: o.ints.nd === k + 1 && o.sd === 0 });
  }
  const elements: Pt[][] = [];
  for (let k = 0; k < N - 1; k++) {
    const glass = Math.abs(Math.abs(n[k + 1]) - 1) > 1e-6 && !surfaces[k].mirror && !surfaces[k + 1].mirror;
    if (glass && surfaces[k].points.length > 1 && surfaces[k + 1].points.length > 1)
      elements.push([...surfaces[k].points, ...[...surfaces[k + 1].points].reverse()]);
  }
  const image: Pt[] | null = zImg !== null && !virtualImage && imgH > 0 ? [[zImg, -imgH], [zImg, imgH]] : null;
  let stop: Layout["stop"] = null;
  {
    const nd = o.ints.nd;
    let zStop: number | null = null;
    if (nd === 99) zStop = zEp;
    else if (nd === 0) zStop = o.sd;
    else if (nd >= 1 && nd <= N) zStop = zs[nd - 1] + (o.sd ? o.sd : sags[nd - 1](H));
    if (zStop !== null && Number.isFinite(zStop) && H > 0) stop = { z: zStop, h: H };
  }
  const all: Pt[] = [
    ...surfaces.flatMap((s) => s.points), ...rays.flatMap((r) => r.points), ...(image ?? []),
    ...(stop ? ([[stop.z, stop.h * 1.25], [stop.z, -stop.h * 1.25]] as Pt[]) : []),
  ];
  const finite = all.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (!finite.length) return null;
  const bounds = {
    zMin: Math.min(...finite.map((q) => q[0])),
    zMax: Math.max(...finite.map((q) => q[0])),
    yMin: Math.min(...finite.map((q) => q[1])),
    yMax: Math.max(...finite.map((q) => q[1])),
  };
  return { surfaces, elements, rays, image, stop, bounds };
}
