import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDiagnostic } from '../src/diagnostics.ts';
import { tokenize } from '../src/lexer.ts';
import { parse } from '../src/parser.ts';
import { diagnosticsOf, EXAMPLE, findError } from './helpers.ts';

describe('lexer', () => {
  it('skips all three comment styles', () => {
    const kinds = tokenize('a # one\nb // two\n/* three\n */ c').map((t) => t.text);
    assert.deepEqual(kinds, ['a', 'b', 'c', '']);
  });

  it('keeps forced line breaks and turns tabs into spaces', () => {
    const [t] = tokenize('"Bill of\\nMaterials\tand \\"quoted\\" \\\\"');
    assert.equal(t!.kind, 'string');
    assert.equal(t!.text, 'Bill of\nMaterials and "quoted" \\');
  });

  it('records line and column of each token', () => {
    const tokens = tokenize('title "x"\n  activity');
    assert.deepEqual(
      tokens.map((t) => [t.text, t.span.line, t.span.column]),
      [
        ['title', 1, 1],
        ['x', 1, 7],
        ['activity', 2, 3],
        ['', 2, 11],
      ],
    );
  });

  it('reports a missing closing quote on the line where it is missing', () => {
    const [d] = diagnosticsOf(() => tokenize('title "Custom\nactivity "A" { }'));
    assert.match(d!.message, /unterminated string/);
    assert.equal(d!.span?.line, 1);
    assert.equal(d!.span?.column, 7);
    assert.match(d!.hint ?? '', /\\n for a line break/);
    assert.equal(diagnosticsOf(() => tokenize('"open'))[0]!.span?.column, 1);
  });

  it('rejects unknown escapes', () => {
    const [d] = diagnosticsOf(() => tokenize('"a\\qb"'));
    assert.match(d!.message, /\\q/);
  });
});

describe('parser', () => {
  it('parses settings and the activity tree of the example', () => {
    const doc = parse(EXAMPLE);
    assert.deepEqual(
      doc.meta.map((m) => m.key),
      ['title', 'author', 'project', 'date', 'rev', 'status', 'purpose', 'viewpoint'],
    );
    assert.equal(doc.activities.length, 1);
    const top = doc.activities[0]!;
    assert.equal(top.name, 'Make Custom Furniture');
    assert.deepEqual(
      top.children.map((c) => c.name),
      ['Design Piece', 'Prepare Materials', 'Assemble and Finish', 'Deliver and Bill'],
    );
    assert.equal(top.children[2]!.children.length, 3);
  });

  it('accepts short role keywords and unquoted single-word labels', () => {
    const doc = parse('activity Work { I Order; C Rules, "Budget"; O Product; M Staff }');
    const roles = doc.activities[0]!.icoms.map((i) => `${i.role}:${i.label}`);
    assert.deepEqual(roles, ['input:Order', 'control:Rules', 'control:Budget', 'output:Product', 'mechanism:Staff']);
  });

  it('marks parenthesised labels as tunneled', () => {
    const doc = parse('activity "A" { control "Plain", ("Hidden") }');
    assert.deepEqual(
      doc.activities[0]!.icoms.map((i) => [i.label, i.tunneled]),
      [
        ['Plain', false],
        ['Hidden', true],
      ],
    );
  });

  it('takes an explicit node number only when a name follows it', () => {
    const numbered = parse('activity A0 "Run" { activity A1 "Plan" }').activities[0]!;
    assert.equal(numbered.node, 'A0');
    assert.equal(numbered.children[0]!.node, 'A1');
    const named = parse('activity A1').activities[0]!;
    assert.equal(named.node, undefined);
    assert.equal(named.name, 'A1');
  });

  it('suggests the keyword a typo was meant to be', () => {
    const diagnostics = diagnosticsOf(() => parse('activity "A" {\n  contrl "Rules"\n}'));
    const d = findError(diagnostics, "found 'contrl'");
    assert.equal(d.hint, "did you mean 'control'?");
    assert.equal(d.span?.line, 2);
  });

  it('explains a missing comma between labels', () => {
    const [d] = diagnosticsOf(() => parse('activity "A" { input "One" "Two" }'));
    assert.match(d!.hint ?? '', /separate several labels with commas/);
  });

  it('reports a missing closing brace at the opening one', () => {
    const [d] = diagnosticsOf(() => parse('activity "A" {\n  input "x"\n'));
    assert.match(d!.message, /missing '}' to close activity "A"/);
    assert.equal(d!.span?.line, 1);
  });

  it('rejects role keywords outside an activity, including look-alike object keys', () => {
    assert.match(diagnosticsOf(() => parse('input "x"'))[0]!.message, /'input' must be inside an activity/);
    assert.match(diagnosticsOf(() => parse('constructor "x"'))[0]!.message, /expected a setting/);
  });

  it('formats a diagnostic with a code frame and the hint', () => {
    const source = 'activity "A" {\n  contrl "Rules"\n}';
    const [d] = diagnosticsOf(() => parse(source));
    const text = formatDiagnostic(d!, source, 'model.idef0');
    assert.match(text, /^model\.idef0:2:3: error: /);
    assert.match(text, /contrl "Rules"\n\s+\| +\^{6}/);
    assert.match(text, /= hint: did you mean 'control'\?/);
  });
});
