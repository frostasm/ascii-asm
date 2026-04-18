import {
  Program, Instruction, Mnemonic, Operand, Register, DataType,
  RegisterValue, VMState, StepResult, DATA_TYPE_RANGE, DATA_TYPE_SIZE,
  JUMP_MNEMONICS, OverflowMode, VMStats, createEmptyStats,
  AccessHighlights, createEmptyHighlights, AddressExpression,
} from './types';
import { Memory } from './memory';
import { RegisterFile } from './registers';
import { RuntimeError, TypeMismatchError, TypeOverflowError } from './errors';

/**
 * Callback interface for VM I/O.
 */
export interface VMIO {
  /** Called when VM needs input. The optional prompt string comes from the READ instruction. */
  requestInput(prompt?: string): Promise<string>;
  /** Called when VM writes output. */
  writeOutput(text: string): void;
}

/**
 * AsciiAsm Virtual Machine.
 * Executes a parsed Program step by step.
 */
export class VM {
  memory: Memory;
  registers: RegisterFile;
  program: Program;
  private ip = 0; // instruction pointer (index into program.instructions)
  state: VMState = VMState.IDLE;
  private overflowMode: OverflowMode;
  private io: VMIO;
  stdout = '';

  // ── Execution control flags ────────────────────────────
  private _pauseRequested = false;
  private _stopRequested = false;

  /** Instructions per second (Infinity = unlimited). */
  speed: number = Infinity;

  /** Execution statistics — reset on reset(). */
  stats: VMStats = createEmptyStats();

  /**
   * Per-cell and per-register access highlights for the most recently executed
   * instruction. Reset at the start of every _step() call.
   */
  lastAccess: AccessHighlights = createEmptyHighlights();

  /** Optional callback fired after each step in run() for live UI updates. */
  onAfterStep?: () => void;

  constructor(program: Program, io: VMIO) {
    this.program = program;
    this.io = io;
    this.overflowMode = program.overflow;

    // Initialize memory
    this.memory = new Memory(program.memory.size, program.memory.initValue);

    // Apply #data directives
    for (const d of program.data) {
      this.memory.initializeData(d.address, d.dataType, d.value);
    }

    // Initialize registers
    this.registers = new RegisterFile();

    // Set IP to _start
    const startIndex = program.labels.get('_start');
    if (startIndex !== undefined) {
      this.ip = startIndex;
    }
  }

  /** Current source line (1-based) or null if not running. */
  get currentLine(): number | null {
    if (this.ip < this.program.instructions.length) {
      return this.program.instructions[this.ip].line;
    }
    return null;
  }

  /** Current instruction pointer. */
  get instructionPointer(): number {
    return this.ip;
  }

  // ── Pause / Stop requests ──────────────────────────────

  /** Request the VM to pause at the next opportunity. */
  requestPause(): void {
    this._pauseRequested = true;
  }

  /** Request the VM to stop at the next opportunity.
   *  Sets the stop flag for the run() loop, and also sets HALTED directly
   *  if the VM is not currently inside run(). */
  requestStop(): void {
    this._stopRequested = true;
    // Also set HALTED immediately for non-running states (IDLE, PAUSED, ERROR)
    // so callers that aren't inside a run() loop see the state change.
    if (this.state !== VMState.RUNNING && this.state !== VMState.WAITING_INPUT) {
      this.state = VMState.HALTED;
    }
  }

  /** Reset VM to initial state. */
  reset(): void {
    this.memory = new Memory(this.program.memory.size, this.program.memory.initValue);
    for (const d of this.program.data) {
      this.memory.initializeData(d.address, d.dataType, d.value);
    }
    this.registers.reset();
    this.stdout = '';
    this.state = VMState.IDLE;
    this._pauseRequested = false;
    this._stopRequested = false;
    this.stats = createEmptyStats();
    this.lastAccess = createEmptyHighlights();
    const startIndex = this.program.labels.get('_start');
    this.ip = startIndex ?? 0;
  }

  /** Execute one instruction and pause. Public API for single-stepping. */
  async step(): Promise<StepResult> {
    return this._step(VMState.PAUSED);
  }

  /**
   * Core execution of a single instruction.
   * @param successState — the state to set after a normal (non-terminal) instruction.
   *   - `PAUSED` when called from public `step()` (user is single-stepping).
   *   - `RUNNING` when called from `run()` (continuous execution loop).
   *   Terminal states (HALTED, ERROR, WAITING_INPUT) are set by instruction
   *   handlers and always take precedence.
   */
  private async _step(successState: VMState): Promise<StepResult> {
    if (this.state === VMState.HALTED || this.state === VMState.ERROR) {
      return { state: this.state, currentLine: this.currentLine };
    }

    if (this.ip >= this.program.instructions.length) {
      this.state = VMState.ERROR;
      return { state: this.state, currentLine: null, error: 'Unexpected end of program (missing HALT)' };
    }

    this.state = VMState.RUNNING;
    this.lastAccess = createEmptyHighlights(); // reset per-instruction access tracking
    const instr = this.program.instructions[this.ip];
    let output: string | undefined;

    try {
      const result = await this.executeInstruction(instr);
      output = result?.output;
    } catch (e) {
      this.state = VMState.ERROR;
      const msg = e instanceof Error ? e.message : String(e);
      return { state: this.state, currentLine: instr.line, error: msg };
    }

    // Track instruction stats (covers both step() and run() paths)
    this.stats.totalInstructions++;
    const m = instr.mnemonic;
    this.stats.instructionCounts[m] = (this.stats.instructionCounts[m] ?? 0) + 1;

    if ((this.state as VMState) === VMState.HALTED) {
      return { state: this.state, currentLine: instr.line, output };
    }

    this.state = successState;
    return { state: this.state, currentLine: this.currentLine, output };
  }

  /**
   * Yield to the browser event loop for speed control.
   * - Unlimited speed: yields every ~1000 steps via setTimeout(0).
   * - Finite speed: delays by 1000/speed ms per instruction.
   */
  private throttle(steps: number): Promise<void> {
    if (!isFinite(this.speed)) {
      // Unlimited: yield every 1000 steps so the browser can process events
      if (steps % 1000 === 0) {
        return new Promise(r => setTimeout(r, 0));
      }
      return Promise.resolve();
    }
    // Finite speed: delay between instructions
    const delay = 1000 / this.speed;
    return new Promise(r => setTimeout(r, delay));
  }

  /** Run until HALT, error, or breakpoint callback returns true.
   *  @param shouldPause — callback checked before each instruction; return true to pause.
   *  @param skipFirstCheck — when true, skip the breakpoint check on the very first
   *         iteration (used by continue() to avoid re-pausing on the current line).
   */
  async run(shouldPause?: (line: number) => boolean, skipFirstCheck = false): Promise<StepResult> {
    this.state = VMState.RUNNING;
    this._pauseRequested = false;
    this._stopRequested = false;
    let lastResult: StepResult = { state: this.state, currentLine: this.currentLine };
    let steps = 0;
    const MAX_STEPS = 1_000_000; // safety limit

    while (steps < MAX_STEPS) {
      // ── Check pause/stop requests ────────────────────────
      if (this._stopRequested) {
        this._stopRequested = false;
        this.state = VMState.HALTED;
        return { state: VMState.HALTED, currentLine: this.currentLine };
      }
      if (this._pauseRequested) {
        this._pauseRequested = false;
        this.state = VMState.PAUSED;
        return { state: VMState.PAUSED, currentLine: this.currentLine };
      }

      // Check breakpoint before executing (skip the first check when resuming
      // from a breakpoint via continue(), to avoid re-pausing on the same line).
      if (shouldPause && this.currentLine !== null && shouldPause(this.currentLine)
          && !(skipFirstCheck && steps === 0)) {
        this.state = VMState.PAUSED;
        return { state: VMState.PAUSED, currentLine: this.currentLine };
      }

      const instr = this.ip < this.program.instructions.length
        ? this.program.instructions[this.ip]
        : null;

      // _step(RUNNING) keeps state as RUNNING after normal execution,
      // so the loop continues naturally without state overrides.
      lastResult = await this._step(VMState.RUNNING);

      // Notify listener (for live UI updates)
      this.onAfterStep?.();

      // If _step resulted in anything other than RUNNING (i.e. HALTED, ERROR,
      // WAITING_INPUT), stop the loop — those are terminal/blocking states.
      if (lastResult.state !== VMState.RUNNING) break;

      // ── Speed throttle / yield ───────────────────────────
      await this.throttle(steps);

      steps++;
    }

    if (steps >= MAX_STEPS && this.state === VMState.RUNNING) {
      this.state = VMState.ERROR;
      return { state: VMState.ERROR, currentLine: this.currentLine, error: 'Execution limit exceeded (infinite loop?)' };
    }

    return lastResult;
  }

  // ── Instruction execution ─────────────────────────────────

  private async executeInstruction(instr: Instruction): Promise<{ output?: string } | void> {
    switch (instr.mnemonic) {
      case Mnemonic.MOV:   return this.executeMov(instr);
      case Mnemonic.ADD:   return this.executeAdd(instr);
      case Mnemonic.SUB:   return this.executeSub(instr);
      case Mnemonic.CMP:   return this.executeCmp(instr);
      case Mnemonic.READ:  return this.executeRead(instr);
      case Mnemonic.WRITE: return this.executeWrite(instr, false);
      case Mnemonic.WRITELN: return this.executeWrite(instr, true);
      case Mnemonic.HALT:  return this.executeHalt();
      default:
        if (JUMP_MNEMONICS.has(instr.mnemonic)) {
          return this.executeJump(instr);
        }
        throw new RuntimeError(`Unknown instruction: ${instr.mnemonic}`, instr.line);
    }
  }

  // ── MOV ───────────────────────────────────────────────────

  private executeMov(instr: Instruction): void {
    const [dst, src] = instr.operands;
    const line = instr.line;

    if (dst.kind === 'register') {
      this.assertRegisterWritable(dst.reg, line);
      // MOV reg, ...
      const value = this.resolveSource(src, line);
      this.registers.set(dst.reg, value);
      this.stats.registerWrites++;
      this.lastAccess.regWrites.push(dst.reg as string);
      // Update flags on MOV
      const numVal = value.type === 'char' ? value.value - 32 : value.value;
      this.registers.updateFlags(numVal, false);
    } else if (dst.kind === 'memory') {
      // MOV TYPE [addr], ...
      const address = this.resolveAddress(dst.address, line);
      const dataType = dst.dataType;

      if (src.kind === 'register') {
        const regVal = this.getRegisterValue(src.reg, line);
        if (dataType === DataType.CHAR) {
          if (regVal.type !== 'char') throw new TypeMismatchError(line);
          this.memory.writeChar(address, regVal.value, line);
          this.trackMemoryWrite(address, DataType.CHAR);
        } else if (dataType === DataType.TEXT) {
          throw new RuntimeError('Cannot MOV to TEXT with register', line);
        } else {
          if (regVal.type !== 'integer') throw new TypeMismatchError(line);
          const { overflow } = this.memory.writeInteger(address, dataType, regVal.value, line);
          this.trackMemoryWrite(address, dataType);
          this.registers.updateFlags(regVal.value, overflow);
          this.checkOverflowHalt(overflow, line);
        }
      } else if (src.kind === 'immediate') {
        if (dataType === DataType.CHAR) {
          throw new TypeMismatchError(line); // MOV CHAR [addr], imm is forbidden
        }
        const { overflow } = this.memory.writeInteger(address, dataType, src.value, line);
        this.trackMemoryWrite(address, dataType);
        this.registers.updateFlags(src.value, overflow);
        this.checkOverflowHalt(overflow, line);
      } else if (src.kind === 'char_immediate') {
        if (dataType !== DataType.CHAR) throw new TypeMismatchError(line);
        this.memory.writeChar(address, src.value.charCodeAt(0), line);
        this.trackMemoryWrite(address, DataType.CHAR);
      } else {
        throw new RuntimeError('Invalid MOV operands', line);
      }
    } else {
      throw new RuntimeError('Invalid MOV destination', line);
    }

    this.ip++;
  }

  // ── ADD / SUB ─────────────────────────────────────────────

  private executeAdd(instr: Instruction): void {
    this.executeArithmetic(instr, (a, b) => a + b);
  }

  private executeSub(instr: Instruction): void {
    this.executeArithmetic(instr, (a, b) => a - b);
  }

  private executeArithmetic(instr: Instruction, op: (a: number, b: number) => number): void {
    const [dst, src] = instr.operands;
    const line = instr.line;

    if (dst.kind === 'register') {
      this.assertRegisterWritable(dst.reg, line);
      const regVal = this.getRegisterValue(dst.reg, line);
      const srcVal = this.resolveSource(src, line);

      if (regVal.type === 'char' && srcVal.type === 'char') {
        throw new TypeMismatchError(line); // CHAR ± CHAR forbidden
      }

      if (regVal.type === 'integer' && srcVal.type === 'char') {
        throw new TypeMismatchError(line); // integer ± CHAR forbidden
      }

      if (regVal.type === 'char') {
        // CHAR ± integer → CHAR
        if (srcVal.type !== 'integer') throw new TypeMismatchError(line);
        const mathResult = op(regVal.value, srcVal.value);
        const range = DATA_TYPE_RANGE[DataType.CHAR]!;
        const overflow = mathResult < range[0] || mathResult > range[1];
        const clamped = Math.max(range[0], Math.min(range[1], mathResult));
        this.registers.set(dst.reg, { type: 'char', value: clamped });
        this.stats.registerWrites++;
        this.lastAccess.regWrites.push(dst.reg as string);
        this.registers.updateFlags(mathResult - 32, overflow); // relative to ASCII space
        this.checkOverflowHalt(overflow, line);
      } else {
        // integer ± integer
        if (srcVal.type !== 'integer') throw new TypeMismatchError(line);
        const mathResult = op(regVal.value, srcVal.value);
        // No specific type constraint for register integers; overflow check happens on write
        this.registers.set(dst.reg, { type: 'integer', value: mathResult });
        this.stats.registerWrites++;
        this.lastAccess.regWrites.push(dst.reg as string);
        this.registers.updateFlags(mathResult, false);
      }
    } else if (dst.kind === 'memory') {
      const address = this.resolveAddress(dst.address, line);
      const dataType = dst.dataType;

      if (dataType === DataType.TEXT) {
        throw new RuntimeError('TEXT does not support arithmetic', line);
      }

      // Read current memory value
      let currentValue: number;
      if (dataType === DataType.CHAR) {
        currentValue = this.memory.readChar(address, line);
        this.trackMemoryRead(address, DataType.CHAR);
      } else {
        currentValue = this.memory.readInteger(address, dataType, line);
        this.trackMemoryRead(address, dataType);
      }

      // Resolve source
      let srcValue: number;
      if (src.kind === 'register') {
        const sv = this.getRegisterValue(src.reg, line);
        if (dataType === DataType.CHAR && sv.type === 'char') throw new TypeMismatchError(line);
        if (dataType !== DataType.CHAR && sv.type !== 'integer') throw new TypeMismatchError(line);
        srcValue = sv.value;
      } else if (src.kind === 'immediate') {
        srcValue = src.value;
      } else {
        throw new RuntimeError('Invalid arithmetic source for memory destination', line);
      }

      const mathResult = op(currentValue, srcValue);

      if (dataType === DataType.CHAR) {
        const range = DATA_TYPE_RANGE[DataType.CHAR]!;
        const overflow = mathResult < range[0] || mathResult > range[1];
        const clamped = Math.max(range[0], Math.min(range[1], mathResult));
        this.memory.writeChar(address, clamped, line);
        this.trackMemoryWrite(address, DataType.CHAR);
        this.registers.updateFlags(mathResult - 32, overflow);
        this.checkOverflowHalt(overflow, line);
      } else {
        const { overflow } = this.memory.writeInteger(address, dataType, mathResult, line);
        this.trackMemoryWrite(address, dataType);
        this.registers.updateFlags(mathResult, overflow);
        this.checkOverflowHalt(overflow, line);
      }
    } else {
      throw new RuntimeError('Invalid arithmetic destination', line);
    }

    this.ip++;
  }

  // ── CMP ───────────────────────────────────────────────────

  private executeCmp(instr: Instruction): void {
    const [op1, op2] = instr.operands;
    const line = instr.line;

    const val1 = this.resolveValueForCmp(op1, line);
    const val2 = this.resolveValueForCmp(op2, line);

    // Type check: both must be same category
    if (val1.type !== val2.type) {
      throw new TypeMismatchError(line);
    }

    const diff = val1.value - val2.value;
    // For CMP, overflow is possible but we check range based on context
    this.registers.updateFlags(diff, false);

    this.ip++;
  }

  private resolveValueForCmp(op: Operand, line: number): RegisterValue {
    switch (op.kind) {
      case 'register':
        return this.getRegisterValue(op.reg, line);
      case 'immediate':
        return { type: 'integer', value: op.value };
      case 'char_immediate':
        return { type: 'char', value: op.value.charCodeAt(0) };
      case 'memory': {
        if (op.dataType === DataType.CHAR) {
          const addr = this.resolveAddress(op.address, line);
          const val = this.memory.readChar(addr, line);
          this.trackMemoryRead(addr, DataType.CHAR);
          return { type: 'char', value: val };
        }
        if (op.dataType === DataType.TEXT) {
          throw new RuntimeError('TEXT is not supported in CMP', line);
        }
        const addr = this.resolveAddress(op.address, line);
        const val = this.memory.readInteger(addr, op.dataType, line);
        this.trackMemoryRead(addr, op.dataType);
        return { type: 'integer', value: val };
      }
      default:
        throw new RuntimeError('Invalid CMP operand', line);
    }
  }

  // ── Jumps ─────────────────────────────────────────────────

  private executeJump(instr: Instruction): void {
    const target = this.resolveJumpTarget(instr.operands[0], instr.line);

    const flags = this.registers.flags;
    let shouldJump = false;

    switch (instr.mnemonic) {
      case Mnemonic.JMP: shouldJump = true; break;
      case Mnemonic.JE:  shouldJump = flags.ZF; break;
      case Mnemonic.JNE: shouldJump = !flags.ZF; break;
      case Mnemonic.JL:  shouldJump = flags.SF && !flags.ZF; break;
      case Mnemonic.JLE: shouldJump = flags.SF || flags.ZF; break;
      case Mnemonic.JG:  shouldJump = !flags.SF && !flags.ZF; break;
      case Mnemonic.JGE: shouldJump = !flags.SF || flags.ZF; break;
      case Mnemonic.JO:  shouldJump = flags.OF; break;
      case Mnemonic.JNO: shouldJump = !flags.OF; break;
    }

    if (shouldJump) {
      this.ip = target;
    } else {
      this.ip++;
    }
  }

  // ── READ ──────────────────────────────────────────────────

  private async executeRead(instr: Instruction): Promise<void> {
    const memOp = instr.operands[0];
    if (memOp.kind !== 'memory') {
      throw new RuntimeError('READ requires memory operand', instr.line);
    }

    const line = instr.line;
    const address = this.resolveAddress(memOp.address, line);
    const dataType = memOp.dataType;

    // Extract optional prompt: the last string_immediate operand
    const promptOp = instr.operands.slice(1).find(op => op.kind === 'string_immediate');
    const prompt = promptOp?.kind === 'string_immediate' ? promptOp.value : undefined;

    this.state = VMState.WAITING_INPUT;
    const input = await this.io.requestInput(prompt);
    this.state = VMState.RUNNING;

    if (dataType === DataType.TEXT) {
      // Optional max length: READ TEXT [addr], imm (separate from the prompt operand)
      let maxLen: number | undefined;
      const limitOp = instr.operands.slice(1).find(op => op.kind === 'immediate');
      if (limitOp?.kind === 'immediate') {
        maxLen = limitOp.value;
      }
      let text = input;
      if (maxLen !== undefined && text.length > maxLen - 1) {
        text = text.substring(0, maxLen - 1);
      }
      const storedText = text + '$';
      this.memory.writeText(address, storedText, line);
      this.trackMemoryWriteBytes(address, storedText.length);
      this.registers.updateFlags(0, false);
    } else if (dataType === DataType.CHAR) {
      const charCode = input.length > 0 ? input.charCodeAt(0) : 32;
      const range = DATA_TYPE_RANGE[DataType.CHAR]!;
      const overflow = charCode < range[0] || charCode > range[1];
      const clamped = Math.max(range[0], Math.min(range[1], charCode));
      this.memory.writeChar(address, clamped, line);
      this.trackMemoryWrite(address, DataType.CHAR);
      this.registers.updateFlags(clamped - 32, overflow);
      this.checkOverflowHalt(overflow, line);
    } else {
      // WORD / DWORD / QWORD
      const num = parseInt(input, 10) || 0;
      const { overflow } = this.memory.writeInteger(address, dataType, num, line);
      this.trackMemoryWrite(address, dataType);
      this.registers.updateFlags(num, overflow);
      this.checkOverflowHalt(overflow, line);
    }

    this.ip++;
  }

  // ── WRITE / WRITELN ───────────────────────────────────────

  private executeWrite(instr: Instruction, newline: boolean): { output: string } {
    const line = instr.line;
    let output = '';

    if (instr.operands.length > 0) {
      const op = instr.operands[0];

      if (op.kind === 'memory') {
        const address = this.resolveAddress(op.address, line);
        const dataType = op.dataType;

        if (dataType === DataType.TEXT) {
          output = this.memory.readText(address, line);
          this.trackMemoryReadBytes(address, output.length);
        } else if (dataType === DataType.CHAR) {
          output = String.fromCharCode(this.memory.readChar(address, line));
          this.trackMemoryRead(address, DataType.CHAR);
        } else {
          // WORD / DWORD / QWORD — output without leading zeros and '+'
          const num = this.memory.readInteger(address, dataType, line);
          this.trackMemoryRead(address, dataType);
          output = num.toString();
        }
      } else if (op.kind === 'register') {
        const regVal = this.getRegisterValue(op.reg, line);
        if (regVal.type === 'char') {
          output = String.fromCharCode(regVal.value);
        } else {
          output = regVal.value.toString();
        }
      } else if (op.kind === 'immediate') {
        output = op.value.toString();
      } else if (op.kind === 'char_immediate') {
        output = op.value; // single character
      } else if (op.kind === 'string_immediate') {
        // Strip trailing '$' if present (TEXT terminator convention)
        output = op.value.endsWith('$') ? op.value.slice(0, -1) : op.value;
      } else {
        throw new RuntimeError('WRITE/WRITELN: unsupported operand type', line);
      }
    }

    if (newline) {
      output += '\n';
    }

    this.stdout += output;
    this.io.writeOutput(output);
    this.ip++;
    return { output };
  }

  // ── HALT ──────────────────────────────────────────────────

  private executeHalt(): void {
    this.state = VMState.HALTED;
    // Don't increment IP
  }

  // ── Value resolution helpers ──────────────────────────────

  /**
   * Resolve a source operand to a RegisterValue.
   */
  private resolveSource(op: Operand, line: number): RegisterValue {
    switch (op.kind) {
      case 'register':
        return this.getRegisterValue(op.reg, line);
      case 'immediate':
        return { type: 'integer', value: op.value };
      case 'label': {
        const target = this.program.labels.get(op.name);
        if (target === undefined) {
          throw new RuntimeError(`Undefined label: ${op.name}`, line);
        }
        return { type: 'integer', value: target };
      }
      case 'char_immediate':
        return { type: 'char', value: op.value.charCodeAt(0) };
      case 'memory': {
        const addr = this.resolveAddress(op.address, line);
        if (op.dataType === DataType.CHAR) {
          const val = this.memory.readChar(addr, line);
          this.trackMemoryRead(addr, DataType.CHAR);
          return { type: 'char', value: val };
        }
        if (op.dataType === DataType.TEXT) {
          throw new RuntimeError('Cannot use TEXT as register source', line);
        }
        const val = this.memory.readInteger(addr, op.dataType, line);
        this.trackMemoryRead(addr, op.dataType);
        return { type: 'integer', value: val };
      }
      default:
        throw new RuntimeError('Invalid source operand', line);
    }
  }

  /**
   * Resolve a jump target operand to a valid instruction index.
   */
  private resolveJumpTarget(op: Operand, line: number): number {
    let target: number;

    if (op.kind === 'label') {
      const resolved = this.program.labels.get(op.name);
      if (resolved === undefined) {
        throw new RuntimeError(`Undefined label: ${op.name}`, line);
      }
      target = resolved;
    } else if (op.kind === 'register') {
      const regVal = this.getRegisterValue(op.reg, line);
      if (regVal.type !== 'integer') {
        throw new TypeMismatchError(line);
      }
      target = regVal.value;
    } else {
      throw new RuntimeError('Expected label or integer register for jump', line);
    }

    if (!Number.isInteger(target) || target < 0 || target >= this.program.instructions.length) {
      throw new RuntimeError(`Invalid jump target: ${target}`, line);
    }

    return target;
  }

  /**
   * Resolve an address (register or immediate) to a numeric address.
   */
  private resolveAddress(addr: AddressExpression, line: number): number {
    if (typeof addr === 'number') return addr;
    if (typeof addr === 'string') {
      const regVal = this.getRegisterValue(addr, line);
      if (regVal.type !== 'integer') {
        throw new TypeMismatchError(line);
      }
      return regVal.value;
    }

    const baseValue = this.getRegisterValue(addr.base, line);
    if (baseValue.type !== 'integer') {
      throw new TypeMismatchError(line);
    }
    return baseValue.value + addr.displacement;
  }

  /**
   * Get register value, throwing if uninitialized.
   */
  private getRegisterValue(reg: Register, line: number): RegisterValue {
    const val = this.registers.get(reg, this.ip);
    if (val === null) {
      throw new RuntimeError(`Register ${reg} is not initialized`, line);
    }
    this.stats.registerReads++;
    this.lastAccess.regReads.push(reg as string);
    return val;
  }

  private assertRegisterWritable(reg: Register, line: number): void {
    if (reg === Register.IP) {
      throw new RuntimeError('Register IP is read-only', line);
    }
  }

  /**
   * If overflow mode is 'halt', throw TypeOverflowError.
   */
  private checkOverflowHalt(overflow: boolean, line: number): void {
    if (overflow && this.overflowMode === 'halt') {
      this.state = VMState.ERROR;
      throw new TypeOverflowError(line);
    }
  }

  // ── Stats tracking helpers ────────────────────────────────

  private trackMemoryRead(address: number, dataType: DataType): void {
    this.stats.memoryReads++;
    const size = DATA_TYPE_SIZE[dataType] || 0;
    this.stats.memoryReadBytes += size;
    for (let i = 0; i < size; i++) this.lastAccess.memReads.push(address + i);
  }

  private trackMemoryReadBytes(address: number, bytes: number): void {
    this.stats.memoryReads++;
    this.stats.memoryReadBytes += bytes;
    for (let i = 0; i < bytes; i++) this.lastAccess.memReads.push(address + i);
  }

  private trackMemoryWrite(address: number, dataType: DataType): void {
    this.stats.memoryWrites++;
    const size = DATA_TYPE_SIZE[dataType] || 0;
    this.stats.memoryWriteBytes += size;
    for (let i = 0; i < size; i++) this.lastAccess.memWrites.push(address + i);
  }

  private trackMemoryWriteBytes(address: number, bytes: number): void {
    this.stats.memoryWrites++;
    this.stats.memoryWriteBytes += bytes;
    for (let i = 0; i < bytes; i++) this.lastAccess.memWrites.push(address + i);
  }
}
