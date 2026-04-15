import { describe, it, expect } from 'vitest';
import { RegisterFile } from '@core/registers';
import { Register } from '@core/types';

describe('RegisterFile', () => {
  it('initializes registers as null', () => {
    const regs = new RegisterFile();
    expect(regs.get(Register.AX)).toBeNull();
    expect(regs.get(Register.BX)).toBeNull();
    expect(regs.get(Register.CX)).toBeNull();
    expect(regs.get(Register.DX)).toBeNull();
    expect(regs.get(Register.SI)).toBeNull();
    expect(regs.get(Register.DI)).toBeNull();
  });

  it('initializes flags as cleared', () => {
    const regs = new RegisterFile();
    expect(regs.flags).toEqual({ ZF: false, SF: false, OF: false });
  });

  it('sets and gets integer value', () => {
    const regs = new RegisterFile();
    regs.set(Register.AX, { type: 'integer', value: 42 });
    expect(regs.get(Register.AX)).toEqual({ type: 'integer', value: 42 });
  });

  it('sets and gets char value', () => {
    const regs = new RegisterFile();
    regs.set(Register.BX, { type: 'char', value: 65 }); // 'A'
    const val = regs.get(Register.BX);
    expect(val).toEqual({ type: 'char', value: 65 });
  });

  it('overwrites register value and type', () => {
    const regs = new RegisterFile();
    regs.set(Register.AX, { type: 'integer', value: 42 });
    regs.set(Register.AX, { type: 'char', value: 65 });
    expect(regs.get(Register.AX)).toEqual({ type: 'char', value: 65 });
  });

  it('updates flags: zero result', () => {
    const regs = new RegisterFile();
    regs.updateFlags(0, false);
    expect(regs.flags.ZF).toBe(true);
    expect(regs.flags.SF).toBe(false);
    expect(regs.flags.OF).toBe(false);
  });

  it('updates flags: negative result', () => {
    const regs = new RegisterFile();
    regs.updateFlags(-5, false);
    expect(regs.flags.ZF).toBe(false);
    expect(regs.flags.SF).toBe(true);
    expect(regs.flags.OF).toBe(false);
  });

  it('updates flags: overflow', () => {
    const regs = new RegisterFile();
    regs.updateFlags(100, true);
    expect(regs.flags.ZF).toBe(false);
    expect(regs.flags.SF).toBe(false);
    expect(regs.flags.OF).toBe(true);
  });

  it('resets all state', () => {
    const regs = new RegisterFile();
    regs.set(Register.AX, { type: 'integer', value: 42 });
    regs.updateFlags(-1, true);
    regs.reset();
    expect(regs.get(Register.AX)).toBeNull();
    expect(regs.flags).toEqual({ ZF: false, SF: false, OF: false });
  });

  it('returns correct snapshot', () => {
    const regs = new RegisterFile();
    regs.set(Register.AX, { type: 'integer', value: 1 });
    regs.set(Register.CX, { type: 'char', value: 65 });
    regs.set(Register.DI, { type: 'integer', value: 99 });
    const snap = regs.getSnapshot();
    expect(snap.AX).toEqual({ type: 'integer', value: 1 });
    expect(snap.BX).toBeNull();
    expect(snap.CX).toEqual({ type: 'char', value: 65 });
    expect(snap.DX).toBeNull();
    expect(snap.SI).toBeNull();
    expect(snap.DI).toEqual({ type: 'integer', value: 99 });
  });
});
