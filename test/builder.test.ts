import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActivityDecl, DocumentAst } from '../src/ast.ts';
import { activity, model, toSource, tunnel } from '../src/builder.ts';
import { formatDiagnostic } from '../src/diagnostics.ts';
import { check, compile } from '../src/index.ts';
import { parse } from '../src/parser.ts';
import { diagnosticsOf, EXAMPLE } from './helpers.ts';

/** The workshop example, built in code. */
const workshop = model(
  {
    title: 'Custom Furniture Workshop',
    author: 'M. Petrov',
    project: 'Workshop process model',
    date: '2026-11-18',
    rev: '1',
    status: 'draft',
    purpose: 'Show how a customer order becomes delivered furniture, to find where rework and delays come from.',
    viewpoint: 'Workshop manager',
  },
  activity(
    'Make Custom Furniture',
    {
      input: ['Customer Order', 'Raw Timber'],
      control: ['Building Codes', 'Budget'],
      output: ['Delivered Furniture', 'Invoice', 'Offcuts'],
      mechanism: ['Carpenters', 'Workshop Tools'],
    },
    [
      activity('Design Piece', {
        input: 'Customer Order',
        control: ['Building Codes', 'Change Request'],
        output: ['Drawings', 'Cut List'],
        mechanism: 'Carpenters',
      }),
      activity('Prepare Materials', {
        input: 'Raw Timber',
        control: ['Cut List', 'Budget'],
        output: ['Cut Parts', 'Offcuts'],
        mechanism: 'Workshop Tools',
      }),
      activity(
        'Assemble and Finish',
        {
          input: 'Cut Parts',
          control: 'Drawings',
          output: ['Finished Piece', 'Change Request'],
          mechanism: ['Carpenters', 'Workshop Tools'],
        },
        [
          activity('Assemble Frame', {
            input: 'Cut Parts',
            control: ['Drawings', 'Rework Notes'],
            output: 'Frame',
            mechanism: ['Carpenters', 'Workshop Tools'],
          }),
          activity('Sand and Finish', {
            input: 'Frame',
            control: ['Drawings', tunnel('Finish Spec')],
            output: 'Finished Frame',
            mechanism: ['Carpenters', tunnel('Spray Booth')],
          }),
          activity('Inspect', {
            input: 'Finished Frame',
            control: 'Drawings',
            output: ['Finished Piece', 'Rework Notes', 'Change Request'],
            mechanism: 'Carpenters',
          }),
        ],
      ),
      activity('Deliver and Bill', {
        input: 'Finished Piece',
        control: 'Customer Order',
        output: ['Delivered Furniture', 'Invoice'],
        mechanism: 'Carpenters',
      }),
    ],
  ),
);

/** The AST without source positions. */
function bare(doc: DocumentAst): unknown {
  const act = (a: ActivityDecl): unknown => ({
    ...(a.node ? { node: a.node } : {}),
    name: a.name,
    icoms: a.icoms.map(({ role, label, tunneled }) => ({ role, label, tunneled })),
    children: a.children.map(act),
  });
  return { meta: doc.meta.map(({ key, value }) => ({ key, value })), activities: doc.activities.map(act) };
}

describe('builder', () => {
  it('builds the same model as the DSL', () => {
    assert.deepEqual(bare(workshop), bare(parse(EXAMPLE)));
  });

  it('compiles a built model', async () => {
    const { pdf, model: m, warnings } = await compile(workshop);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(m.diagrams.length, 3);
    assert.deepEqual(warnings, []);
  });

  it('reports problems without source positions', () => {
    const doc = model({}, activity('Top', { input: 'A', output: 'B', control: 'C' }, [activity('Only', { input: 'X', output: 'B', control: 'C' })]));
    const diagnostics = diagnosticsOf(() => check(doc));
    const text = diagnostics.map((d) => formatDiagnostic(d, undefined, 'model')).join('\n');
    assert.match(text, /^model: error: A0 "Top" has an input "A", but none of its sub-activities uses it$/m);
    assert.match(text, /^model: error: input "X" of A1 "Only" has no source/m);
  });
});

describe('toSource', () => {
  it('writes source that parses back to the same model', () => {
    const source = toSource(parse(EXAMPLE));
    assert.deepEqual(bare(parse(source)), bare(parse(EXAMPLE)));
    assert.deepEqual(bare(parse(toSource(workshop))), bare(workshop));
  });

  it('writes settings aligned, statuses bare and tunnels in parentheses', () => {
    const source = toSource(
      model(
        { title: 'Say "hi"', status: 'draft', font: 'C:\\Fonts\\a.ttf' },
        activity('Greet', { input: 'Name', control: tunnel('Etiquette'), output: 'Greeting\nCard' }),
      ),
    );
    assert.equal(
      source,
      [
        'title  "Say \\"hi\\""',
        'status draft',
        'font   "C:\\\\Fonts\\\\a.ttf"',
        '',
        'activity "Greet" {',
        '  input   "Name"',
        '  control ("Etiquette")',
        '  output  "Greeting\\nCard"',
        '}',
        '',
      ].join('\n'),
    );
    const [top] = parse(source).activities;
    assert.equal(top!.icoms[2]!.label, 'Greeting\nCard');
  });

  it('keeps explicit node numbers and leaves out empty bodies', () => {
    const doc = parse('activity A0 "Top" { activity A1 "Leaf" }');
    assert.equal(toSource(doc), 'activity A0 "Top" {\n  activity A1 "Leaf"\n}\n');
  });
});
