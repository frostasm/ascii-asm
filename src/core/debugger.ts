import { VM } from './vm';
import { VMState, DebugState, StepResult, RegisterValue } from './types';

/**
 * AsciiAsm Debugger — wraps the VM with breakpoints and step control.
 */
export class Debugger {
  readonly vm: VM;
  private breakpoints = new Set<number>(); // source line numbers (1-based)

  constructor(vm: VM) {
    this.vm = vm;
  }

  // ── Breakpoint management ─────────────────────────────────

  addBreakpoint(line: number): void {
    this.breakpoints.add(line);
  }

  removeBreakpoint(line: number): void {
    this.breakpoints.delete(line);
  }

  toggleBreakpoint(line: number): boolean {
    if (this.breakpoints.has(line)) {
      this.breakpoints.delete(line);
      return false;
    } else {
      this.breakpoints.add(line);
      return true;
    }
  }

  hasBreakpoint(line: number): boolean {
    return this.breakpoints.has(line);
  }

  getBreakpoints(): Set<number> {
    return new Set(this.breakpoints);
  }

  clearBreakpoints(): void {
    this.breakpoints.clear();
  }

  // ── Execution control ─────────────────────────────────────

  /** Execute a single instruction.
   *  When called from IDLE, transitions to PAUSED at the first instruction
   *  without executing it (like VS Code F10 start behavior).
   */
  async stepOver(): Promise<StepResult> {
    if (this.vm.state === VMState.IDLE) {
      this.vm.state = VMState.PAUSED;
      return { state: VMState.PAUSED, currentLine: this.vm.currentLine };
    }
    return this.vm.step();
  }

  /** Run until next breakpoint, HALT, or error. */
  async continue(): Promise<StepResult> {
    return this.vm.run((line) => this.breakpoints.has(line), true);
  }

  /** Start debugging — run until first breakpoint or end. */
  async start(): Promise<StepResult> {
    return this.vm.run((line) => this.breakpoints.has(line), false);
  }

  /** Stop / abort execution. */
  stop(): void {
    this.vm.state = VMState.HALTED;
  }

  /** Reset VM to initial state. */
  reset(): void {
    this.vm.reset();
  }

  // ── State inspection ──────────────────────────────────────

  getState(): DebugState {
    return {
      vmState: this.vm.state,
      currentLine: this.vm.currentLine,
      registers: this.vm.registers.getSnapshot() as Record<string, RegisterValue | null>,
      flags: this.vm.registers.getFlagsSnapshot(),
      memory: this.vm.memory.getSnapshot(),
      stdout: this.vm.stdout,
      breakpoints: new Set(this.breakpoints),
    };
  }

  get isRunning(): boolean {
    return this.vm.state === VMState.RUNNING;
  }

  get isPaused(): boolean {
    return this.vm.state === VMState.PAUSED;
  }

  get isHalted(): boolean {
    return this.vm.state === VMState.HALTED;
  }

  get isError(): boolean {
    return this.vm.state === VMState.ERROR;
  }

  get isIdle(): boolean {
    return this.vm.state === VMState.IDLE;
  }
}
