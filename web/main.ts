/**
 * The editor page: model source on the left, the compiled PDF on the right. Everything runs
 * in the browser; the PDF is recompiled shortly after each change. The source can be opened
 * from and saved to .idef0 files.
 */
import boldFontUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url';
import regularFontUrl from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import example from '../examples/workshop.idef0?raw';
import { analyze, Idef0Error, needsUnicodeFont, parse, renderPdf, type Diagnostic, type FontFiles, type Model } from '../src/browser.ts';
import { createEditor } from './editor.ts';
import { downloadFile, openFile, saveFile, type ModelFile } from './files.ts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const STORAGE_KEY = 'idef0-editor.source';
/** Pause after typing before the model is recompiled, in ms. */
const DEBOUNCE = 300;

const problems = element<HTMLUListElement>('#problems');
const preview = element<HTMLElement>('#preview');
const status = element<HTMLElement>('#status');
const download = element<HTMLButtonElement>('#download');
const fileLabel = element<HTMLElement>('#file-name');
const openButton = element<HTMLButtonElement>('#open');
const saveButton = element<HTMLButtonElement>('#save');

/** The last PDF compiled without errors, and its model. */
let current: { bytes: Uint8Array<ArrayBuffer>; model: Model } | undefined;
/** The file the source was opened from or last saved to, and the text it got. */
let file: (ModelFile & { saved: string }) | undefined;
/** DejaVu Sans, fetched the first time a model has text that Helvetica cannot show. */
let unicodeFonts: Promise<FontFiles> | undefined;
let unicodeFontsLoaded = false;
let compiles = 0;
let renders = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const editor = createEditor(element('#editor'), restore() ?? example, (text) => {
  store(text);
  showFile(text);
  clearTimeout(timer);
  timer = setTimeout(update, DEBOUNCE);
});
download.addEventListener('click', downloadPdf);
openButton.addEventListener('click', () => void open());
saveButton.addEventListener('click', (e) => void save(e.shiftKey));
document.addEventListener(
  'keydown',
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    // In layouts without Latin letters, such as Russian, the letter is the key's place on a US keyboard.
    const key = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^Key/, '').toLowerCase();
    if (key !== 'o' && key !== 's') return;
    e.preventDefault(); // the browser's own Open and Save Page
    if (e.repeat) return;
    if (key === 'o') void open();
    else void save(e.shiftKey);
  },
  { capture: true },
);
const mod = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';
openButton.title = `Open a .idef0 file (${mod}O)`;
saveButton.title = `Save the model to a .idef0 file (${mod}S; Shift+${mod}S to save as a new file)`;
element('#show-skill').addEventListener('click', async () => {
  const { showSkill } = await import('./skill.ts');
  showSkill(element<HTMLDialogElement>('#skill'));
});
new ResizeObserver(whenWidthChanges(preview, () => current && void show(current.bytes))).observe(preview);
void update();

async function update(): Promise<void> {
  const run = ++compiles;
  try {
    const ast = parse(editor.text());
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
    current = { bytes: pdf, model };
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
  editor.showProblems(diagnostics);

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
        button.addEventListener('click', () => editor.select(at));
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

function downloadPdf(): void {
  if (current) downloadFile(current.bytes, `${baseName()}.pdf`, 'application/pdf');
}

/** Replaces the source with a file's; the replacement can be undone. */
async function open(): Promise<void> {
  try {
    const opened = await openFile();
    if (!opened) return;
    editor.replace(opened.text);
    file = { name: opened.name, handle: opened.handle, saved: editor.text() };
    showFile(file.saved);
  } catch (e) {
    fileProblem('open', e);
  }
}

/** Saves the source to its file, or asks where to save it the first time and when `asNew`. */
async function save(asNew = false): Promise<void> {
  const text = editor.text();
  try {
    const saved = await saveFile(text, { name: `${baseName()}.idef0`, handle: asNew ? undefined : file?.handle });
    if (!saved) return;
    file = { ...saved, saved: text };
    showFile(editor.text());
  } catch (e) {
    fileProblem('save', e);
  }
}

/** Shows the file's name, marked while the source has changes that are not saved. */
function showFile(text: string): void {
  const edited = file !== undefined && text !== file.saved;
  fileLabel.hidden = !file;
  fileLabel.replaceChildren(file?.name ?? '');
  if (edited) {
    const mark = span('edited', '•');
    mark.title = 'Unsaved changes';
    mark.setAttribute('aria-hidden', 'true');
    fileLabel.append(mark, span('visually-hidden', '(unsaved changes)'));
  }
  document.title = file ? `${edited ? '• ' : ''}${file.name} – IDEF0 Editor` : 'IDEF0 Editor';
}

function fileProblem(action: 'open' | 'save', e: unknown): void {
  status.textContent = `Could not ${action} the file: ${e instanceof Error ? e.message : String(e)}`;
  status.classList.add('error');
}

/** The name for files made from the source: its file's name, or else the model's title. */
function baseName(): string {
  if (file) return file.name.replace(/\.[^.]*$/, '') || 'model';
  const title = current ? (current.model.meta.title ?? current.model.top.name) : '';
  return title.replace(/\s+/g, ' ').replace(/[\\/:*?"<>|]/g, '').trim() || 'model';
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
