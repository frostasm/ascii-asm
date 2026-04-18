// ─── Token Types ───────────────────────────────────────────────

export enum TokenType {
  DIRECTIVE = 'DIRECTIVE',         // #memory, #data, #on_overflow
  LABEL_DEF = 'LABEL_DEF',        // identifier: (label definition, with colon)
  IDENTIFIER = 'IDENTIFIER',      // label reference (in JMP), keyword (flag/halt)
  MNEMONIC = 'MNEMONIC',          // MOV, ADD, SUB, ...
  REGISTER = 'REGISTER',          // IP, AX, BX, CX, DX, SI, DI, BP, SP
  TYPE_PREFIX = 'TYPE_PREFIX',     // CHAR, WORD, DWORD, QWORD, TEXT
  NUMBER = 'NUMBER',              // 42, -7
  CHAR_LITERAL = 'CHAR_LITERAL',  // 'A'
  STRING_LITERAL = 'STRING_LITERAL', // "Hello$"
  LBRACKET = 'LBRACKET',          // [
  RBRACKET = 'RBRACKET',          // ]
  PLUS = 'PLUS',                  // +
  COMMA = 'COMMA',                // ,
  HEX_COLOR = 'HEX_COLOR',        // #RRGGBB or #RRGGBBAA color literal
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
  IP = 'IP',
  AX = 'AX',
  BX = 'BX',
  CX = 'CX',
  DX = 'DX',
  SI = 'SI',
  DI = 'DI',
  BP = 'BP',
  SP = 'SP',
}

export const GENERAL_PURPOSE_REGISTERS: Register[] = [
  Register.AX,
  Register.BX,
  Register.CX,
  Register.DX,
  Register.SI,
  Register.DI,
  Register.BP,
  Register.SP,
];

export const PROGRAM_VISIBLE_REGISTERS: Register[] = [
  Register.IP,
  ...GENERAL_PURPOSE_REGISTERS,
];

// ─── Mnemonics ─────────────────────────────────────────────────

export enum Mnemonic {
  MOV = 'MOV',
  ADD = 'ADD',
  IMUL = 'IMUL',
  SUB = 'SUB',
  CMP = 'CMP',
  JMP = 'JMP',
  CALL = 'CALL',
  RET = 'RET',
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
  Mnemonic.JMP, Mnemonic.CALL, Mnemonic.JE, Mnemonic.JNE,
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

export interface BaseDisplacementAddress {
  kind: 'base_displacement';
  base: Register;
  displacement: number;
}

export type AddressExpression = Register | number | BaseDisplacementAddress;

export interface MemoryOperand {
  kind: 'memory';
  address: AddressExpression;
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
  /** Optional color for memory visualization highlighting.
   *  Stored as a lowercase #rrggbb hex string regardless of input format.
   *  Accepted in source: #RRGGBB, #RRGGBBAA, or any CSS named color (e.g. "red", "cornflowerblue"). */
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

// ─── VM Statistics ─────────────────────────────────────────────

export interface VMStats {
  /** Total number of instructions executed. */
  totalInstructions: number;
  /** Count of executed instructions per mnemonic. */
  instructionCounts: Record<string, number>;
  /** Total number of memory read operations. */
  memoryReads: number;
  /** Total bytes (cells) read from memory. */
  memoryReadBytes: number;
  /** Total number of memory write operations. */
  memoryWrites: number;
  /** Total bytes (cells) written to memory. */
  memoryWriteBytes: number;
  /** Total number of register read operations. */
  registerReads: number;
  /** Total number of register write operations. */
  registerWrites: number;
}

/** Create a zeroed-out VMStats object. */
export function createEmptyStats(): VMStats {
  return {
    totalInstructions: 0,
    instructionCounts: {},
    memoryReads: 0,
    memoryReadBytes: 0,
    memoryWrites: 0,
    memoryWriteBytes: 0,
    registerReads: 0,
    registerWrites: 0,
  };
}

// ─── Access Highlights ─────────────────────────────────────────

/**
 * Tracks which memory cells and registers were accessed (read / written)
 * during the most recently executed instruction.
 * Used for transient visual highlighting in the IDE.
 */
export interface AccessHighlights {
  /** Memory cell indices that were read. */
  memReads: number[];
  /** Memory cell indices that were written. */
  memWrites: number[];
  /** Register names that were read (e.g. "AX"). */
  regReads: string[];
  /** Register names that were written. */
  regWrites: string[];
}

/** Create an empty AccessHighlights object. */
export function createEmptyHighlights(): AccessHighlights {
  return { memReads: [], memWrites: [], regReads: [], regWrites: [] };
}

// ─── VM Speed Presets ──────────────────────────────────────────

export const SPEED_PRESETS: { label: string; value: number }[] = [
  { label: '1 IPS', value: 1 },
  { label: '5 IPS', value: 5 },
  { label: '10 IPS', value: 10 },
  { label: '50 IPS', value: 50 },
  { label: '100 IPS', value: 100 },
  { label: '500 IPS', value: 500 },
  { label: 'Unlimited', value: Infinity },
];

// ─── Step Result ───────────────────────────────────────────────

export interface StepResult {
  state: VMState;
  currentLine: number | null;
  output?: string;          // text written to stdout in this step
  error?: string;           // error message if state is ERROR
}
