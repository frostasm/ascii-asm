import { ref, reactive, computed, shallowRef, markRaw } from 'vue';
import { Lexer } from '@core/lexer';
import { Parser } from '@core/parser';
import { VM, VMIO } from '@core/vm';
import { Debugger } from '@core/debugger';
import { VMState, Program, DataType, DATA_TYPE_SIZE } from '@core/types';
import { ParseError } from '@core/errors';
import { createEditor, setDebugLine } from '@editor/editor-setup';
import type { AppTheme } from './useTheme';
import type { EditorView } from '@codemirror/view';

const HELLO_WORLD = `#memory 32
#data 0, TEXT "Hello, World!$"

_start:
  WRITELN TEXT [0]
  HALT
`;

export function useAppStore() {
  // ── Internal (non-reactive) ──────────────────────────────
  let vm: VM | null = null;
  let dbg: Debugger | null = null;
  let currentProgram: Program | null = null;

  // ── Editor ───────────────────────────────────────────────
  const source = ref(HELLO_WORLD);
  const editorView = shallowRef<EditorView | null>(null);

  // ── VM state ─────────────────────────────────────────────
  const vmState = ref<VMState>(VMState.IDLE);
  const registers = ref<Record<string, any>>({ AX: null, BX: null, CX: null, DX: null });
  const flags = reactive({ ZF: false, SF: false, OF: false });
  const memory = ref<number[]>([]);
  const memorySize = ref(0);
  const memoryColors = ref<string[]>([]);
  const stdout = ref('');
  const currentLine = ref<number | null>(null);

  // ── Errors ───────────────────────────────────────────────
  const parseErrors = ref<ParseError[]>([]);
  const runtimeError = ref<string | null>(null);

  // ── Debug ────────────────────────────────────────────────
  const breakpoints = reactive(new Set<number>());

  // ── Computed ─────────────────────────────────────────────
  const canRun = computed(() =>
    vmState.value === VMState.IDLE || vmState.value === VMState.HALTED || vmState.value === VMState.ERROR
  );

  const canDebug = computed(() =>
    vmState.value === VMState.IDLE || vmState.value === VMState.HALTED || vmState.value === VMState.ERROR
  );

  const canStep = computed(() =>
    vmState.value === VMState.PAUSED || vmState.value === VMState.IDLE
  );

  const canContinue = computed(() =>
    vmState.value === VMState.PAUSED
  );

  const canStop = computed(() =>
    vmState.value === VMState.RUNNING || vmState.value === VMState.PAUSED || vmState.value === VMState.WAITING_INPUT
  );

  // ── Editor init ──────────────────────────────────────────
  function initEditor(el: HTMLElement, initialTheme: AppTheme = 'dark') {
    editorView.value = markRaw(createEditor(el, {
      onChange: (src: string) => {
        source.value = src;
        parseSource();
      },
      onBreakpointToggle: (line: number) => {
        if (breakpoints.has(line)) {
          breakpoints.delete(line);
        } else {
          breakpoints.add(line);
        }
      },
    }, source.value, initialTheme));
    parseSource();
  }

  // ── Parse ────────────────────────────────────────────────
  function parseSource() {
    try {
      const lexer = new Lexer(source.value);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const { program, errors } = parser.tryParse();
      parseErrors.value = errors;
      currentProgram = program;
      // Recompute per-cell colors from #data directives
      memoryColors.value = currentProgram ? computeColorMap(currentProgram) : [];
    } catch (e) {
      if (e instanceof ParseError) {
        parseErrors.value = [e];
      }
      currentProgram = null;
    }
  }

  /**
   * Build a per-cell color array from the program's #data directives.
   * Cells without a color annotation get an empty string.
   */
  function computeColorMap(program: Program): string[] {
    const colors: string[] = new Array(program.memory.size).fill('');
    for (const d of program.data) {
      if (!d.color) continue;
      const cellCount = d.dataType === DataType.TEXT
        ? (d.value as string).length  // TEXT value always includes the '$' terminator
        : DATA_TYPE_SIZE[d.dataType];
      for (let i = 0; i < cellCount; i++) {
        const idx = d.address + i;
        if (idx < colors.length) colors[idx] = d.color;
      }
    }
    return colors;
  }

  // ── Build VM ─────────────────────────────────────────────
  function buildVM(): boolean {
    parseSource();
    if (!currentProgram || parseErrors.value.length > 0) {
      return false;
    }

    const io: VMIO = {
      requestInput: (prompt?: string) => {
        const message = prompt ? prompt : 'Program is waiting for input:';
        const value = window.prompt(message) ?? '';
        return Promise.resolve(value);
      },
      writeOutput: (text: string) => {
        stdout.value += text;
      },
    };

    vm = new VM(currentProgram, io);
    dbg = new Debugger(vm);

    // Sync breakpoints
    for (const line of breakpoints) {
      dbg.addBreakpoint(line);
    }

    updateStateFromVM();
    return true;
  }

  // ── State sync ───────────────────────────────────────────
  function updateStateFromVM() {
    if (!vm) return;
    vmState.value = vm.state;
    registers.value = vm.registers.getSnapshot() as Record<string, any>;
    flags.ZF = vm.registers.getFlagsSnapshot().ZF;
    flags.SF = vm.registers.getFlagsSnapshot().SF;
    flags.OF = vm.registers.getFlagsSnapshot().OF;
    memory.value = vm.memory.getSnapshot();
    memorySize.value = vm.memory.size;
    currentLine.value = vm.currentLine;

    if (editorView.value) {
      setDebugLine(editorView.value, currentLine.value);
    }
  }

  // ── Actions ──────────────────────────────────────────────
  async function run() {
    runtimeError.value = null;
    stdout.value = '';
    if (!buildVM() || !vm) return;

    vm.state = VMState.RUNNING;
    const result = await vm.run();
    if (result.error) {
      runtimeError.value = result.error;
    }
    updateStateFromVM();
  }

  async function debug() {
    runtimeError.value = null;
    stdout.value = '';
    if (!buildVM() || !dbg) return;

    // Sync breakpoints to debugger
    dbg.clearBreakpoints();
    for (const line of breakpoints) {
      dbg.addBreakpoint(line);
    }

    const result = await dbg.start();
    if (result.error) {
      runtimeError.value = result.error;
    }
    updateStateFromVM();
  }

  async function stepOver() {
    if (!dbg) {
      // First step → build VM
      if (!buildVM() || !dbg) return;
      runtimeError.value = null;
      stdout.value = '';
    }
    const result = await dbg.stepOver();
    if (result.error) {
      runtimeError.value = result.error;
    }
    updateStateFromVM();
  }

  async function continueExecution() {
    if (!dbg) return;
    const result = await dbg.continue();
    if (result.error) {
      runtimeError.value = result.error;
    }
    updateStateFromVM();
  }

  function stop() {
    if (dbg) {
      dbg.stop();
      updateStateFromVM();
    }
  }

  function reset() {
    if (dbg) {
      dbg.reset();
    }
    stdout.value = '';
    runtimeError.value = null;
    vmState.value = VMState.IDLE;
    currentLine.value = null;
    registers.value = { AX: null, BX: null, CX: null, DX: null };
    flags.ZF = false;
    flags.SF = false;
    flags.OF = false;
    memory.value = [];
    memorySize.value = 0;

    if (editorView.value) {
      setDebugLine(editorView.value, null);
    }

    vm = null;
    dbg = null;
  }

  // ── Clear console ────────────────────────────────────────────
  function clearConsole() {
    stdout.value = '';
  }

  // ── Programmatic source update ─────────────────────────────
  function setSource(code: string) {
    source.value = code;
    if (editorView.value) {
      const view = editorView.value;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
      });
    }
    parseSource();
  }

  return {
    // State
    source,
    editorView,
    vmState,
    registers,
    flags,
    memory,
    memorySize,
    memoryColors,
    stdout,
    currentLine,
    parseErrors,
    runtimeError,
    breakpoints,

    // Computed
    canRun,
    canDebug,
    canStep,
    canContinue,
    canStop,

    // Actions
    initEditor,
    setSource,
    run,
    debug,
    stepOver,
    continueExecution,
    stop,
    reset,
    clearConsole,
  };
}
