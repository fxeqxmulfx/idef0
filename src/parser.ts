import type { ActivityDecl, DocumentAst, IcomDecl, MetaDecl, Role } from './ast.ts';
import { error, Idef0Error, joinSpans, type Span } from './diagnostics.ts';
import { tokenize, type Token } from './lexer.ts';
import { closest } from './util.ts';

/** Keywords that start an arrow list inside an activity, with their long and short spellings. */
export const ROLE_KEYWORDS: Readonly<Record<string, Role>> = {
  input: 'input',
  inputs: 'input',
  in: 'input',
  I: 'input',
  control: 'control',
  controls: 'control',
  ctrl: 'control',
  C: 'control',
  output: 'output',
  outputs: 'output',
  out: 'output',
  O: 'output',
  mechanism: 'mechanism',
  mechanisms: 'mechanism',
  mech: 'mechanism',
  M: 'mechanism',
};

export const ACTIVITY_KEYWORDS: readonly string[] = ['activity', 'function'];

export const META_KEYS: readonly string[] = [
  'title',
  'author',
  'project',
  'date',
  'rev',
  'status',
  'purpose',
  'viewpoint',
  'page',
  'font',
];

const NODE_NUMBER = /^A\d+$/;

/**
 * Parses IDEF0 DSL source into an AST.
 *
 * ```
 * title  "Manufacturing"
 * author "J. Smith"
 *
 * activity "Manufacture Product" {
 *   input     "Raw Materials"
 *   control   "Design Specs", "Quality Standards"
 *   output    "Finished Product"
 *   mechanism "Workers"
 *
 *   activity "Plan Production" { ... }
 * }
 * ```
 *
 * Throws {@link Idef0Error} on the first syntax error.
 */
export function parse(source: string): DocumentAst {
  return new Parser(tokenize(source)).document();
}

function describe(t: Token): string {
  switch (t.kind) {
    case 'eof':
      return 'end of file';
    case 'string':
      return `string "${t.text}"`;
    case 'word':
      return `'${t.text}'`;
    default:
      return `'${t.kind}'`;
  }
}

class Parser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.pos++;
    return t;
  }

  private fail(message: string, span: Span, hint?: string): never {
    throw new Idef0Error([error(message, span, hint)]);
  }

  private isWord(t: Token, words: readonly string[]): boolean {
    return t.kind === 'word' && words.includes(t.text);
  }

  document(): DocumentAst {
    const doc: DocumentAst = { meta: [], activities: [] };
    for (;;) {
      const t = this.peek();
      if (t.kind === 'eof') return doc;
      if (t.kind === ';') {
        this.next();
      } else if (this.isWord(t, ACTIVITY_KEYWORDS)) {
        doc.activities.push(this.activity());
      } else if (this.isWord(t, META_KEYS)) {
        doc.meta.push(this.meta());
      } else if (t.kind === 'word' && Object.hasOwn(ROLE_KEYWORDS, t.text)) {
        this.fail(`'${t.text}' must be inside an activity`, t.span, `write it between the braces of an activity: activity "Name" { ${t.text} ... }`);
      } else {
        const suggestion = t.kind === 'word' ? closest(t.text, [...META_KEYS, ...ACTIVITY_KEYWORDS]) : undefined;
        this.fail(
          `expected a setting (${META_KEYS.join(', ')}) or an activity, found ${describe(t)}`,
          t.span,
          suggestion ? `did you mean '${suggestion}'?` : undefined,
        );
      }
    }
  }

  private meta(): MetaDecl {
    const key = this.next();
    const value = this.peek();
    if (value.kind !== 'string' && value.kind !== 'word') {
      this.fail(`expected a value after '${key.text}', found ${describe(value)}`, value.span, `for example: ${key.text} "..."`);
    }
    this.next();
    return { key: key.text, value: value.text, keySpan: key.span, valueSpan: value.span };
  }

  private label(what: string): { text: string; span: Span } {
    const t = this.peek();
    if (t.kind === 'string' || t.kind === 'word') {
      this.next();
      return { text: t.text, span: t.span };
    }
    const hint = t.kind === '{' ? 'give the activity a name: activity "Name" { ... }' : undefined;
    return this.fail(`expected ${what}, found ${describe(t)}`, t.span, hint);
  }

  private activity(): ActivityDecl {
    this.next(); // 'activity'
    const decl: ActivityDecl = { name: '', icoms: [], children: [] };
    const first = this.peek();
    const second = this.peek(1);
    if (first.kind === 'word' && NODE_NUMBER.test(first.text) && (second.kind === 'string' || second.kind === 'word')) {
      this.next();
      decl.node = first.text;
      decl.nodeSpan = first.span;
    }
    const name = this.label('an activity name');
    decl.name = name.text;
    decl.nameSpan = name.span;

    if (this.peek().kind !== '{') return decl;
    const open = this.next();
    for (;;) {
      const t = this.peek();
      if (t.kind === '}') {
        this.next();
        return decl;
      }
      if (t.kind === ';') {
        this.next();
      } else if (t.kind === 'eof') {
        this.fail(`missing '}' to close activity "${decl.name}"`, open.span);
      } else if (this.isWord(t, ACTIVITY_KEYWORDS)) {
        decl.children.push(this.activity());
      } else if (t.kind === 'word' && Object.hasOwn(ROLE_KEYWORDS, t.text)) {
        this.next();
        decl.icoms.push(...this.icomList(ROLE_KEYWORDS[t.text]!));
      } else {
        const keywords = ['input', 'control', 'output', 'mechanism', 'activity'];
        const suggestion = t.kind === 'word' ? closest(t.text, keywords) : undefined;
        const hint = suggestion
          ? `did you mean '${suggestion}'?`
          : t.kind === 'string'
            ? 'separate several labels with commas: input "A", "B"'
            : undefined;
        this.fail(`expected input, control, output, mechanism or activity, found ${describe(t)}`, t.span, hint);
      }
    }
  }

  private icomList(role: Role): IcomDecl[] {
    const items: IcomDecl[] = [];
    for (;;) {
      const t = this.peek();
      if (t.kind === '(') {
        this.next();
        const label = this.label('an arrow label');
        const end = this.peek();
        if (end.kind !== ')') this.fail(`expected ')' after tunneled arrow "${label.text}", found ${describe(end)}`, end.span);
        this.next();
        items.push({ role, label: label.text, tunneled: true, span: joinSpans(t.span, end.span) });
      } else {
        const label = this.label(`a label for the ${role}`);
        items.push({ role, label: label.text, tunneled: false, span: label.span });
      }
      if (this.peek().kind !== ',') return items;
      this.next();
    }
  }
}
