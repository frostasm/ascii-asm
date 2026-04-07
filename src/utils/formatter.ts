import { RegisterValue, DataType, DATA_TYPE_SIZE } from '@core/types';

/**
 * Format a register value for display.
 */
export function formatRegisterValue(val: RegisterValue | null): string {
  if (val === null) return '—';
  if (val.type === 'char') {
    const ch = String.fromCharCode(val.value);
    return `'${ch}' (${val.value})`;
  }
  return val.value.toString();
}

/**
 * Format a register type for display.
 */
export function formatRegisterType(val: RegisterValue | null): string {
  if (val === null) return 'unset';
  return val.type === 'char' ? 'CHAR' : 'INT';
}

/**
 * Format a memory cell for display as a character.
 */
export function formatMemoryCell(code: number): string {
  if (code >= 32 && code <= 126) {
    return String.fromCharCode(code);
  }
  return '·';
}

/**
 * Format a memory cell as a decimal ASCII code.
 */
export function formatMemoryCellCode(code: number): string {
  return code.toString().padStart(3, ' ');
}

/**
 * Get the display width for a data type.
 */
export function getTypeWidth(dt: DataType): number {
  return DATA_TYPE_SIZE[dt];
}
