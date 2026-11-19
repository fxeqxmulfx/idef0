import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, compile, Idef0Error } from '../src/index.ts';
import { EXAMPLE } from './helpers.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const EXAMPLE_FILE = fileURLToPath(new URL('../examples/workshop.idef0', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'idef0-test-'));
const DEJAVU = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const noDejaVu = existsSync(DEJAVU) ? false : 'DejaVu Sans is not installed here';
after(() => rmSync(work, { recursive: true, force: true }));

/** Pages in a PDF: page objects, not the /Pages tree node. */
const pageCount = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;

function cli(...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: work });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('compile', () => {
  it('renders one PDF page per diagram', async () => {
    const result = await compile(EXAMPLE);
    assert.equal(result.pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(pageCount(result.pdf), 3);
    assert.equal(result.layouts.length, 3);
    assert.deepEqual(result.warnings, []);
    const text = result.pdf.toString('latin1');
    // Bookmarks and named destinations let readers jump between levels.
    for (const node of ['A-0', 'A0', 'A3']) assert.ok(text.includes(`(${node})`), `destination ${node}`);
  });

  it('honours the page size option', async () => {
    const { pdf } = await compile(EXAMPLE, { page: 'A3' });
    assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 1190\.55\d* 841\.89\d*\]/);
  });

  it('accepts an AST built in code', async () => {
    const { model } = await compile({
      meta: [{ key: 'title', value: 'Coded' }],
      activities: [
        {
          name: 'Brew Tea',
          icoms: [
            { role: 'input', label: 'Water', tunneled: false },
            { role: 'output', label: 'Tea', tunneled: false },
            { role: 'control', label: 'Recipe', tunneled: false },
          ],
          children: [],
        },
      ],
    });
    assert.equal(model.meta.title, 'Coded');
    assert.equal(model.diagrams.length, 1);
  });

  it('throws an Idef0Error carrying every diagnostic', async () => {
    await assert.rejects(compile('activity "A" { input "x" }\nactivity "B"'), (e: unknown) => {
      assert.ok(e instanceof Idef0Error);
      assert.match(e.message, /exactly one top activity/);
      return true;
    });
  });

  it('checks without rendering', () => {
    assert.equal(check(EXAMPLE).model.diagrams.length, 3);
  });

  it('switches to an embedded Unicode font for text Helvetica cannot show', { skip: noDejaVu }, async () => {
    const { pdf } = await compile('activity "Испечь хлеб" { input "Мука"; control "Рецепт"; output "Хлеб" }');
    const text = pdf.toString('latin1');
    assert.match(text, /\/BaseFont \/[A-Z]{6}\+DejaVuSans\b/);
    assert.doesNotMatch(text, /\/BaseFont \/Helvetica/);
  });

  it('uses Helvetica when it can show every character', async () => {
    const { pdf } = await compile('activity "Café crème" { input "Lait"; control "Recette"; output "Café" }');
    assert.match(pdf.toString('latin1'), /\/BaseFont \/Helvetica\b/);
  });
});

describe('cli', () => {
  it('writes the PDF next to the input by default', () => {
    const input = join(work, 'model.idef0');
    writeFileSync(input, EXAMPLE);
    const r = cli(input);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /wrote .*model\.pdf \(3 diagrams\)/);
    assert.equal(pageCount(readFileSync(join(work, 'model.pdf'))), 3);
  });

  it('checks a model without writing anything', () => {
    const r = cli('--check', EXAMPLE_FILE);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /ok, 3 diagrams/);
  });

  it('prints diagnostics with a code frame and exits 1 on errors', () => {
    const input = join(work, 'broken.idef0');
    writeFileSync(input, 'activity "A" {\n  inptu "x"\n}\n');
    const r = cli(input, '-o', join(work, 'broken.pdf'));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /broken\.idef0:2:3: error: expected input, control, output, mechanism or activity, found 'inptu'/);
    assert.match(r.stderr, /= hint: did you mean 'input'\?/);
  });

  it('finds a font named in the model next to the model file', { skip: noDejaVu }, () => {
    const dir = join(work, 'fonted');
    mkdirSync(join(dir, 'fonts'), { recursive: true });
    copyFileSync(DEJAVU, join(dir, 'fonts', 'Body.ttf'));
    writeFileSync(join(dir, 'm.idef0'), 'font "fonts/Body.ttf"\nactivity "Bake" { input "Flour"; control "Recipe"; output "Bread" }\n');
    const r = cli(join(dir, 'm.idef0'));
    assert.equal(r.code, 0, r.stderr);
    assert.match(readFileSync(join(dir, 'm.pdf')).toString('latin1'), /\/BaseFont \/[A-Z]{6}\+DejaVuSans\b/);
    const missing = cli(join(dir, 'm.idef0'), '--font', 'nope.ttf');
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /font file not found: nope\.ttf/);
  });

  it('rejects bad usage with exit code 2', () => {
    assert.equal(cli().code, 2);
    const r = cli(EXAMPLE_FILE, '--page', 'B5');
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown page size "B5"/);
  });

  it('reports a missing file', () => {
    const r = cli(join(work, 'nope.idef0'));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cannot read .*nope\.idef0: ENOENT/);
  });

  it('prints help and version', () => {
    assert.match(cli('--help').stdout, /^Usage: idef0 <model\.idef0>/);
    assert.match(cli('-v').stdout, /^\d+\.\d+\.\d+\n$/);
  });
});
