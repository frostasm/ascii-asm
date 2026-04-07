// ── Hotkey definitions ─────────────────────────────────────────────────────
// Change shortcuts here; the handler and toolbar badges update automatically.

export interface HotkeyDef {
  /** DOM KeyboardEvent.key value */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  /** Text shown inside the <kbd> badge in the toolbar */
  label: string;
}

export const HOTKEYS = {
  run:       { key: 'F5',  ctrl: true,  shift: false, label: 'Ctrl+F5' },
  debug:     { key: 'F5',  ctrl: false, shift: false, label: 'F5'       },
  continue:  { key: 'F5',  ctrl: false, shift: false, label: 'F5'       },
  step:      { key: 'F10', ctrl: false, shift: false, label: 'F10'      },
  stop:      { key: 'F5',  ctrl: false, shift: true,  label: '⇧F5'     },
  reset:     { key: 'F5',  ctrl: true,  shift: true,  label: '⌃⇧F5'    },
  toggleFiles: { key: 'F3',  ctrl: false, shift: false, label: 'F3'     },
  newFile:     { key: 'F4',  ctrl: false, shift: false, label: 'F4'     },
  help:        { key: 'F1',  ctrl: false, shift: false, label: 'F1'     },
} satisfies Record<string, HotkeyDef>;

export type HotkeyAction = keyof typeof HOTKEYS;

/** Returns true when the keyboard event matches a given hotkey definition. */
export function matchesHotkey(e: KeyboardEvent, hk: HotkeyDef): boolean {
  return (
    e.key === hk.key &&
    !!e.ctrlKey  === !!hk.ctrl &&
    !!e.shiftKey === !!hk.shift
  );
}
