import { ViewPlugin, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// Matches the optional #RRGGBB or #RRGGBBAA color parameter in #data directives
const HEX_COLOR_RE = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6})\b/g;

class ColorSwatchWidget extends WidgetType {
  constructor(readonly color: string) { super(); }

  eq(other: ColorSwatchWidget): boolean {
    return other.color === this.color;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-color-swatch';
    span.style.backgroundColor = this.color;
    span.setAttribute('aria-hidden', 'true');
    span.title = this.color;
    return span;
  }

  ignoreEvent(): boolean { return true; }
}

function buildSwatchDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;

  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to);
    HEX_COLOR_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HEX_COLOR_RE.exec(text)) !== null) {
      // Insert swatch immediately after the closing character of the hex color
      const pos = from + match.index + match[0].length;
      builder.add(pos, pos, Decoration.widget({
        widget: new ColorSwatchWidget('#' + match[1]),
        side: 1,
      }));
    }
  }

  return builder.finish();
}

export const colorSwatchPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildSwatchDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildSwatchDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
