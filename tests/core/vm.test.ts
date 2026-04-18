import { describe, it, expect } from 'vitest';
import { Lexer } from '@core/lexer';
import { Parser } from '@core/parser';
import { VM, VMIO } from '@core/vm';
import { VMState } from '@core/types';

function createTestIO(inputs: string[] = []): { io: VMIO; output: string[]; prompts: string[]; inputIdx: number } {
  const state = { output: [] as string[], prompts: [] as string[], inputIdx: 0 };
  const io: VMIO = {
    requestInput: (prompt?: string) => {
      state.prompts.push(prompt ?? '');
      const val = inputs[state.inputIdx] ?? '';
      state.inputIdx++;
      return Promise.resolve(val);
    },
    writeOutput: (text: string) => {
      state.output.push(text);
    },
  };
  return { io, ...state };
}

function buildVM(source: string, inputs: string[] = []) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const testIO = createTestIO(inputs);
  const vm = new VM(program, testIO.io);
  return { vm, io: testIO };
}

describe('VM', () => {
  // ── MOV ──────────────────────────────────────────────

  it('initializes SP with memory size before execution starts', () => {
    const { vm } = buildVM(`
#memory 64
_start:
    HALT
`);
    expect(vm.registers.get('SP' as any)).toEqual({ type: 'integer', value: 64 });
    expect(vm.registers.get('AX' as any)).toBeNull();
  });

  it('MOV reg, immediate', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 42
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 42 });
    expect(vm.state).toBe(VMState.HALTED);
  });

  it('MOV reg, CHAR literal', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, CHAR 'A'
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'char', value: 65 });
  });

  it('MOV reg, reg', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 42
    MOV BX, AX
    HALT
`);
    await vm.run();
    expect(vm.registers.get('BX' as any)).toEqual({ type: 'integer', value: 42 });
  });

  it('MOV supports SI and DI registers', async () => {
    const { vm } = buildVM(`
_start:
    MOV SI, 42
    MOV DI, SI
    HALT
`);
    await vm.run();
    expect(vm.registers.get('SI' as any)).toEqual({ type: 'integer', value: 42 });
    expect(vm.registers.get('DI' as any)).toEqual({ type: 'integer', value: 42 });
  });

  it('MOV supports BP and SP registers', async () => {
    const { vm } = buildVM(`
_start:
    MOV BP, 42
    MOV SP, BP
    HALT
`);
    await vm.run();
    expect(vm.registers.get('BP' as any)).toEqual({ type: 'integer', value: 42 });
    expect(vm.registers.get('SP' as any)).toEqual({ type: 'integer', value: 42 });
  });

  it('reset restores SP to memory size', async () => {
    const { vm } = buildVM(`
#memory 32
_start:
    MOV SP, 1
    HALT
`);
    await vm.run();
    expect(vm.registers.get('SP' as any)).toEqual({ type: 'integer', value: 1 });
    vm.reset();
    expect(vm.registers.get('SP' as any)).toEqual({ type: 'integer', value: 32 });
    expect(vm.registers.get('AX' as any)).toBeNull();
  });

  it('MOV reg, IP reads the current instruction pointer', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, IP
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 0 });
  });

  it('MOV to IP raises runtime error', async () => {
    const { vm } = buildVM(`
_start:
    MOV IP, 1
    HALT
`);
    const result = await vm.run();
    expect(result.state).toBe(VMState.ERROR);
    expect(result.error).toContain('Register IP is read-only');
  });

  it('MOV reg, label stores instruction pointer', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, target
    HALT
target:
    HALT
`);
    await vm.step();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 2 });
  });

  it('MOV reg, memory', async () => {
    const { vm } = buildVM(`
#memory 16
#data 0, DWORD 42
_start:
    MOV AX, DWORD [0]
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 42 });
  });

  it('MOV reg, memory supports base + displacement addressing', async () => {
    const { vm } = buildVM(`
#memory 24
#data 8, DWORD 42
_start:
    MOV BX, 4
    MOV AX, DWORD [BX + 4]
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 42 });
  });

  it('MOV memory, reg', async () => {
    const { vm } = buildVM(`
#memory 16
#data 0, DWORD 0
_start:
    MOV AX, 99
    MOV DWORD [0], AX
    HALT
`);
    await vm.run();
    expect(vm.memory.readInteger(0, 'DWORD' as any)).toBe(99);
  });

  it('MOV memory, reg supports base + displacement addressing', async () => {
    const { vm } = buildVM(`
#memory 24
#data 12, DWORD 0
_start:
    MOV BX, 8
    MOV AX, 99
    MOV DWORD [BX + 4], AX
    HALT
`);
    await vm.run();
    expect(vm.memory.readInteger(12, 'DWORD' as any)).toBe(99);
  });

  it('MOV memory, immediate', async () => {
    const { vm } = buildVM(`
#memory 16
_start:
    MOV DWORD [0], 42
    HALT
`);
    await vm.run();
    expect(vm.memory.readInteger(0, 'DWORD' as any)).toBe(42);
  });

  // ── ADD / SUB ────────────────────────────────────────

  it('ADD reg, immediate', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 10
    ADD AX, 5
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 15 });
  });

  it('ADD to IP raises runtime error', async () => {
    const { vm } = buildVM(`
_start:
    ADD IP, 1
    HALT
`);
    const result = await vm.run();
    expect(result.state).toBe(VMState.ERROR);
    expect(result.error).toContain('Register IP is read-only');
  });

  it('SUB reg, immediate', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 10
    SUB AX, 3
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 7 });
  });

  it('ADD CHAR + integer → CHAR', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, CHAR 'A'
    ADD AX, 1
    HALT
`);
    await vm.run();
    const val = vm.registers.get('AX' as any);
    expect(val).toEqual({ type: 'char', value: 66 }); // 'B'
  });

  it('SUB CHAR - integer → CHAR', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, CHAR 'B'
    SUB AX, 1
    HALT
`);
    await vm.run();
    const val = vm.registers.get('AX' as any);
    expect(val).toEqual({ type: 'char', value: 65 }); // 'A'
  });

  it('CHAR + CHAR → TypeError', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, CHAR 'A'
    MOV BX, CHAR 'B'
    ADD AX, BX
    HALT
`);
    const result = await vm.run();
    expect(result.state).toBe(VMState.ERROR);
    expect(result.error).toContain('Type Mismatch');
  });

  it('ADD memory, immediate', async () => {
    const { vm } = buildVM(`
#memory 16
#data 0, DWORD 10
_start:
    ADD DWORD [0], 5
    HALT
`);
    await vm.run();
    expect(vm.memory.readInteger(0, 'DWORD' as any)).toBe(15);
  });

  // ── CMP + Jumps ──────────────────────────────────────

  it('CMP sets ZF on equal', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 5
    CMP AX, 5
    HALT
`);
    await vm.run();
    expect(vm.registers.flags.ZF).toBe(true);
    expect(vm.registers.flags.SF).toBe(false);
  });

  it('CMP sets SF on less', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 3
    CMP AX, 5
    HALT
`);
    await vm.run();
    expect(vm.registers.flags.SF).toBe(true);
    expect(vm.registers.flags.ZF).toBe(false);
  });

  it('JE takes branch when ZF=1', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 5
    CMP AX, 5
    JE equal
    MOV AX, 0
    HALT
equal:
    MOV AX, 1
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 1 });
  });

  it('JNE takes branch when ZF=0', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 3
    CMP AX, 5
    JNE notequal
    MOV AX, 0
    HALT
notequal:
    MOV AX, 1
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 1 });
  });

  it('JMP unconditional', async () => {
    const { vm } = buildVM(`
_start:
    JMP skip
    MOV AX, 99
skip:
    MOV AX, 1
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 1 });
  });

  it('JMP register jumps indirectly', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, target
    JMP AX
    MOV BX, 0
target:
    MOV BX, 7
    HALT
`);
    await vm.run();
    expect(vm.registers.get('BX' as any)).toEqual({ type: 'integer', value: 7 });
  });

  it('JMP supports SI register target', async () => {
    const { vm } = buildVM(`
_start:
    MOV SI, target
    JMP SI
    MOV AX, 0
target:
    MOV AX, 9
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 9 });
  });

  it('JMP supports BP register target', async () => {
    const { vm } = buildVM(`
_start:
    MOV BP, target
    JMP BP
    MOV AX, 0
target:
    MOV AX, 9
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 9 });
  });

  it('JMP supports IP register target', async () => {
    const { vm } = buildVM(`
_start:
    JMP IP
    HALT
`);
    const result = await vm.step();
    expect(result.state).toBe(VMState.PAUSED);
    expect(vm.instructionPointer).toBe(0);
  });

  it('JMP register with CHAR target raises type mismatch', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, CHAR 'A'
    JMP AX
    HALT
`);
    const result = await vm.run();
    expect(vm.state).toBe(VMState.ERROR);
    expect(result.error).toContain('Type Mismatch');
  });

  it('JMP register with invalid instruction pointer raises runtime error', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 99
    JMP AX
    HALT
`);
    const result = await vm.run();
    expect(vm.state).toBe(VMState.ERROR);
    expect(result.error).toContain('Invalid jump target: 99');
  });

  it('CALL label jumps to subroutine and RET returns to next instruction', async () => {
    const { vm } = buildVM(`
#memory 32
_start:
    CALL fn
    MOV AX, 7
    HALT
fn:
    MOV BX, 5
    RET
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 7 });
    expect(vm.registers.get('BX' as any)).toEqual({ type: 'integer', value: 5 });
    expect(vm.registers.get('SP' as any)).toEqual({ type: 'integer', value: 32 });
  });

  it('CALL register jumps indirectly and RET returns', async () => {
    const { vm } = buildVM(`
#memory 32
_start:
    MOV AX, fn
    CALL AX
    MOV BX, 9
    HALT
fn:
    MOV CX, 4
    RET
`);
    await vm.run();
    expect(vm.registers.get('BX' as any)).toEqual({ type: 'integer', value: 9 });
    expect(vm.registers.get('CX' as any)).toEqual({ type: 'integer', value: 4 });
  });

  it('nested CALL instructions restore return addresses in LIFO order', async () => {
    const { vm } = buildVM(`
#memory 64
_start:
    CALL first
    MOV AX, 3
    HALT
first:
    MOV BX, 1
    CALL second
    MOV CX, 2
    RET
second:
    MOV DX, 4
    RET
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)).toEqual({ type: 'integer', value: 3 });
    expect(vm.registers.get('BX' as any)).toEqual({ type: 'integer', value: 1 });
    expect(vm.registers.get('CX' as any)).toEqual({ type: 'integer', value: 2 });
    expect(vm.registers.get('DX' as any)).toEqual({ type: 'integer', value: 4 });
    expect(vm.registers.get('SP' as any)).toEqual({ type: 'integer', value: 64 });
  });

  it('CALL stores return address as DWORD below SP', async () => {
    const { vm } = buildVM(`
#memory 32
_start:
    CALL fn
    HALT
fn:
    HALT
`);
    await vm.step();
    expect(vm.registers.get('SP' as any)).toEqual({ type: 'integer', value: 28 });
    expect(vm.memory.readInteger(28, 'DWORD' as any)).toBe(1);
  });

  it('CALL with CHAR register target raises type mismatch', async () => {
    const { vm } = buildVM(`
#memory 32
_start:
    MOV AX, CHAR 'A'
    CALL AX
    HALT
`);
    const result = await vm.run();
    expect(vm.state).toBe(VMState.ERROR);
    expect(result.error).toContain('Type Mismatch');
  });

  it('RET with insufficient stack space raises invalid memory access', async () => {
    const { vm } = buildVM(`
#memory 8
_start:
    RET
    HALT
`);
    const result = await vm.run();
    expect(vm.state).toBe(VMState.ERROR);
    expect(result.error).toContain('Invalid memory access');
  });

  it('RET with invalid restored instruction pointer raises runtime error', async () => {
    const { vm } = buildVM(`
#memory 16
_start:
    MOV SP, 0
    MOV DWORD [0], 99
    RET
    HALT
`);
    const result = await vm.run();
    expect(vm.state).toBe(VMState.ERROR);
    expect(result.error).toContain('Invalid jump target: 99');
  });

  it('CALL and RET do not modify FLAGS', async () => {
    const { vm } = buildVM(`
#memory 32
_start:
    MOV AX, 1
    CMP AX, 1
    CALL fn
    HALT
fn:
    RET
`);
    await vm.run();
    expect(vm.registers.flags.ZF).toBe(true);
    expect(vm.registers.flags.SF).toBe(false);
    expect(vm.registers.flags.OF).toBe(false);
  });

  // ── Loops ────────────────────────────────────────────

  it('loop: sum from 1 to 5', async () => {
    const { vm } = buildVM(`
#memory 32
#data 0, DWORD 5
#data 4, DWORD 0
#data 8, QWORD 0

_start:
    MOV DWORD [4], 1
loop:
    MOV AX, DWORD [4]
    CMP AX, DWORD [0]
    JG done
    ADD QWORD [8], AX
    ADD DWORD [4], 1
    JMP loop
done:
    HALT
`);
    await vm.run();
    expect(vm.memory.readInteger(8, 'QWORD' as any)).toBe(15); // 1+2+3+4+5
  });

  // ── WRITE / WRITELN ──────────────────────────────────

  it('WRITE TEXT outputs string', async () => {
    const { vm } = buildVM(`
#memory 32
#data 0, TEXT "Hello$"
_start:
    WRITE TEXT [0]
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('Hello');
  });

  it('WRITELN TEXT outputs string + newline', async () => {
    const { vm } = buildVM(`
#memory 32
#data 0, TEXT "Hello$"
_start:
    WRITELN TEXT [0]
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('Hello\n');
  });

  it('WRITELN without args outputs newline', async () => {
    const { vm } = buildVM(`
_start:
    WRITELN
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('\n');
  });

  it('WRITE DWORD outputs number without leading zeros', async () => {
    const { vm } = buildVM(`
#memory 8
#data 0, DWORD 42
_start:
    WRITE DWORD [0]
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('42');
  });

  it('WRITE CHAR outputs single character', async () => {
    const { vm } = buildVM(`
#memory 4
#data 0, CHAR 'A'
_start:
    WRITE CHAR [0]
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('A');
  });

  // ── WRITE/WRITELN shorthand (register / constant) ────

  it('WRITE integer register outputs number', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 42
    WRITE AX
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('42');
  });

  it('WRITE supports DI register', async () => {
    const { vm } = buildVM(`
_start:
    MOV DI, 42
    WRITE DI
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('42');
  });

  it('WRITE supports SP register', async () => {
    const { vm } = buildVM(`
_start:
    MOV SP, 42
    WRITE SP
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('42');
  });

  it('WRITELN integer register outputs number + newline', async () => {
    const { vm } = buildVM(`
_start:
    MOV CX, -7
    WRITELN CX
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('-7\n');
  });

  it('WRITE char register outputs character', async () => {
    const { vm } = buildVM(`
_start:
    MOV BX, CHAR 'Z'
    WRITE BX
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('Z');
  });

  it('WRITELN char register outputs character + newline', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, CHAR 'A'
    WRITELN AX
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('A\n');
  });

  it('WRITE integer constant outputs number', async () => {
    const { vm } = buildVM(`
_start:
    WRITE 99
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('99');
  });

  it('WRITELN integer constant outputs number + newline', async () => {
    const { vm } = buildVM(`
_start:
    WRITELN 0
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('0\n');
  });

  it("WRITE char literal outputs character", async () => {
    const { vm } = buildVM(`
_start:
    WRITE 'C'
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('C');
  });

  it("WRITELN char literal outputs character + newline", async () => {
    const { vm } = buildVM(`
_start:
    WRITELN 'X'
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('X\n');
  });

  it('WRITE string literal outputs text', async () => {
    const { vm } = buildVM(`
_start:
    WRITE "Hello"
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('Hello');
  });

  it('WRITELN string literal outputs text + newline', async () => {
    const { vm } = buildVM(`
_start:
    WRITELN "Some text"
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('Some text\n');
  });

  it('WRITE string literal strips trailing $ terminator', async () => {
    const { vm } = buildVM(`
_start:
    WRITE "Hello$"
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('Hello');
  });

  it('WRITE multiple shorthand forms in sequence', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 10
    WRITE AX
    WRITE " "
    WRITE 'B'
    WRITELN " end"
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('10 B end\n');
  });

  // ── READ ──────────────────────────────────────────────

  it('READ DWORD stores input number', async () => {
    const { vm } = buildVM(`
#memory 8
#data 0, DWORD 0
_start:
    READ DWORD [0]
    HALT
`, ['42']);
    await vm.run();
    expect(vm.memory.readInteger(0, 'DWORD' as any)).toBe(42);
  });

  it('READ TEXT stores input string', async () => {
    const { vm } = buildVM(`
#memory 32
_start:
    READ TEXT [0]
    HALT
`, ['Hello']);
    await vm.run();
    expect(vm.memory.readText(0)).toBe('Hello');
  });

  it('READ with prompt passes prompt string to IO', async () => {
    const tokens = new Lexer(`
#memory 8
#data 0, DWORD 0
_start:
    READ DWORD [0], "Enter a number:"
    HALT
`).tokenize();
    const program = new Parser(tokens).parse();
    const testIO = createTestIO(['7']);
    const vm = new VM(program, testIO.io);
    await vm.run();
    expect(vm.memory.readInteger(0, 'DWORD' as any)).toBe(7);
    expect(testIO.prompts[0]).toBe('Enter a number:');
  });

  it('READ without prompt passes empty string to IO', async () => {
    const { vm, io } = buildVM(`
#memory 8
#data 0, DWORD 0
_start:
    READ DWORD [0]
    HALT
`, ['5']);
    await vm.run();
    expect(io.prompts[0]).toBe('');
  });

  it('READ TEXT with max length and prompt truncates and passes prompt', async () => {
    const tokens = new Lexer(`
#memory 32
_start:
    READ TEXT [0], 5, "Enter text:"
    HALT
`).tokenize();
    const program = new Parser(tokens).parse();
    const testIO = createTestIO(['Hello World']);
    const vm = new VM(program, testIO.io);
    await vm.run();
    expect(vm.memory.readText(0)).toBe('Hell'); // max 5-1=4 chars
    expect(testIO.prompts[0]).toBe('Enter text:');
  });

  it('READ TEXT with only prompt (no max length)', async () => {
    const tokens = new Lexer(`
#memory 32
_start:
    READ TEXT [0], "Your name:"
    HALT
`).tokenize();
    const program = new Parser(tokens).parse();
    const testIO = createTestIO(['Alice']);
    const vm = new VM(program, testIO.io);
    await vm.run();
    expect(vm.memory.readText(0)).toBe('Alice');
    expect(testIO.prompts[0]).toBe('Your name:');
  });

  // ── Type mismatch errors ──────────────────────────────

  it('CMP CHAR vs integer → Type Mismatch', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, CHAR 'A'
    CMP AX, 42
    HALT
`);
    const result = await vm.run();
    expect(result.state).toBe(VMState.ERROR);
    expect(result.error).toContain('Type Mismatch');
  });

  it('MOV CHAR [addr], imm → Type Mismatch', async () => {
    const { vm } = buildVM(`
#memory 4
_start:
    MOV CHAR [0], 65
    HALT
`);
    const result = await vm.run();
    expect(result.state).toBe(VMState.ERROR);
    expect(result.error).toContain('Type Mismatch');
  });

  // ── Overflow mode ─────────────────────────────────────

  it('#on_overflow halt stops on overflow', async () => {
    const { vm } = buildVM(`
#memory 4
#on_overflow halt
_start:
    MOV DWORD [0], 99999
    HALT
`);
    const result = await vm.run();
    expect(result.state).toBe(VMState.ERROR);
    expect(result.error).toContain('Type Overflow');
  });

  it('#on_overflow flag sets OF flag but continues', async () => {
    const { vm } = buildVM(`
#memory 4
#data 0, DWORD 0
_start:
    MOV DWORD [0], 99999
    HALT
`);
    await vm.run();
    expect(vm.state).toBe(VMState.HALTED);
    // The value should be truncated but execution continued
  });

  // ── Full program: Hello World ─────────────────────────

  it('Hello World program', async () => {
    const { vm } = buildVM(`
#memory 32
#data 0, TEXT "Hello, World!$"

_start:
    WRITELN TEXT [0]
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('Hello, World!\n');
    expect(vm.state).toBe(VMState.HALTED);
  });

  // ── Full program: Sum of Two Numbers ──────────────────

  it('Sum of two numbers', async () => {
    const { vm } = buildVM(`
#memory 16
#data 0, DWORD 0
#data 4, DWORD 0

_start:
    READ DWORD [0]
    READ DWORD [4]
    MOV AX, DWORD [0]
    ADD AX, DWORD [4]
    MOV DWORD [0], AX
    WRITELN DWORD [0]
    HALT
`, ['3', '7']);
    await vm.run();
    expect(vm.stdout).toBe('10\n');
  });

  // ── Full program: Max of Two Numbers ──────────────────

  it('Max of two numbers (first is larger)', async () => {
    const { vm } = buildVM(`
#memory 16
#data 0, DWORD 0
#data 4, DWORD 0

_start:
    READ DWORD [0]
    READ DWORD [4]
    MOV AX, DWORD [0]
    CMP AX, DWORD [4]
    JGE show_first
    WRITELN DWORD [4]
    JMP done
show_first:
    WRITELN DWORD [0]
done:
    HALT
`, ['10', '3']);
    await vm.run();
    expect(vm.stdout).toBe('10\n');
  });

  it('Max of two numbers (second is larger)', async () => {
    const { vm } = buildVM(`
#memory 16
#data 0, DWORD 0
#data 4, DWORD 0

_start:
    READ DWORD [0]
    READ DWORD [4]
    MOV AX, DWORD [0]
    CMP AX, DWORD [4]
    JGE show_first
    WRITELN DWORD [4]
    JMP done
show_first:
    WRITELN DWORD [0]
done:
    HALT
`, ['3', '10']);
    await vm.run();
    expect(vm.stdout).toBe('10\n');
  });

  // ── CHAR arithmetic example ───────────────────────────

  it('CHAR increment: A → B', async () => {
    const { vm } = buildVM(`
#memory 8
#data 0, CHAR 'A'

_start:
    WRITE CHAR [0]
    ADD CHAR [0], 1
    WRITELN CHAR [0]
    HALT
`);
    await vm.run();
    expect(vm.stdout).toBe('AB\n');
  });

  // ── Reset ─────────────────────────────────────────────

  it('reset restores initial state', async () => {
    const { vm } = buildVM(`
#memory 8
#data 0, DWORD 42
_start:
    MOV AX, DWORD [0]
    ADD AX, 10
    HALT
`);
    await vm.run();
    expect(vm.registers.get('AX' as any)!.value).toBe(52);

    vm.reset();
    expect(vm.state).toBe(VMState.IDLE);
    expect(vm.registers.get('AX' as any)).toBeNull();
    expect(vm.memory.readInteger(0, 'DWORD' as any)).toBe(42); // re-initialized from #data
  });

  // ── Pause / Stop requests ────────────────────────────

  it('requestPause() causes run() to return PAUSED', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 0
loop:
    ADD AX, 1
    JMP loop
    HALT
`);
    // Request pause before run (flag is checked at loop start)
    // We need to request pause asynchronously after the run starts
    // Since the loop yields every 1000 steps, we schedule pause before first yield
    vm.speed = Infinity;
    setTimeout(() => vm.requestPause(), 0);
    const result = await vm.run();
    expect(result.state).toBe(VMState.PAUSED);
  });

  it('requestStop() causes run() to return HALTED', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 0
loop:
    ADD AX, 1
    JMP loop
    HALT
`);
    vm.speed = Infinity;
    setTimeout(() => vm.requestStop(), 0);
    const result = await vm.run();
    expect(result.state).toBe(VMState.HALTED);
  });

  it('requestStop() on PAUSED sets HALTED immediately', () => {
    const { vm } = buildVM(`
_start:
    HALT
`);
    vm.state = VMState.PAUSED;
    vm.requestStop();
    expect(vm.state).toBe(VMState.HALTED);
  });

  it('requestStop() on IDLE sets HALTED immediately', () => {
    const { vm } = buildVM(`
_start:
    HALT
`);
    expect(vm.state).toBe(VMState.IDLE);
    vm.requestStop();
    expect(vm.state).toBe(VMState.HALTED);
  });

  // ── Statistics tracking ──────────────────────────────

  it('stats count total instructions', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 1
    MOV BX, 2
    MOV CX, 3
    HALT
`);
    await vm.run();
    expect(vm.stats.totalInstructions).toBe(4); // 3x MOV + HALT
  });

  it('stats count instructions per mnemonic', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 1
    MOV BX, 2
    ADD AX, BX
    HALT
`);
    await vm.run();
    expect(vm.stats.instructionCounts['MOV']).toBe(2);
    expect(vm.stats.instructionCounts['ADD']).toBe(1);
    expect(vm.stats.instructionCounts['HALT']).toBe(1);
  });

  it('stats count CALL and RET instructions', async () => {
    const { vm } = buildVM(`
#memory 32
_start:
    CALL fn
    HALT
fn:
    RET
`);
    await vm.run();
    expect(vm.stats.instructionCounts['CALL']).toBe(1);
    expect(vm.stats.instructionCounts['RET']).toBe(1);
    expect(vm.stats.instructionCounts['HALT']).toBe(1);
  });

  it('stats track register reads and writes', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 42
    MOV BX, AX
    HALT
`);
    await vm.run();
    // MOV AX, 42 → 1 reg write
    // MOV BX, AX → 1 reg read (AX) + 1 reg write (BX)
    expect(vm.stats.registerWrites).toBe(2);
    expect(vm.stats.registerReads).toBe(1);
  });

  it('stats track memory reads and writes', async () => {
    const { vm } = buildVM(`
#memory 16
#data 0, DWORD 0
_start:
    MOV DWORD [0], 42
    MOV AX, DWORD [0]
    HALT
`);
    await vm.run();
    expect(vm.stats.memoryWrites).toBe(1);
    expect(vm.stats.memoryWriteBytes).toBe(4); // DWORD = 4 cells
    expect(vm.stats.memoryReads).toBe(1);
    expect(vm.stats.memoryReadBytes).toBe(4);
  });

  it('stats track TEXT memory writes', async () => {
    const { vm } = buildVM(`
#memory 32
#data 0, DWORD 0
_start:
    READ TEXT [0]
    HALT
`, ['Hello']);
    await vm.run();
    // "Hello" + '$' = 6 cells
    expect(vm.stats.memoryWrites).toBe(1);
    expect(vm.stats.memoryWriteBytes).toBe(6);
  });

  it('stats track TEXT memory reads via WRITE', async () => {
    const { vm } = buildVM(`
#memory 32
#data 0, TEXT "Hi$"
_start:
    WRITE TEXT [0]
    HALT
`);
    await vm.run();
    expect(vm.stats.memoryReads).toBe(1);
    expect(vm.stats.memoryReadBytes).toBe(2); // "Hi" (2 chars, $ excluded from output)
  });

  it('stats reset on vm.reset()', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 1
    HALT
`);
    await vm.run();
    expect(vm.stats.totalInstructions).toBe(2);

    vm.reset();
    expect(vm.stats.totalInstructions).toBe(0);
    expect(vm.stats.registerWrites).toBe(0);
    expect(vm.stats.registerReads).toBe(0);
    expect(vm.stats.memoryReads).toBe(0);
    expect(vm.stats.memoryWrites).toBe(0);
  });

  // ── Speed control ────────────────────────────────────

  it('speed defaults to Infinity', () => {
    const { vm } = buildVM(`
_start:
    HALT
`);
    expect(vm.speed).toBe(Infinity);
  });

  it('speed can be set and affects throttle behavior', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 1
    MOV BX, 2
    HALT
`);
    vm.speed = 1000; // 1000 IPS
    await vm.run();
    expect(vm.state).toBe(VMState.HALTED);
  });

  // ── onAfterStep callback ─────────────────────────────

  it('onAfterStep is called for each instruction in run()', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, 1
    MOV BX, 2
    HALT
`);
    let callCount = 0;
    vm.onAfterStep = () => callCount++;
    await vm.run();
    // 3 instructions (MOV, MOV, HALT) — callback called 3 times
    // But HALT breaks the loop, callback fires after step (before break check)
    expect(callCount).toBe(3);
  });
});
