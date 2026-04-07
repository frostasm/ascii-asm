import {
  Program, Instruction, Mnemonic, Operand, Register, DataType,
  RegisterValue, VMState, StepResult, DATA_TYPE_RANGE, DATA_TYPE_SIZE,
  JUMP_MNEMONICS, OverflowMode,
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

  /** Reset VM to initial state. */
  reset(): void {
    this.memory = new Memory(this.program.memory.size, this.program.memory.initValue);
    for (const d of this.program.data) {
      this.memory.initializeData(d.address, d.dataType, d.value);
    }
    this.registers.reset();
    this.stdout = '';
    this.state = VMState.IDLE;
    const startIndex = this.program.labels.get('_start');
    this.ip = startIndex ?? 0;
  }

  /** Execute one instruction. Returns step result. */
  async step(): Promise<StepResult> {
    if (this.state === VMState.HALTED || this.state === VMState.ERROR) {
      return { state: this.state, currentLine: this.currentLine };
    }

    if (this.ip >= this.program.instructions.length) {
      this.state = VMState.ERROR;
      return { state: this.state, currentLine: null, error: 'Unexpected end of program (missing HALT)' };
    }

    this.state = VMState.RUNNING;
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

    if ((this.state as VMState) === VMState.HALTED) {
      return { state: this.state, currentLine: instr.line, output };
    }

    // After executing one instruction, the VM is paused awaiting
    // the next action (step, continue, stop). See spec §2 — PAUSED
    // state: "Execution is suspended at a breakpoint or after a single-step."
    this.state = VMState.PAUSED;
    return { state: this.state, currentLine: this.currentLine, output };
  }

  /** Run until HALT, error, or breakpoint callback returns true.
   *  @param shouldPause — callback checked before each instruction; return true to pause.
   *  @param skipFirstCheck — when true, skip the breakpoint check on the very first
   *         iteration (used by continue() to avoid re-pausing on the current line).
   */
  async run(shouldPause?: (line: number) => boolean, skipFirstCheck = false): Promise<StepResult> {
    this.state = VMState.RUNNING;
    let lastResult: StepResult = { state: this.state, currentLine: this.currentLine };
    let steps = 0;
    const MAX_STEPS = 1_000_000; // safety limit

    while (steps < MAX_STEPS) {
      // Check breakpoint before executing (skip the first check when resuming
      // from a breakpoint via continue(), to avoid re-pausing on the same line).
      if (shouldPause && this.currentLine !== null && shouldPause(this.currentLine)
          && !(skipFirstCheck && steps === 0)) {
        this.state = VMState.PAUSED;
        return { state: VMState.PAUSED, currentLine: this.currentLine };
      }

      // step() sets state to PAUSED after normal execution;
      // override back to RUNNING so the loop continues.
      this.state = VMState.RUNNING;
      lastResult = await this.step();

      // If step resulted in anything other than PAUSED (i.e. HALTED, ERROR,
      // WAITING_INPUT), stop the loop — those are terminal/blocking states.
      if (lastResult.state !== VMState.PAUSED) break;
      steps++;
    }

    if (steps >= MAX_STEPS && (this.state === VMState.RUNNING || this.state === VMState.PAUSED)) {
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
      // MOV reg, ...
      const value = this.resolveSource(src, line);
      this.registers.set(dst.reg, value);
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
        } else if (dataType === DataType.TEXT) {
          throw new RuntimeError('Cannot MOV to TEXT with register', line);
        } else {
          if (regVal.type !== 'integer') throw new TypeMismatchError(line);
          const { overflow } = this.memory.writeInteger(address, dataType, regVal.value, line);
          this.registers.updateFlags(regVal.value, overflow);
          this.checkOverflowHalt(overflow, line);
        }
      } else if (src.kind === 'immediate') {
        if (dataType === DataType.CHAR) {
          throw new TypeMismatchError(line); // MOV CHAR [addr], imm is forbidden
        }
        const { overflow } = this.memory.writeInteger(address, dataType, src.value, line);
        this.registers.updateFlags(src.value, overflow);
        this.checkOverflowHalt(overflow, line);
      } else if (src.kind === 'char_immediate') {
        if (dataType !== DataType.CHAR) throw new TypeMismatchError(line);
        this.memory.writeChar(address, src.value.charCodeAt(0), line);
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
        this.registers.updateFlags(mathResult - 32, overflow); // relative to ASCII space
        this.checkOverflowHalt(overflow, line);
      } else {
        // integer ± integer
        if (srcVal.type !== 'integer') throw new TypeMismatchError(line);
        const mathResult = op(regVal.value, srcVal.value);
        // No specific type constraint for register integers; overflow check happens on write
        this.registers.set(dst.reg, { type: 'integer', value: mathResult });
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
      } else {
        currentValue = this.memory.readInteger(address, dataType, line);
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
        this.registers.updateFlags(mathResult - 32, overflow);
        this.checkOverflowHalt(overflow, line);
      } else {
        const { overflow } = this.memory.writeInteger(address, dataType, mathResult, line);
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
          return { type: 'char', value: this.memory.readChar(addr, line) };
        }
        if (op.dataType === DataType.TEXT) {
          throw new RuntimeError('TEXT is not supported in CMP', line);
        }
        const addr = this.resolveAddress(op.address, line);
        return { type: 'integer', value: this.memory.readInteger(addr, op.dataType, line) };
      }
      default:
        throw new RuntimeError('Invalid CMP operand', line);
    }
  }

  // ── Jumps ─────────────────────────────────────────────────

  private executeJump(instr: Instruction): void {
    const labelOp = instr.operands[0];
    if (labelOp.kind !== 'label') {
      throw new RuntimeError('Expected label for jump', instr.line);
    }

    const target = this.program.labels.get(labelOp.name);
    if (target === undefined) {
      throw new RuntimeError(`Undefined label: ${labelOp.name}`, instr.line);
    }

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
      this.memory.writeText(address, text + '$', line);
      this.registers.updateFlags(0, false);
    } else if (dataType === DataType.CHAR) {
      const charCode = input.length > 0 ? input.charCodeAt(0) : 32;
      const range = DATA_TYPE_RANGE[DataType.CHAR]!;
      const overflow = charCode < range[0] || charCode > range[1];
      const clamped = Math.max(range[0], Math.min(range[1], charCode));
      this.memory.writeChar(address, clamped, line);
      this.registers.updateFlags(clamped - 32, overflow);
      this.checkOverflowHalt(overflow, line);
    } else {
      // WORD / DWORD / QWORD
      const num = parseInt(input, 10) || 0;
      const { overflow } = this.memory.writeInteger(address, dataType, num, line);
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
        } else if (dataType === DataType.CHAR) {
          output = String.fromCharCode(this.memory.readChar(address, line));
        } else {
          // WORD / DWORD / QWORD — output without leading zeros and '+'
          const num = this.memory.readInteger(address, dataType, line);
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
      case 'char_immediate':
        return { type: 'char', value: op.value.charCodeAt(0) };
      case 'memory': {
        const addr = this.resolveAddress(op.address, line);
        if (op.dataType === DataType.CHAR) {
          return { type: 'char', value: this.memory.readChar(addr, line) };
        }
        if (op.dataType === DataType.TEXT) {
          throw new RuntimeError('Cannot use TEXT as register source', line);
        }
        return { type: 'integer', value: this.memory.readInteger(addr, op.dataType, line) };
      }
      default:
        throw new RuntimeError('Invalid source operand', line);
    }
  }

  /**
   * Resolve an address (register or immediate) to a numeric address.
   */
  private resolveAddress(addr: Register | number, line: number): number {
    if (typeof addr === 'number') return addr;
    const regVal = this.getRegisterValue(addr, line);
    if (regVal.type !== 'integer') {
      throw new TypeMismatchError(line);
    }
    return regVal.value;
  }

  /**
   * Get register value, throwing if uninitialized.
   */
  private getRegisterValue(reg: Register, line: number): RegisterValue {
    const val = this.registers.get(reg);
    if (val === null) {
      throw new RuntimeError(`Register ${reg} is not initialized`, line);
    }
    return val;
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
}
