/**
 * The library for Node: everything in the browser build, plus fonts found on disk and PDFs
 * returned as Buffers.
 */
import type { DocumentAst } from './ast.ts';
import { check, renderPdf as render } from './browser.ts';
import type { Diagnostic } from './diagnostics.ts';
import { findFonts, type FontOptions } from './fonts.ts';
import type { DiagramLayout } from './layout.ts';
import type { Model } from './model.ts';
import type { RenderOptions } from './pdf.ts';

export * from './browser.ts';
export { findFonts, type FontOptions } from './fonts.ts';

export interface PdfOptions extends Omit<RenderOptions, 'fonts'>, FontOptions {}

export interface PdfResult {
  pdf: Buffer;
  layouts: DiagramLayout[];
}

export interface CompileResult extends PdfResult {
  model: Model;
  warnings: Diagnostic[];
}

/**
 * Lays out every diagram of the model and renders them as pages of one PDF. Text that the
 * built-in Helvetica cannot show gets a Unicode font found on the system.
 */
export async function renderPdf(model: Model, options: PdfOptions = {}): Promise<PdfResult> {
  const { pdf, layouts } = await render(model, { page: options.page, style: options.style, fonts: findFonts(model, options) });
  return { pdf: Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength), layouts };
}

/**
 * Compiles IDEF0 DSL source (or an AST built with the TypeScript API) to a PDF with one page
 * per diagram. Throws {@link Idef0Error} if the source is invalid.
 */
export async function compile(source: string | DocumentAst, options: PdfOptions = {}): Promise<CompileResult> {
  const { model, warnings } = check(source);
  const { pdf, layouts } = await renderPdf(model, options);
  return { pdf, model, layouts, warnings };
}
