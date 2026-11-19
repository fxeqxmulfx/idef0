import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyze, type Activity, type DiagramSpec } from '../src/model.ts';
import { parse } from '../src/parser.ts';
import { diagnosticsOf, EXAMPLE, findError } from './helpers.ts';

const check = (source: string) => analyze(parse(source));
const errorsOf = (source: string) => diagnosticsOf(() => check(source));

/** A well-formed three-box decomposition to vary in tests. */
function model(children: string, parentExtra = ''): string {
  return `
    activity "Run Shop" {
      input "Order"
      control "Policy"
      output "Goods"
      mechanism "Staff"
      ${parentExtra}
      ${children}
    }`;
}

const THREE = `
  activity "Plan"  { input "Order"; control "Policy"; output "Plan"; mechanism "Staff" }
  activity "Build" { input "Plan"; control "Policy"; output "Parts"; mechanism "Staff" }
  activity "Ship"  { input "Parts"; control "Policy"; output "Goods"; mechanism "Staff" }`;

function arrow(diagram: DiagramSpec, label: string) {
  const found = diagram.arrows.find((a) => a.label === label);
  assert.ok(found, `no arrow "${label}" in ${diagram.node}`);
  return found;
}

describe('model', () => {
  it('numbers nodes by nesting and lists diagrams in node order', () => {
    const { model, warnings } = check(EXAMPLE);
    assert.deepEqual(warnings, []);
    const nodes: string[] = [];
    const walk = (a: Activity) => {
      nodes.push(a.node);
      a.children.forEach(walk);
    };
    walk(model.top);
    assert.deepEqual(nodes, ['A0', 'A1', 'A2', 'A3', 'A31', 'A32', 'A33', 'A4']);
    assert.deepEqual(
      model.diagrams.map((d) => `${d.node}:${d.kind}`),
      ['A-0:context', 'A0:decomposition', 'A3:decomposition'],
    );
    assert.equal(model.meta.status, 'draft');
    assert.equal(model.meta.page, 'A4');
  });

  it('joins arrows by label and connects boundary arrows to the parent ICOMs', () => {
    const a0 = check(EXAMPLE).model.diagrams[1]!;
    const order = arrow(a0, 'Customer Order');
    assert.equal(order.sources.length, 1);
    const [src] = order.sources;
    assert.ok(src!.kind === 'frame' && src.side === 'left' && src.parentIcom?.label === 'Customer Order');
    assert.deepEqual(
      order.targets.map((t) => (t.kind === 'box' ? `${t.box}:${t.role}` : 'frame')),
      ['0:input', '3:control'],
    );
    // Box-to-box arrows have no frame end.
    const drawings = arrow(a0, 'Drawings');
    assert.deepEqual(
      [...drawings.sources, ...drawings.targets].map((e) => e.kind),
      ['box', 'box'],
    );
  });

  it('brings tunneled child arrows in from the frame without a parent ICOM', () => {
    const a3 = check(EXAMPLE).model.diagrams[2]!;
    for (const label of ['Finish Spec', 'Spray Booth']) {
      const [src] = arrow(a3, label).sources;
      assert.ok(src!.kind === 'frame' && src.tunnel && src.parentIcom === null, label);
    }
  });

  it('matches labels ignoring case and spacing, and warns when the spelling differs', () => {
    const { model: m, warnings } = check(model(THREE.replace('input "Plan"', 'input "PLAN  "')));
    const plan = arrow(m.diagrams[1]!, 'Plan');
    assert.equal(plan.sources.length, 1);
    assert.equal(plan.targets.length, 1);
    assert.deepEqual(
      warnings.map((w) => w.message),
      ['"PLAN" and "Plan" in A0 are taken as the same arrow, labelled "Plan"'],
    );
    // A forced line break is only layout, not a different spelling.
    assert.deepEqual(check(model(THREE.replace('input "Plan"', 'input "Pl\\nan"').replace(/"Plan"/g, '"Pl an"'))).warnings, []);
  });

  it('reports a parent ICOM no sub-activity uses, and offers to tunnel it', () => {
    const d = findError(errorsOf(model(THREE, 'control "Audit Rules"')), 'none of its sub-activities uses it');
    assert.match(d.message, /A0 "Run Shop" has a control "Audit Rules"/);
    assert.match(d.hint ?? '', /control \("Audit Rules"\)/);
  });

  it('accepts a tunneled parent ICOM that the decomposition leaves out, and marks the box end', () => {
    const { model: m } = check(model(THREE, 'control ("Audit Rules")'));
    const context = m.diagrams[0]!;
    const [end] = arrow(context, 'Audit Rules').targets;
    assert.ok(end!.kind === 'box' && end.tunnel, 'box end should be tunneled on A-0');
    assert.equal(m.diagrams[1]!.arrows.some((a) => a.label === 'Audit Rules'), false);
  });

  it('suggests a near-miss label when an input has no source', () => {
    const d = findError(errorsOf(model(THREE.replace('input "Plan"', 'input "Plann"'))), 'has no source');
    assert.equal(d.hint, 'did you mean "Plan"?');
    const out = findError(errorsOf(model(THREE.replace('input "Plan"', 'input "Plann"'))), 'goes nowhere');
    assert.match(out.message, /output "Plan" of A1 "Plan"/);
  });

  it('rejects an arrow on two sides of one box', () => {
    const d = findError(errorsOf('activity "A" { input "X"; control "X"; output "Y" }'), 'both an input and a control');
    assert.equal(d.hint, 'an arrow attaches to one side of a box only');
    assert.match(findError(errorsOf('activity "A" { input "X", "X"; output "Y" }'), 'listed twice').message, /input/);
  });

  it('checks explicit node numbers against the tree', () => {
    const d = findError(errorsOf(model(THREE.replace('activity "Build"', 'activity A3 "Build"'))), 'is numbered A3');
    assert.match(d.message, /makes it A2/);
  });

  it('rejects a second top activity and unknown settings', () => {
    findError(errorsOf('activity "A" { output "x" }\nactivity "B" { output "y" }'), 'exactly one top activity');
    const status = findError(errorsOf('status drafft\nactivity "A" { output "x" }'), 'unknown status');
    assert.match(status.hint ?? '', /did you mean 'draft'/);
    findError(errorsOf('page B5\nactivity "A" { output "x" }'), 'unknown page size');
    findError(errorsOf('title "a"\ntitle "b"\nactivity "A" { output "x" }'), "'title' is set more than once");
  });

  it('warns about missing controls, odd box counts and feedback into the same box', () => {
    const { warnings } = check(`
      activity "Top" {
        input "In"; control "C"; output "Out"
        activity "Only" { input "In", "Out"; output "Out"; mechanism "C" }
      }`);
    const messages = warnings.map((w) => w.message);
    assert.ok(messages.some((m) => m.includes('A1 "Only" has no control')), messages.join('\n'));
    assert.ok(messages.some((m) => m.includes('decomposed into 1 activity')), messages.join('\n'));
    assert.ok(messages.some((m) => m.includes('feedback loop')), messages.join('\n'));
  });

  it('returns every error at once, warnings included', () => {
    const diagnostics = errorsOf(model(THREE.replace('input "Plan"', 'input "Plann"'), 'control "Unused"'));
    assert.ok(diagnostics.filter((d) => d.severity === 'error').length >= 3);
  });
});
