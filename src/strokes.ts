import type { Pt } from './layout.ts';

/** A piece of an arrow path to stroke. */
export interface StrokePiece {
  pts: Pt[];
  /** True when the piece ends where its path ends, so the line must stop short of the arrowhead. */
  atEnd: boolean;
}

const EPS = 0.01;

interface Seg {
  axis: 'h' | 'v';
  c: number;
  lo: number;
  hi: number;
}

function segmentsOf(path: readonly Pt[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    if (Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) >= EPS) {
      out.push({ axis: 'h', c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    } else if (Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) >= EPS) {
      out.push({ axis: 'v', c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }
  }
  return out;
}

/** Drops repeated points, which would leave a corner without a direction. */
export function dedupe(path: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of path) {
    const q = out[out.length - 1];
    if (!q || Math.abs(p.x - q.x) >= EPS || Math.abs(p.y - q.y) >= EPS) out.push(p);
  }
  return out;
}

function union(intervals: [number, number][]): [number, number][] {
  intervals.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [lo, hi] of intervals) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + EPS) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/**
 * Splits the paths of one arrow into the pieces that still need stroking, so that a trunk shared by
 * a fork or a join is stroked once. Stroking it once per path would make shared lines look heavier
 * than the rest, because their anti-aliased edges get painted several times.
 *
 * Each later path is drawn only where no earlier path runs. A piece that leaves or joins a shared
 * line starts (or ends) `radius` back along that line, so its rounded corner peels off the trunk.
 */
export function strokePieces(paths: readonly (readonly Pt[])[], radius: number): StrokePiece[] {
  const drawn: Seg[] = [];
  const pieces: StrokePiece[] = [];
  for (const raw of paths) {
    const p = dedupe(raw);
    if (p.length < 2) continue;
    const s = [0];
    for (let i = 1; i < p.length; i++) s.push(s[i - 1]! + Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.y - p[i - 1]!.y));
    const total = s[s.length - 1]!;

    const covered: [number, number][] = [];
    for (let i = 0; i + 1 < p.length; i++) {
      const [seg] = segmentsOf([p[i]!, p[i + 1]!]);
      if (!seg) continue;
      const from = seg.axis === 'h' ? p[i]!.x : p[i]!.y;
      for (const d of drawn) {
        if (d.axis !== seg.axis || Math.abs(d.c - seg.c) >= EPS) continue;
        const lo = Math.max(d.lo, seg.lo);
        const hi = Math.min(d.hi, seg.hi);
        if (hi - lo <= EPS) continue;
        const t0 = s[i]! + Math.abs(lo - from);
        const t1 = s[i]! + Math.abs(hi - from);
        covered.push([Math.min(t0, t1), Math.max(t0, t1)]);
      }
    }

    let at = 0;
    const open: [number, number][] = [];
    for (const [lo, hi] of union(covered)) {
      if (lo - at > EPS) open.push([at, lo]);
      at = Math.max(at, hi);
    }
    if (total - at > EPS) open.push([at, total]);

    for (const [u0, u1] of open) {
      const before = Math.max(0, ...s.filter((v) => v < u0 - EPS));
      const after = Math.min(total, ...s.filter((v) => v > u1 + EPS));
      const a = u0 <= EPS ? 0 : Math.max(u0 - radius, before);
      const b = u1 >= total - EPS ? total : Math.min(u1 + radius, after);
      pieces.push({ pts: slice(p, s, a, b), atEnd: b >= total - EPS });
    }
    drawn.push(...segmentsOf(p));
  }
  return pieces;
}

function pointAt(p: readonly Pt[], s: readonly number[], t: number): Pt {
  for (let i = 0; i + 1 < p.length; i++) {
    if (t <= s[i + 1]! + EPS) {
      const len = s[i + 1]! - s[i]!;
      const k = len > 0 ? Math.min(1, Math.max(0, (t - s[i]!) / len)) : 0;
      return { x: p[i]!.x + (p[i + 1]!.x - p[i]!.x) * k, y: p[i]!.y + (p[i + 1]!.y - p[i]!.y) * k };
    }
  }
  return p[p.length - 1]!;
}

function slice(p: readonly Pt[], s: readonly number[], a: number, b: number): Pt[] {
  const out = [pointAt(p, s, a)];
  for (let i = 0; i < p.length; i++) if (s[i]! > a + EPS && s[i]! < b - EPS) out.push(p[i]!);
  out.push(pointAt(p, s, b));
  return dedupe(out);
}
