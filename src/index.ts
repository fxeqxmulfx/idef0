import type { DocumentAst } from './ast.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { DiagramLayout } from './layout.ts';
import { analyze, type Model } from './model.ts';
import { parse } from './parser.ts';
import { renderPdf, type PdfOptions } from './pdf.ts';

export type { ActivityDecl, DocumentAst, IcomDecl, MetaDecl, Role } from './ast.ts';
export { activity, model, toSource, tunnel, type Arrow, type Icoms, type Settings, type TunneledArrow } from './builder.ts';
export { formatDiagnostic, Idef0Error, type Diagnostic, type Span } from './diagnostics.ts';
export { DEFAULT_STYLE, layoutDiagram, layoutModel, type DiagramLayout, type LayoutOptions, type LayoutStyle, type ModelLayoutOptions } from './layout.ts';
export { analyze, type Activity, type ArrowSpec, type DiagramSpec, type Model } from './model.ts';
export { parse } from './parser.ts';
export { PAGE_POINTS, renderPdf, type PdfOptions } from './pdf.ts';

export interface CompileResult {
  pdf: Buffer;
  model: Model;
  layouts: DiagramLayout[];
  warnings: Diagnostic[];
}

/**
 * Compiles IDEF0 DSL source (or an AST built with the TypeScript API) to a PDF with one page
 * per diagram. Throws {@link Idef0Error} if the source is invalid.
 */
export async function compile(source: string | DocumentAst, options: PdfOptions = {}): Promise<CompileResult> {
  const ast = typeof source === 'string' ? parse(source) : source;
  const { model, warnings } = analyze(ast);
  const { pdf, layouts } = await renderPdf(model, options);
  return { pdf, model, layouts, warnings };
}

/** Parses and checks a model without rendering it. Throws {@link Idef0Error} if it is invalid. */
export function check(source: string | DocumentAst): { model: Model; warnings: Diagnostic[] } {
  return analyze(typeof source === 'string' ? parse(source) : source);
}
