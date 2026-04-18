/**
 * AsciiAsm error classes for parse-time and runtime errors.
 */

export class AsciiAsmError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number = 0,
  ) {
    super(message);
    this.name = 'AsciiAsmError';
  }

  toString(): string {
    return `${this.name} (line ${this.line}): ${this.message}`;
  }
}

export class ParseError extends AsciiAsmError {
  constructor(message: string, line: number, col: number = 0) {
    super(message, line, col);
    this.name = 'Parse Error';
  }
}

export class RuntimeError extends AsciiAsmError {
  constructor(message: string, line: number = 0) {
    super(message, line, 0);
    this.name = 'Runtime Error';
  }
}

export class TypeMismatchError extends RuntimeError {
  constructor(line: number = 0) {
    super('Type Mismatch', line);
  }
}

export class TypeOverflowError extends RuntimeError {
  constructor(line: number = 0) {
    super('Type Overflow', line);
  }
}

export class InvalidMemoryAccessError extends RuntimeError {
  constructor(address: number, memSize: number, line: number = 0) {
    super(`Invalid memory access: address ${address} out of bounds [0..${memSize - 1}]`, line);
  }
}

export class MissingHaltError extends ParseError {
  constructor() {
    super('Program must contain a HALT instruction', 0);
  }
}

export class MissingStartLabelError extends ParseError {
  constructor() {
    super('Program must contain the _start: label', 0);
  }
}

export class UndefinedLabelError extends ParseError {
  constructor(label: string, line: number) {
    super(`Undefined label: ${label}`, line);
  }
}

export class DuplicateLabelError extends ParseError {
  constructor(label: string, line: number) {
    super(`Duplicate label: ${label}`, line);
  }
}
