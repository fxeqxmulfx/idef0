/**
 * Building models in TypeScript instead of the text DSL, and writing any model back as DSL text.
 *
 *     const doc = model(
 *       { title: 'Tea', status: 'draft' },
 *       activity('Make Tea', { input: ['Water', 'Tea Leaves'], control: 'Recipe', output: 'Cup of Tea', mechanism: 'Kettle' }, [
 *         activity('Boil Water', { input: 'Water', control: 'Recipe', output: 'Hot Water', mechanism: 'Kettle' }),
 *         activity('Steep', { input: ['Hot Water', 'Tea Leaves'], control: ['Recipe', tunnel('Taste')], output: 'Brewed Tea', mechanism: 'Kettle' }),
 *         activity('Serve', { input: 'Brewed Tea', control: 'Recipe', output: 'Cup of Tea', mechanism: 'Kettle' }),
 *       ]),
 *     );
 *     const { pdf } = await compile(doc);
 */
import { ROLES, type ActivityDecl, type DocumentAst, type IcomDecl } from './ast.ts';
import type { PageSize, Status } from './model.ts';

/** A tunneled arrow, made with {@link tunnel}. */
export interface TunneledArrow {
  readonly tunneled: string;
}

/** An arrow label, or a tunneled arrow. */
export type Arrow = string | TunneledArrow;

/** One arrow or several, per ICOM role. */
export interface Icoms {
  input?: Arrow | readonly Arrow[];
  control?: Arrow | readonly Arrow[];
  output?: Arrow | readonly Arrow[];
  mechanism?: Arrow | readonly Arrow[];
}

/** Model settings, as in the header of a `.idef0` file. */
export interface Settings {
  title?: string;
  author?: string;
  project?: string;
  date?: string;
  rev?: string;
  status?: Status;
  purpose?: string;
  viewpoint?: string;
  page?: PageSize;
  /** TrueType or OpenType font file for all text. */
  font?: string;
}

/**
 * Marks an arrow as tunneled, like `("Label")` in the DSL. On a decomposed activity, the arrow is
 * left out of its decomposition; on a sub-activity, it comes from (or goes) outside the parent.
 */
export function tunnel(label: string): TunneledArrow {
  return { tunneled: label };
}

/** An activity (a box), its arrows and its sub-activities. A `\n` in a label forces a line break. */
export function activity(name: string, icoms: Icoms = {}, children: readonly ActivityDecl[] = []): ActivityDecl {
  const decls: IcomDecl[] = [];
  for (const role of ROLES) {
    const value = icoms[role];
    const list: readonly Arrow[] = value === undefined ? [] : typeof value === 'string' || 'tunneled' in value ? [value] : value;
    for (const a of list) {
      decls.push(typeof a === 'string' ? { role, label: a, tunneled: false } : { role, label: a.tunneled, tunneled: true });
    }
  }
  return { name, icoms: decls, children: [...children] };
}

/** A whole model: its settings and its top activity (A0). Compile it with `compile()`. */
export function model(settings: Settings, top: ActivityDecl): DocumentAst {
  const meta = Object.entries(settings)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value: String(value) }));
  return { meta, activities: [top] };
}

// ---------------------------------------------------------------------------------------------

function quote(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n|\r/g, '\\n').replace(/\t/g, ' ');
  return `"${escaped}"`;
}

/** Settings whose values read better as bare words when they are one. */
const BARE = new Set(['status', 'page']);

/** Writes a model as idef0 DSL source, e.g. to save a model built in code. */
export function toSource(doc: DocumentAst): string {
  const out: string[] = [];
  const width = Math.max(0, ...doc.meta.map((m) => m.key.length));
  for (const m of doc.meta) {
    const value = BARE.has(m.key) && /^[A-Za-z0-9]+$/.test(m.value) ? m.value : quote(m.value);
    out.push(`${m.key.padEnd(width)} ${value}`);
  }
  for (const a of doc.activities) {
    if (out.length > 0) out.push('');
    writeActivity(a, '', out);
  }
  return `${out.join('\n')}\n`;
}

function writeActivity(a: ActivityDecl, indent: string, out: string[]): void {
  const head = `${indent}activity ${a.node ? `${a.node} ` : ''}${quote(a.name)}`;
  if (a.icoms.length === 0 && a.children.length === 0) {
    out.push(head);
    return;
  }
  out.push(`${head} {`);
  const width = Math.max(...a.icoms.map((d) => d.role.length), 0);
  // Arrows keep their order; a run of one role shares a line.
  for (let i = 0; i < a.icoms.length; ) {
    const role = a.icoms[i]!.role;
    const run: string[] = [];
    for (; i < a.icoms.length && a.icoms[i]!.role === role; i++) {
      const d = a.icoms[i]!;
      run.push(d.tunneled ? `(${quote(d.label)})` : quote(d.label));
    }
    out.push(`${indent}  ${role.padEnd(width)} ${run.join(', ')}`);
  }
  for (const child of a.children) {
    if (a.icoms.length > 0 || child !== a.children[0]) out.push('');
    writeActivity(child, `${indent}  `, out);
  }
  out.push(`${indent}}`);
}
