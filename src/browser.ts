/**
 * The library without Node: parsing, checks, layout and PDF rendering. It runs in browsers.
 * There is no file system to find fonts on, so a model with text beyond Western European
 * scripts needs a Unicode font passed in as bytes; see {@link needsUnicodeFont}.
 */
import * as pdfkit from 'pdfkit';
import Helvetica from 'pdfkit/standard-fonts/Helvetica';
import HelveticaBold from 'pdfkit/standard-fonts/HelveticaBold';
import type { DocumentAst } from './ast.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { DiagramLayout } from './layout.ts';
import { analyze, type Model } from './model.ts';
import { parse } from './parser.ts';
import { renderPdf, type RenderOptions } from './pdf.ts';

// pdfkit's browser build has no files to read the built-in fonts' metrics from, so they are
// registered here. Its Node build loads them itself and has no such function.
(pdfkit as unknown as { registerStdFonts?: (...fonts: object[]) => void }).registerStdFonts?.(Helvetica, HelveticaBold);

export type { ActivityDecl, DocumentAst, IcomDecl, MetaDecl, Role } from './ast.ts';
export { activity, model, toSource, tunnel, type Arrow, type Icoms, type Settings, type TunneledArrow } from './builder.ts';
export { formatDiagnostic, Idef0Error, type Diagnostic, type Span } from './diagnostics.ts';
export { DEFAULT_STYLE, layoutDiagram, layoutModel, type DiagramLayout, type LayoutOptions, type LayoutStyle, type ModelLayoutOptions } from './layout.ts';
export { analyze, PAGE_SIZES, type Activity, type ArrowSpec, type DiagramSpec, type Model, type PageSize } from './model.ts';
export { parse } from './parser.ts';
export { needsUnicodeFont, PAGE_POINTS, renderPdf, type FontFiles, type FontSource, type RenderOptions, type RenderResult } from './pdf.ts';

export interface CompileResult {
  pdf: Uint8Array;
  model: Model;
  layouts: DiagramLayout[];
  warnings: Diagnostic[];
}

/**
 * Compiles IDEF0 DSL source (or an AST built with the TypeScript API) to a PDF with one page
 * per diagram. Throws {@link Idef0Error} if the source is invalid.
 */
export async function compile(source: string | DocumentAst, options: RenderOptions = {}): Promise<CompileResult> {
  const { model, warnings } = check(source);
  const { pdf, layouts } = await renderPdf(model, options);
  return { pdf, model, layouts, warnings };
}

/** Parses and checks a model without rendering it. Throws {@link Idef0Error} if it is invalid. */
export function check(source: string | DocumentAst): { model: Model; warnings: Diagnostic[] } {
  return analyze(typeof source === 'string' ? parse(source) : source);
}
