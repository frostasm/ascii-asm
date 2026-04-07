// ─── Token Types ───────────────────────────────────────────────

export enum TokenType {
  DIRECTIVE = 'DIRECTIVE',         // #memory, #data, #on_overflow
  LABEL_DEF = 'LABEL_DEF',        // identifier: (label definition, with colon)
  IDENTIFIER = 'IDENTIFIER',      // label reference (in JMP), keyword (flag/halt)
  MNEMONIC = 'MNEMONIC',          // MOV, ADD, SUB, ...
  REGISTER = 'REGISTER',          // AX, BX, CX, DX
  TYPE_PREFIX = 'TYPE_PREFIX',     // CHAR, WORD, DWORD, QWORD, TEXT
  NUMBER = 'NUMBER',              // 42, -7
  CHAR_LITERAL = 'CHAR_LITERAL',  // 'A'
  STRING_LITERAL = 'STRING_LITERAL', // "Hello$"
  LBRACKET = 'LBRACKET',          // [
  RBRACKET = 'RBRACKET',          // ]
  COMMA = 'COMMA',                // ,
  HEX_COLOR = 'HEX_COLOR',        // #RRGGBB color literal
  NEWLINE = 'NEWLINE',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

// ─── Data Types ────────────────────────────────────────────────

export enum DataType {
  CHAR = 'CHAR',
  WORD = 'WORD',
  DWORD = 'DWORD',
  QWORD = 'QWORD',
  TEXT = 'TEXT',
}

/** Number of memory cells occupied by each numeric type */
export const DATA_TYPE_SIZE: Record<DataType, number> = {
  [DataType.CHAR]: 1,
  [DataType.WORD]: 2,
  [DataType.DWORD]: 4,
  [DataType.QWORD]: 8,
  [DataType.TEXT]: 0, // variable length
};

/** Value range per numeric type [min, max] */
export const DATA_TYPE_RANGE: Partial<Record<DataType, [number, number]>> = {
  [DataType.CHAR]: [32, 126],
  [DataType.WORD]: [-9, 99],
  [DataType.DWORD]: [-999, 9999],
  [DataType.QWORD]: [-9999999, 99999999],
};

// ─── Registers ─────────────────────────────────────────────────

export enum Register {
  AX = 'AX',
  BX = 'BX',
  CX = 'CX',
  DX = 'DX',
}

// ─── Mnemonics ─────────────────────────────────────────────────

export enum Mnemonic {
  MOV = 'MOV',
  ADD = 'ADD',
  SUB = 'SUB',
  CMP = 'CMP',
  JMP = 'JMP',
  JE = 'JE',
  JNE = 'JNE',
  JL = 'JL',
  JLE = 'JLE',
  JG = 'JG',
  JGE = 'JGE',
  JO = 'JO',
  JNO = 'JNO',
  READ = 'READ',
  WRITE = 'WRITE',
  WRITELN = 'WRITELN',
  HALT = 'HALT',
}

export const JUMP_MNEMONICS = new Set<Mnemonic>([
  Mnemonic.JMP, Mnemonic.JE, Mnemonic.JNE,
  Mnemonic.JL, Mnemonic.JLE, Mnemonic.JG, Mnemonic.JGE,
  Mnemonic.JO, Mnemonic.JNO,
]);

// ─── Flags ─────────────────────────────────────────────────────

export interface Flags {
  ZF: boolean;  // Zero Flag
  SF: boolean;  // Sign Flag
  OF: boolean;  // Overflow Flag
}

// ─── Register Value ────────────────────────────────────────────

export interface CharValue {
  type: 'char';
  value: number; // ASCII code 32–126
}

export interface IntegerValue {
  type: 'integer';
  value: number;
}

export type RegisterValue = CharValue | IntegerValue;

// ─── Operands (AST) ───────────────────────────────────────────

export interface RegisterOperand {
  kind: 'register';
  reg: Register;
}

export interface ImmediateOperand {
  kind: 'immediate';
  value: number;
}

export interface CharImmediateOperand {
  kind: 'char_immediate';
  value: string; // single character
}

export interface StringImmediateOperand {
  kind: 'string_immediate';
  value: string; // raw string content (without surrounding quotes)
}

export interface MemoryOperand {
  kind: 'memory';
  address: Register | number;
  dataType: DataType;
}

export interface LabelOperand {
  kind: 'label';
  name: string;
}

export type Operand =
  | RegisterOperand
  | ImmediateOperand
  | CharImmediateOperand
  | StringImmediateOperand
  | MemoryOperand
  | LabelOperand;

// ─── AST Nodes / Program ──────────────────────────────────────

export interface MemoryDirective {
  size: number;
  initValue?: number; // ASCII code for initialization
}

export interface DataDirective {
  address: number;
  dataType: DataType;
  value: number | string; // number for WORD/DWORD/QWORD/CHAR; string for TEXT
  /** Optional CSS hex color (#RRGGBB) for memory visualization highlighting */
  color?: string;
}

export type OverflowMode = 'flag' | 'halt';

export interface Instruction {
  mnemonic: Mnemonic;
  operands: Operand[];
  line: number; // source line number (1-based)
}

export interface Program {
  memory: MemoryDirective;
  overflow: OverflowMode;
  data: DataDirective[];
  labels: Map<string, number>; // label name → instruction index
  instructions: Instruction[];
}

// ─── VM State ──────────────────────────────────────────────────

export enum VMState {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',        // debugger breakpoint
  WAITING_INPUT = 'WAITING_INPUT',
  HALTED = 'HALTED',
  ERROR = 'ERROR',
}

// ─── Debugger State ────────────────────────────────────────────

export interface DebugState {
  vmState: VMState;
  currentLine: number | null;
  registers: Record<string, RegisterValue | null>;
  flags: Flags;
  memory: number[];
  stdout: string;
  breakpoints: Set<number>;
}

// ─── Step Result ───────────────────────────────────────────────

export interface StepResult {
  state: VMState;
  currentLine: number | null;
  output?: string;          // text written to stdout in this step
  error?: string;           // error message if state is ERROR
}
