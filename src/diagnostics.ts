/** Source positions and error reporting shared by the parser and the model checker. */

export interface Span {
  /** 0-based character offset into the source. */
  offset: number;
  length: number;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
}

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  message: string;
  span?: Span;
  hint?: string;
}

/** Thrown when a model cannot be compiled. Carries every diagnostic found, warnings included. */
export class Idef0Error extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    const errors = diagnostics.filter((d) => d.severity === 'error');
    const first = errors[0] ?? diagnostics[0];
    const more = errors.length > 1 ? ` (and ${errors.length - 1} more error${errors.length > 2 ? 's' : ''})` : '';
    super((first ? first.message : 'invalid IDEF0 model') + more);
    this.name = 'Idef0Error';
    this.diagnostics = diagnostics;
  }
}

export function error(message: string, span?: Span, hint?: string): Diagnostic {
  return { severity: 'error', message, span, hint };
}

export function warning(message: string, span?: Span, hint?: string): Diagnostic {
  return { severity: 'warning', message, span, hint };
}

/** Span covering `a` through the end of `b`. */
export function joinSpans(a: Span, b: Span): Span {
  return { ...a, length: b.offset + b.length - a.offset };
}

/**
 * Formats a diagnostic the way compilers do:
 *
 *     model.idef0:12:9: error: "Raw Material" has no source
 *       12 |   input "Raw Material"
 *          |         ^^^^^^^^^^^^^^
 *        = hint: did you mean "Raw Materials"?
 */
export function formatDiagnostic(d: Diagnostic, source: string | undefined, file: string): string {
  const where = d.span ? `${file}:${d.span.line}:${d.span.column}` : file;
  let out = `${where}: ${d.severity}: ${d.message}`;
  if (d.span && source !== undefined) {
    const text = (source.split(/\r?\n/)[d.span.line - 1] ?? '').replace(/\t/g, ' ');
    const gutter = String(d.span.line);
    const pad = ' '.repeat(gutter.length);
    const start = d.span.column - 1;
    const width = Math.max(1, Math.min(d.span.length, text.length - start));
    out += `\n  ${gutter} | ${text}\n  ${pad} | ${' '.repeat(start)}${'^'.repeat(width)}`;
  }
  if (d.hint) out += `\n  = hint: ${d.hint}`;
  return out;
}
