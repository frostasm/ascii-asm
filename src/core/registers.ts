import { Register, Flags, RegisterValue } from './types';

/**
 * AsciiAsm Register File — 4 general-purpose registers + FLAGS.
 */
export class RegisterFile {
  private values: Map<Register, RegisterValue | null> = new Map();
  flags: Flags;

  constructor() {
    // Initialize registers as null (unset)
    this.values.set(Register.AX, null);
    this.values.set(Register.BX, null);
    this.values.set(Register.CX, null);
    this.values.set(Register.DX, null);

    this.flags = { ZF: false, SF: false, OF: false };
  }

  get(reg: Register): RegisterValue | null {
    return this.values.get(reg) ?? null;
  }

  set(reg: Register, value: RegisterValue): void {
    this.values.set(reg, value);
  }

  /** Reset all registers and flags. */
  reset(): void {
    this.values.set(Register.AX, null);
    this.values.set(Register.BX, null);
    this.values.set(Register.CX, null);
    this.values.set(Register.DX, null);
    this.flags = { ZF: false, SF: false, OF: false };
  }

  /**
   * Update flags based on a mathematical result (pre-truncation) and overflow status.
   * @param mathResult The full mathematical result (before any truncation).
   * @param overflow   Whether the result overflowed the type range.
   */
  updateFlags(mathResult: number, overflow: boolean): void {
    this.flags.ZF = mathResult === 0;
    this.flags.SF = mathResult < 0;
    this.flags.OF = overflow;
  }

  /** Returns a snapshot for UI display. */
  getSnapshot(): Record<string, RegisterValue | null> {
    return {
      AX: this.values.get(Register.AX) ?? null,
      BX: this.values.get(Register.BX) ?? null,
      CX: this.values.get(Register.CX) ?? null,
      DX: this.values.get(Register.DX) ?? null,
    };
  }

  /** Returns a copy of current flags. */
  getFlagsSnapshot(): Flags {
    return { ...this.flags };
  }
}
