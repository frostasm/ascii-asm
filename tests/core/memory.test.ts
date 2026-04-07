import { describe, it, expect } from 'vitest';
import { Memory } from '@core/memory';
import { DataType } from '@core/types';

describe('Memory', () => {
  it('creates with given size and default random init', () => {
    const mem = new Memory(10);
    expect(mem.size).toBe(10);
    const snap = mem.getSnapshot();
    expect(snap).toHaveLength(10);
    // All should be printable ASCII (32–126)
    for (const cell of snap) {
      expect(cell).toBeGreaterThanOrEqual(32);
      expect(cell).toBeLessThanOrEqual(126);
    }
  });

  it('creates with explicit init value', () => {
    const mem = new Memory(5, 48); // ASCII '0'
    const snap = mem.getSnapshot();
    expect(snap).toEqual([48, 48, 48, 48, 48]);
  });

  // ── CHAR ──────────────────────────────────────────────

  it('reads and writes CHAR', () => {
    const mem = new Memory(4, 32);
    mem.writeChar(0, 65); // 'A'
    expect(mem.readChar(0)).toBe(65);
    expect(String.fromCharCode(mem.readChar(0))).toBe('A');
  });

  // ── WORD ──────────────────────────────────────────────

  it('writes and reads WORD positive', () => {
    const mem = new Memory(10, 48);
    mem.writeInteger(0, DataType.WORD, 42);
    expect(mem.readInteger(0, DataType.WORD)).toBe(42);
  });

  it('writes and reads WORD zero', () => {
    const mem = new Memory(10, 48);
    mem.writeInteger(0, DataType.WORD, 0);
    expect(mem.readInteger(0, DataType.WORD)).toBe(0);
    // Should be "00" in memory
    expect(String.fromCharCode(mem.getCell(0))).toBe('0');
    expect(String.fromCharCode(mem.getCell(1))).toBe('0');
  });

  it('writes and reads WORD negative', () => {
    const mem = new Memory(10, 48);
    mem.writeInteger(0, DataType.WORD, -4);
    expect(mem.readInteger(0, DataType.WORD)).toBe(-4);
    // Should be "-4" in memory
    expect(String.fromCharCode(mem.getCell(0))).toBe('-');
    expect(String.fromCharCode(mem.getCell(1))).toBe('4');
  });

  // ── DWORD ─────────────────────────────────────────────

  it('writes and reads DWORD positive', () => {
    const mem = new Memory(10, 48);
    mem.writeInteger(0, DataType.DWORD, 42);
    expect(mem.readInteger(0, DataType.DWORD)).toBe(42);
    // "0042" in memory
    expect(String.fromCharCode(mem.getCell(0), mem.getCell(1), mem.getCell(2), mem.getCell(3))).toBe('0042');
  });

  it('writes and reads DWORD negative', () => {
    const mem = new Memory(10, 48);
    mem.writeInteger(0, DataType.DWORD, -42);
    expect(mem.readInteger(0, DataType.DWORD)).toBe(-42);
    // "-042" in memory
    expect(String.fromCharCode(mem.getCell(0), mem.getCell(1), mem.getCell(2), mem.getCell(3))).toBe('-042');
  });

  it('DWORD max value', () => {
    const mem = new Memory(10, 48);
    mem.writeInteger(0, DataType.DWORD, 9999);
    expect(mem.readInteger(0, DataType.DWORD)).toBe(9999);
  });

  it('DWORD min value', () => {
    const mem = new Memory(10, 48);
    mem.writeInteger(0, DataType.DWORD, -999);
    expect(mem.readInteger(0, DataType.DWORD)).toBe(-999);
  });

  // ── QWORD ─────────────────────────────────────────────

  it('writes and reads QWORD', () => {
    const mem = new Memory(16, 48);
    mem.writeInteger(0, DataType.QWORD, 12345);
    expect(mem.readInteger(0, DataType.QWORD)).toBe(12345);
    // "00012345" in memory
    const str = Array.from({ length: 8 }, (_, i) => String.fromCharCode(mem.getCell(i))).join('');
    expect(str).toBe('00012345');
  });

  it('writes and reads QWORD negative', () => {
    const mem = new Memory(16, 48);
    mem.writeInteger(0, DataType.QWORD, -12345);
    expect(mem.readInteger(0, DataType.QWORD)).toBe(-12345);
    const str = Array.from({ length: 8 }, (_, i) => String.fromCharCode(mem.getCell(i))).join('');
    expect(str).toBe('-0012345');
  });

  // ── Overflow ──────────────────────────────────────────

  it('detects WORD overflow and truncates', () => {
    const mem = new Memory(10, 48);
    const { overflow } = mem.writeInteger(0, DataType.WORD, 123); // > 99
    expect(overflow).toBe(true);
    // Should keep least significant digits: 23
    expect(mem.readInteger(0, DataType.WORD)).toBe(23);
  });

  it('detects DWORD overflow', () => {
    const mem = new Memory(10, 48);
    const { overflow } = mem.writeInteger(0, DataType.DWORD, 12345); // > 9999
    expect(overflow).toBe(true);
    expect(mem.readInteger(0, DataType.DWORD)).toBe(2345);
  });

  it('no overflow for in-range values', () => {
    const mem = new Memory(10, 48);
    const { overflow } = mem.writeInteger(0, DataType.DWORD, 42);
    expect(overflow).toBe(false);
  });

  // ── TEXT ──────────────────────────────────────────────

  it('writes and reads TEXT', () => {
    const mem = new Memory(20, 32);
    mem.writeText(0, 'Hello$');
    expect(mem.readText(0)).toBe('Hello');
  });

  it('writes TEXT with auto-appended terminator', () => {
    const mem = new Memory(20, 32);
    mem.writeText(0, 'World');
    expect(mem.readText(0)).toBe('World');
  });

  it('handles empty TEXT', () => {
    const mem = new Memory(10, 32);
    mem.writeText(0, '$');
    expect(mem.readText(0)).toBe('');
  });

  // ── Bounds checking ───────────────────────────────────

  it('throws on out-of-bounds read', () => {
    const mem = new Memory(4, 32);
    expect(() => mem.readInteger(3, DataType.DWORD)).toThrow('Invalid memory access');
  });

  it('throws on out-of-bounds write', () => {
    const mem = new Memory(4, 32);
    expect(() => mem.writeInteger(3, DataType.DWORD, 42)).toThrow('Invalid memory access');
  });

  it('throws on negative address', () => {
    const mem = new Memory(4, 32);
    expect(() => mem.readChar(-1)).toThrow('Invalid memory access');
  });

  // ── initializeData ────────────────────────────────────

  it('initializes data from directive', () => {
    const mem = new Memory(32, 32);
    mem.initializeData(0, DataType.DWORD, 42);
    mem.initializeData(4, DataType.TEXT, 'Hello$');
    mem.initializeData(10, DataType.CHAR, 65);
    expect(mem.readInteger(0, DataType.DWORD)).toBe(42);
    expect(mem.readText(4)).toBe('Hello');
    expect(mem.readChar(10)).toBe(65);
  });
});
