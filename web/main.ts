/**
 * The editor page: model source on the left, the compiled PDF on the right. Everything runs
 * in the browser; the PDF is recompiled shortly after each change.
 */
import boldFontUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url';
import regularFontUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import example from '../examples/workshop.idef0?raw';
import { analyze, Idef0Error, needsUnicodeFont, parse, renderPdf, type Diagnostic, type FontFiles, type Model, type Span } from '../src/browser.ts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const STORAGE_KEY = 'idef0-editor.source';
/** Pause after typing before the model is recompiled, in ms. */
const DEBOUNCE = 300;

const source = element<HTMLTextAreaElement>('#source');
const problems = element<HTMLUListElement>('#problems');
const preview = element<HTMLElement>('#preview');
const status = element<HTMLElement>('#status');
const download = element<HTMLButtonElement>('#download');

/** The last PDF compiled without errors. */
let current: { bytes: Uint8Array<ArrayBuffer>; name: string } | undefined;
/** DejaVu Sans, fetched the first time a model has text that Helvetica cannot show. */
let unicodeFonts: Promise<FontFiles> | undefined;
let unicodeFontsLoaded = false;
let compiles = 0;
let renders = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

source.value = restore() ?? example;
source.addEventListener('input', () => {
  store(source.value);
  clearTimeout(timer);
  timer = setTimeout(update, DEBOUNCE);
});
download.addEventListener('click', save);
new ResizeObserver(whenWidthChanges(preview, () => current && void show(current.bytes))).observe(preview);
void update();

async function update(): Promise<void> {
  const run = ++compiles;
  try {
    const ast = parse(source.value);
    const { model, warnings } = analyze(ast);
    const font = ast.meta.find((m) => m.key === 'font');
    if (font) {
      warnings.push({
        severity: 'warning',
        message: 'the font setting only works on the command line; here the PDF uses Helvetica, or DejaVu Sans if the text has characters Helvetica lacks',
        span: font.keySpan,
      });
    }
    let fonts: FontFiles | undefined;
    if (needsUnicodeFont(model)) {
      if (!unicodeFontsLoaded) status.textContent = 'Loading a font for non-Latin text…';
      fonts = await loadUnicodeFonts();
    }
    if (run !== compiles) return;
    const { pdf } = await renderPdf(model, { fonts });
    if (run !== compiles) return;
    current = { bytes: pdf, name: fileName(model) };
    download.disabled = false;
    download.title = '';
    report(warnings, `${count(model.diagrams.length, 'diagram')}`);
    await show(pdf);
    preview.classList.remove('stale');
  } catch (e) {
    if (run !== compiles) return;
    const diagnostics: Diagnostic[] = e instanceof Idef0Error ? e.diagnostics : [{ severity: 'error', message: String(e instanceof Error ? e.message : e) }];
    report(diagnostics);
    // The preview keeps the last good PDF, dimmed; downloading it would look like the current one.
    preview.classList.add('stale');
    download.disabled = true;
    download.title = 'Fix the errors to download the PDF';
  }
}

/** Lists the problems and sums them up in the status line. */
function report(diagnostics: readonly Diagnostic[], done?: string): void {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const parts = errors > 0 ? [count(errors, 'error')] : [done ?? ''];
  if (warnings > 0) parts.push(count(warnings, 'warning'));
  status.textContent = parts.join(' · ');
  status.classList.toggle('error', errors > 0);

  problems.replaceChildren(
    ...diagnostics.map((d) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = d.severity;
      button.append(
        span('where', d.span ? `${d.span.line}:${d.span.column}` : d.severity),
        span('message', d.message),
        ...(d.hint ? [span('hint', d.hint)] : []),
      );
      if (d.span) {
        const at = d.span;
        button.addEventListener('click', () => select(at));
      } else {
        button.disabled = true;
      }
      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );
  problems.hidden = diagnostics.length === 0;
}

/** Selects a span of the source and scrolls it into view. */
function select(at: Span): void {
  source.focus();
  source.setSelectionRange(at.offset, at.offset + at.length);
  const lineHeight = parseFloat(getComputedStyle(source).lineHeight) || 20;
  source.scrollTop = Math.max(0, (at.line - 4) * lineHeight);
}

/** Draws every page of the PDF, fitted to the preview's width, keeping the scroll position. */
async function show(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const run = ++renders;
  // pdf.js takes over the buffer it is given, so it gets a copy.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  try {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(200, preview.clientWidth - 32);
    const canvases: HTMLCanvasElement[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale: scale * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Page ${n}`);
      await page.render({ canvas, viewport }).promise;
      if (run !== renders) return;
      canvases.push(canvas);
    }
    const top = preview.scrollTop;
    preview.replaceChildren(...canvases);
    preview.scrollTop = top;
  } finally {
    void task.destroy();
  }
}

function loadUnicodeFonts(): Promise<FontFiles> {
  unicodeFonts ??= Promise.all([fetchBytes(regularFontUrl), fetchBytes(boldFontUrl)]).then(
    ([regular, bold]) => {
      unicodeFontsLoaded = true;
      return { regular, bold };
    },
    (e: unknown) => {
      unicodeFonts = undefined; // try again on the next change
      throw new Error(`could not load the font for non-Latin text: ${e instanceof Error ? e.message : String(e)}`);
    },
  );
  return unicodeFonts;
}

async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function save(): void {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([current.bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = current.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function fileName(model: Model): string {
  const title = (model.meta.title ?? model.top.name).replace(/\s+/g, ' ').replace(/[\\/:*?"<>|]/g, '').trim();
  return `${title || 'model'}.pdf`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

/** Calls `fn`, at most every 150 ms, when the element's width changes. */
function whenWidthChanges(target: HTMLElement, fn: () => void): ResizeObserverCallback {
  let width = target.clientWidth;
  let pending: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (target.clientWidth === width) return;
    width = target.clientWidth;
    clearTimeout(pending);
    pending = setTimeout(fn, 150);
  };
}

function restore(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function store(text: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // Private windows and blocked storage: the text just isn't kept.
  }
}
