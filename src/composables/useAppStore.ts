import { ref, reactive, computed, shallowRef, markRaw } from 'vue';
import { Lexer } from '@core/lexer';
import { Parser } from '@core/parser';
import { VM, VMIO } from '@core/vm';
import { Debugger } from '@core/debugger';
import { VMState, Program, DataType, DATA_TYPE_SIZE, VMStats, createEmptyStats, SPEED_PRESETS, AccessHighlights, createEmptyHighlights, PROGRAM_VISIBLE_REGISTERS, Register } from '@core/types';
import { ParseError } from '@core/errors';
import { createEditor, setDebugLine, setEditorReadOnly, setBreakpoints, toggleBreakpointLine, clearEditorHistory, type DebugLineMode } from '@editor/editor-setup';
import type { AppTheme } from './useTheme';
import type { EditorView } from '@codemirror/view';
import { undoDepth, redoDepth } from "@codemirror/commands"

const HELLO_WORLD = `#memory 32
#data 0, TEXT "Hello, World!$"

_start:
  WRITELN TEXT [0]
  HALT
`;

export function useAppStore() {
  const createEmptyRegisterState = () =>
    Object.fromEntries(PROGRAM_VISIBLE_REGISTERS.map(reg => [reg, reg === Register.IP ? { type: 'integer', value: 0 } : null])) as Record<string, any>;

  // ── Internal (non-reactive) ──────────────────────────────
  let vm: VM | null = null;
  let dbg: Debugger | null = null;
  let currentProgram: Program | null = null;

  // ── Editor ───────────────────────────────────────────────
  const source = ref(HELLO_WORLD);
  const editorView = shallowRef<EditorView | null>(null);

  // ── VM state ─────────────────────────────────────────────
  const vmState = ref<VMState>(VMState.IDLE);
  const registers = ref<Record<string, any>>(createEmptyRegisterState());
  const flags = reactive({ ZF: false, SF: false, OF: false });
  const memory = ref<number[]>([]);
  const memorySize = ref(0);
  const memoryColors = ref<string[]>([]);
  const stdout = ref('');
  const currentLine = ref<number | null>(null);

  // ── Speed & Statistics ───────────────────────────────────
  const SPEED_KEY = 'asciiasm-speed';
  const savedSpeed = localStorage.getItem(SPEED_KEY);
  const speed = ref<number>(savedSpeed ? Number(savedSpeed) : Infinity);
  const stats = reactive<VMStats>(createEmptyStats());

  // ── Access Visualization ────────────────────────────────
  /** Visualization is disabled when speed exceeds this threshold (IPS). */
  const VISUALIZATION_IPS_THRESHOLD = 10;
  const accessHighlights = ref<AccessHighlights>(createEmptyHighlights());
  const accessVisualizationEnabled = computed(
    () => speed.value <= VISUALIZATION_IPS_THRESHOLD,
  );

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
    vmState.value === VMState.PAUSED || vmState.value === VMState.IDLE || vmState.value === VMState.HALTED
  );

  const canContinue = computed(() =>
    vmState.value === VMState.PAUSED
  );

  const canRunToCursor = computed(() =>
    vmState.value === VMState.IDLE   ||
    vmState.value === VMState.PAUSED ||
    vmState.value === VMState.HALTED
  );

  const canStop = computed(() =>
    vmState.value === VMState.RUNNING || vmState.value === VMState.PAUSED || vmState.value === VMState.WAITING_INPUT
  );

  const canPause = computed(() =>
    vmState.value === VMState.RUNNING || vmState.value === VMState.WAITING_INPUT
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
        // Keep the live debugger in sync so toggling during RUNNING/PAUSED takes effect immediately
        if (dbg) dbg.toggleBreakpoint(line);
      },
    }, source.value, initialTheme));
    parseSource();
  }

  // ── Load breakpoints from a saved file ───────────────────
  function loadBreakpoints(lines: number[]) {
    breakpoints.clear();
    for (const l of lines) breakpoints.add(l);
    if (editorView.value) setBreakpoints(editorView.value, lines);
    if (dbg) {
      dbg.clearBreakpoints();
      for (const l of lines) dbg.addBreakpoint(l);
    }
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
   * Auto-color palette applied to #data directives that have no explicit color.
   * Chosen to be clearly distinct from the memory-access highlight colors:
   *   green #22c55e (read), red #ef4444 (write), orange #f59e0b (read+write).
   */
  const AUTO_DATA_COLORS = [
    '#3b82f6', // blue
    '#a855f7', // purple
    '#06b6d4', // cyan
    '#ec4899', // pink
  ] as const;

  /**
   * Build a per-cell color array from the program's #data directives.
   * Directives without an explicit color annotation receive an auto-assigned
   * color cycling through AUTO_DATA_COLORS.
   */
  function computeColorMap(program: Program): string[] {
    const colors: string[] = new Array(program.memory.size).fill('');
    let autoIdx = 0;
    for (const d of program.data) {
      const color = d.color ?? AUTO_DATA_COLORS[autoIdx++ % AUTO_DATA_COLORS.length];
      const cellCount = d.dataType === DataType.TEXT
        ? (d.value as string).length  // TEXT value always includes the '$' terminator
        : DATA_TYPE_SIZE[d.dataType];
      for (let i = 0; i < cellCount; i++) {
        const idx = d.address + i;
        if (idx < colors.length) colors[idx] = color;
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
    vm.speed = speed.value;
    vm.onAfterStep = () => updateStateFromVM();
    dbg = new Debugger(vm);

    // Sync breakpoints
    for (const line of breakpoints) {
      dbg.addBreakpoint(line);
    }

    updateStateFromVM();
    return true;
  }

  // ── State sync ───────────────────────────────────────────

  /** Sync all reactive state from the VM — vmState, registers, memory, stats, etc. */
  function updateStateFromVM(accessVisualization: boolean = false) {
    if (!vm) return;
    vmState.value = vm.state;
    registers.value = vm.registers.getSnapshot(vm.instructionPointer) as Record<string, any>;
    flags.ZF = vm.registers.getFlagsSnapshot().ZF;
    flags.SF = vm.registers.getFlagsSnapshot().SF;
    flags.OF = vm.registers.getFlagsSnapshot().OF;
    memory.value = vm.memory.getSnapshot();
    memorySize.value = vm.memory.size;
    currentLine.value = vm.currentLine;

    // Sync stats
    const s = vm.stats;
    stats.totalInstructions = s.totalInstructions;
    stats.instructionCounts = { ...s.instructionCounts };
    stats.memoryReads = s.memoryReads;
    stats.memoryReadBytes = s.memoryReadBytes;
    stats.memoryWrites = s.memoryWrites;
    stats.memoryWriteBytes = s.memoryWriteBytes;
    stats.registerReads = s.registerReads;
    stats.registerWrites = s.registerWrites;

    // Sync access highlights (only when visualization is enabled)
    if (accessVisualizationEnabled.value || accessVisualization) {
      accessHighlights.value = {
        memReads:  [...vm.lastAccess.memReads],
        memWrites: [...vm.lastAccess.memWrites],
        regReads:  [...vm.lastAccess.regReads],
        regWrites: [...vm.lastAccess.regWrites],
      };
    } else {
      accessHighlights.value = createEmptyHighlights();
    }

    if (editorView.value) {
      const mode: DebugLineMode = vm.state === VMState.HALTED ? 'halted' : 'paused';
      setDebugLine(editorView.value, currentLine.value, mode);
      const isActive = vm.state === VMState.RUNNING || vm.state === VMState.PAUSED || vm.state === VMState.WAITING_INPUT;
      setEditorReadOnly(editorView.value, isActive);
    }
  }

  // ── Actions ──────────────────────────────────────────────
  async function run() {
    runtimeError.value = null;
    stdout.value = '';
    if (!buildVM() || !vm) return;

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
    if (!dbg || vmState.value === VMState.HALTED) {
      // No VM yet, or previous run finished/errored — build a fresh VM
      if (!buildVM() || !dbg) return;
      runtimeError.value = null;
      stdout.value = '';
    }
    const result = await dbg.stepOver();
    if (result.error) {
      runtimeError.value = result.error;
    }
    updateStateFromVM(true /* accessVisualization */);
  }

  async function continueExecution() {
    if (!dbg) return;
    const result = await dbg.continue();
    if (result.error) {
      runtimeError.value = result.error;
    }
    updateStateFromVM();
  }

  async function runToCursor() {
    const view = editorView.value;
    if (!view) return;
    const cursorPos = view.state.selection.main.head;
    const targetLine = view.state.doc.lineAt(cursorPos).number;

    // Rebuild the VM when starting fresh (IDLE, HALTED, ERROR)
    const needFreshVM = !dbg ||
      vmState.value === VMState.HALTED ||
      vmState.value === VMState.ERROR;

    if (needFreshVM) {
      if (!buildVM() || !dbg) return;
      runtimeError.value = null;
      stdout.value = '';
    }

    const result = await dbg!.runToCursor(targetLine);
    if (result.error) {
      runtimeError.value = result.error;
    }
    updateStateFromVM(true /* accessVisualization */);
  }

  function toggleBreakpointAtCursor() {
    const view = editorView.value;
    if (!view) return;
    const cursorPos = view.state.selection.main.head;
    const lineNo = view.state.doc.lineAt(cursorPos).number;
    const nowSet = toggleBreakpointLine(view, lineNo);
    if (nowSet) {
      breakpoints.add(lineNo);
    } else {
      breakpoints.delete(lineNo);
    }
    if (dbg) dbg.toggleBreakpoint(lineNo);
  }

  function stop() {
    if (dbg) {
      dbg.stop();
      updateStateFromVM(true /* accessVisualization */);
    }
  }

  function pause() {
    if (dbg) {
      dbg.pause();
      updateStateFromVM(true /* accessVisualization */);
    }
  }

  function setSpeed(value: number) {
    speed.value = value;
    localStorage.setItem(SPEED_KEY, String(value));
    if (vm) {
      vm.speed = value;
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
    registers.value = createEmptyRegisterState();
    flags.ZF = false;
    flags.SF = false;
    flags.OF = false;
    memory.value = [];
    memorySize.value = 0;

    // Reset stats
    Object.assign(stats, createEmptyStats());

    accessHighlights.value = createEmptyHighlights();

    if (editorView.value) {
      setDebugLine(editorView.value, null);
      setEditorReadOnly(editorView.value, false);
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
      clearEditorHistory(view);
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
    speed,
    stats,
    accessHighlights,
    accessVisualizationEnabled,

    // Computed
    canRun,
    canDebug,
    canStep,
    canContinue,
    canStop,
    canPause,
    canRunToCursor,

    // Actions
    initEditor,
    loadBreakpoints,
    setSource,
    run,
    debug,
    stepOver,
    continueExecution,
    runToCursor,
    toggleBreakpointAtCursor,
    stop,
    pause,
    reset,
    clearConsole,
    setSpeed,
    SPEED_PRESETS,
  };
}
