import { describe, it, expect } from 'vitest';
import { Lexer } from '@core/lexer';
import { Parser } from '@core/parser';
import { Mnemonic, DataType } from '@core/types';

function parse(source: string) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

function tryParse(source: string) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.tryParse();
}

describe('Parser', () => {
  it('parses minimal valid program', () => {
    const program = parse(`
_start:
    HALT
`);
    expect(program.memory.size).toBe(100); // default
    expect(program.overflow).toBe('flag'); // default
    expect(program.instructions).toHaveLength(1);
    expect(program.instructions[0].mnemonic).toBe(Mnemonic.HALT);
    expect(program.labels.has('_start')).toBe(true);
  });

  it('parses #memory directive without init value', () => {
    const program = parse(`
#memory 50
_start:
    HALT
`);
    expect(program.memory.size).toBe(50);
    expect(program.memory.initValue).toBeUndefined();
  });

  it('parses #memory directive with char init value', () => {
    const program = parse(`
#memory 50, ' '
_start:
    HALT
`);
    expect(program.memory.size).toBe(50);
    expect(program.memory.initValue).toBe(32); // ' ' = ASCII 32
  });

  it('parses #memory directive with non-space char init value', () => {
    const program = parse(`
#memory 64, '$'
_start:
    HALT
`);
    expect(program.memory.size).toBe(64);
    expect(program.memory.initValue).toBe(36); // '$' = ASCII 36
  });

  it('parses #data directives', () => {
    const program = parse(`
#memory 32
#data 0, DWORD 42
#data 4, TEXT "Hello$"
#data 10, CHAR 'A'
_start:
    HALT
`);
    expect(program.data).toHaveLength(3);
    expect(program.data[0]).toMatchObject({ address: 0, dataType: DataType.DWORD, value: 42 });
    expect(program.data[1]).toMatchObject({ address: 4, dataType: DataType.TEXT, value: 'Hello$' });
    expect(program.data[2]).toMatchObject({ address: 10, dataType: DataType.CHAR, value: 65 }); // 'A'
  });

  it('parses #on_overflow directive', () => {
    const program = parse(`
#on_overflow halt
_start:
    HALT
`);
    expect(program.overflow).toBe('halt');
  });

  it('parses MOV register, immediate', () => {
    const program = parse(`
_start:
    MOV AX, 42
    HALT
`);
    const instr = program.instructions[0];
    expect(instr.mnemonic).toBe(Mnemonic.MOV);
    expect(instr.operands).toHaveLength(2);
    expect(instr.operands[0]).toMatchObject({ kind: 'register', reg: 'AX' });
    expect(instr.operands[1]).toMatchObject({ kind: 'immediate', value: 42 });
  });

  it('parses MOV register, CHAR literal', () => {
    const program = parse(`
_start:
    MOV AX, CHAR 'A'
    HALT
`);
    const instr = program.instructions[0];
    expect(instr.operands[1]).toMatchObject({ kind: 'char_immediate', value: 'A' });
  });

  it('parses MOV register, memory', () => {
    const program = parse(`
#memory 16
_start:
    MOV AX, DWORD [0]
    HALT
`);
    const instr = program.instructions[0];
    expect(instr.operands[1]).toMatchObject({ kind: 'memory', address: 0, dataType: DataType.DWORD });
  });

  it('parses MOV memory, register', () => {
    const program = parse(`
#memory 16
_start:
    MOV AX, 42
    MOV DWORD [0], AX
    HALT
`);
    const instr = program.instructions[1];
    expect(instr.operands[0]).toMatchObject({ kind: 'memory', address: 0, dataType: DataType.DWORD });
    expect(instr.operands[1]).toMatchObject({ kind: 'register', reg: 'AX' });
  });

  it('parses MOV register, register', () => {
    const program = parse(`
_start:
    MOV AX, 1
    MOV BX, AX
    HALT
`);
    const instr = program.instructions[1];
    expect(instr.operands[0]).toMatchObject({ kind: 'register', reg: 'BX' });
    expect(instr.operands[1]).toMatchObject({ kind: 'register', reg: 'AX' });
  });

  it('parses SI and DI as registers', () => {
    const program = parse(`
_start:
    MOV SI, 12
    MOV DI, SI
    HALT
`);
    expect(program.instructions[0].operands[0]).toMatchObject({ kind: 'register', reg: 'SI' });
    expect(program.instructions[1].operands[0]).toMatchObject({ kind: 'register', reg: 'DI' });
    expect(program.instructions[1].operands[1]).toMatchObject({ kind: 'register', reg: 'SI' });
  });

  it('parses IP as a register', () => {
    const program = parse(`
_start:
    MOV AX, IP
    HALT
`);
    expect(program.instructions[0].operands[1]).toMatchObject({ kind: 'register', reg: 'IP' });
  });

  it('parses MOV register, label', () => {
    const program = parse(`
_start:
    MOV AX, done
    HALT
done:
    HALT
`);
    const instr = program.instructions[0];
    expect(instr.operands[0]).toMatchObject({ kind: 'register', reg: 'AX' });
    expect(instr.operands[1]).toMatchObject({ kind: 'label', name: 'done' });
    expect(program.labels.get('done')).toBe(2);
  });

  it('parses ADD and SUB', () => {
    const program = parse(`
_start:
    MOV AX, 10
    ADD AX, 5
    SUB AX, 3
    HALT
`);
    expect(program.instructions[1].mnemonic).toBe(Mnemonic.ADD);
    expect(program.instructions[2].mnemonic).toBe(Mnemonic.SUB);
  });

  it('parses CMP instruction', () => {
    const program = parse(`
_start:
    MOV AX, 10
    CMP AX, 5
    HALT
`);
    expect(program.instructions[1].mnemonic).toBe(Mnemonic.CMP);
  });

  it('parses jump instructions with labels', () => {
    const program = parse(`
_start:
    JMP done
done:
    HALT
`);
    expect(program.instructions[0].mnemonic).toBe(Mnemonic.JMP);
    expect(program.instructions[0].operands[0]).toMatchObject({ kind: 'label', name: 'done' });
    expect(program.labels.get('done')).toBe(1); // instruction index 1
  });

  it('parses READ and WRITE', () => {
    const program = parse(`
#memory 8
_start:
    READ DWORD [0]
    WRITE DWORD [0]
    HALT
`);
    expect(program.instructions[0].mnemonic).toBe(Mnemonic.READ);
    expect(program.instructions[1].mnemonic).toBe(Mnemonic.WRITE);
  });

  it('parses WRITELN without operands', () => {
    const program = parse(`
_start:
    WRITELN
    HALT
`);
    expect(program.instructions[0].mnemonic).toBe(Mnemonic.WRITELN);
    expect(program.instructions[0].operands).toHaveLength(0);
  });

  it('parses READ TEXT with max length', () => {
    const program = parse(`
#memory 32
_start:
    READ TEXT [0], 10
    HALT
`);
    const instr = program.instructions[0];
    expect(instr.operands).toHaveLength(2);
    expect(instr.operands[0]).toMatchObject({ kind: 'memory', dataType: DataType.TEXT });
    expect(instr.operands[1]).toMatchObject({ kind: 'immediate', value: 10 });
  });

  it('parses memory access with register address', () => {
    const program = parse(`
#memory 16
_start:
    MOV BX, 0
    MOV AX, DWORD [BX]
    HALT
`);
    const instr = program.instructions[1];
    expect(instr.operands[1]).toMatchObject({ kind: 'memory', address: 'BX', dataType: DataType.DWORD });
  });

  it('parses memory access with SI register address', () => {
    const program = parse(`
#memory 16
_start:
    MOV SI, 0
    MOV AX, DWORD [SI]
    HALT
`);
    const instr = program.instructions[1];
    expect(instr.operands[1]).toMatchObject({ kind: 'memory', address: 'SI', dataType: DataType.DWORD });
  });

  it('parses memory access with base + displacement address', () => {
    const program = parse(`
#memory 32
_start:
    MOV BX, 8
    MOV AX, DWORD [BX + 4]
    HALT
`);
    const instr = program.instructions[1];
    expect(instr.operands[1]).toMatchObject({
      kind: 'memory',
      dataType: DataType.DWORD,
      address: { kind: 'base_displacement', base: 'BX', displacement: 4 },
    });
  });

  it('parses memory access with negative displacement', () => {
    const program = parse(`
#memory 32
_start:
    MOV SI, 8
    MOV AX, DWORD [SI + -4]
    HALT
`);
    const instr = program.instructions[1];
    expect(instr.operands[1]).toMatchObject({
      kind: 'memory',
      dataType: DataType.DWORD,
      address: { kind: 'base_displacement', base: 'SI', displacement: -4 },
    });
  });

  it('collects labels correctly', () => {
    const program = parse(`
_start:
    JMP middle
first:
    HALT
middle:
    JMP first
`);
    expect(program.labels.get('_start')).toBe(0);
    expect(program.labels.get('first')).toBe(1);
    expect(program.labels.get('middle')).toBe(2);
  });

  // ── #data hex color parameter ─────────────────────────────

  it('parses #data with hex color on WORD', () => {
    const program = parse(`
#memory 32
#data 0, WORD 42, #4488ff
_start:
    HALT
`);
    expect(program.data).toHaveLength(1);
    expect(program.data[0]).toMatchObject({ address: 0, dataType: DataType.WORD, value: 42, color: '#4488ff' });
  });

  it('parses #data with uppercase hex color and normalizes to lowercase', () => {
    const program = parse(`
#memory 32
#data 0, DWORD 100, #FF0000
_start:
    HALT
`);
    expect(program.data[0].color).toBe('#ff0000');
  });

  it('parses #data with hex color on TEXT', () => {
    const program = parse(`
#memory 32
#data 0, TEXT "Hello$", #44bb77
_start:
    HALT
`);
    expect(program.data[0]).toMatchObject({ address: 0, dataType: DataType.TEXT, value: 'Hello$', color: '#44bb77' });
  });

  it('parses #data with hex color on CHAR', () => {
    const program = parse(`
#memory 32
#data 0, CHAR 'A', #ffaa00
_start:
    HALT
`);
    expect(program.data[0]).toMatchObject({ address: 0, dataType: DataType.CHAR, value: 65, color: '#ffaa00' });
  });

  it('parses mixed #data with and without color', () => {
    const program = parse(`
#memory 32
#data 0, WORD 10, #ff0000
#data 2, DWORD 99
#data 6, CHAR 'Z', #00ff00
_start:
    HALT
`);
    expect(program.data).toHaveLength(3);
    expect(program.data[0].color).toBe('#ff0000');
    expect(program.data[1].color).toBeUndefined();
    expect(program.data[2].color).toBe('#00ff00');
  });

  it('parses #data without color — no regression', () => {
    const program = parse(`
#memory 32
#data 0, DWORD 42
#data 4, TEXT "Hello$"
#data 10, CHAR 'A'
_start:
    HALT
`);
    for (const d of program.data) {
      expect(d.color).toBeUndefined();
    }
  });

  // ── Error cases ──────────────────────────────────────────

  it('reports missing _start label', () => {
    const { errors } = tryParse('HALT');
    expect(errors.some(e => e.message.includes('_start'))).toBe(true);
  });

  it('reports missing HALT', () => {
    const { errors } = tryParse(`
_start:
    MOV AX, 1
`);
    expect(errors.some(e => e.message.includes('HALT'))).toBe(true);
  });

  it('reports undefined label in jump', () => {
    const { errors } = tryParse(`
_start:
    JMP nonexistent
    HALT
`);
    expect(errors.some(e => e.message.includes('nonexistent'))).toBe(true);
  });

  it('reports undefined label in MOV', () => {
    const { errors } = tryParse(`
_start:
    MOV AX, nonexistent
    HALT
`);
    expect(errors.some(e => e.message.includes('nonexistent'))).toBe(true);
  });
});
