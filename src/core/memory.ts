import { DataType, DATA_TYPE_SIZE, DATA_TYPE_RANGE } from './types';
import { InvalidMemoryAccessError } from './errors';

/**
 * AsciiAsm Memory — a linear array of ASCII cells.
 * Each cell stores one character (ASCII 32–126).
 */
export class Memory {
  private cells: number[];
  readonly size: number;

  constructor(size: number, initValue?: number) {
    this.size = size;
    if (initValue !== undefined) {
      this.cells = new Array(size).fill(initValue);
    } else {
      // Uninitialized: fill with random printable ASCII (32–126)
      this.cells = new Array(size);
      for (let i = 0; i < size; i++) {
        this.cells[i] = 32 + Math.floor(Math.random() * 95);
      }
    }
  }

  // ── Bounds check ──────────────────────────────────────────

  private checkBounds(address: number, count: number, line: number): void {
    if (address < 0 || address + count > this.size) {
      throw new InvalidMemoryAccessError(address, this.size, line);
    }
  }

  // ── Raw cell access ───────────────────────────────────────

  getCell(address: number, line = 0): number {
    this.checkBounds(address, 1, line);
    return this.cells[address];
  }

  setCell(address: number, value: number, line = 0): void {
    this.checkBounds(address, 1, line);
    this.cells[address] = value;
  }

  // ── CHAR ──────────────────────────────────────────────────

  readChar(address: number, line = 0): number {
    this.checkBounds(address, 1, line);
    return this.cells[address];
  }

  writeChar(address: number, value: number, line = 0): void {
    this.checkBounds(address, 1, line);
    this.cells[address] = value;
  }

  // ── Integer (WORD / DWORD / QWORD) ────────────────────────

  readInteger(address: number, dataType: DataType, line = 0): number {
    const cellCount = DATA_TYPE_SIZE[dataType];
    this.checkBounds(address, cellCount, line);

    // Read ASCII string from cells
    let str = '';
    for (let i = 0; i < cellCount; i++) {
      str += String.fromCharCode(this.cells[address + i]);
    }

    // Parse: first char may be '-' for negative
    return parseInt(str, 10);
  }

  writeInteger(address: number, dataType: DataType, value: number, line = 0): { overflow: boolean } {
    const cellCount = DATA_TYPE_SIZE[dataType];
    this.checkBounds(address, cellCount, line);

    const range = DATA_TYPE_RANGE[dataType]!;
    let overflow = false;

    // Check overflow and truncate
    if (value < range[0] || value > range[1]) {
      overflow = true;
      value = this.truncateInteger(value, dataType);
    }

    // Format to ASCII string with proper padding
    const formatted = this.formatInteger(value, cellCount);

    for (let i = 0; i < cellCount; i++) {
      this.cells[address + i] = formatted.charCodeAt(i);
    }

    return { overflow };
  }

  // ── TEXT ───────────────────────────────────────────────────

  readText(address: number, line = 0): string {
    let result = '';
    let i = address;
    while (i < this.size) {
      const ch = String.fromCharCode(this.cells[i]);
      if (ch === '$') break;
      result += ch;
      i++;
    }
    if (i >= this.size) {
      throw new InvalidMemoryAccessError(i, this.size, line);
    }
    return result;
  }

  writeText(address: number, text: string, line = 0): void {
    // text should include the $ terminator
    const withTerminator = text.endsWith('$') ? text : text + '$';
    this.checkBounds(address, withTerminator.length, line);
    for (let i = 0; i < withTerminator.length; i++) {
      this.cells[address + i] = withTerminator.charCodeAt(i);
    }
  }

  // ── Snapshot for UI ───────────────────────────────────────

  getSnapshot(): number[] {
    return [...this.cells];
  }

  // ── Integer formatting ────────────────────────────────────

  /**
   * Truncate integer to fit type: keep sign, keep least significant digits.
   */
  private truncateInteger(value: number, dataType: DataType): number {
    const cellCount = DATA_TYPE_SIZE[dataType];
    const isNegative = value < 0;
    const absValue = Math.abs(value);

    // Max number of digits that fit: cellCount for positive, cellCount-1 for negative
    const maxDigits = isNegative ? cellCount - 1 : cellCount;
    const absStr = absValue.toString();

    let truncated: string;
    if (absStr.length > maxDigits) {
      // Keep least significant digits
      truncated = absStr.slice(absStr.length - maxDigits);
    } else {
      truncated = absStr;
    }

    const result = parseInt(truncated, 10);
    return isNegative ? -result : result;
  }

  /**
   * Format integer value as a fixed-width ASCII string.
   * Negative: '-' + zero-padded digits.
   * Positive/zero: zero-padded digits filling all cells.
   */
  private formatInteger(value: number, cellCount: number): string {
    if (value < 0) {
      const digits = Math.abs(value).toString();
      return '-' + digits.padStart(cellCount - 1, '0');
    } else {
      return value.toString().padStart(cellCount, '0');
    }
  }

  // ── Initialization from #data ─────────────────────────────

  initializeData(address: number, dataType: DataType, value: number | string, line = 0): void {
    if (dataType === DataType.TEXT) {
      this.writeText(address, value as string, line);
    } else if (dataType === DataType.CHAR) {
      this.writeChar(address, value as number, line);
    } else {
      this.writeInteger(address, dataType, value as number, line);
    }
  }
}
