import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutModel, type DiagramLayout, type Pt, type Rect } from '../src/layout.ts';
import { analyze, type Activity, type Model } from '../src/model.ts';
import { parse } from '../src/parser.ts';
import { EXAMPLE, measure } from './helpers.ts';

type Side = 'left' | 'right' | 'top' | 'bottom';

const EPS = 0.01;
/** Diagram area of an A4 page with the IDEF0 form. */
const A4_AREA = { width: 798, height: 467 };
const SIDE_OF_ROLE = { input: 'left', control: 'top', output: 'right', mechanism: 'bottom' } as const;
const LETTER = { input: 'I', control: 'C', output: 'O', mechanism: 'M' } as const;
/** Direction of travel into a box (or into the diagram) through each side. */
const INWARD: Record<Side, [number, number]> = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] };

function layout(source: string, area = A4_AREA): { model: Model; layouts: DiagramLayout[] } {
  const { model } = analyze(parse(source));
  return { model, layouts: layoutModel(model, { measure, area: () => area }) };
}

const sgn = (v: number) => (v > EPS ? 1 : v < -EPS ? -1 : 0);
const dir = (a: Pt, b: Pt) => [sgn(b.x - a.x), sgn(b.y - a.y)];
const key = (p: Pt) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

function sideOf(p: Pt, r: Rect): Side | undefined {
  const inX = p.x > r.x + EPS && p.x < r.x + r.w - EPS;
  const inY = p.y > r.y + EPS && p.y < r.y + r.h - EPS;
  if (inY && Math.abs(p.x - r.x) < EPS) return 'left';
  if (inY && Math.abs(p.x - (r.x + r.w)) < EPS) return 'right';
  if (inX && Math.abs(p.y - r.y) < EPS) return 'top';
  if (inX && Math.abs(p.y - (r.y + r.h)) < EPS) return 'bottom';
  return undefined;
}

function frameSide(p: Pt, l: DiagramLayout): Side | undefined {
  if (Math.abs(p.x) < EPS) return 'left';
  if (Math.abs(p.x - l.width) < EPS) return 'right';
  if (Math.abs(p.y) < EPS) return 'top';
  if (Math.abs(p.y - l.height) < EPS) return 'bottom';
  return undefined;
}

function throughBox(a: Pt, b: Pt, r: Rect): boolean {
  const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return x0 < r.x + r.w - 0.5 && x1 > r.x + 0.5 && y0 < r.y + r.h - 0.5 && y1 > r.y + 0.5;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Checks what every IDEF0 diagram must satisfy: orthogonal arrows inside the frame that never cross
 * a box, outputs leaving right sides, inputs/controls/mechanisms entering left/top/bottom sides,
 * one port per ICOM, codes I1..In per side, and boundary codes matching the parent diagram.
 */
function checkDiagram(l: DiagramLayout, parentCodes?: Map<unknown, string>, opts = { labels: true }): void {
  const node = l.spec.node;
  const rects = l.boxes.map((b) => b.rect);
  const ports = new Map<string, Set<string>>();
  const note = (box: number, side: Side, p: Pt) => {
    const k = `${box}:${side}`;
    ports.set(k, (ports.get(k) ?? new Set()).add(key(p)));
  };

  for (const arrow of l.arrows) {
    const name = `${node} "${arrow.label}"`;
    assert.ok(arrow.paths.length > 0, `${name} has no path`);
    for (const path of arrow.paths) {
      assert.ok(path.length >= 2, `${name} has a path with one point`);
      for (const p of path) {
        assert.ok(p.x > -EPS && p.x < l.width + EPS && p.y > -EPS && p.y < l.height + EPS, `${name} leaves the frame`);
      }
      for (let k = 1; k < path.length; k++) {
        const [a, b] = [path[k - 1]!, path[k]!];
        assert.ok((Math.abs(a.x - b.x) < EPS) !== (Math.abs(a.y - b.y) < EPS), `${name} has a diagonal or empty leg`);
        rects.forEach((r, i) => assert.ok(!throughBox(a, b, r), `${name} runs through box ${i + 1}`));
      }

      const [p0, p1] = [path[0]!, path[1]!];
      const from = rects.findIndex((r) => sideOf(p0, r));
      if (from >= 0) {
        assert.equal(sideOf(p0, rects[from]!), 'right', `${name} leaves box ${from + 1} elsewhere than its output side`);
        assert.deepEqual(dir(p0, p1), [1, 0], `${name} leaves box ${from + 1} sideways`);
        note(from, 'right', p0);
      } else {
        const side = frameSide(p0, l);
        assert.ok(side && side !== 'right', `${name} starts in mid-air at ${key(p0)}`);
        assert.deepEqual(dir(p0, p1), INWARD[side], `${name} enters the diagram sideways`);
      }

      const [q1, q0] = [path[path.length - 2]!, path[path.length - 1]!];
      const to = rects.findIndex((r) => sideOf(q0, r));
      if (to >= 0) {
        const side = sideOf(q0, rects[to]!)!;
        assert.notEqual(side, 'right', `${name} enters box ${to + 1} on its output side`);
        assert.deepEqual(dir(q1, q0), INWARD[side], `${name} enters box ${to + 1} sideways`);
        note(to, side, q0);
      } else {
        assert.equal(frameSide(q0, l), 'right', `${name} ends in mid-air at ${key(q0)}`);
        assert.deepEqual(dir(q1, q0), [1, 0], `${name} leaves the diagram sideways`);
      }
    }
    const targets = new Set(arrow.paths.map((p) => key(p[p.length - 1]!)));
    assert.equal(arrow.heads.length, targets.size, `${name} needs one arrowhead per target`);

    if (opts.labels) {
      assert.ok(arrow.text, `${name} has no label`);
      const t = arrow.text.rect;
      assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= l.width && t.y + t.h <= l.height, `${name} label is outside the frame`);
      rects.forEach((r, i) => assert.ok(!overlaps(t, r), `${name} label covers box ${i + 1}`));
    }
  }

  l.boxes.forEach((box, b) => {
    for (const role of ['input', 'control', 'output', 'mechanism'] as const) {
      const icoms = box.activity.icoms.filter((i) => i.role === role);
      const where = `${node} box ${box.activity.node} ${role}s`;
      assert.equal(ports.get(`${b}:${SIDE_OF_ROLE[role]}`)?.size ?? 0, icoms.length, where);
      const codes = icoms.map((i) => l.icomCodes.get(i)).sort();
      assert.deepEqual(codes, icoms.map((_, k) => `${LETTER[role]}${k + 1}`).sort(), `${where}: codes`);
    }
  });

  if (parentCodes) {
    for (const [i, spec] of l.spec.arrows.entries()) {
      const expected: (string | undefined)[] = [];
      for (const e of [...spec.sources, ...spec.targets]) {
        if (e.kind === 'frame' && e.parentIcom) expected.push(parentCodes.get(e.parentIcom));
      }
      assert.deepEqual(l.arrows[i]!.codes.map((c) => c.lines[0]).sort(), expected.sort(), `${node} "${spec.label}" codes`);
    }
  }
}

/** Checks every diagram, each decomposition against the codes of the diagram above it. */
function checkAll(layouts: DiagramLayout[], opts?: { labels: boolean }): void {
  const codesOf = new Map<Activity, Map<unknown, string>>();
  for (const l of layouts) {
    checkDiagram(l, l.spec.kind === 'decomposition' ? codesOf.get(l.spec.activity) : undefined, opts);
    for (const box of l.spec.boxes) codesOf.set(box, l.icomCodes);
  }
}

const SIX = `
  activity "Run Project" {
    input "Request"
    control "Budget", "Standards"
    output "Product", "Report"
    mechanism "Team", "Tools"
    activity "Scope"   { input "Request", "Lessons"; control "Budget"; output "Scope"; mechanism "Team" }
    activity "Design"  { input "Scope"; control "Standards", "Review Notes"; output "Design"; mechanism "Team", "Tools" }
    activity "Build"   { input "Design"; control "Standards"; output "Build"; mechanism "Team", "Tools" }
    activity "Test"    { input "Build"; control "Standards"; output "Defects", "Tested Build"; mechanism "Tools" }
    activity "Review"  { input "Defects"; control "Budget"; output "Review Notes", "Lessons"; mechanism "Team" }
    activity "Release" { input "Tested Build"; control "Budget"; output "Product", "Report"; mechanism "Team" }
  }`;

describe('layout', () => {
  it('keeps every diagram of the example well-formed', () => {
    const { layouts } = layout(EXAMPLE);
    assert.equal(layouts.length, 3);
    checkAll(layouts);
  });

  it('lays out six boxes with feedback loops and shared resources', () => {
    const { layouts } = layout(SIX);
    checkAll(layouts);
    assert.equal(layouts[1]!.boxes.length, 6);
  });

  it('handles a single-box decomposition, crowded sides and long labels', () => {
    checkAll(
      layout(`
        activity "Assemble Bicycle" {
          input "Frame", "Wheels", "Seat", "Handlebars", "Chain", "Pedals"
          control "Specification of the customer's custom build"
          output "Bicycle"
          mechanism "Fitter"
          activity "Fit Everything" {
            input "Frame", "Wheels", "Seat", "Handlebars", "Chain", "Pedals"
            control "Specification of the customer's custom build"
            output "Bicycle"
            mechanism "Fitter"
          }
        }`).layouts,
    );
  });

  it('scales a diagram down instead of letting it overflow a small page', () => {
    const { layouts } = layout(SIX, { width: 300, height: 200 });
    const a0 = layouts[1]!;
    assert.ok(a0.scale < 1, `scale ${a0.scale}`);
    assert.ok(Math.abs(a0.width * a0.scale - 300) < 0.5 && Math.abs(a0.height * a0.scale - 200) < 0.5);
    checkAll(layouts, { labels: false });
  });

  it('reads ICOM codes in order along each frame side when that costs no crossings', () => {
    for (const source of [EXAMPLE, SIX]) {
      for (const l of layout(source).layouts) {
        const codes = l.arrows.flatMap((a) => a.codes.map((c) => ({ code: c.lines[0]!, rect: c.rect })));
        for (const letter of ['I', 'C', 'O', 'M']) {
          const along = codes
            .filter((c) => c.code[0] === letter)
            .sort((a, b) => (letter === 'I' || letter === 'O' ? a.rect.y - b.rect.y : a.rect.x - b.rect.x))
            .map((c) => c.code);
          assert.deepEqual(along, [...along].sort(), `${l.spec.node}: ${letter} codes along the frame`);
        }
      }
    }
  });

  it('is deterministic', () => {
    const strip = (ls: DiagramLayout[]) => JSON.stringify(ls.map((l) => ({ boxes: l.boxes.map((b) => b.rect), arrows: l.arrows })));
    assert.equal(strip(layout(SIX).layouts), strip(layout(SIX).layouts));
  });
});
