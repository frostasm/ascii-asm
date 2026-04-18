import { StreamLanguage, StringStream } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const MNEMONICS = new Set([
  'MOV', 'ADD', 'IMUL', 'SUB', 'CMP',
  'JMP', 'CALL', 'RET', 'JE', 'JNE', 'JL', 'JLE', 'JG', 'JGE', 'JO', 'JNO',
  'READ', 'WRITE', 'WRITELN', 'HALT',
]);

const REGISTERS = new Set(['IP', 'AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'BP', 'SP']);
const TYPE_PREFIXES = new Set(['CHAR', 'WORD', 'DWORD', 'QWORD', 'TEXT']);

interface AsciiAsmState {
  inComment: boolean;
}

const asciiAsmStreamParser = {
  name: 'asciiasm',

  languageData: {
    commentTokens: { line: ';' },
  },

  startState(): AsciiAsmState {
    return { inComment: false };
  },

  token(stream: StringStream, _state: AsciiAsmState): string | null {
    // Whitespace
    if (stream.eatSpace()) return null;

    // Comment
    if (stream.match(';')) {
      stream.skipToEnd();
      return 'comment';
    }

    // Directive: #memory, #data, #on_overflow
    if (stream.match(/#[a-zA-Z_][a-zA-Z0-9_]*/)) {
      return 'keyword';
    }

    // String literal
    if (stream.match(/"[^"]*"/)) {
      return 'string';
    }

    // Character literal
    if (stream.match(/'[^']'/)) {
      return 'string';
    }

    // Number (with optional sign)
    if (stream.match(/-?\d+/)) {
      return 'number';
    }

    // Brackets
    if (stream.match(/[[\]]/)) {
      return 'bracket';
    }

    // Comma
    if (stream.eat(',')) {
      return 'punctuation';
    }

    // Identifiers, keywords, registers, labels
    const word = stream.match(/[a-zA-Z_][a-zA-Z0-9_]*/);
    if (word) {
      const upper = (word as RegExpMatchArray)[0].toUpperCase();

      // Check if followed by ':' → label definition
      if (stream.eat(':')) {
        return 'labelName';
      }

      if (MNEMONICS.has(upper)) return 'keyword';
      if (REGISTERS.has(upper)) return 'variableName';
      if (TYPE_PREFIXES.has(upper)) return 'typeName';

      // Otherwise: label reference or keyword value (flag/halt)
      return 'variableName';
    }

    // Unknown character — advance
    stream.next();
    return null;
  },
};

/**
 * CodeMirror 6 language support for AsciiAsm.
 */
export const asciiAsmLanguage = StreamLanguage.define(asciiAsmStreamParser);

/**
 * Tag-based highlighting for AsciiAsm.
 * Uses standard lezer tag names that map to CodeMirror's default highlight styles.
 */
export { tags };
