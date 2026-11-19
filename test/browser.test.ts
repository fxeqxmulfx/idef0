import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { compile } from '../src/browser.ts';
import { EXAMPLE } from './helpers.ts';

const DEJAVU = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const RUSSIAN = 'activity "Испечь хлеб" { input "Мука"; control "Рецепт"; output "Хлеб" }';

/** What each module reachable from `entry` imports, by module URL. */
function importsFrom(entry: URL, seen = new Map<string, string[]>()): Map<string, string[]> {
  if (seen.has(entry.href)) return seen;
  const text = readFileSync(entry, 'utf8');
  const specifiers = [...text.matchAll(/^(?:import|export)\s[^'"]*?from\s+'([^']+)'/gm)].map((m) => m[1]!);
  seen.set(entry.href, specifiers);
  for (const s of specifiers) if (s.startsWith('.')) importsFrom(new URL(s, entry), seen);
  return seen;
}

describe('browser build', () => {
  it('loads no Node modules', () => {
    const modules = importsFrom(new URL('../src/browser.ts', import.meta.url));
    assert.ok(modules.size > 5);
    for (const [file, specifiers] of modules) {
      for (const s of specifiers) assert.ok(!s.startsWith('node:'), `${file} imports ${s}`);
    }
  });

  it('returns the PDF as bytes', async () => {
    const { pdf, layouts } = await compile(EXAMPLE);
    assert.equal(Object.getPrototypeOf(pdf), Uint8Array.prototype);
    assert.equal(new TextDecoder().decode(pdf.subarray(0, 5)), '%PDF-');
    assert.equal(layouts.length, 3);
  });

  it('asks for a Unicode font when the text needs one', async () => {
    await assert.rejects(compile(RUSSIAN), /pass a Unicode font in `fonts`/);
  });

  it('embeds a font given as bytes', { skip: existsSync(DEJAVU) ? false : 'DejaVu Sans is not installed here' }, async () => {
    const bytes = new Uint8Array(readFileSync(DEJAVU));
    const { pdf } = await compile(RUSSIAN, { fonts: { regular: bytes, bold: bytes } });
    assert.match(new TextDecoder('latin1').decode(pdf), /\/BaseFont \/[A-Z]{6}\+DejaVuSans\b/);
  });
});
