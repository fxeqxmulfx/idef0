import { error, Idef0Error, type Span } from './diagnostics.ts';

export type TokenKind = 'word' | 'string' | '{' | '}' | '(' | ')' | ',' | ';' | 'eof';

export interface Token {
  kind: TokenKind;
  /** For strings: the unescaped value. For everything else: the raw text. */
  text: string;
  span: Span;
}

const PUNCTUATION = new Set(['{', '}', '(', ')', ',', ';']);

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === '﻿' || c === ' ';
}

/**
 * Splits source text into tokens.
 *
 * - `// ...`, `# ...` and `/* ... *\/` are comments.
 * - `"..."` is a string; `\n` inside it forces a line break in the rendered label,
 *   `\"` and `\\` escape themselves. A string must end on the line it starts on.
 * - Any other run of non-space, non-punctuation characters is a word (`A0`, `draft`, `Materials`).
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const mark = () => ({ offset: i, line, column: i - lineStart + 1 });
  const close = (start: { offset: number; line: number; column: number }): Span => ({ ...start, length: i - start.offset });
  const fail = (message: string, span: Span, hint?: string): never => {
    throw new Idef0Error([error(message, span, hint)]);
  };
  /** Advances over one character, tracking line breaks. */
  const step = () => {
    if (src[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
    i++;
  };

  while (i < src.length) {
    const c = src[i]!;
    if (isSpace(c)) {
      step();
      continue;
    }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const start = mark();
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) step();
      if (i >= src.length) fail('unterminated block comment', { ...start, length: 2 });
      i += 2;
      continue;
    }

    const start = mark();
    if (PUNCTUATION.has(c)) {
      i++;
      tokens.push({ kind: c as TokenKind, text: c, span: close(start) });
      continue;
    }

    if (c === '"') {
      i++;
      let value = '';
      for (;;) {
        const d = src[i];
        // Strings end on their own line, so a missing quote is reported where it is missing.
        if (d === undefined || d === '\n' || d === '\r') {
          fail('unterminated string: missing closing "', { ...start, length: 1 }, 'a string must end on the line it starts on; write \\n for a line break inside a label');
        }
        if (d === '"') {
          i++;
          break;
        }
        if (d === '\\') {
          const e = src[i + 1];
          if (e === 'n') value += '\n';
          else if (e === 't') value += ' ';
          else if (e === '"' || e === '\\') value += e;
          else {
            const at = mark();
            fail(`unknown escape sequence "\\${e ?? ''}" (use \\n, \\" or \\\\)`, { ...at, length: 2 });
          }
          i += 2;
          continue;
        }
        value += d === '\t' ? ' ' : d;
        i++;
      }
      tokens.push({ kind: 'string', text: value, span: close(start) });
      continue;
    }

    while (
      i < src.length &&
      !isSpace(src[i]!) &&
      !PUNCTUATION.has(src[i]!) &&
      src[i] !== '"' &&
      !(src[i] === '/' && (src[i + 1] === '/' || src[i + 1] === '*'))
    ) {
      i++;
    }
    tokens.push({ kind: 'word', text: src.slice(start.offset, i), span: close(start) });
  }

  tokens.push({ kind: 'eof', text: '', span: { ...mark(), length: 0 } });
  return tokens;
}
