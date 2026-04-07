import { EditorView, Decoration, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap, gutter, GutterMarker } from '@codemirror/view';
import { EditorState, StateField, StateEffect, RangeSet, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, toggleComment } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentUnit } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import type { AppTheme } from '../composables/useTheme';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { asciiAsmLanguage } from './asciiasm-language';
import { asciiAsmLinter } from './asciiasm-linter';
import { asciiAsmAutocomplete } from './asciiasm-autocomplete';
import { colorSwatchPlugin } from './asciiasm-color-swatch';

// ── Theme compartment ────────────────────────────────────────

const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

function buildThemeExtension(theme: AppTheme) {
  return theme === 'dark' ? oneDark : [];
}

// ── Breakpoint gutter ──────────────────────────────────────

const breakpointEffect = StateEffect.define<{ pos: number; on: boolean }>();
const breakpointClearEffect = StateEffect.define<void>();

const breakpointState = StateField.define<RangeSet<GutterMarker>>({
  create() { return RangeSet.empty; },
  update(set, transaction) {
    set = set.map(transaction.changes);
    for (const e of transaction.effects) {
      if (e.is(breakpointClearEffect)) {
        set = RangeSet.empty;
      } else if (e.is(breakpointEffect)) {
        if (e.value.on) {
          set = set.update({ add: [breakpointMarker.range(e.value.pos)] });
        } else {
          set = set.update({ filter: from => from !== e.value.pos });
        }
      }
    }
    return set;
  },
});

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-breakpoint-marker';
    el.textContent = '●';
    return el;
  }
}

const breakpointMarker = new BreakpointMarker();

function breakpointGutter(onToggle: (line: number) => void) {
  return gutter({
    class: 'cm-breakpoint-gutter',
    markers: v => v.state.field(breakpointState),
    initialSpacer: () => breakpointMarker,
    domEventHandlers: {
      mousedown(view, line) {
        const lineNo = view.state.doc.lineAt(line.from).number;
        const bps = view.state.field(breakpointState);
        let hasBreakpoint = false;
        bps.between(line.from, line.from, () => { hasBreakpoint = true; });
        view.dispatch({
          effects: breakpointEffect.of({ pos: line.from, on: !hasBreakpoint }),
        });
        onToggle(lineNo);
        return true;
      },
    },
  });
}

// ── Active debug line highlight ────────────────────────────

export type DebugLineMode = 'paused' | 'halted';
interface ActiveDebugLine { line: number; mode: DebugLineMode; }

const activeDebugLineEffect = StateEffect.define<ActiveDebugLine | null>();

const activeDebugLineState = StateField.define<ActiveDebugLine | null>({
  create() { return null; },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(activeDebugLineEffect)) return e.value;
    }
    return value;
  },
});

const debugLinePausedDecoration = Decoration.line({ class: 'cm-debug-active-line' });
const debugLineHaltedDecoration = Decoration.line({ class: 'cm-debug-halted-line' });

const activeDebugLineDecoration = EditorView.decorations.compute(
  [activeDebugLineState],
  (state) => {
    const active = state.field(activeDebugLineState);
    if (active === null || active.line < 1 || active.line > state.doc.lines) return RangeSet.empty;
    const lineInfo = state.doc.line(active.line);
    const deco = active.mode === 'halted' ? debugLineHaltedDecoration : debugLinePausedDecoration;
    return RangeSet.of([deco.range(lineInfo.from)]);
  },
);

const debugGutterMarker = new class extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-debug-line-marker';
    el.textContent = '▶';
    return el;
  }
}();

const debugGutter = gutter({
  class: 'cm-debug-gutter',
  markers: (view) => {
    const active = view.state.field(activeDebugLineState);
    if (active === null || active.line < 1 || active.line > view.state.doc.lines) return RangeSet.empty;
    const lineInfo = view.state.doc.line(active.line);
    return RangeSet.of([debugGutterMarker.range(lineInfo.from)]);
  },
});

// ── Editor factory ─────────────────────────────────────────

export interface EditorCallbacks {
  onChange: (source: string) => void;
  onBreakpointToggle: (line: number) => void;
}

export function createEditor(
  parent: HTMLElement,
  callbacks: EditorCallbacks,
  initialSource = '',
  initialTheme: AppTheme = 'dark',
): EditorView {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      callbacks.onChange(update.state.doc.toString());
    }
  });

  const state = EditorState.create({
    doc: initialSource,
    extensions: [
      indentUnit.of('  '), // 2-space indentation
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      bracketMatching(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      themeCompartment.of(buildThemeExtension(initialTheme)),
      asciiAsmLanguage,
      asciiAsmLinter(),
      asciiAsmAutocomplete(),
      readOnlyCompartment.of(EditorState.readOnly.of(false)),
      breakpointState,
      breakpointGutter(callbacks.onBreakpointToggle),
      activeDebugLineState,
      activeDebugLineDecoration,
      debugGutter,
      colorSwatchPlugin,
      updateListener,
      keymap.of([
        // Tab: accept autocomplete when dropdown is open, otherwise indent
        {
          key: 'Tab',
          run: (view) => completionStatus(view.state) === 'active'
            ? acceptCompletion(view)
            : indentMore(view),
          shift: indentLess,
        },
        // Ctrl+/ — toggle line comment
        { key: 'Ctrl-/', run: toggleComment },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-breakpoint-gutter .cm-gutterElement': {
          cursor: 'pointer',
          color: '#e53935',
          fontSize: '14px',
          padding: '0 4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: '20px',
        },
        '.cm-debug-line-marker': {
          color: '#fdd835',
          fontSize: '12px',
        },
        '.cm-debug-active-line': {
          backgroundColor: 'rgba(253, 216, 53, 0.15)',
        },
        '.cm-debug-halted-line': {
          backgroundColor: 'rgba(39, 174, 96, 0.18)',
        },
        '.cm-color-swatch': {
          display: 'inline-block',
          width: '10px',
          height: '10px',
          borderRadius: '2px',
          marginLeft: '4px',
          verticalAlign: 'middle',
          border: '1px solid rgba(128, 128, 128, 0.4)',
          pointerEvents: 'none',
        },
      }),
    ],
  });

  return new EditorView({ state, parent });
}

/**
 * Highlight the current debug line in the editor.
 * @param mode 'paused' (yellow) while stepping/at breakpoint, 'halted' (green) when program ended.
 */
export function setDebugLine(view: EditorView, line: number | null, mode: DebugLineMode = 'paused'): void {
  view.dispatch({
    effects: activeDebugLineEffect.of(line !== null ? { line, mode } : null),
  });
}

/**
 * Dynamically switch the editor between dark and light themes.
 */
export function setEditorTheme(view: EditorView, theme: AppTheme): void {
  view.dispatch({
    effects: themeCompartment.reconfigure(buildThemeExtension(theme)),
  });
}

/**
 * Toggle the editor between read-only and editable.
 * Used to lock the editor during debugging/running.
 */
export function setEditorReadOnly(view: EditorView, readOnly: boolean): void {
  view.dispatch({
    effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
  });
}

/**
 * Programmatically replace all breakpoint markers in the editor gutter.
 * Used when loading a file that has saved breakpoints.
 */
export function setBreakpoints(view: EditorView, lines: number[]): void {
  const effects: StateEffect<any>[] = [breakpointClearEffect.of(undefined)];
  for (const lineNo of lines) {
    if (lineNo < 1 || lineNo > view.state.doc.lines) continue;
    const pos = view.state.doc.line(lineNo).from;
    effects.push(breakpointEffect.of({ pos, on: true }));
  }
  view.dispatch({ effects });
}

export { breakpointEffect, breakpointClearEffect, breakpointState };
