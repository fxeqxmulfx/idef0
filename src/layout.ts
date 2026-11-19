/**
 * IDEF0 diagram layout.
 *
 * Boxes are placed on a strict staircase (box i in column i and row i), which leaves
 * box-free routing channels between the box columns ("VC") and box rows ("HC").
 * Every arrow leg runs either on a port line (the line through an arrow's attachment
 * point on a box side) or on a track inside a channel. Routes are found by enumerating
 * leg sequences, then port and track orders are improved by local search on the real
 * number of crossings, and finally labels are placed greedily.
 */
import type { Role } from './ast.ts';
import type { Activity, ArrowSpec, BoxEnd, DiagramSpec, End, FrameEnd, FrameSide, Icom, Model } from './model.ts';
import { widestLine, wrapBalanced, wrapGreedy, type Measure } from './text.ts';

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = FrameSide;
export type Axis = 'h' | 'v';

export interface LayoutStyle {
  boxFont: number;
  contextBoxFont: number;
  labelFont: number;
  codeFont: number;
  numberFont: number;
  /** Line height as a multiple of the font size. */
  lineGap: number;
  minBoxW: number;
  maxBoxW: number;
  minBoxH: number;
  maxBoxH: number;
  boxPadX: number;
  boxPadY: number;
  /** Minimum distance between neighbouring arrows on a box side. */
  portGap: number;
  /** Minimum distance between neighbouring arrows in a channel. */
  trackGap: number;
  minInnerChannel: number;
  /** Minimum width of the left/right margins (room for input and output labels). */
  minEdgeV: number;
  /** Minimum height of the top/bottom margins (room for control and mechanism labels). */
  minEdgeH: number;
  /** Routing cost of one bend, in points of arrow length. */
  bendCost: number;
  /** Gap between an arrow and its label. */
  labelGap: number;
}

export const DEFAULT_STYLE: LayoutStyle = {
  boxFont: 10,
  contextBoxFont: 12,
  labelFont: 8,
  codeFont: 7,
  numberFont: 8,
  lineGap: 1.18,
  minBoxW: 96,
  maxBoxW: 150,
  minBoxH: 54,
  maxBoxH: 84,
  boxPadX: 7,
  boxPadY: 6,
  portGap: 13,
  trackGap: 10,
  minInnerChannel: 26,
  minEdgeV: 64,
  minEdgeH: 44,
  bendCost: 40,
  labelGap: 2.5,
};

export interface TextBlock {
  lines: string[];
  size: number;
  bold?: boolean;
  rect: Rect;
  align: 'left' | 'center' | 'right';
}

export interface BoxLayout {
  rect: Rect;
  activity: Activity;
  label: TextBlock;
  number: TextBlock;
  /** Detail reference written under the box when it is decomposed further. */
  detail?: TextBlock;
}

export interface ArrowHead {
  at: Pt;
  dx: number;
  dy: number;
}

/** Tunnel parentheses drawn around an arrow at `at`. */
export interface Tunnel {
  at: Pt;
  axis: Axis;
}

export interface ArrowLayout {
  id: number;
  label: string;
  /** One polyline per source/target pair; forks and joins share their common legs. */
  paths: Pt[][];
  heads: ArrowHead[];
  text?: TextBlock;
  /** Connector drawn when the label could not sit right next to its arrow. */
  squiggle?: [Pt, Pt];
  /** ICOM codes (I1, C2, ...) at boundary ends. */
  codes: TextBlock[];
  tunnels: Tunnel[];
}

export interface DiagramLayout {
  spec: DiagramSpec;
  /** Size of the content coordinate system. Draw it scaled by `scale` into the available area. */
  width: number;
  height: number;
  scale: number;
  boxes: BoxLayout[];
  arrows: ArrowLayout[];
  /** ICOM code of every arrow attached to every box, by its position on the box side. */
  icomCodes: Map<Icom, string>;
  /**
   * Position of each boundary arrow along its frame side (0 = top or left), by the parent ICOM it
   * continues. The diagram above can order the box's arrows the same way.
   */
  boundaryOrder: Map<Icom, number>;
  /** Number of arrow crossings left after optimisation. */
  crossings: number;
}

export interface LayoutOptions {
  measure: Measure;
  /** Available drawing area, in points. */
  width: number;
  height: number;
  /** ICOM codes of the detailed activity's arrows, from the layout of the diagram it appears on. */
  parentCodes?: Map<Icom, string>;
  /** Preferred position of box arrows along their side, kept where it costs no crossings. */
  preferredOrder?: Map<Icom, number>;
  /** Detail reference (e.g. a page number) to write under a box that has its own diagram. */
  detailRef?: (activity: Activity) => string | undefined;
  style?: Partial<LayoutStyle>;
}

export function layoutDiagram(spec: DiagramSpec, options: LayoutOptions): DiagramLayout {
  return new Layouter(spec, options).run();
}

export interface ModelLayoutOptions {
  measure: Measure;
  /** Available drawing area for a diagram, in points. */
  area: (spec: DiagramSpec) => { width: number; height: number };
  detailRef?: (activity: Activity) => string | undefined;
  style?: Partial<LayoutStyle>;
}

/**
 * Lays out every diagram of a model, in order. A decomposition gets the ICOM codes its activity
 * has on the diagram above it, so its boundary arrows are labelled to match.
 */
export function layoutModel(model: Model, options: ModelLayoutOptions): DiagramLayout[] {
  const run = (spec: DiagramSpec, parentCodes?: Map<Icom, string>, preferredOrder?: Map<Icom, number>) => {
    const { width, height } = options.area(spec);
    const { measure, detailRef, style } = options;
    return layoutDiagram(spec, { measure, width, height, parentCodes, preferredOrder, detailRef, style });
  };
  // First see how each decomposition orders its boundary arrows on its own, so that the diagram
  // above can attach them to the box in that order and the ICOM codes read in sequence.
  const natural = new Map<Activity, Map<Icom, number>>();
  for (const spec of model.diagrams) {
    if (spec.kind === 'decomposition') natural.set(spec.activity, run(spec).boundaryOrder);
  }
  const codesFor = new Map<Activity, Map<Icom, string>>();
  return model.diagrams.map((spec) => {
    const preferred = new Map<Icom, number>();
    for (const box of spec.boxes) for (const [icom, rank] of natural.get(box) ?? []) preferred.set(icom, rank);
    const layout = run(spec, spec.kind === 'decomposition' ? codesFor.get(spec.activity) : undefined, preferred);
    for (const box of spec.boxes) codesFor.set(box, layout.icomCodes);
    return layout;
  });
}

// ---------------------------------------------------------------------------------------------
// Geometry

interface Geom {
  n: number;
  W: number;
  H: number;
  L: number[];
  R: number[];
  T: number[];
  B: number[];
  vcLo: number[];
  vcHi: number[];
  hcLo: number[];
  hcHi: number[];
  width: number;
  height: number;
}

function buildGeom(n: number, W: number, H: number, vc: number[], hc: number[]): Geom {
  const g: Geom = { n, W, H, L: [], R: [], T: [], B: [], vcLo: [], vcHi: [], hcLo: [], hcHi: [], width: 0, height: 0 };
  let x = 0;
  for (let k = 0; k <= n; k++) {
    g.vcLo[k] = x;
    x += vc[k]!;
    g.vcHi[k] = x;
    if (k < n) {
      g.L[k] = x;
      x += W;
      g.R[k] = x;
    }
  }
  let y = 0;
  for (let k = 0; k <= n; k++) {
    g.hcLo[k] = y;
    y += hc[k]!;
    g.hcHi[k] = y;
    if (k < n) {
      g.T[k] = y;
      y += H;
      g.B[k] = y;
    }
  }
  g.width = x;
  g.height = y;
  return g;
}

/** Raises the smallest values to a common level so that they add up to `total`. */
function waterfill(mins: number[], total: number): number[] {
  const sumMin = mins.reduce((a, b) => a + b, 0);
  if (total <= sumMin) return mins.slice();
  let lo = 0;
  let hi = total;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const s = mins.reduce((a, m) => a + Math.max(m, mid), 0);
    if (s > total) hi = mid;
    else lo = mid;
  }
  const out = mins.map((m) => Math.max(m, lo));
  const rest = (total - out.reduce((a, b) => a + b, 0)) / out.length;
  return out.map((v) => v + rest);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------------------------
// Routing data

/** The line a leg runs on: a box port's line, or a track (one per arrow) in a channel. */
type LineRef = { kind: 'port'; port: number } | { kind: 'track'; axis: Axis; ch: number; arrow: number };

interface Port {
  id: number;
  box: number;
  side: Side;
  arrow: number;
  end: BoxEnd;
}

/** Where a route starts or ends: on a box side, or on the frame. */
interface Cap {
  frame: boolean;
  side: Side;
  box: number;
}

interface Pair {
  arrow: number;
  src: End;
  dst: End;
  start: Cap;
  end: Cap;
  lines: LineRef[];
}

interface Seg {
  arrow: number;
  axis: Axis;
  /** Constant coordinate: y for horizontal segments, x for vertical ones. */
  c: number;
  lo: number;
  hi: number;
}

const ROLE_SIDE: Record<Role, Side> = { input: 'left', control: 'top', output: 'right', mechanism: 'bottom' };
const SIDE_LETTER: Record<Side, string> = { left: 'I', top: 'C', right: 'O', bottom: 'M' };
const OUTWARD: Record<Side, [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

/** Routing cost of one pair of boundary arrows out of ICOM code order on a frame side (I2 above I1). */
const INVERSION_COST = 80;
/** Width beyond which boundary labels wrap anyway, so margins need not grow past it. */
const MAX_EDGE_LABEL = 120;

const flip = (a: Axis): Axis => (a === 'h' ? 'v' : 'h');
const sideAxis = (side: Side): Axis => (side === 'left' || side === 'right' ? 'h' : 'v');

/** Direction of travel when leaving a cap. */
function exitDir(cap: Cap): [number, number] {
  const [dx, dy] = OUTWARD[cap.side];
  return cap.frame ? [-dx, -dy] : [dx, dy];
}

/** Direction of travel when arriving at a cap. */
function arriveDir(cap: Cap): [number, number] {
  const [dx, dy] = exitDir(cap);
  return [-dx, -dy];
}

function sameLine(a: LineRef, b: LineRef): boolean {
  if (a.kind === 'port' || b.kind === 'port') return a.kind === b.kind && a.kind === 'port' && b.kind === 'port' && a.port === b.port;
  return a.axis === b.axis && a.ch === b.ch && a.arrow === b.arrow;
}

function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

function segHitsRect(s: Seg, r: Rect): boolean {
  if (s.axis === 'h') return s.c > r.y && s.c < r.y + r.h && s.hi > r.x && s.lo < r.x + r.w;
  return s.c > r.x && s.c < r.x + r.w && s.hi > r.y && s.lo < r.y + r.h;
}

export function countCrossings(segs: readonly Seg[]): number {
  const eps = 0.01;
  let count = 0;
  for (const h of segs) {
    if (h.axis !== 'h') continue;
    for (const v of segs) {
      if (v.axis !== 'v' || v.arrow === h.arrow) continue;
      if (v.c > h.lo + eps && v.c < h.hi - eps && h.c > v.lo + eps && h.c < v.hi - eps) count++;
    }
  }
  return count;
}

function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    const prev = out[out.length - 2];
    if (last && prev) {
      const collinear =
        (Math.abs(prev.x - last.x) < 1e-6 && Math.abs(last.x - p.x) < 1e-6) ||
        (Math.abs(prev.y - last.y) < 1e-6 && Math.abs(last.y - p.y) < 1e-6);
      if (collinear) out.pop();
    }
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

interface LabelVariant {
  lines: string[];
  w: number;
  h: number;
}

interface LabelCandidate {
  rect: Rect;
  lines: string[];
  score: number;
  squiggle?: [Pt, Pt];
}

class Layouter {
  private readonly spec: DiagramSpec;
  private readonly opts: LayoutOptions;
  private readonly style: LayoutStyle;
  private readonly measure: Measure;
  private readonly n: number;

  private readonly ports: Port[] = [];
  private readonly portOfEnd = new Map<BoxEnd, number>();
  /** `${box}:${side}` → port ids, in order along the side (top→bottom, left→right). */
  private readonly sides = new Map<string, number[]>();
  /** `${axis}${channel}` → arrow ids, in order across the channel. */
  private tracks = new Map<string, number[]>();
  private readonly pairs: Pair[] = [];

  private W = 0;
  private H = 0;
  private boxFont = 0;
  private boxLines: string[][] = [];
  private g!: Geom;
  private scale = 1;
  private portPos: number[] = [];
  private trackPos = new Map<string, number>();

  constructor(spec: DiagramSpec, opts: LayoutOptions) {
    this.spec = spec;
    this.opts = opts;
    this.style = { ...DEFAULT_STYLE, ...opts.style };
    this.measure = opts.measure;
    this.n = spec.boxes.length;
  }

  run(): DiagramLayout {
    this.collectPorts();
    this.sizeBoxes();

    // Route on a provisional geometry; routes are topological, so they stay valid when channels resize.
    const n = this.n;
    const edgeOr = (k: number, edge: number, inner: number) => (k === 0 || k === n ? edge : inner);
    this.fit(
      Array.from({ length: n + 1 }, (_, k) => edgeOr(k, this.style.minEdgeV, this.style.minInnerChannel)),
      Array.from({ length: n + 1 }, (_, k) => edgeOr(k, this.style.minEdgeH, this.style.minInnerChannel)),
    );
    this.computeCoords();
    for (const arrow of this.spec.arrows) this.routeArrow(arrow);
    this.repairCodeOrder();

    // Size channels for the tracks they carry, then lay out for real.
    const usage = new Map<string, Set<number>>();
    for (const pair of this.pairs) {
      for (const line of pair.lines) {
        if (line.kind !== 'track') continue;
        const key = `${line.axis}${line.ch}`;
        const set = usage.get(key) ?? new Set<number>();
        set.add(line.arrow);
        usage.set(key, set);
      }
    }
    this.tracks = new Map([...usage].map(([key, set]) => [key, [...set].sort((a, b) => a - b)]));
    const count = (key: string) => this.tracks.get(key)?.length ?? 0;
    const gap = this.style.trackGap;
    // Left and right margins hold the input and output labels on one line where possible.
    const edgeV = (side: Side) => Math.max(this.style.minEdgeV * 0.6, this.edgeLabelWidth(side) + 14);
    const vcMin = Array.from({ length: n + 1 }, (_, k) =>
      k === 0 || k === n
        ? Math.max(this.style.minEdgeV, count(`v${k}`) * gap + edgeV(k === 0 ? 'left' : 'right'))
        : Math.max(this.style.minInnerChannel, (count(`v${k}`) + 1) * gap),
    );
    const hcMin = Array.from({ length: n + 1 }, (_, k) =>
      k === 0 || k === n
        ? Math.max(this.style.minEdgeH, count(`h${k}`) * gap + this.style.minEdgeH * 0.6)
        : Math.max(this.style.minInnerChannel, (count(`h${k}`) + 1) * gap),
    );
    this.fit(vcMin, hcMin);

    this.computeCoords();
    this.orderPortsByDirection();
    const crossings = this.optimizeOrders();
    this.computeCoords();
    return this.assemble(crossings);
  }

  // -- ports and boxes ------------------------------------------------------------------------

  private collectPorts(): void {
    for (const arrow of this.spec.arrows) {
      for (const end of [...arrow.sources, ...arrow.targets]) {
        if (end.kind !== 'box') continue;
        const port: Port = { id: this.ports.length, box: end.box, side: ROLE_SIDE[end.role], arrow: arrow.id, end };
        this.ports.push(port);
        this.portOfEnd.set(end, port.id);
      }
    }
    // Initial order on each side: the preferred one where given, else the order of declaration.
    const rank = (p: Port) => this.opts.preferredOrder?.get(p.end.icom) ?? 1000 + p.end.icom.owner.icoms.indexOf(p.end.icom);
    for (const p of [...this.ports].sort((a, b) => rank(a) - rank(b))) {
      const key = `${p.box}:${p.side}`;
      const list = this.sides.get(key) ?? [];
      list.push(p.id);
      this.sides.set(key, list);
    }
  }

  private sideCount(box: number, side: Side): number {
    return this.sides.get(`${box}:${side}`)?.length ?? 0;
  }

  private sizeBoxes(): void {
    const s = this.style;
    const n = this.n;
    const context = this.spec.kind === 'context';
    this.boxFont = context ? s.contextBoxFont : s.boxFont;
    let W = context ? clamp(this.opts.width * 0.26, 170, 230) : clamp((this.opts.width * 0.6) / n, s.minBoxW, s.maxBoxW);
    let H = context ? clamp(this.opts.height * 0.28, 96, 130) : clamp((this.opts.height * 0.5) / n, s.minBoxH, s.maxBoxH);

    for (let b = 0; b < n; b++) {
      W = Math.max(W, (Math.max(this.sideCount(b, 'top'), this.sideCount(b, 'bottom')) + 1) * s.portGap);
      H = Math.max(H, (Math.max(this.sideCount(b, 'left'), this.sideCount(b, 'right')) + 1) * s.portGap);
      for (const word of this.spec.boxes[b]!.name.split(/\s+/)) {
        W = Math.max(W, this.measure(word, this.boxFont) + 2 * s.boxPadX);
      }
    }
    const lineH = this.boxFont * s.lineGap;
    this.boxLines = this.spec.boxes.map((a) => wrapBalanced(this.measure, a.name, this.boxFont, W - 2 * s.boxPadX));
    const maxLines = Math.max(...this.boxLines.map((l) => l.length));
    H = Math.max(H, maxLines * lineH + 2 * s.boxPadY + s.numberFont);
    this.W = W;
    this.H = H;
  }

  /** Builds the geometry, scaling the content down if the minimum sizes don't fit the area. */
  private fit(vcMin: number[], hcMin: number[]): void {
    const { n, W, H } = this;
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const scale = Math.min(1, this.opts.width / (n * W + sum(vcMin)), this.opts.height / (n * H + sum(hcMin)));
    const vw = this.opts.width / scale;
    const vh = this.opts.height / scale;
    this.g = buildGeom(n, W, H, waterfill(vcMin, vw - n * W), waterfill(hcMin, vh - n * H));
    this.scale = scale;
  }

  // -- coordinates ----------------------------------------------------------------------------

  private computeCoords(): void {
    const g = this.g;
    for (const list of this.sides.values()) {
      list.forEach((pid, idx) => {
        const p = this.ports[pid]!;
        this.portPos[pid] =
          sideAxis(p.side) === 'h'
            ? g.T[p.box]! + ((idx + 1) * g.H) / (list.length + 1)
            : g.L[p.box]! + ((idx + 1) * g.W) / (list.length + 1);
      });
    }
    this.trackPos.clear();
    for (const [key, list] of this.tracks) {
      const axis = key[0] as Axis;
      const ch = Number(key.slice(1));
      list.forEach((arrow, idx) => this.trackPos.set(`${key}:${arrow}`, this.trackCoord(axis, ch, idx, list.length)));
    }
  }

  /** Track position inside a channel. Margin channels keep their tracks close to the boxes. */
  private trackCoord(axis: Axis, ch: number, idx: number, count: number): number {
    const g = this.g;
    const lo = axis === 'v' ? g.vcLo[ch]! : g.hcLo[ch]!;
    const hi = axis === 'v' ? g.vcHi[ch]! : g.hcHi[ch]!;
    const width = hi - lo;
    const step = Math.min(this.style.trackGap, width / (count + 1));
    if (ch === 0) return hi - (count - idx) * step;
    if (ch === g.n) return lo + (idx + 1) * step;
    return lo + ((idx + 1) * width) / (count + 1);
  }

  private axisOf(line: LineRef): Axis {
    return line.kind === 'port' ? sideAxis(this.ports[line.port]!.side) : line.axis;
  }

  private lineValue(line: LineRef): number {
    if (line.kind === 'port') return this.portPos[line.port]!;
    return this.trackPos.get(`${line.axis}${line.ch}:${line.arrow}`) ?? this.trackCoord(line.axis, line.ch, 0, 1);
  }

  private capValue(cap: Cap): number {
    const g = this.g;
    if (cap.frame) {
      return cap.side === 'left' ? 0 : cap.side === 'right' ? g.width : cap.side === 'top' ? 0 : g.height;
    }
    const b = cap.box;
    return cap.side === 'left' ? g.L[b]! : cap.side === 'right' ? g.R[b]! : cap.side === 'top' ? g.T[b]! : g.B[b]!;
  }

  private capOf(end: End): Cap {
    return end.kind === 'box'
      ? { frame: false, side: ROLE_SIDE[end.role], box: end.box }
      : { frame: true, side: end.side, box: -1 };
  }

  private points(lines: readonly LineRef[], start: Cap, end: Cap): Pt[] {
    const pts: Pt[] = [];
    const first = lines[0]!;
    const c0 = this.capValue(start);
    pts.push(this.axisOf(first) === 'h' ? { x: c0, y: this.lineValue(first) } : { x: this.lineValue(first), y: c0 });
    for (let k = 1; k < lines.length; k++) {
      const a = lines[k - 1]!;
      const b = lines[k]!;
      pts.push(this.axisOf(a) === 'h' ? { x: this.lineValue(b), y: this.lineValue(a) } : { x: this.lineValue(a), y: this.lineValue(b) });
    }
    const last = lines[lines.length - 1]!;
    const c1 = this.capValue(end);
    pts.push(this.axisOf(last) === 'h' ? { x: c1, y: this.lineValue(last) } : { x: this.lineValue(last), y: c1 });
    return pts;
  }

  // -- routing --------------------------------------------------------------------------------

  private routeArrow(arrow: ArrowSpec): void {
    const pairs: [End, End][] = [];
    for (const s of arrow.sources) {
      for (const t of arrow.targets) {
        if (s.kind === 'frame' && t.kind === 'frame') continue;
        pairs.push([s, t]);
      }
    }
    const frameSource = arrow.sources.find((e) => e.kind === 'frame');
    const frameTarget = arrow.targets.find((e) => e.kind === 'frame');
    const trunkFirst = frameSource ? this.chooseTrunk(arrow.id, pairs.filter(([s]) => s === frameSource), 'first') : undefined;
    const trunkLast = frameTarget ? this.chooseTrunk(arrow.id, pairs.filter(([, t]) => t === frameTarget), 'last') : undefined;

    for (const [src, dst] of pairs) {
      const route = this.bestRoute(
        arrow.id,
        src,
        dst,
        src === frameSource ? trunkFirst : undefined,
        dst === frameTarget ? trunkLast : undefined,
      );
      if (!route) throw new Error(`internal error: no route for arrow "${arrow.label}" in ${this.spec.node}`);
      this.pairs.push({ arrow: arrow.id, src, dst, start: this.capOf(src), end: this.capOf(dst), lines: route.lines });
    }
  }

  /**
   * A boundary arrow enters the frame once, however many boxes it feeds (or leaves it once,
   * however many boxes produce it). Pick the shared frame line that is cheapest for all pairs.
   */
  private chooseTrunk(arrow: number, pairs: [End, End][], which: 'first' | 'last'): LineRef | undefined {
    if (pairs.length === 0) return undefined;
    const frame = which === 'first' ? pairs[0]![0] : pairs[0]![1];
    const candidates: LineRef[] = [];
    for (const [src, dst] of pairs) {
      for (const line of which === 'first' ? this.firstCandidates(arrow, src, dst) : this.lastCandidates(arrow, src, dst)) {
        if (!candidates.some((c) => sameLine(c, line))) candidates.push(line);
      }
    }
    let best: { line: LineRef; total: number } | undefined;
    for (const line of candidates) {
      // On a tie, enter the frame aimed straight at a box rather than along a channel.
      let total = this.inversionCost(arrow, frame, line) + (line.kind === 'port' ? 0 : 2);
      for (const [src, dst] of pairs) {
        if (best && total >= best.total) break;
        const r = which === 'first' ? this.bestRoute(arrow, src, dst, line) : this.bestRoute(arrow, src, dst, undefined, line);
        total += r ? r.cost : Infinity;
      }
      if (total < (best?.total ?? Infinity)) best = { line, total };
    }
    return best?.line;
  }

  /**
   * ICOM codes on the frame should read in order, like on the parent box: I1 above I2, C1 left
   * of C2. Boundary arrows that break the order get another route when that costs little.
   */
  private repairCodeOrder(): void {
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const arrow of this.spec.arrows) {
        const mine = this.pairs.filter((p) => p.arrow === arrow.id);
        const inverted = mine.some(
          (p) =>
            this.inversionCost(arrow.id, p.src, p.lines[0]!) > 0 ||
            this.inversionCost(arrow.id, p.dst, p.lines[p.lines.length - 1]!) > 0,
        );
        if (!inverted) continue;
        const before = JSON.stringify(mine.map((p) => p.lines));
        this.pairs.splice(0, this.pairs.length, ...this.pairs.filter((p) => p.arrow !== arrow.id));
        this.routeArrow(arrow);
        if (JSON.stringify(this.pairs.filter((p) => p.arrow === arrow.id).map((p) => p.lines)) !== before) changed = true;
      }
      if (!changed) break;
    }
  }

  /** Number of the parent's ICOM code at a frame end (2 for I2), if it has one. */
  private frameCode(end: End): number | undefined {
    if (end.kind !== 'frame' || !end.parentIcom) return undefined;
    const code = this.opts.parentCodes?.get(end.parentIcom);
    return code ? Number(code.slice(1)) : undefined;
  }

  /** Where the routed boundary arrows that continue a parent ICOM meet the frame. */
  private frameEnds(): { arrow: number; side: Side; icom: Icom; code?: number; at: number }[] {
    const out: { arrow: number; side: Side; icom: Icom; code?: number; at: number }[] = [];
    const seen = new Set<End>();
    for (const pair of this.pairs) {
      for (const [end, line] of [
        [pair.src, pair.lines[0]!],
        [pair.dst, pair.lines[pair.lines.length - 1]!],
      ] as const) {
        if (end.kind !== 'frame' || !end.parentIcom || seen.has(end)) continue;
        seen.add(end);
        out.push({ arrow: pair.arrow, side: end.side, icom: end.parentIcom, code: this.frameCode(end), at: this.lineValue(line) });
      }
    }
    return out;
  }

  /** Cost of the code-order inversions a frame end on `line` would make with the other arrows. */
  private inversionCost(arrow: number, end: End, line: LineRef): number {
    const code = this.frameCode(end);
    if (code === undefined || end.kind !== 'frame') return 0;
    const at = this.lineValue(line);
    let count = 0;
    for (const o of this.frameEnds()) {
      if (o.code === undefined || o.arrow === arrow || o.side !== end.side) continue;
      if ((o.code < code && o.at > at + 0.01) || (o.code > code && o.at < at - 0.01)) count++;
    }
    return count * INVERSION_COST;
  }

  /** Pairs of boundary arrows out of ICOM code order, over all frame sides. */
  private codeInversions(): number {
    const ends = this.frameEnds().filter((e) => e.code !== undefined);
    let count = 0;
    for (const a of ends) {
      for (const b of ends) if (a.side === b.side && a.code! < b.code! && a.at > b.at + 0.01) count++;
    }
    return count;
  }

  /** Pairs of arrows on a box side out of the preferred order. */
  private preferenceInversions(): number {
    const pref = this.opts.preferredOrder;
    if (!pref || pref.size === 0) return 0;
    let count = 0;
    for (const list of this.sides.values()) {
      const ranks = list.map((pid) => pref.get(this.ports[pid]!.end.icom));
      for (let i = 0; i < ranks.length; i++) {
        for (let j = i + 1; j < ranks.length; j++) {
          if (ranks[i] !== undefined && ranks[j] !== undefined && ranks[i]! > ranks[j]!) count++;
        }
      }
    }
    return count;
  }

  /** Widest label of the boundary arrows on a frame side, up to the width where labels wrap. */
  private edgeLabelWidth(side: Side): number {
    let w = 0;
    for (const a of this.spec.arrows) {
      if (![...a.sources, ...a.targets].some((e) => e.kind === 'frame' && e.side === side)) continue;
      w = Math.max(w, Math.min(this.labelVariants(a.label)[0]!.w, MAX_EDGE_LABEL));
    }
    return w;
  }

  private firstCandidates(arrow: number, src: End, dst: End): LineRef[] {
    if (src.kind === 'box') return [{ kind: 'port', port: this.portOfEnd.get(src)! }];
    const axis = sideAxis(src.side);
    const out: LineRef[] = [];
    if (dst.kind === 'box') {
      const port = this.portOfEnd.get(dst)!;
      if (sideAxis(this.ports[port]!.side) === axis) out.push({ kind: 'port', port });
    }
    for (let ch = 0; ch <= this.n; ch++) out.push({ kind: 'track', axis, ch, arrow });
    return out;
  }

  private lastCandidates(arrow: number, src: End, dst: End): LineRef[] {
    if (dst.kind === 'box') return [{ kind: 'port', port: this.portOfEnd.get(dst)! }];
    const axis = sideAxis(dst.side);
    const out: LineRef[] = [];
    if (src.kind === 'box') {
      const port = this.portOfEnd.get(src)!;
      if (sideAxis(this.ports[port]!.side) === axis) out.push({ kind: 'port', port });
    }
    for (let ch = 0; ch <= this.n; ch++) out.push({ kind: 'track', axis, ch, arrow });
    return out;
  }

  /** Cheapest valid route from `src` to `dst` with at most four bends. */
  private bestRoute(
    arrow: number,
    src: End,
    dst: End,
    fixedFirst?: LineRef,
    fixedLast?: LineRef,
  ): { lines: LineRef[]; cost: number } | null {
    const start = this.capOf(src);
    const end = this.capOf(dst);
    const firsts = fixedFirst ? [fixedFirst] : this.firstCandidates(arrow, src, dst);
    const lasts = fixedLast ? [fixedLast] : this.lastCandidates(arrow, src, dst);
    const channels = this.n + 1;
    let best: { lines: LineRef[]; cost: number } | null = null;

    const consider = (lines: LineRef[]) => {
      const cost = this.routeCost(lines, start, end, dst);
      if (cost < (best?.cost ?? Infinity)) best = { lines, cost };
    };

    for (const first of firsts) {
      const fa = this.axisOf(first);
      for (const last of lasts) {
        const la = this.axisOf(last);
        for (let legs = 1; legs <= 5; legs++) {
          if (((legs - 1) % 2 === 0 ? fa : flip(fa)) !== la) continue;
          if (legs === 1) {
            if (sameLine(first, last)) consider([first]);
            continue;
          }
          const mids = legs - 2;
          const combos = channels ** mids;
          for (let c = 0; c < combos; c++) {
            const lines: LineRef[] = [first];
            let rest = c;
            for (let t = 1; t <= mids; t++) {
              lines.push({ kind: 'track', axis: t % 2 === 0 ? fa : flip(fa), ch: rest % channels, arrow });
              rest = Math.floor(rest / channels);
            }
            lines.push(last);
            consider(lines);
          }
        }
      }
    }
    return best;
  }

  private routeCost(lines: LineRef[], start: Cap, end: Cap, dst: End): number {
    const pts = this.points(lines, start, end);
    const m = pts.length - 1;
    const [ex, ey] = exitDir(start);
    const [ax, ay] = arriveDir(end);
    const dirOk = (a: Pt, b: Pt, dx: number, dy: number) => Math.sign(b.x - a.x) === dx && Math.sign(b.y - a.y) === dy;
    if (!dirOk(pts[0]!, pts[1]!, ex, ey) || !dirOk(pts[m - 1]!, pts[m]!, ax, ay)) return Infinity;

    const g = this.g;
    let length = 0;
    let penalty = 0;
    for (let k = 0; k < m; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (len < 1) return Infinity;
      length += len;
      for (let box = 0; box < this.n; box++) if (this.legHitsBox(a, b, box)) return Infinity;
      // IDEF0 convention: feedback to a control goes over the top, feedback to an input or mechanism underneath.
      if (this.axisOf(lines[k]!) === 'h' && b.x < a.x && dst.kind === 'box') {
        const wrongSide = dst.role === 'control' ? a.y > g.T[dst.box]! : a.y < g.B[dst.box]!;
        if (wrongSide) penalty += 300;
      }
    }
    const lastLeg = Math.abs(pts[m]!.x - pts[m - 1]!.x) + Math.abs(pts[m]!.y - pts[m - 1]!.y);
    return (lines.length - 1) * this.style.bendCost + length + penalty + 0.01 * lastLeg;
  }

  private legHitsBox(a: Pt, b: Pt, box: number): boolean {
    const g = this.g;
    const L = g.L[box]! + 0.5;
    const R = g.R[box]! - 0.5;
    const T = g.T[box]! + 0.5;
    const B = g.B[box]! - 0.5;
    if (a.y === b.y) {
      if (a.y <= T || a.y >= B) return false;
      return Math.min(a.x, b.x) < R && Math.max(a.x, b.x) > L;
    }
    if (a.x <= L || a.x >= R) return false;
    return Math.min(a.y, b.y) < B && Math.max(a.y, b.y) > T;
  }

  // -- ordering -------------------------------------------------------------------------------

  /**
   * Initial port order from where each arrow comes from or goes to, so that nested routes
   * don't cross (e.g. on the top side: arrows arriving from the left, then straight ones,
   * then arrows arriving from the right).
   */
  private orderPortsByDirection(): void {
    const keys = new Map<number, [number, number]>();
    for (const pair of this.pairs) {
      const pts = this.points(pair.lines, pair.start, pair.end);
      const m = pts.length - 1;
      if (pair.src.kind === 'box') {
        const pid = this.portOfEnd.get(pair.src)!;
        if (!keys.has(pid)) {
          if (m < 2) keys.set(pid, [1, 0]);
          else keys.set(pid, pts[2]!.y < pts[1]!.y ? [0, pts[1]!.x] : [2, -pts[1]!.x]);
        }
      }
      if (pair.dst.kind === 'box') {
        const pid = this.portOfEnd.get(pair.dst)!;
        if (keys.has(pid)) continue;
        if (m < 2) {
          keys.set(pid, [1, 0]);
          continue;
        }
        const a = pts[m - 2]!;
        const b = pts[m - 1]!;
        switch (this.ports[pid]!.side) {
          case 'left':
            keys.set(pid, a.y < b.y ? [0, -b.x] : [2, b.x]);
            break;
          case 'top':
            keys.set(pid, a.x < b.x ? [0, -b.y] : [2, b.y]);
            break;
          case 'bottom':
            keys.set(pid, a.x < b.x ? [0, b.y] : [2, -b.y]);
            break;
          default:
            break;
        }
      }
    }
    for (const list of this.sides.values()) {
      list.sort((p, q) => {
        const a = keys.get(p) ?? [1, 0];
        const b = keys.get(q) ?? [1, 0];
        return a[0] - b[0] || a[1] - b[1];
      });
    }
  }

  /**
   * Local search over port and track orders, minimising crossings, then arrows out of order: ICOM
   * codes on the frame, and box arrows against the order their decomposition prefers. Returns the
   * crossings left.
   */
  private optimizeOrders(): number {
    const lists = [...this.sides.values(), ...this.tracks.values()].filter((l) => l.length > 1);
    const evaluate = () => {
      this.computeCoords();
      return countCrossings(this.mergedSegments()) * 1000 + this.codeInversions() + this.preferenceInversions();
    };
    let best = evaluate();
    for (let pass = 0; pass < 6 && best > 0; pass++) {
      let improved = false;
      for (const list of lists) {
        for (let i = 0; i < list.length; i++) {
          for (let j = 0; j < list.length; j++) {
            if (i === j) continue;
            const [item] = list.splice(i, 1);
            list.splice(j, 0, item!);
            const value = evaluate();
            if (value < best) {
              best = value;
              improved = true;
            } else {
              list.splice(j, 1);
              list.splice(i, 0, item!);
            }
          }
        }
      }
      if (!improved) break;
    }
    return Math.floor(best / 1000);
  }

  /** All drawn segments, with overlapping legs of the same arrow (fork trunks) merged. */
  private mergedSegments(): Seg[] {
    const byArrow = new Map<number, Seg[]>();
    for (const pair of this.pairs) {
      const pts = this.points(pair.lines, pair.start, pair.end);
      const list = byArrow.get(pair.arrow) ?? [];
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k]!;
        const b = pts[k + 1]!;
        list.push(
          a.y === b.y
            ? { arrow: pair.arrow, axis: 'h', c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) }
            : { arrow: pair.arrow, axis: 'v', c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) },
        );
      }
      byArrow.set(pair.arrow, list);
    }
    const out: Seg[] = [];
    for (const segs of byArrow.values()) {
      segs.sort((s, t) => (s.axis === t.axis ? 0 : s.axis === 'h' ? -1 : 1) || s.c - t.c || s.lo - t.lo);
      let cur: Seg | undefined;
      for (const s of segs) {
        if (cur && cur.axis === s.axis && Math.abs(cur.c - s.c) < 1e-6 && s.lo <= cur.hi + 1e-6) {
          cur.hi = Math.max(cur.hi, s.hi);
        } else {
          if (cur) out.push(cur);
          cur = { ...s };
        }
      }
      if (cur) out.push(cur);
    }
    return out;
  }

  // -- output ---------------------------------------------------------------------------------

  private assemble(crossings: number): DiagramLayout {
    const s = this.style;
    const g = this.g;
    const obstacles: Rect[] = [];

    const boxes: BoxLayout[] = this.spec.boxes.map((activity, b) => {
      const rect = { x: g.L[b]!, y: g.T[b]!, w: g.W, h: g.H };
      const lines = this.boxLines[b]!;
      const lh = this.boxFont * s.lineGap;
      const textH = lines.length * lh;
      const label: TextBlock = {
        lines,
        size: this.boxFont,
        rect: { x: rect.x + s.boxPadX, y: rect.y + (rect.h - textH) / 2, w: rect.w - 2 * s.boxPadX, h: textH },
        align: 'center',
      };
      const numberText = activity.number;
      const nw = this.measure(numberText, s.numberFont);
      const number: TextBlock = {
        lines: [numberText],
        size: s.numberFont,
        rect: { x: rect.x + rect.w - nw - 3, y: rect.y + rect.h - s.numberFont * s.lineGap - 1.5, w: nw, h: s.numberFont * s.lineGap },
        align: 'right',
      };
      const box: BoxLayout = { rect, activity, label, number };
      const ref = activity.children.length > 0 ? this.opts.detailRef?.(activity) : undefined;
      if (ref) {
        const w = this.measure(ref, s.codeFont);
        box.detail = {
          lines: [ref],
          size: s.codeFont,
          rect: { x: rect.x + rect.w - w, y: rect.y + rect.h + 1.5, w, h: s.codeFont * s.lineGap },
          align: 'right',
        };
        obstacles.push(box.detail.rect);
      }
      obstacles.push(inflate(rect, 3));
      return box;
    });

    const arrows: ArrowLayout[] = this.spec.arrows.map((spec) => {
      const pairs = this.pairs.filter((p) => p.arrow === spec.id);
      const layout: ArrowLayout = { id: spec.id, label: spec.label, paths: [], heads: [], codes: [], tunnels: [] };
      const seenTargets = new Set<End>();
      const seenSources = new Set<End>();
      for (const pair of pairs) {
        const pts = simplify(this.points(pair.lines, pair.start, pair.end));
        layout.paths.push(pts);
        const m = pts.length - 1;
        if (!seenTargets.has(pair.dst)) {
          seenTargets.add(pair.dst);
          const a = pts[m - 1]!;
          const b = pts[m]!;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const head: ArrowHead = { at: b, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
          layout.heads.push(head);
          obstacles.push({ x: b.x - 6, y: b.y - 6, w: 12, h: 12 });
          this.endDecorations(layout, pair.dst, b, head.dx, head.dy, true, obstacles);
        }
        if (!seenSources.has(pair.src)) {
          seenSources.add(pair.src);
          const a = pts[0]!;
          const b = pts[1]!;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          this.endDecorations(layout, pair.src, a, (b.x - a.x) / len, (b.y - a.y) / len, false, obstacles);
        }
      }
      return layout;
    });

    this.placeLabels(arrows, obstacles);

    const icomCodes = new Map<Icom, string>();
    for (const list of this.sides.values()) {
      list.forEach((pid, idx) => {
        const p = this.ports[pid]!;
        icomCodes.set(p.end.icom, `${SIDE_LETTER[p.side]}${idx + 1}`);
      });
    }

    const boundaryOrder = new Map<Icom, number>();
    const ends = this.frameEnds().sort((a, b) => a.at - b.at);
    for (const side of ['left', 'top', 'right', 'bottom'] as const) {
      ends.filter((e) => e.side === side).forEach((e, i) => boundaryOrder.set(e.icom, i));
    }

    return { spec: this.spec, width: g.width, height: g.height, scale: this.scale, boxes, arrows, icomCodes, boundaryOrder, crossings };
  }

  /**
   * ICOM codes and tunnel parentheses at an arrow end. `(dx, dy)` is the direction of travel
   * at that end; `atTarget` tells whether the arrow arrives (true) or departs (false) there.
   */
  private endDecorations(layout: ArrowLayout, end: End, at: Pt, dx: number, dy: number, atTarget: boolean, obstacles: Rect[]): void {
    const s = this.style;
    // Unit vector pointing from the end into the diagram, along the arrow.
    const ix = atTarget ? -dx : dx;
    const iy = atTarget ? -dy : dy;
    const axis: Axis = dx !== 0 ? 'h' : 'v';
    if (end.kind === 'frame') {
      const frame = end as FrameEnd;
      const code = frame.parentIcom ? this.opts.parentCodes?.get(frame.parentIcom) : undefined;
      if (code) {
        const w = this.measure(code, s.codeFont);
        const h = s.codeFont * s.lineGap;
        const rect =
          axis === 'h'
            ? { x: frame.side === 'left' ? at.x + 3 : at.x - 3 - w, y: at.y + 2, w, h }
            : { x: at.x - 3 - w, y: frame.side === 'top' ? at.y + 3 : at.y - 3 - h, w, h };
        layout.codes.push({ lines: [code], size: s.codeFont, rect, align: 'left' });
        obstacles.push(rect);
      }
      if (frame.tunnel) {
        const p = { x: at.x + ix * 10, y: at.y + iy * 10 };
        layout.tunnels.push({ at: p, axis });
        obstacles.push({ x: p.x - 6, y: p.y - 6, w: 12, h: 12 });
      }
    } else if (end.tunnel) {
      const offset = atTarget ? 14 : 9;
      const p = { x: at.x + ix * offset, y: at.y + iy * offset };
      layout.tunnels.push({ at: p, axis });
      obstacles.push({ x: p.x - 6, y: p.y - 6, w: 12, h: 12 });
    }
  }

  // -- labels ---------------------------------------------------------------------------------

  private labelVariants(label: string): LabelVariant[] {
    const fs = this.style.labelFont;
    const lh = fs * this.style.lineGap;
    const seen = new Set<string>();
    const out: LabelVariant[] = [];
    const add = (lines: string[]) => {
      const key = lines.join('\n');
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ lines, w: widestLine(this.measure, lines, fs), h: lines.length * lh });
    };
    add(wrapGreedy(this.measure, label, fs, Infinity));
    for (const width of [120, 84, 58]) add(wrapBalanced(this.measure, label, fs, width));
    return out;
  }

  /** The point a label should stay close to: the frame end of boundary arrows, else the source. */
  private labelAnchor(spec: ArrowSpec, layout: ArrowLayout): Pt {
    const pairs = this.pairs.filter((p) => p.arrow === spec.id);
    const fromFrame = pairs.find((p) => p.src.kind === 'frame');
    if (fromFrame) return layout.paths[pairs.indexOf(fromFrame)]![0]!;
    const toFrame = pairs.find((p) => p.dst.kind === 'frame');
    if (toFrame) {
      const path = layout.paths[pairs.indexOf(toFrame)]!;
      return path[path.length - 1]!;
    }
    return layout.paths[0]![0]!;
  }

  private placeLabels(arrows: ArrowLayout[], obstacles: Rect[]): void {
    const s = this.style;
    const g = this.g;
    const segs = this.mergedSegments();
    const placed: Rect[] = [];
    const bounds: Rect = { x: 1, y: 1, w: g.width - 2, h: g.height - 2 };
    const within = (r: Rect) => r.x >= bounds.x && r.y >= bounds.y && r.x + r.w <= bounds.x + bounds.w && r.y + r.h <= bounds.y + bounds.h;
    const isBoundary = (a: ArrowSpec) => [...a.sources, ...a.targets].some((e) => e.kind === 'frame');
    const order = [...this.spec.arrows].sort((a, b) => Number(isBoundary(b)) - Number(isBoundary(a)) || a.id - b.id);

    for (const spec of order) {
      const layout = arrows[spec.id]!;
      const anchor = this.labelAnchor(spec, layout);
      const own = segs.filter((x) => x.arrow === spec.id);
      let best: LabelCandidate | undefined;
      let fallback: LabelCandidate | undefined;

      this.labelVariants(spec.label).forEach((variant, vi) => {
        for (const seg of own) {
          for (const cand of this.labelCandidates(seg, variant)) {
            if (!within(cand.rect)) continue;
            const blocked =
              obstacles.some((o) => rectsOverlap(o, cand.rect)) || placed.some((o) => rectsOverlap(o, cand.rect, 1.5));
            const crossings = segs.filter((x) => x !== seg && segHitsRect(x, cand.rect)).length;
            // A label hugging another arrow's line reads as that arrow's label.
            const halo = inflate(cand.rect, 4);
            const near = segs.filter((x) => x.arrow !== spec.id && !segHitsRect(x, cand.rect) && segHitsRect(x, halo)).length;
            const attach = cand.attach;
            const score =
              cand.penalty + vi * 5 + crossings * 60 + near * 25 + Math.hypot(attach.x - anchor.x, attach.y - anchor.y) * 0.12;
            const full: LabelCandidate = { rect: cand.rect, lines: variant.lines, score, squiggle: cand.squiggle };
            if (blocked) {
              const overlap = full.score + 1000;
              if (!fallback || overlap < fallback.score) fallback = { ...full, score: overlap };
            } else if (!best || score < best.score) {
              best = full;
            }
          }
        }
      });

      const chosen = best ?? fallback;
      if (!chosen) continue;
      placed.push(chosen.rect);
      layout.text = { lines: chosen.lines, size: s.labelFont, rect: chosen.rect, align: 'left' };
      if (chosen.squiggle) layout.squiggle = chosen.squiggle;
    }
  }

  /** Label positions alongside a segment: right next to it, or a little away with a squiggle. */
  private labelCandidates(seg: Seg, v: LabelVariant): { rect: Rect; attach: Pt; penalty: number; squiggle?: [Pt, Pt] }[] {
    const out: { rect: Rect; attach: Pt; penalty: number; squiggle?: [Pt, Pt] }[] = [];
    const gap = this.style.labelGap;
    const along = (lo: number, hi: number, size: number): number[] => {
      const first = lo + 3;
      const last = hi - 3 - size;
      if (last < first) return [(lo + hi - size) / 2];
      const steps = Math.max(1, Math.ceil((last - first) / 6));
      return Array.from({ length: steps + 1 }, (_, i) => first + ((last - first) * i) / steps);
    };
    if (seg.axis === 'h') {
      for (const x of along(seg.lo, seg.hi, v.w)) {
        const attach = { x: clamp(x + v.w / 2, seg.lo, seg.hi), y: seg.c };
        out.push({ rect: { x, y: seg.c - gap - v.h, w: v.w, h: v.h }, attach, penalty: 0 });
        out.push({ rect: { x, y: seg.c + gap, w: v.w, h: v.h }, attach, penalty: 4 });
        for (const d of [12, 22]) {
          const px = clamp(x - 4, seg.lo + 2, seg.hi - 2);
          out.push({
            rect: { x, y: seg.c - d - v.h, w: v.w, h: v.h },
            attach,
            penalty: 30 + d,
            squiggle: [{ x: px, y: seg.c }, { x: x + 2, y: seg.c - d + 0.5 }],
          });
          out.push({
            rect: { x, y: seg.c + d, w: v.w, h: v.h },
            attach,
            penalty: 34 + d,
            squiggle: [{ x: px, y: seg.c }, { x: x + 2, y: seg.c + d - 0.5 }],
          });
        }
      }
    } else {
      for (const y of along(seg.lo, seg.hi, v.h)) {
        const attach = { x: seg.c, y: clamp(y + v.h / 2, seg.lo, seg.hi) };
        out.push({ rect: { x: seg.c + gap, y, w: v.w, h: v.h }, attach, penalty: 0 });
        out.push({ rect: { x: seg.c - gap - v.w, y, w: v.w, h: v.h }, attach, penalty: 4 });
        for (const d of [12, 22]) {
          const py = clamp(y + v.h / 2, seg.lo + 2, seg.hi - 2);
          out.push({
            rect: { x: seg.c + d, y, w: v.w, h: v.h },
            attach,
            penalty: 30 + d,
            squiggle: [{ x: seg.c, y: py }, { x: seg.c + d - 0.5, y: y + v.h / 2 }],
          });
          out.push({
            rect: { x: seg.c - d - v.w, y, w: v.w, h: v.h },
            attach,
            penalty: 34 + d,
            squiggle: [{ x: seg.c, y: py }, { x: seg.c - d + 0.5, y: y + v.h / 2 }],
          });
        }
      }
    }
    return out;
  }
}
