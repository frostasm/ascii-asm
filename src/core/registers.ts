import { Register, Flags, RegisterValue, GENERAL_PURPOSE_REGISTERS, PROGRAM_VISIBLE_REGISTERS } from './types';

/**
 * AsciiAsm Register File — general-purpose registers + FLAGS.
 */
export class RegisterFile {
  private values: Map<Register, RegisterValue | null> = new Map();
  flags: Flags;

  constructor() {
    // Initialize registers as null (unset)
    for (const reg of GENERAL_PURPOSE_REGISTERS) {
      this.values.set(reg, null);
    }

    this.flags = { ZF: false, SF: false, OF: false };
  }

  get(reg: Register, instructionPointer = 0): RegisterValue | null {
    if (reg === Register.IP) {
      return { type: 'integer', value: instructionPointer };
    }
    return this.values.get(reg) ?? null;
  }

  set(reg: Register, value: RegisterValue): void {
    if (reg === Register.IP) {
      throw new Error('IP is read-only');
    }
    this.values.set(reg, value);
  }

  /** Reset all registers and flags. */
  reset(): void {
    for (const reg of GENERAL_PURPOSE_REGISTERS) {
      this.values.set(reg, null);
    }
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
  getSnapshot(instructionPointer = 0): Record<string, RegisterValue | null> {
    return Object.fromEntries(
      PROGRAM_VISIBLE_REGISTERS.map(reg => [
        reg,
        reg === Register.IP
          ? { type: 'integer', value: instructionPointer }
          : (this.values.get(reg) ?? null),
      ]),
    );
  }

  /** Returns a copy of current flags. */
  getFlagsSnapshot(): Flags {
    return { ...this.flags };
  }
}
