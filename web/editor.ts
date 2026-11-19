/** The source editor: CodeMirror with IDEF0 highlighting, indentation, folding and problems. */
import { foldService, HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic as Mark } from '@codemirror/lint';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import type { Diagnostic, Span } from '../src/browser.ts';
import { ACTIVITY_KEYWORDS, META_KEYS, ROLE_KEYWORDS } from '../src/parser.ts';

export interface Editor {
  text(): string;
  /** Replaces the whole text with one change, which can be undone, and goes to the start. */
  replace(text: string): void;
  /** Selects a span of the source, scrolls to it and focuses the editor. */
  select(span: Span): void;
  /** Underlines the problems in the source and marks their lines. */
  showProblems(diagnostics: readonly Diagnostic[]): void;
}

export function createEditor(parent: HTMLElement, doc: string, onChange: (text: string) => void): Editor {
  const dark = new Compartment();
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        StreamLanguage.define(idef0),
        foldBraces,
        syntaxHighlighting(highlightStyle),
        lintGutter(),
        theme,
        dark.of(EditorView.darkTheme.of(scheme.matches)),
        EditorView.contentAttributes.of({ 'aria-label': 'Model source' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
      ],
    }),
  });
  scheme.addEventListener('change', () => view.dispatch({ effects: dark.reconfigure(EditorView.darkTheme.of(scheme.matches)) }));

  return {
    text: () => view.state.doc.toString(),
    replace(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 }, scrollIntoView: true });
      view.focus();
    },
    select(span) {
      const length = view.state.doc.length;
      const from = Math.min(span.offset, length);
      view.dispatch({ selection: { anchor: from, head: Math.min(from + span.length, length) }, scrollIntoView: true });
      view.focus();
    },
    showProblems(diagnostics) {
      const length = view.state.doc.length;
      const marks: Mark[] = [];
      for (const d of diagnostics) {
        if (!d.span) continue;
        const from = Math.min(d.span.offset, length);
        const message = d.hint ? `${d.message}\n${d.hint}` : d.message;
        marks.push({ from, to: Math.min(from + d.span.length, length), severity: d.severity, message });
      }
      view.dispatch(setDiagnostics(view.state, marks));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The language

interface State {
  depth: number;
  inComment: boolean;
  /** The next word starts a statement, so it can be a keyword. */
  atStatement: boolean;
  /** The last token was a comma: the list of labels goes on, maybe on the next line. */
  afterComma: boolean;
  /** The last token was `activity`, so a node number may follow. */
  afterActivity: boolean;
}

const ACTIVITY = new Set(ACTIVITY_KEYWORDS);
const SETTINGS = new Set(META_KEYS);
const STOP = new Set([' ', '\t', '{', '}', '(', ')', ',', ';', '"']);

/** Tokens as the lexer reads them; keywords count only where the parser takes them as such. */
const idef0: StreamParser<State> = {
  name: 'idef0',
  startState: () => ({ depth: 0, inComment: false, atStatement: true, afterComma: false, afterActivity: false }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    if (stream.sol() && !state.afterComma) state.atStatement = true;
    if (state.inComment) {
      if (stream.skipTo('*/')) {
        stream.pos += 2;
        state.inComment = false;
      } else {
        stream.skipToEnd();
      }
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('#') || stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.inComment = true;
      return 'comment';
    }

    const c = stream.next()!;
    if (c === '"') {
      while (!stream.eol()) {
        const d = stream.next();
        if (d === '\\') stream.next();
        else if (d === '"') break;
      }
      return label(state);
    }
    if (c === '{' || c === '}' || c === ';') {
      state.depth = Math.max(0, state.depth + (c === '{' ? 1 : c === '}' ? -1 : 0));
      state.atStatement = true;
      state.afterComma = false;
      state.afterActivity = false;
      return c === ';' ? 'punctuation' : 'brace';
    }
    if (c === ',') {
      state.afterComma = true;
      return 'punctuation';
    }
    if (c === '(' || c === ')') return 'paren';

    // A word: up to a space, punctuation, a quote or a comment.
    while (!stream.eol()) {
      const d = stream.peek()!;
      if (STOP.has(d) || (d === '/' && (stream.string[stream.pos + 1] === '/' || stream.string[stream.pos + 1] === '*'))) break;
      stream.next();
    }
    const word = stream.current();
    const atStatement = state.atStatement;
    if (ACTIVITY.has(word)) {
      Object.assign(state, { atStatement: false, afterComma: false, afterActivity: true });
      return 'keyword';
    }
    if (state.afterActivity && /^A-?\d+$/.test(word)) {
      state.afterActivity = false;
      return 'number';
    }
    if (atStatement && state.depth > 0 && Object.hasOwn(ROLE_KEYWORDS, word)) {
      Object.assign(state, { atStatement: false, afterComma: false });
      return 'typeName';
    }
    if (atStatement && state.depth === 0 && SETTINGS.has(word)) {
      Object.assign(state, { atStatement: false, afterComma: false });
      return 'propertyName';
    }
    return label(state);
  },
  indent(state, textAfter, cx) {
    return Math.max(0, state.depth - (/^\s*\}/.test(textAfter) ? 1 : 0)) * cx.unit;
  },
  languageData: {
    commentTokens: { line: '#', block: { open: '/*', close: '*/' } },
    indentOnInput: /^\s*\}$/,
    closeBrackets: { brackets: ['(', '{', '"'] },
  },
};

/** A label, name or setting value, quoted or not. */
function label(state: State): string {
  Object.assign(state, { atStatement: false, afterComma: false, afterActivity: false });
  return 'string';
}

/** Folds an activity's body: from its `{` to the `}` indented like the line that opens it. */
const foldBraces = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const open = line.text.lastIndexOf('{');
  if (open < 0 || !/\{\s*(?:(?:#|\/\/).*)?$/.test(line.text)) return null;
  const indent = /^\s*/.exec(line.text)![0].length;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const next = state.doc.line(n);
    if (!next.text.trim()) continue;
    const nextIndent = /^\s*/.exec(next.text)![0].length;
    if (nextIndent > indent) continue;
    return next.text.trimStart().startsWith('}') && n > line.number + 1 ? { from: line.from + open + 1, to: next.from + nextIndent } : null;
  }
  return null;
});

// ---------------------------------------------------------------------------------------------
// Looks: colours come from CSS variables, so light and dark mode follow the page.

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: tags.typeName, color: 'var(--syntax-role)' },
  { tag: tags.propertyName, color: 'var(--syntax-setting)' },
  { tag: tags.string, color: 'var(--syntax-label)' },
  { tag: tags.number, color: 'var(--syntax-node)' },
  { tag: tags.paren, color: 'var(--syntax-tunnel)', fontWeight: '600' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--fg)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--muted)', borderRight: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
});
