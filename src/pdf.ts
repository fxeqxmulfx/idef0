import PDFDocument from 'pdfkit';
import { layoutModel, type ArrowHead, type DiagramLayout, type LayoutStyle, DEFAULT_STYLE, type Pt, type Rect, type TextBlock } from './layout.ts';
import type { Activity, DiagramSpec, Model, PageSize, Status } from './model.ts';
import { STATUSES } from './model.ts';
import { wrapGreedy, type Measure } from './text.ts';
import { strokePieces } from './strokes.ts';

/** A font file: its bytes, or its path (paths work only in Node). */
export type FontSource = string | Uint8Array | ArrayBuffer;

/** Regular and bold TrueType/OpenType fonts, embedded for all text. */
export interface FontFiles {
  regular: FontSource;
  bold: FontSource;
}

export interface RenderOptions {
  /** Overrides the model's `page` setting. */
  page?: PageSize;
  /**
   * Fonts for all text. Without them the PDF uses the built-in Helvetica, which only covers
   * Western European text; {@link needsUnicodeFont} tells whether a model needs more.
   */
  fonts?: FontFiles;
  style?: Partial<LayoutStyle>;
}

export interface RenderResult {
  pdf: Uint8Array<ArrayBuffer>;
  layouts: DiagramLayout[];
}

/** Page sizes in points, landscape (IDEF0 forms are landscape). */
export const PAGE_POINTS: Record<PageSize, [number, number]> = {
  A4: [841.89, 595.28],
  A3: [1190.55, 841.89],
  letter: [792, 612],
  tabloid: [1224, 792],
};

const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

function fitsWinAnsi(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch)) continue;
    return false;
  }
  return true;
}

/** All text the PDF shows. */
function modelText(model: Model): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(model.meta)) {
    if (key !== 'font' && typeof value === 'string') parts.push(value);
  }
  const visit = (a: Activity) => {
    parts.push(a.name, ...a.icoms.map((i) => i.label));
    a.children.forEach(visit);
  };
  visit(model.top);
  return parts.join(' ');
}

/** Whether the model has text the built-in Helvetica cannot show, so it needs a Unicode font. */
export function needsUnicodeFont(model: Model): boolean {
  return !fitsWinAnsi(modelText(model));
}

/** The names the fonts are used under. */
interface Fonts {
  regular: string;
  bold: string;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Form geometry

const MARGIN = 22;
const HEADER_H = 50;
const FOOTER_H = 34;
const NOTES_FONT = 8.5;
const CORNER_RADIUS = 6;
const HEAD_LENGTH = 7;

interface Form {
  width: number;
  height: number;
  header: Rect;
  footer: Rect;
  /** The diagram area: boundary arrows start and end on its edges. */
  area: Rect;
}

function formFor(page: PageSize): Form {
  const [width, height] = PAGE_POINTS[page];
  const w = width - 2 * MARGIN;
  return {
    width,
    height,
    header: { x: MARGIN, y: MARGIN, w, h: HEADER_H },
    footer: { x: MARGIN, y: height - MARGIN - FOOTER_H, w, h: FOOTER_H },
    area: { x: MARGIN, y: MARGIN + HEADER_H, w, h: height - 2 * MARGIN - HEADER_H - FOOTER_H },
  };
}

// ---------------------------------------------------------------------------------------------

/** Lays out every diagram of the model and renders them as pages of one PDF. */
export async function renderPdf(model: Model, options: RenderOptions = {}): Promise<RenderResult> {
  const page = options.page ?? model.meta.page;
  const form = formFor(page);
  if (!options.fonts && needsUnicodeFont(model)) {
    throw new Error('the model contains characters the built-in PDF fonts cannot show; pass a Unicode font in `fonts`');
  }
  const fonts: Fonts = options.fonts ? { regular: 'Body', bold: 'BodyBold' } : { regular: 'Helvetica', bold: 'Helvetica-Bold' };
  const style: LayoutStyle = { ...DEFAULT_STYLE, ...options.style };

  // pdfkit chokes on undefined entries, so only set the author when there is one.
  const info: PDFKit.DocumentInfo = {
    Title: model.meta.title ?? model.top.name,
    Subject: `IDEF0 model: ${model.top.name}`,
    Creator: 'idef0-dsl',
  };
  if (model.meta.author) info.Author = model.meta.author;
  const doc = new PDFDocument({ autoFirstPage: false, size: [form.width, form.height], margin: 0, info });
  const chunks: Uint8Array[] = [];
  doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
  const finished = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    doc.on('end', () => resolve(concat(chunks)));
    doc.on('error', reject);
  });

  if (options.fonts) {
    doc.registerFont(fonts.regular, options.fonts.regular);
    doc.registerFont(fonts.bold, options.fonts.bold);
  }
  const measure: Measure = (text, size, bold) => doc.font(bold ? fonts.bold : fonts.regular).fontSize(size).widthOfString(text);
  const r = new Renderer(doc, fonts, measure, style, form, model);

  // Page numbers first, so boxes can refer to the page that details them.
  const pageOf = new Map<string, number>();
  model.diagrams.forEach((d, i) => pageOf.set(d.node, i + 1));

  const layouts = layoutModel(model, {
    measure,
    area: (spec) => {
      const area = r.layoutArea(spec);
      return { width: area.w, height: area.h };
    },
    detailRef: (a) => (pageOf.has(a.node) ? `p. ${pageOf.get(a.node)}` : undefined),
    style,
  });

  layouts.forEach((layout, i) => r.page(layout, i + 1, model.diagrams.length));
  doc.end();
  return { pdf: await finished, layouts };
}

class Renderer {
  private readonly doc: PDFKit.PDFDocument;
  private readonly fonts: Fonts;
  private readonly measure: Measure;
  private readonly style: LayoutStyle;
  private readonly form: Form;
  private readonly model: Model;

  constructor(doc: PDFKit.PDFDocument, fonts: Fonts, measure: Measure, style: LayoutStyle, form: Form, model: Model) {
    this.doc = doc;
    this.fonts = fonts;
    this.measure = measure;
    this.style = style;
    this.form = form;
    this.model = model;
  }

  /** Purpose and viewpoint lines shown under the A-0 diagram. */
  private notesLines(): { label: string; lines: string[] }[] {
    const { purpose, viewpoint } = this.model.meta;
    const width = this.form.area.w - 20;
    const out: { label: string; lines: string[] }[] = [];
    for (const [label, text] of [
      ['Purpose:', purpose],
      ['Viewpoint:', viewpoint],
    ] as const) {
      if (!text) continue;
      const indent = this.measure(`${label} `, NOTES_FONT, true);
      const lines = wrapGreedy(this.measure, text, NOTES_FONT, width - indent);
      out.push({ label, lines });
    }
    return out;
  }

  private notesHeight(): number {
    const count = this.notesLines().reduce((n, e) => n + e.lines.length, 0);
    return count === 0 ? 0 : count * NOTES_FONT * 1.3 + 12;
  }

  layoutArea(spec: DiagramSpec): Rect {
    const a = this.form.area;
    if (spec.kind !== 'context') return a;
    return { ...a, h: a.h - this.notesHeight() };
  }

  page(layout: DiagramLayout, number: number, total: number): void {
    const doc = this.doc;
    const spec = layout.spec;
    doc.addPage({ size: [this.form.width, this.form.height], margin: 0 });
    doc.addNamedDestination(spec.node);
    doc.outline.addItem(`${spec.node}  ${spec.activity.name.replace(/\n/g, ' ')}`);

    this.drawForm(spec, number, total);
    if (spec.kind === 'context') this.drawNotes();

    const area = this.layoutArea(spec);
    doc.save();
    doc.translate(area.x, area.y).scale(layout.scale);
    this.drawDiagram(layout);
    doc.restore();
  }

  // -- text helpers ---------------------------------------------------------------------------

  private font(bold = false): string {
    return bold ? this.fonts.bold : this.fonts.regular;
  }

  /** Writes one line with its baseline at `y`. */
  private line(text: string, x: number, y: number, size: number, bold = false): void {
    this.doc.font(this.font(bold)).fontSize(size).text(text, x, y, { lineBreak: false, baseline: 'alphabetic' });
  }

  /** Writes a laid-out text block, each line vertically centred in its line box. */
  private block(b: TextBlock): void {
    const doc = this.doc;
    doc.font(this.font(b.bold)).fontSize(b.size);
    const f = (doc as unknown as { _font: { ascender: number; descender: number } })._font;
    const ascent = f.ascender / 1000;
    const descent = f.descender / 1000;
    const lh = b.size * this.style.lineGap;
    b.lines.forEach((text, i) => {
      const w = doc.widthOfString(text);
      const x = b.align === 'center' ? b.rect.x + (b.rect.w - w) / 2 : b.align === 'right' ? b.rect.x + b.rect.w - w : b.rect.x;
      const baseline = b.rect.y + i * lh + (lh - (ascent - descent) * b.size) / 2 + ascent * b.size;
      doc.text(text, x, baseline, { lineBreak: false, baseline: 'alphabetic' });
    });
  }

  /** Largest size ≤ `size` at which `text` fits in `width` (never below `min`), and the text, truncated if needed. */
  private fit(text: string, width: number, size: number, bold = false, min = 5): [string, number] {
    let s = size;
    while (s > min && this.measure(text, s, bold) > width) s -= 0.25;
    if (this.measure(text, s, bold) <= width) return [text, s];
    let t = text;
    while (t.length > 1 && this.measure(`${t}…`, s, bold) > width) t = t.slice(0, -1);
    return [`${t}…`, s];
  }

  // -- form -----------------------------------------------------------------------------------

  private drawForm(spec: DiagramSpec, number: number, total: number): void {
    const doc = this.doc;
    const { header: hd, footer: ft, area } = this.form;
    const meta = this.model.meta;

    doc.lineWidth(1).strokeColor('black');
    doc.rect(hd.x, hd.y, hd.w, ft.y + ft.h - hd.y).stroke();
    doc.moveTo(hd.x, hd.y + hd.h).lineTo(hd.x + hd.w, hd.y + hd.h).stroke();
    doc.moveTo(ft.x, ft.y).lineTo(ft.x + ft.w, ft.y).stroke();

    // Header cells.
    const widths = [0.12, 0.34, 0.13, 0.14, 0.12, 0.15];
    const xs: number[] = [hd.x];
    for (const w of widths) xs.push(xs[xs.length - 1]! + w * hd.w);
    doc.lineWidth(0.6);
    for (const x of xs.slice(1, -1)) doc.moveTo(x, hd.y).lineTo(x, hd.y + hd.h).stroke();

    const small = 5.5;
    const value = 7.5;
    const row = (i: number) => hd.y + 10 + i * 13;
    const field = (x: number, y: number, w: number, label: string, text?: string) => {
      this.line(label, x + 3, y, small, true);
      if (!text) return;
      const lw = this.measure(label, small, true) + 6;
      const [t, s] = this.fit(text.replace(/\n/g, ' '), w - lw - 6, value);
      this.line(t, x + lw, y, s);
    };

    field(xs[0]!, row(0), xs[1]! - xs[0]!, 'USED AT:');
    field(xs[1]!, row(0), xs[2]! - xs[1]!, 'AUTHOR:', meta.author);
    field(xs[1]!, row(1), xs[2]! - xs[1]!, 'PROJECT:', meta.project ?? meta.title);
    this.line('NOTES:  1  2  3  4  5  6  7  8  9  10', xs[1]! + 3, row(2) + 4, small, true);
    field(xs[2]!, row(0), xs[3]! - xs[2]!, 'DATE:', meta.date);
    field(xs[2]!, row(1), xs[3]! - xs[2]!, 'REV:', meta.rev);

    // Status: a small box per state, the current one filled.
    STATUSES.forEach((status: Status, i) => {
      const y = hd.y + 6 + i * 10.5;
      const x = xs[3]! + 5;
      doc.lineWidth(0.5).rect(x, y + 1, 5.5, 5.5);
      if (status === meta.status) doc.fillAndStroke('black', 'black');
      else doc.stroke();
      doc.fillColor('black');
      this.line(status.toUpperCase(), x + 9, y + 6.3, small + 0.5, status === meta.status);
    });

    field(xs[4]!, row(0), xs[5]! - xs[4]!, 'READER:');
    field(xs[4]!, row(1), xs[5]! - xs[4]!, 'DATE:');
    this.drawContextCell(spec, { x: xs[5]!, y: hd.y, w: xs[6]! - xs[5]!, h: hd.h });

    // Footer: NODE | TITLE | NUMBER.
    const fx = [ft.x, ft.x + 0.12 * ft.w, ft.x + 0.84 * ft.w, ft.x + ft.w];
    doc.lineWidth(0.6);
    for (const x of fx.slice(1, -1)) doc.moveTo(x, ft.y).lineTo(x, ft.y + ft.h).stroke();
    const labelY = ft.y + 8;
    const textY = ft.y + ft.h - 9;
    this.line('NODE:', fx[0]! + 3, labelY, small, true);
    this.line(spec.node, fx[0]! + 10, textY, 13, true);
    this.line('TITLE:', fx[1]! + 3, labelY, small, true);
    const [title, size] = this.fit(spec.activity.name.replace(/\n/g, ' '), fx[2]! - fx[1]! - 20, 14, true, 7);
    this.line(title, fx[1]! + 10, textY, size, true);
    this.line('NUMBER:', fx[2]! + 3, labelY, small, true);
    this.line(`${number} / ${total}`, fx[2]! + 10, textY, 11);

    // Make the frame unambiguous where arrows leave it.
    doc.lineWidth(1).rect(area.x, area.y, area.w, area.h).stroke();
  }

  /** The CONTEXT cell: "TOP" on A-0, otherwise the parent diagram in miniature with this box filled. */
  private drawContextCell(spec: DiagramSpec, cell: Rect): void {
    const doc = this.doc;
    this.line('CONTEXT:', cell.x + 3, cell.y + 8, 5.5, true);
    if (spec.kind === 'context') {
      this.line('TOP', cell.x + cell.w / 2 - this.measure('TOP', 10, true) / 2, cell.y + 32, 10, true);
      return;
    }
    const act = spec.activity;
    const siblings = act.parent ? act.parent.children : [act];
    const index = siblings.indexOf(act);
    const k = siblings.length;
    const inner = { x: cell.x + 8, y: cell.y + 12, w: cell.w - 16, h: cell.h - 16 };
    const bw = Math.min(16, (inner.w / k) * 0.75);
    const bh = Math.min(8, (inner.h / k) * 0.75);
    const stepX = k > 1 ? (inner.w - bw) / (k - 1) : 0;
    const stepY = k > 1 ? (inner.h - bh) / (k - 1) : 0;
    const x0 = k > 1 ? inner.x : inner.x + (inner.w - bw) / 2;
    const y0 = k > 1 ? inner.y : inner.y + (inner.h - bh) / 2;
    siblings.forEach((_, i) => {
      doc.lineWidth(0.6).rect(x0 + i * stepX, y0 + i * stepY, bw, bh);
      if (i === index) doc.fillAndStroke('black', 'black');
      else doc.stroke();
    });
    doc.fillColor('black');
    // The parent's node goes top right: the staircase of boxes runs into the bottom right corner.
    const parentNode = act.parent ? act.parent.node : 'A-0';
    this.line(parentNode, cell.x + cell.w - 3 - this.measure(parentNode, 6, true), cell.y + 8, 6, true);
    doc.goTo(cell.x, cell.y, cell.w, cell.h, parentNode);
  }

  private drawNotes(): void {
    const entries = this.notesLines();
    if (entries.length === 0) return;
    const doc = this.doc;
    const a = this.form.area;
    const top = a.y + a.h - this.notesHeight();
    doc.lineWidth(0.6).moveTo(a.x, top).lineTo(a.x + a.w, top).stroke();
    let y = top + 6 + NOTES_FONT;
    for (const e of entries) {
      const indent = this.measure(`${e.label} `, NOTES_FONT, true);
      this.line(e.label, a.x + 10, y, NOTES_FONT, true);
      for (const l of e.lines) {
        this.line(l, a.x + 10 + indent, y, NOTES_FONT);
        y += NOTES_FONT * 1.3;
      }
    }
  }

  // -- diagram --------------------------------------------------------------------------------

  private drawDiagram(layout: DiagramLayout): void {
    const doc = this.doc;
    doc.lineJoin('miter').lineCap('butt').strokeColor('black').fillColor('black');

    for (const arrow of layout.arrows) {
      doc.lineWidth(0.9);
      for (const piece of strokePieces(arrow.paths, CORNER_RADIUS)) {
        this.strokePath(piece.pts, CORNER_RADIUS, piece.atEnd ? HEAD_LENGTH - 1 : 0);
      }
      for (const head of arrow.heads) this.drawHead(head);
      doc.lineWidth(0.8);
      for (const t of arrow.tunnels) this.drawTunnel(t.at, t.axis);
      if (arrow.squiggle) this.drawSquiggle(arrow.squiggle[0], arrow.squiggle[1]);
    }

    for (const box of layout.boxes) {
      const { rect } = box;
      doc.lineWidth(1.4).rect(rect.x, rect.y, rect.w, rect.h).fillAndStroke('white', 'black');
      doc.fillColor('black');
      this.block(box.label);
      this.block(box.number);
      if (box.detail) {
        this.block(box.detail);
        doc.goTo(rect.x, rect.y, rect.w, rect.h, box.activity.node);
      }
    }

    for (const arrow of layout.arrows) {
      if (arrow.text) this.block(arrow.text);
      for (const code of arrow.codes) this.block({ ...code, bold: true });
    }
  }

  /** Orthogonal polyline with rounded corners, shortened at the end to make room for the arrowhead. */
  private strokePath(pts: Pt[], radius: number, trimEnd: number): void {
    if (pts.length < 2) return;
    const doc = this.doc;
    const m = pts.length - 1;
    const a = pts[m - 1]!;
    const b = pts[m]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = Math.min(trimEnd, Math.max(0, len - 0.5)) / len;
    const path = [...pts.slice(0, m), { x: b.x - (b.x - a.x) * t, y: b.y - (b.y - a.y) * t }];

    doc.moveTo(path[0]!.x, path[0]!.y);
    for (let i = 1; i < path.length - 1; i++) {
      const p = path[i - 1]!;
      const c = path[i]!;
      const q = path[i + 1]!;
      const l1 = Math.hypot(c.x - p.x, c.y - p.y);
      const l2 = Math.hypot(q.x - c.x, q.y - c.y);
      const r = Math.min(radius, i === 1 ? l1 : l1 / 2, i === path.length - 2 ? l2 : l2 / 2);
      doc
        .lineTo(c.x + ((p.x - c.x) / l1) * r, c.y + ((p.y - c.y) / l1) * r)
        .quadraticCurveTo(c.x, c.y, c.x + ((q.x - c.x) / l2) * r, c.y + ((q.y - c.y) / l2) * r);
    }
    const last = path[path.length - 1]!;
    doc.lineTo(last.x, last.y).stroke();
  }

  private drawHead(h: ArrowHead): void {
    const len = HEAD_LENGTH;
    const half = 2.7;
    const bx = h.at.x - h.dx * len;
    const by = h.at.y - h.dy * len;
    this.doc
      .polygon([h.at.x, h.at.y], [bx - h.dy * half, by + h.dx * half], [bx + h.dy * half, by - h.dx * half])
      .fill('black');
  }

  /** Tunnel parentheses around an arrow: "( )" on horizontal arrows, rotated on vertical ones. */
  private drawTunnel(at: Pt, axis: 'h' | 'v'): void {
    const doc = this.doc;
    const s = 5;
    const d = 3.2;
    for (const sign of [-1, 1]) {
      if (axis === 'h') {
        const x = at.x + sign * d;
        doc.moveTo(x, at.y - s).bezierCurveTo(x + sign * 2.4, at.y - s / 2, x + sign * 2.4, at.y + s / 2, x, at.y + s).stroke();
      } else {
        const y = at.y + sign * d;
        doc.moveTo(at.x - s, y).bezierCurveTo(at.x - s / 2, y + sign * 2.4, at.x + s / 2, y + sign * 2.4, at.x + s, y).stroke();
      }
    }
  }

  /** The IDEF0 "squiggle" tying a label to its arrow. */
  private drawSquiggle(a: Pt, b: Pt): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * 3;
    const py = (dx / len) * 3;
    this.doc
      .lineWidth(0.6)
      .moveTo(a.x, a.y)
      .bezierCurveTo(a.x + dx / 3 + px, a.y + dy / 3 + py, a.x + (2 * dx) / 3 - px, a.y + (2 * dy) / 3 - py, b.x, b.y)
      .stroke();
  }
}
