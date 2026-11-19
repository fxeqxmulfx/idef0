import type { ActivityDecl, DocumentAst, Role } from './ast.ts';
import { error, Idef0Error, warning, type Diagnostic, type Span } from './diagnostics.ts';
import { closest, flatLabel, labelKey, normalizeLabel } from './util.ts';

export type Status = 'working' | 'draft' | 'recommended' | 'publication';
export const STATUSES: readonly Status[] = ['working', 'draft', 'recommended', 'publication'];

export type PageSize = 'A4' | 'A3' | 'letter' | 'tabloid';
export const PAGE_SIZES: readonly PageSize[] = ['A4', 'A3', 'letter', 'tabloid'];

export interface Meta {
  title?: string;
  author?: string;
  project?: string;
  date?: string;
  rev?: string;
  status: Status;
  purpose?: string;
  viewpoint?: string;
  page: PageSize;
  /** Path to a TrueType/OpenType font used for all text. */
  font?: string;
}

/** An arrow attachment on an activity box. */
export interface Icom {
  role: Role;
  /** Display text; may contain explicit line breaks. */
  label: string;
  /** Matching key: two ICOMs are the same arrow when their keys are equal. */
  key: string;
  tunneled: boolean;
  span?: Span;
  owner: Activity;
}

export interface Activity {
  /** Node number: A0, A1, A12, ... */
  node: string;
  /** Box number shown in the corner of the box: "0" for A0, otherwise the last digit. */
  number: string;
  name: string;
  span?: Span;
  icoms: Icom[];
  children: Activity[];
  parent: Activity | null;
}

export type FrameSide = 'left' | 'top' | 'right' | 'bottom';

/** Arrow end attached to a box side. `tunnel` = parentheses at the box end (not shown on the box's decomposition). */
export interface BoxEnd {
  kind: 'box';
  box: number;
  role: Role;
  icom: Icom;
  tunnel: boolean;
}

/**
 * Arrow end on the diagram frame (a boundary arrow).
 * `parentIcom` links it to the parent box's arrow (for the ICOM code); `tunnel` = parentheses at the frame end.
 */
export interface FrameEnd {
  kind: 'frame';
  side: FrameSide;
  parentIcom: Icom | null;
  tunnel: boolean;
}

export type End = BoxEnd | FrameEnd;

/** One arrow on a diagram. Several sources = join, several targets = fork. */
export interface ArrowSpec {
  id: number;
  label: string;
  sources: End[];
  targets: End[];
}

export interface DiagramSpec {
  /** "A-0" for the context diagram, otherwise the node number of the activity being detailed. */
  node: string;
  kind: 'context' | 'decomposition';
  /** The activity this diagram details. */
  activity: Activity;
  boxes: Activity[];
  arrows: ArrowSpec[];
}

export interface Model {
  meta: Meta;
  top: Activity;
  /** All diagrams in node-tree order: A-0, A0, A1, A11, ..., A2, ... */
  diagrams: DiagramSpec[];
}

export interface AnalysisResult {
  model: Model;
  warnings: Diagnostic[];
}

const ROLE_SIDE: Record<Role, FrameSide> = { input: 'left', control: 'top', output: 'right', mechanism: 'bottom' };
const ROLE_KEYWORD: Record<Role, string> = { input: 'input', control: 'control', output: 'output', mechanism: 'mechanism' };

export function roleSide(role: Role): FrameSide {
  return ROLE_SIDE[role];
}

const isConsumer = (role: Role) => role !== 'output';

function article(role: Role): string {
  return role === 'input' || role === 'output' ? 'an' : 'a';
}

/**
 * Checks a parsed document against the IDEF0 rules and builds the diagrams.
 * Throws {@link Idef0Error} (with all problems found) if the model is inconsistent.
 */
export function analyze(doc: DocumentAst): AnalysisResult {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const meta = buildMeta(doc, errors);

  const topDecl = doc.activities[0];
  if (!topDecl) {
    throw new Idef0Error([
      error('the model has no activity', undefined, 'add the top activity: activity "Make Product" { input ... output ... }'),
    ]);
  }
  for (const extra of doc.activities.slice(1)) {
    errors.push(
      error(
        `an IDEF0 model has exactly one top activity (A0), but "${extra.name}" is a second one`,
        extra.nameSpan,
        `nest it inside "${topDecl.name}" to make it a sub-activity`,
      ),
    );
  }

  const top = buildActivity(topDecl, null, 'A0', errors, warnings);
  const diagrams: DiagramSpec[] = [buildContext(top)];
  const visit = (a: Activity) => {
    if (a.children.length === 0) return;
    diagrams.push(buildDecomposition(a, errors, warnings));
    a.children.forEach(visit);
  };
  visit(top);

  if (errors.length > 0) throw new Idef0Error([...errors, ...warnings]);
  return { model: { meta, top, diagrams }, warnings };
}

function buildMeta(doc: DocumentAst, errors: Diagnostic[]): Meta {
  const meta: Meta = { status: 'working', page: 'A4' };
  const seen = new Set<string>();
  for (const m of doc.meta) {
    if (seen.has(m.key)) {
      errors.push(error(`'${m.key}' is set more than once`, m.keySpan));
      continue;
    }
    seen.add(m.key);
    const value = m.value.trim();
    switch (m.key) {
      case 'status': {
        const status = STATUSES.find((s) => s === value.toLowerCase());
        if (status) meta.status = status;
        else {
          const guess = closest(value, STATUSES);
          errors.push(
            error(`unknown status "${value}"`, m.valueSpan, `use one of: ${STATUSES.join(', ')}${guess ? ` (did you mean '${guess}'?)` : ''}`),
          );
        }
        break;
      }
      case 'page': {
        const page = PAGE_SIZES.find((p) => p.toLowerCase() === value.toLowerCase());
        if (page) meta.page = page;
        else errors.push(error(`unknown page size "${value}"`, m.valueSpan, `use one of: ${PAGE_SIZES.join(', ')}`));
        break;
      }
      case 'title':
      case 'author':
      case 'project':
      case 'date':
      case 'rev':
      case 'purpose':
      case 'viewpoint':
      case 'font':
        meta[m.key] = m.key === 'font' ? value : normalizeLabel(m.value);
        break;
      default:
        errors.push(error(`unknown setting '${m.key}'`, m.keySpan));
    }
  }
  return meta;
}

function buildActivity(
  decl: ActivityDecl,
  parent: Activity | null,
  node: string,
  errors: Diagnostic[],
  warnings: Diagnostic[],
): Activity {
  const activity: Activity = {
    node,
    number: node === 'A0' ? '0' : node.slice(-1),
    name: normalizeLabel(decl.name),
    span: decl.nameSpan,
    icoms: [],
    children: [],
    parent,
  };
  const who = `${node} "${activity.name}"`;

  if (activity.name === '') errors.push(error('activity name is empty', decl.nameSpan));
  if (decl.node !== undefined && decl.node !== node) {
    errors.push(
      error(
        `activity "${activity.name}" is numbered ${decl.node}, but its position in the tree makes it ${node}`,
        decl.nodeSpan,
        'node numbers follow nesting and order; remove the number or move the activity',
      ),
    );
  }

  // ICOMs: reject duplicates and arrows that would enter the box on two sides.
  const byKey = new Map<string, typeof activity.icoms>();
  for (const d of decl.icoms) {
    const label = normalizeLabel(d.label);
    if (label === '') {
      errors.push(error(`empty ${d.role} label on ${who}`, d.span));
      continue;
    }
    const icom = { role: d.role, label, key: labelKey(label), tunneled: d.tunneled, span: d.span, owner: activity };
    const same = byKey.get(icom.key) ?? [];
    const clash = same.find((o) => o.role === icom.role || (isConsumer(o.role) && isConsumer(icom.role)));
    if (clash) {
      const message =
        clash.role === icom.role
          ? `"${label}" is listed twice as ${article(icom.role)} ${icom.role} of ${who}`
          : `"${label}" is both ${article(clash.role)} ${clash.role} and ${article(icom.role)} ${icom.role} of ${who}`;
      errors.push(error(message, d.span, 'an arrow attaches to one side of a box only'));
      continue;
    }
    if (same.length > 0) {
      warnings.push(
        warning(
          `"${label}" is both consumed and produced by ${who}; it will be drawn as a feedback loop into the same box`,
          d.span,
          'if these are different things, give them different labels (e.g. "Draft" and "Reviewed Draft")',
        ),
      );
    }
    same.push(icom);
    byKey.set(icom.key, same);
    activity.icoms.push(icom);
  }

  if (!activity.icoms.some((i) => i.role === 'output')) {
    warnings.push(warning(`${who} has no output; every IDEF0 activity should produce at least one`, decl.nameSpan));
  }
  if (!activity.icoms.some((i) => i.role === 'control')) {
    warnings.push(warning(`${who} has no control; every IDEF0 activity should have at least one`, decl.nameSpan));
  }

  const count = decl.children.length;
  if (count > 9) {
    errors.push(error(`${who} has ${count} sub-activities; at most 9 can be numbered`, decl.nameSpan, 'IDEF0 recommends 3 to 6 boxes per diagram'));
  } else if (count > 0 && (count < 3 || count > 6)) {
    warnings.push(warning(`${who} is decomposed into ${count} ${count === 1 ? 'activity' : 'activities'}; IDEF0 recommends 3 to 6`, decl.nameSpan));
  }
  decl.children.forEach((child, k) => {
    const childNode = node === 'A0' ? `A${k + 1}` : `${node}${k + 1}`;
    activity.children.push(buildActivity(child, activity, childNode, errors, warnings));
  });
  return activity;
}

/** Does the decomposition of the ICOM's owner pick this arrow up? */
function connectsDown(icom: Icom): boolean {
  return icom.owner.children.some((c) =>
    c.icoms.some((o) => o.key === icom.key && (icom.role === 'output' ? o.role === 'output' : isConsumer(o.role))),
  );
}

/** Parentheses at the box end: the arrow is deliberately left out of the box's decomposition. */
function boxEndTunnel(icom: Icom): boolean {
  return icom.tunneled && icom.owner.children.length > 0 && !connectsDown(icom);
}

function buildContext(top: Activity): DiagramSpec {
  const arrows: ArrowSpec[] = top.icoms.map((icom, id) => {
    const box: BoxEnd = { kind: 'box', box: 0, role: icom.role, icom, tunnel: boxEndTunnel(icom) };
    const frame: FrameEnd = { kind: 'frame', side: ROLE_SIDE[icom.role], parentIcom: null, tunnel: false };
    return icom.role === 'output'
      ? { id, label: icom.label, sources: [box], targets: [frame] }
      : { id, label: icom.label, sources: [frame], targets: [box] };
  });
  return { node: 'A-0', kind: 'context', activity: top, boxes: [top], arrows };
}

interface Group {
  label: string;
  sources: End[];
  targets: End[];
  icoms: Icom[];
}

function buildDecomposition(parent: Activity, errors: Diagnostic[], warnings: Diagnostic[]): DiagramSpec {
  const groups = new Map<string, Group>();
  const group = (icom: Icom): Group => {
    let g = groups.get(icom.key);
    if (!g) {
      g = { label: icom.label, sources: [], targets: [], icoms: [] };
      groups.set(icom.key, g);
    }
    g.icoms.push(icom);
    return g;
  };

  for (const icom of parent.icoms) {
    const end: FrameEnd = { kind: 'frame', side: ROLE_SIDE[icom.role], parentIcom: icom, tunnel: false };
    if (icom.role === 'output') group(icom).targets.push(end);
    else group(icom).sources.push(end);
  }
  parent.children.forEach((child, box) => {
    for (const icom of child.icoms) {
      const end: BoxEnd = { kind: 'box', box, role: icom.role, icom, tunnel: boxEndTunnel(icom) };
      if (icom.role === 'output') group(icom).sources.push(end);
      else group(icom).targets.push(end);
    }
  });

  // Labels available as sources / targets, for "did you mean" hints.
  const producible = [...groups.entries()].filter(([, g]) => g.sources.length > 0).map(([k]) => k);
  const consumable = [...groups.entries()].filter(([, g]) => g.targets.length > 0).map(([k]) => k);
  const p = `${parent.node} "${parent.name}"`;
  /** The label of the arrow with the closest key, as written, for "did you mean" hints. */
  const guessFrom = (key: string, keys: string[]) => {
    const k = closest(key, keys.filter((other) => other !== key));
    return k === undefined ? undefined : flatLabel(groups.get(k)!.label);
  };

  const arrows: ArrowSpec[] = [];
  for (const [key, g] of groups) {
    const boxSources = g.sources.filter((e): e is BoxEnd => e.kind === 'box');
    const boxTargets = g.targets.filter((e): e is BoxEnd => e.kind === 'box');

    // The parent's own arrows must be picked up by some child (or be tunneled).
    const frameSource = g.sources.find((e): e is FrameEnd => e.kind === 'frame');
    if (frameSource && boxTargets.length === 0) {
      const icom = frameSource.parentIcom!;
      if (!icom.tunneled) {
        const guess = guessFrom(key, consumable);
        errors.push(
          error(
            `${p} has ${article(icom.role)} ${icom.role} "${icom.label}", but none of its sub-activities uses it`,
            icom.span,
            guess
              ? `did you mean "${guess}"?`
              : `use it in a sub-activity, or tunnel it with ${ROLE_KEYWORD[icom.role]} ("${icom.label}") to leave it out of ${parent.node}'s decomposition`,
          ),
        );
      }
      g.sources = g.sources.filter((e) => e !== frameSource);
    }
    const frameTarget = g.targets.find((e): e is FrameEnd => e.kind === 'frame');
    if (frameTarget && boxSources.length === 0) {
      const icom = frameTarget.parentIcom!;
      if (!icom.tunneled) {
        const guess = guessFrom(key, producible);
        errors.push(
          error(
            `${p} has output "${icom.label}", but none of its sub-activities produces it`,
            icom.span,
            guess ? `did you mean "${guess}"?` : `add it as an output of a sub-activity, or tunnel it with output ("${icom.label}")`,
          ),
        );
      }
      g.targets = g.targets.filter((e) => e !== frameTarget);
    }

    // A child consuming something nobody provides: error unless tunneled from outside.
    if (g.sources.length === 0 && boxTargets.length > 0) {
      const tunneled = boxTargets.find((e) => e.icom.tunneled);
      if (tunneled) {
        g.sources.push({ kind: 'frame', side: ROLE_SIDE[tunneled.role], parentIcom: null, tunnel: true });
      } else {
        for (const t of boxTargets) {
          const c = t.icom.owner;
          const guess = guessFrom(key, producible);
          errors.push(
            error(
              `${t.icom.role} "${t.icom.label}" of ${c.node} "${c.name}" has no source: no activity in ${parent.node} outputs it, and ${parent.node} does not take it as an input, control or mechanism`,
              t.icom.span,
              guess
                ? `did you mean "${guess}"?`
                : `add it to ${parent.node}, output it from a sibling, or tunnel it with ${ROLE_KEYWORD[t.icom.role]} ("${t.icom.label}")`,
            ),
          );
        }
      }
    }
    // A child producing something nobody uses: error unless tunneled out.
    if (g.targets.length === 0 && boxSources.length > 0) {
      if (boxSources.some((e) => e.icom.tunneled)) {
        g.targets.push({ kind: 'frame', side: 'right', parentIcom: null, tunnel: true });
      } else {
        for (const s of boxSources) {
          const c = s.icom.owner;
          const guess = guessFrom(key, consumable);
          errors.push(
            error(
              `output "${s.icom.label}" of ${c.node} "${c.name}" goes nowhere: no activity in ${parent.node} uses it and ${parent.node} does not output it`,
              s.icom.span,
              guess
                ? `did you mean "${guess}"?`
                : `use it in a sibling, add it as an output of ${parent.node}, or tunnel it with output ("${s.icom.label}")`,
            ),
          );
        }
      }
    }

    // Matching ignores case, but the diagram can only show one spelling.
    const odd = g.icoms.find((i) => flatLabel(i.label) !== flatLabel(g.label));
    if (odd) {
      warnings.push(
        warning(
          `"${flatLabel(odd.label)}" and "${flatLabel(g.label)}" in ${parent.node} are taken as the same arrow, labelled "${flatLabel(g.label)}"`,
          odd.span,
          'write the label the same way everywhere',
        ),
      );
    }

    if (g.sources.length > 0 && g.targets.length > 0) {
      if (g.sources.length > 1 && g.targets.length > 1 && boxSources.length > 0) {
        warnings.push(
          warning(
            `"${g.label}" in ${parent.node} has ${g.sources.length} sources and ${g.targets.length} destinations; every source will be drawn connected to every destination`,
            boxSources[0]!.icom.span,
            'if these are different arrows, give them different labels',
          ),
        );
      }
      arrows.push({ id: arrows.length, label: g.label, sources: g.sources, targets: g.targets });
    }
  }

  return { node: parent.node, kind: 'decomposition', activity: parent, boxes: parent.children, arrows };
}
