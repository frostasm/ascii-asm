import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';

const MNEMONIC_COMPLETIONS = [
  { label: 'MOV', type: 'keyword', info: 'Move data: MOV dst, src' },
  { label: 'ADD', type: 'keyword', info: 'Addition: ADD dst, src' },
  { label: 'SUB', type: 'keyword', info: 'Subtraction: SUB dst, src' },
  { label: 'CMP', type: 'keyword', info: 'Compare: CMP a, b' },
  { label: 'JMP', type: 'keyword', info: 'Unconditional jump: JMP label' },
  { label: 'JE', type: 'keyword', info: 'Jump if equal (ZF=1)' },
  { label: 'JNE', type: 'keyword', info: 'Jump if not equal (ZF=0)' },
  { label: 'JL', type: 'keyword', info: 'Jump if less (SF=1, ZF=0)' },
  { label: 'JLE', type: 'keyword', info: 'Jump if less or equal' },
  { label: 'JG', type: 'keyword', info: 'Jump if greater (SF=0, ZF=0)' },
  { label: 'JGE', type: 'keyword', info: 'Jump if greater or equal' },
  { label: 'JO', type: 'keyword', info: 'Jump if overflow (OF=1)' },
  { label: 'JNO', type: 'keyword', info: 'Jump if no overflow (OF=0)' },
  { label: 'READ', type: 'keyword', info: 'Read input: READ TYPE [addr]' },
  { label: 'WRITE', type: 'keyword', info: 'Write output: WRITE TYPE [addr]' },
  { label: 'WRITELN', type: 'keyword', info: 'Write output + newline' },
  { label: 'HALT', type: 'keyword', info: 'Stop program execution' },
];

const REGISTER_COMPLETIONS = [
  { label: 'IP', type: 'variable', info: 'Read-only instruction pointer register' },
  { label: 'AX', type: 'variable', info: 'Accumulator register' },
  { label: 'BX', type: 'variable', info: 'Base/address register' },
  { label: 'CX', type: 'variable', info: 'Counter register' },
  { label: 'DX', type: 'variable', info: 'Auxiliary register' },
  { label: 'SI', type: 'variable', info: 'Source index / pointer register' },
  { label: 'DI', type: 'variable', info: 'Destination index / pointer register' },
];

const TYPE_COMPLETIONS = [
  { label: 'CHAR', type: 'type', info: '1 cell, ASCII 32–126' },
  { label: 'WORD', type: 'type', info: '2 cells, range -9..99' },
  { label: 'DWORD', type: 'type', info: '4 cells, range -999..9999' },
  { label: 'QWORD', type: 'type', info: '8 cells, range -9999999..99999999' },
  { label: 'TEXT', type: 'type', info: 'Variable length, $-terminated' },
];

const DIRECTIVE_COMPLETIONS = [
  { label: '#memory', type: 'keyword', info: '#memory size[, init_value]' },
  { label: '#data', type: 'keyword', info: '#data address, TYPE value' },
  { label: '#on_overflow', type: 'keyword', info: '#on_overflow flag|halt' },
];

const ALL_COMPLETIONS = [
  ...MNEMONIC_COMPLETIONS,
  ...REGISTER_COMPLETIONS,
  ...TYPE_COMPLETIONS,
  ...DIRECTIVE_COMPLETIONS,
];

function asciiAsmCompletionSource(context: CompletionContext): CompletionResult | null {
  // Match word at cursor (including #)
  const word = context.matchBefore(/[#a-zA-Z_]\w*/);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;

  return {
    from: word.from,
    options: ALL_COMPLETIONS,
    validFor: /^[#a-zA-Z_]\w*$/,
  };
}

/**
 * CodeMirror 6 autocompletion extension for AsciiAsm.
 */
export function asciiAsmAutocomplete() {
  return autocompletion({
    override: [asciiAsmCompletionSource],
  });
}
