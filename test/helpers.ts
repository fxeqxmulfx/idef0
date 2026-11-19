import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Idef0Error, type Diagnostic } from '../src/diagnostics.ts';
import type { Measure } from '../src/text.ts';

export const EXAMPLE = readFileSync(new URL('../examples/workshop.idef0', import.meta.url), 'utf8');

/** Rough Helvetica-like text width, good enough to lay diagrams out without a PDF document. */
export const measure: Measure = (text, size, bold = false) => text.length * size * (bold ? 0.6 : 0.52);

/** Runs `fn`, expects it to throw an Idef0Error, and returns that error's diagnostics. */
export function diagnosticsOf(fn: () => unknown): Diagnostic[] {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof Idef0Error, `expected an Idef0Error, got ${String(e)}`);
    return e.diagnostics;
  }
  assert.fail('expected an Idef0Error, but nothing was thrown');
}

/** The single error among `diagnostics` whose message contains `text`. */
export function findError(diagnostics: readonly Diagnostic[], text: string): Diagnostic {
  const found = diagnostics.filter((d) => d.severity === 'error' && d.message.includes(text));
  assert.equal(found.length, 1, `expected one error containing "${text}", got:\n${diagnostics.map((d) => d.message).join('\n')}`);
  return found[0]!;
}
