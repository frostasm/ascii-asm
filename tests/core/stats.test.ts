import { describe, it, expect } from 'vitest';
import { Lexer } from '@core/lexer';
import { Parser } from '@core/parser';
import { VM, VMIO } from '@core/vm';
import { Debugger } from '@core/debugger';
import { VMState } from '@core/types';

// ── Helpers ────────────────────────────────────────────────────

function createTestIO(inputs: string[] = []): { io: VMIO; output: string[] } {
  const state = { output: [] as string[], inputIdx: 0 };
  const io: VMIO = {
    requestInput: () => {
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

function buildDebugger(source: string, inputs: string[] = []) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const testIO = createTestIO(inputs);
  const vm = new VM(program, testIO.io);
  const dbg = new Debugger(vm);
  return { vm, dbg, io: testIO };
}

// ── Test programs ──────────────────────────────────────────────

/** 3 MOVs + HALT = 4 instructions */
const SIMPLE = `
_start:
    MOV AX, 1
    MOV BX, 2
    MOV CX, 3
    HALT
`;

/** Memory read + write program */
const MEMORY_PROGRAM = `
#memory 16
#data 0, DWORD 42
_start:
    MOV AX, DWORD [0]
    MOV DWORD [4], AX
    HALT
`;

/** Program with arithmetic */
const ARITHMETIC = `
_start:
    MOV AX, 10
    MOV BX, 20
    ADD AX, BX
    SUB AX, 5
    HALT
`;

/** Program with CMP and branch */
const BRANCH_PROGRAM = `
_start:
    MOV AX, 10
    CMP AX, 5
    JG bigger
    MOV BX, 0
    JMP done
bigger:
    MOV BX, 1
done:
    HALT
`;

/** Loop program: sum 1..3 */
const LOOP_PROGRAM = `
#memory 8
#data 0, DWORD 0
_start:
    MOV AX, 0
    MOV CX, 3
loop:
    ADD AX, 1
    SUB CX, 1
    CMP CX, 0
    JG loop
    MOV DWORD [0], AX
    HALT
`;

/** Program with WRITE */
const WRITE_PROGRAM = `
#memory 8
#data 0, DWORD 42
_start:
    WRITE DWORD [0]
    WRITELN
    HALT
`;

/** Program with READ */
const READ_PROGRAM = `
#memory 8
#data 0, DWORD 0
_start:
    READ DWORD [0]
    MOV AX, DWORD [0]
    HALT
`;

// ═══════════════════════════════════════════════════════════════
// Stats via run() — full execution
// ═══════════════════════════════════════════════════════════════

describe('Stats — run() (full execution)', () => {
  it('counts instructions for simple program', async () => {
    const { vm } = buildVM(SIMPLE);
    await vm.run();
    expect(vm.state).toBe(VMState.HALTED);
    expect(vm.stats.totalInstructions).toBe(4); // 3 MOV + 1 HALT
    expect(vm.stats.instructionCounts['MOV']).toBe(3);
    expect(vm.stats.instructionCounts['HALT']).toBe(1);
  });

  it('counts arithmetic instructions', async () => {
    const { vm } = buildVM(ARITHMETIC);
    await vm.run();
    expect(vm.stats.totalInstructions).toBe(5); // 2 MOV + 1 ADD + 1 SUB + 1 HALT
    expect(vm.stats.instructionCounts['MOV']).toBe(2);
    expect(vm.stats.instructionCounts['ADD']).toBe(1);
    expect(vm.stats.instructionCounts['SUB']).toBe(1);
    expect(vm.stats.instructionCounts['HALT']).toBe(1);
  });

  it('counts branch instructions', async () => {
    const { vm } = buildVM(BRANCH_PROGRAM);
    await vm.run();
    // MOV AX,10 → CMP AX,5 → JG bigger (taken) → MOV BX,1 → HALT
    expect(vm.stats.totalInstructions).toBe(5);
    expect(vm.stats.instructionCounts['MOV']).toBe(2);
    expect(vm.stats.instructionCounts['CMP']).toBe(1);
    expect(vm.stats.instructionCounts['JG']).toBe(1);
    expect(vm.stats.instructionCounts['HALT']).toBe(1);
    // JMP done is NOT executed (skipped via JG)
    expect(vm.stats.instructionCounts['JMP']).toBeUndefined();
  });

  it('counts loop iterations', async () => {
    const { vm } = buildVM(LOOP_PROGRAM);
    await vm.run();
    // Initial: MOV AX,0 + MOV CX,3 = 2
    // Loop (3 iterations): (ADD + SUB + CMP + JG) × 3 = 12
    // But last JG is not taken, so 3×ADD + 3×SUB + 3×CMP + 3×JG = 12
    // Final: MOV DWORD[0],AX + HALT = 2
    // Total = 2 + 12 + 2 = 16
    expect(vm.stats.totalInstructions).toBe(16);
    expect(vm.stats.instructionCounts['ADD']).toBe(3);
    expect(vm.stats.instructionCounts['SUB']).toBe(3);
    expect(vm.stats.instructionCounts['CMP']).toBe(3);
    expect(vm.stats.instructionCounts['JG']).toBe(3);
    expect(vm.stats.instructionCounts['MOV']).toBe(3); // 2 initial + 1 final
  });

  it('tracks memory reads and writes', async () => {
    const { vm } = buildVM(MEMORY_PROGRAM);
    await vm.run();
    // MOV AX, DWORD [0] → 1 memory read (4 bytes)
    // MOV DWORD [4], AX → 1 memory write (4 bytes)
    expect(vm.stats.memoryReads).toBeGreaterThanOrEqual(1);
    expect(vm.stats.memoryReadBytes).toBeGreaterThanOrEqual(4);
    expect(vm.stats.memoryWrites).toBeGreaterThanOrEqual(1);
    expect(vm.stats.memoryWriteBytes).toBeGreaterThanOrEqual(4);
  });

  it('tracks register reads and writes', async () => {
    const { vm } = buildVM(SIMPLE);
    await vm.run();
    // 3 MOV reg, imm → 3 register writes
    expect(vm.stats.registerWrites).toBeGreaterThanOrEqual(3);
  });

  it('tracks WRITE instruction memory access', async () => {
    const { vm } = buildVM(WRITE_PROGRAM);
    await vm.run();
    expect(vm.stats.instructionCounts['WRITE']).toBe(1);
    expect(vm.stats.instructionCounts['WRITELN']).toBe(1);
    expect(vm.stats.memoryReads).toBeGreaterThanOrEqual(1);
  });

  it('tracks READ instruction memory access', async () => {
    const { vm } = buildVM(READ_PROGRAM, ['99']);
    await vm.run();
    expect(vm.stats.instructionCounts['READ']).toBe(1);
    expect(vm.stats.memoryWrites).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Stats via step() — single stepping
// ═══════════════════════════════════════════════════════════════

describe('Stats — step() (single stepping)', () => {
  it('increments stats after each step', async () => {
    const { vm } = buildVM(SIMPLE);

    // Step 1: MOV AX, 1
    await vm.step();
    expect(vm.stats.totalInstructions).toBe(1);
    expect(vm.stats.instructionCounts['MOV']).toBe(1);

    // Step 2: MOV BX, 2
    await vm.step();
    expect(vm.stats.totalInstructions).toBe(2);
    expect(vm.stats.instructionCounts['MOV']).toBe(2);

    // Step 3: MOV CX, 3
    await vm.step();
    expect(vm.stats.totalInstructions).toBe(3);
    expect(vm.stats.instructionCounts['MOV']).toBe(3);

    // Step 4: HALT
    await vm.step();
    expect(vm.stats.totalInstructions).toBe(4);
    expect(vm.stats.instructionCounts['MOV']).toBe(3);
    expect(vm.stats.instructionCounts['HALT']).toBe(1);
    expect(vm.state).toBe(VMState.HALTED);
  });

  it('tracks register writes per step', async () => {
    const { vm } = buildVM(SIMPLE);

    await vm.step(); // MOV AX, 1
    expect(vm.stats.registerWrites).toBeGreaterThanOrEqual(1);
    const afterFirst = vm.stats.registerWrites;

    await vm.step(); // MOV BX, 2
    expect(vm.stats.registerWrites).toBeGreaterThan(afterFirst);
  });

  it('tracks memory access per step', async () => {
    const { vm } = buildVM(MEMORY_PROGRAM);

    await vm.step(); // MOV AX, DWORD [0]
    expect(vm.stats.memoryReads).toBeGreaterThanOrEqual(1);
    expect(vm.stats.memoryWrites).toBe(0);

    await vm.step(); // MOV DWORD [4], AX
    expect(vm.stats.memoryWrites).toBeGreaterThanOrEqual(1);
  });

  it('produces same totals as run() for same program', async () => {
    // Run via step()
    const { vm: vmStep } = buildVM(SIMPLE);
    while (vmStep.state !== VMState.HALTED && vmStep.state !== VMState.ERROR) {
      await vmStep.step();
    }

    // Run via run()
    const { vm: vmRun } = buildVM(SIMPLE);
    await vmRun.run();

    expect(vmStep.stats.totalInstructions).toBe(vmRun.stats.totalInstructions);
    expect(vmStep.stats.instructionCounts).toEqual(vmRun.stats.instructionCounts);
    expect(vmStep.stats.registerReads).toBe(vmRun.stats.registerReads);
    expect(vmStep.stats.registerWrites).toBe(vmRun.stats.registerWrites);
    expect(vmStep.stats.memoryReads).toBe(vmRun.stats.memoryReads);
    expect(vmStep.stats.memoryReadBytes).toBe(vmRun.stats.memoryReadBytes);
    expect(vmStep.stats.memoryWrites).toBe(vmRun.stats.memoryWrites);
    expect(vmStep.stats.memoryWriteBytes).toBe(vmRun.stats.memoryWriteBytes);
  });
});

// ═══════════════════════════════════════════════════════════════
// Stats via debugger — debug/step/continue
// ═══════════════════════════════════════════════════════════════

describe('Stats — Debugger (debug/stepOver/continue)', () => {
  it('debug() without breakpoints counts all instructions', async () => {
    const { vm, dbg } = buildDebugger(SIMPLE);
    await dbg.start();
    expect(vm.state).toBe(VMState.HALTED);
    expect(vm.stats.totalInstructions).toBe(4);
    expect(vm.stats.instructionCounts['MOV']).toBe(3);
    expect(vm.stats.instructionCounts['HALT']).toBe(1);
  });

  it('stepOver() increments stats one instruction at a time', async () => {
    const { vm, dbg } = buildDebugger(SIMPLE);

    // First stepOver from IDLE → PAUSED at first instruction (no execution)
    await dbg.stepOver();
    expect(vm.state).toBe(VMState.PAUSED);
    expect(vm.stats.totalInstructions).toBe(0);

    // Step: MOV AX, 1
    await dbg.stepOver();
    expect(vm.stats.totalInstructions).toBe(1);
    expect(vm.stats.instructionCounts['MOV']).toBe(1);

    // Step: MOV BX, 2
    await dbg.stepOver();
    expect(vm.stats.totalInstructions).toBe(2);
    expect(vm.stats.instructionCounts['MOV']).toBe(2);

    // Step: MOV CX, 3
    await dbg.stepOver();
    expect(vm.stats.totalInstructions).toBe(3);

    // Step: HALT
    await dbg.stepOver();
    expect(vm.stats.totalInstructions).toBe(4);
    expect(vm.stats.instructionCounts['HALT']).toBe(1);
    expect(vm.state).toBe(VMState.HALTED);
  });

  it('debug() with breakpoint then continue()', async () => {
    const { vm, dbg } = buildDebugger(ARITHMETIC);
    // ARITHMETIC lines:
    //   line 3: MOV AX, 10
    //   line 4: MOV BX, 20
    //   line 5: ADD AX, BX
    //   line 6: SUB AX, 5
    //   line 7: HALT
    dbg.addBreakpoint(5); // break before ADD

    // Start → runs MOV AX,10 + MOV BX,20 then pauses before ADD
    const r1 = await dbg.start();
    expect(r1.state).toBe(VMState.PAUSED);
    expect(vm.stats.totalInstructions).toBe(2);
    expect(vm.stats.instructionCounts['MOV']).toBe(2);
    expect(vm.stats.instructionCounts['ADD']).toBeUndefined();

    // Continue → runs ADD + SUB + HALT
    const r2 = await dbg.continue();
    expect(r2.state).toBe(VMState.HALTED);
    expect(vm.stats.totalInstructions).toBe(5);
    expect(vm.stats.instructionCounts['ADD']).toBe(1);
    expect(vm.stats.instructionCounts['SUB']).toBe(1);
    expect(vm.stats.instructionCounts['HALT']).toBe(1);
  });

  it('debug() with breakpoint then stepOver() then continue()', async () => {
    const { vm, dbg } = buildDebugger(ARITHMETIC);
    dbg.addBreakpoint(5); // break before ADD

    // Start → pauses at ADD
    await dbg.start();
    expect(vm.stats.totalInstructions).toBe(2);

    // Step one instruction: ADD AX, BX
    await dbg.stepOver();
    expect(vm.stats.totalInstructions).toBe(3);
    expect(vm.stats.instructionCounts['ADD']).toBe(1);

    // Continue → runs SUB + HALT
    await dbg.continue();
    expect(vm.stats.totalInstructions).toBe(5);
    expect(vm.stats.instructionCounts['SUB']).toBe(1);
    expect(vm.stats.instructionCounts['HALT']).toBe(1);
  });

  it('stats match between debug() without breakpoints and run()', async () => {
    const { vm: vmDbg, dbg } = buildDebugger(LOOP_PROGRAM);
    await dbg.start();

    const { vm: vmRun } = buildVM(LOOP_PROGRAM);
    await vmRun.run();

    expect(vmDbg.stats.totalInstructions).toBe(vmRun.stats.totalInstructions);
    expect(vmDbg.stats.instructionCounts).toEqual(vmRun.stats.instructionCounts);
    expect(vmDbg.stats.memoryReads).toBe(vmRun.stats.memoryReads);
    expect(vmDbg.stats.memoryWrites).toBe(vmRun.stats.memoryWrites);
    expect(vmDbg.stats.registerReads).toBe(vmRun.stats.registerReads);
    expect(vmDbg.stats.registerWrites).toBe(vmRun.stats.registerWrites);
  });

  it('stats match between full stepOver walk and run()', async () => {
    // Walk entire program via stepOver
    const { vm: vmStep, dbg } = buildDebugger(ARITHMETIC);
    await dbg.stepOver(); // IDLE → PAUSED (no execution)
    while (vmStep.state === VMState.PAUSED) {
      await dbg.stepOver();
    }

    // Same program via run()
    const { vm: vmRun } = buildVM(ARITHMETIC);
    await vmRun.run();

    expect(vmStep.stats.totalInstructions).toBe(vmRun.stats.totalInstructions);
    expect(vmStep.stats.instructionCounts).toEqual(vmRun.stats.instructionCounts);
    expect(vmStep.stats.registerReads).toBe(vmRun.stats.registerReads);
    expect(vmStep.stats.registerWrites).toBe(vmRun.stats.registerWrites);
  });
});

// ═══════════════════════════════════════════════════════════════
// Stats — reset
// ═══════════════════════════════════════════════════════════════

describe('Stats — reset', () => {
  it('reset() clears all stats', async () => {
    const { vm } = buildVM(SIMPLE);
    await vm.run();
    expect(vm.stats.totalInstructions).toBe(4);

    vm.reset();
    expect(vm.stats.totalInstructions).toBe(0);
    expect(vm.stats.instructionCounts).toEqual({});
    expect(vm.stats.memoryReads).toBe(0);
    expect(vm.stats.memoryReadBytes).toBe(0);
    expect(vm.stats.memoryWrites).toBe(0);
    expect(vm.stats.memoryWriteBytes).toBe(0);
    expect(vm.stats.registerReads).toBe(0);
    expect(vm.stats.registerWrites).toBe(0);
  });

  it('stats accumulate fresh after reset + re-run', async () => {
    const { vm } = buildVM(SIMPLE);
    await vm.run();
    expect(vm.stats.totalInstructions).toBe(4);

    vm.reset();
    await vm.run();
    expect(vm.stats.totalInstructions).toBe(4); // same count, not 8
  });
});

// ═══════════════════════════════════════════════════════════════
// Stats — error and stop scenarios
// ═══════════════════════════════════════════════════════════════

describe('Stats — error and stop scenarios', () => {
  it('stats are counted up to the point of error', async () => {
    const { vm } = buildVM(`
_start:
    MOV AX, CHAR 'A'
    CMP AX, 42
    HALT
`);
    await vm.run();
    expect(vm.state).toBe(VMState.ERROR);
    // MOV succeeded (counted), CMP threw an error (not counted)
    expect(vm.stats.totalInstructions).toBe(1);
    expect(vm.stats.instructionCounts['MOV']).toBe(1);
  });

  it('stats reflect partial execution when stopped', async () => {
    const { vm, dbg } = buildDebugger(LOOP_PROGRAM);
    dbg.addBreakpoint(8); // break inside the loop (ADD AX, 1 — line 8)

    await dbg.start();
    expect(vm.state).toBe(VMState.PAUSED);
    const countAtBreak = vm.stats.totalInstructions;
    expect(countAtBreak).toBeGreaterThan(0);

    // Stop from paused state
    dbg.stop();
    expect(vm.state).toBe(VMState.HALTED);
    // Stats remain at the breakpoint count
    expect(vm.stats.totalInstructions).toBe(countAtBreak);
  });

  it('no stats counted for HALT/ERROR state step attempts', async () => {
    const { vm } = buildVM(SIMPLE);
    await vm.run();
    expect(vm.stats.totalInstructions).toBe(4);

    // Stepping a halted VM should not change stats
    await vm.step();
    expect(vm.stats.totalInstructions).toBe(4);
    await vm.step();
    expect(vm.stats.totalInstructions).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════
// Stats — onAfterStep callback
// ═══════════════════════════════════════════════════════════════

describe('Stats — onAfterStep callback', () => {
  it('onAfterStep fires during run() with updated stats', async () => {
    const { vm } = buildVM(SIMPLE);
    const snapshots: number[] = [];
    vm.onAfterStep = () => {
      snapshots.push(vm.stats.totalInstructions);
    };
    await vm.run();
    // Should have been called 4 times (one per instruction)
    expect(snapshots).toEqual([1, 2, 3, 4]);
  });

  it('onAfterStep is not called during step()', async () => {
    const { vm } = buildVM(SIMPLE);
    let callCount = 0;
    vm.onAfterStep = () => { callCount++; };
    await vm.step();
    // step() does not call onAfterStep — only run() does
    expect(callCount).toBe(0);
  });
});
