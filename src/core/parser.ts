import {
  Token, TokenType, DataType, Register, Mnemonic,
  Program, MemoryDirective, DataDirective, OverflowMode,
  Instruction, Operand, JUMP_MNEMONICS, AddressExpression,
} from './types';
import {
  ParseError,
  MissingStartLabelError,
  MissingHaltError,
  UndefinedLabelError,
  DuplicateLabelError,
} from './errors';
import colorNames from 'color-name';

// HEX_COLOR token alias for brevity inside parseDataDirectives
const { HEX_COLOR } = TokenType;

/** Convert a CSS named color to lowercase #rrggbb, or null if unknown. */
function namedColorToHex(name: string): string | null {
  const rgb = colorNames[name.toLowerCase() as keyof typeof colorNames];
  if (!rgb) return null;
  return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Parser for the AsciiAsm language.
 * Consumes a token stream and produces a Program AST.
 */
export class Parser {
  private tokens: Token[];
  private pos = 0;
  private errors: ParseError[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  /** Parse tokens into a Program. Throws on first fatal error. */
  parse(): Program {
    this.pos = 0;
    this.errors = [];

    this.skipNewlines();

    // Parse directives
    const memory = this.parseMemoryDirective();
    const overflow = this.parseOverflowDirective();
    const data = this.parseDataDirectives();

    // Parse instructions and labels
    const labels = new Map<string, number>();
    const instructions: Instruction[] = [];

    while (!this.isAtEnd()) {
      this.skipNewlines();
      if (this.isAtEnd()) break;

      const tok = this.current();

      // Label definition
      if (tok.type === TokenType.LABEL_DEF) {
        if (labels.has(tok.value)) {
          this.errors.push(new DuplicateLabelError(tok.value, tok.line));
        } else {
          labels.set(tok.value, instructions.length);
        }
        this.advance();
        this.skipNewlines();
        continue;
      }

      // Instruction
      if (tok.type === TokenType.MNEMONIC) {
        const instr = this.parseInstruction();
        if (instr) instructions.push(instr);
        continue;
      }

      // Unexpected token
      this.addError(`Unexpected token: '${tok.value}'`, tok.line, tok.col);
      this.advance();
    }

    // Validate
    if (!labels.has('_start')) {
      this.errors.push(new MissingStartLabelError());
    }
    if (!instructions.some(i => i.mnemonic === Mnemonic.HALT)) {
      this.errors.push(new MissingHaltError());
    }

    // Validate label references in instructions that allow label operands
    for (const instr of instructions) {
      if (JUMP_MNEMONICS.has(instr.mnemonic) || instr.mnemonic === Mnemonic.MOV) {
        for (const op of instr.operands) {
          if (op.kind === 'label' && !labels.has(op.name)) {
            this.errors.push(new UndefinedLabelError(op.name, instr.line));
          }
        }
      }
    }

    if (this.errors.length > 0) {
      throw this.errors[0]; // throw first error; all errors available via getErrors()
    }

    return { memory, overflow, data, labels, instructions };
  }

  /** Get all collected parse errors (available even after parse() throws). */
  getErrors(): ParseError[] {
    return this.errors;
  }

  /**
   * Parse without throwing — returns either a Program or the error list.
   */
  tryParse(): { program: Program | null; errors: ParseError[] } {
    try {
      const program = this.parse();
      return { program, errors: [] };
    } catch {
      return { program: null, errors: this.errors };
    }
  }

  // ── Directive parsers ──────────────────────────────────────

  private parseMemoryDirective(): MemoryDirective {
    if (this.check(TokenType.DIRECTIVE) && this.current().value === '#memory') {
      this.advance();
      const sizeToken = this.expect(TokenType.NUMBER, 'Expected memory size');
      const size = parseInt(sizeToken.value, 10);
      if (size <= 0) {
        this.addError('Memory size must be positive', sizeToken.line, sizeToken.col);
      }
      let initValue: number | undefined;
      if (this.check(TokenType.COMMA)) {
        this.advance();
        const initToken = this.expect(TokenType.CHAR_LITERAL, "Expected char literal for init value (e.g. ' ')");
        initValue = initToken.value.charCodeAt(0);
      }
      this.skipNewlines();
      return { size, initValue };
    }
    return { size: 100 }; // default
  }

  private parseOverflowDirective(): OverflowMode {
    // Can appear before or between #data directives
    if (this.check(TokenType.DIRECTIVE) && this.current().value === '#on_overflow') {
      this.advance();
      // 'halt' is tokenized as MNEMONIC, 'flag' as IDENTIFIER
      const modeToken = this.current();
      if (modeToken.type !== TokenType.IDENTIFIER && modeToken.type !== TokenType.MNEMONIC) {
        this.addError("Expected 'flag' or 'halt'", modeToken.line, modeToken.col);
        return 'flag';
      }
      this.advance();
      const mode = modeToken.value.toLowerCase();
      if (mode !== 'flag' && mode !== 'halt') {
        this.addError(`Invalid overflow mode: '${modeToken.value}', expected 'flag' or 'halt'`, modeToken.line, modeToken.col);
      }
      this.skipNewlines();
      return mode as OverflowMode;
    }
    return 'flag'; // default
  }

  private parseDataDirectives(): DataDirective[] {
    const directives: DataDirective[] = [];
    while (this.check(TokenType.DIRECTIVE) && this.current().value === '#data') {
      this.advance();
      const addrToken = this.expect(TokenType.NUMBER, 'Expected address');
      const address = parseInt(addrToken.value, 10);
      if (address < 0) {
        this.addError('Address must be non-negative', addrToken.line, addrToken.col);
      }
      this.expect(TokenType.COMMA, "Expected ','");
      const typeToken = this.expect(TokenType.TYPE_PREFIX, 'Expected type (CHAR, WORD, DWORD, QWORD, TEXT)');
      const dataType = typeToken.value as DataType;

      let value: number | string;
      if (dataType === DataType.TEXT) {
        const strToken = this.expect(TokenType.STRING_LITERAL, 'Expected string literal for TEXT');
        value = strToken.value;
      } else if (dataType === DataType.CHAR) {
        const charToken = this.expect(TokenType.CHAR_LITERAL, 'Expected character literal for CHAR');
        value = charToken.value.charCodeAt(0);
      } else {
        const numToken = this.expect(TokenType.NUMBER, 'Expected number');
        value = parseInt(numToken.value, 10);
      }

      // Optional third parameter: , <color>  — background color for memory visualization.
      // Accepted formats: #RRGGBB, #RRGGBBAA, or any CSS named color (e.g. red, cornflowerblue).
      let color: string | undefined;
      if (this.check(TokenType.COMMA)) {
        const savedPos = this.pos;
        this.advance(); // consume comma
        if (this.check(HEX_COLOR)) {
          color = this.current().value;
          this.advance();
        } else if (this.check(TokenType.IDENTIFIER)) {
          const t = this.current();
          const hex = namedColorToHex(t.value);
          if (hex !== null) {
            color = hex;
            this.advance();
          } else {
            this.addError(`Unknown color: '${t.value}'. Use a CSS named color (e.g. red) or #RRGGBB / #RRGGBBAA`, t.line, t.col);
            this.pos = savedPos; // backtrack past comma
          }
        } else {
          // Not a color token — report error and backtrack
          const t = this.current();
          this.addError(`Expected a color after comma: CSS named color (e.g. red) or #RRGGBB / #RRGGBBAA`, t.line, t.col);
          this.pos = savedPos; // backtrack
        }
      }

      directives.push({ address, dataType, value, color });
      this.skipNewlines();

      // Check for #on_overflow between #data directives
      if (this.check(TokenType.DIRECTIVE) && this.current().value === '#on_overflow') {
        // Already parsed or will be handled — skip for now
        // Actually let's parse it here too in case it appears between data
        this.advance();
        const modeToken = this.expect(TokenType.IDENTIFIER, "Expected 'flag' or 'halt'");
        // We ignore this since overflow was parsed first; ideally we'd handle ordering
        void modeToken;
        this.skipNewlines();
      }
    }
    return directives;
  }

  // ── Instruction parser ─────────────────────────────────────

  private parseInstruction(): Instruction | null {
    const mnemonicToken = this.current();
    const mnemonic = mnemonicToken.value as Mnemonic;
    const line = mnemonicToken.line;
    this.advance();

    const operands: Operand[] = [];

    // HALT has no operands
    if (mnemonic === Mnemonic.HALT || mnemonic === Mnemonic.RET) {
      this.skipToEndOfLine();
      return { mnemonic, operands, line };
    }

    // WRITELN can be used without operands
    if (mnemonic === Mnemonic.WRITELN && this.isEndOfStatement()) {
      this.skipToEndOfLine();
      return { mnemonic, operands, line };
    }

    // Parse first operand
    const op1 = this.parseOperand(mnemonic);
    if (op1) operands.push(op1);

    // Parse second operand (if comma)
    if (this.check(TokenType.COMMA)) {
      this.advance();
      const op2 = this.parseOperand(mnemonic);
      if (op2) operands.push(op2);
    }

    // Parse third operand for READ TEXT [addr], imm
    if (this.check(TokenType.COMMA)) {
      this.advance();
      const op3 = this.parseOperand(mnemonic);
      if (op3) operands.push(op3);
    }

    if (mnemonic === Mnemonic.IMUL) {
      this.validateImulOperands(operands, line);
    }

    this.skipToEndOfLine();
    return { mnemonic, operands, line };
  }

  private validateImulOperands(operands: Operand[], line: number): void {
    if (operands.length !== 2) {
      this.addError('IMUL supports only the form: IMUL reg, reg|TYPE [addr]|imm', line, 0);
      return;
    }

    const [dst, src] = operands;
    if (dst.kind !== 'register') {
      this.addError('IMUL destination must be a register', line, 0);
    }

    if (src.kind === 'register' || src.kind === 'immediate') {
      return;
    }

    if (src.kind === 'memory' && src.dataType !== DataType.CHAR && src.dataType !== DataType.TEXT) {
      return;
    }

    this.addError('IMUL source must be a register, integer memory operand, or immediate', line, 0);
  }

  private parseOperand(context: Mnemonic): Operand | null {
    const tok = this.current();

    // Register
    if (tok.type === TokenType.REGISTER) {
      this.advance();
      return { kind: 'register', reg: tok.value as Register };
    }

    // Number (immediate)
    if (tok.type === TokenType.NUMBER) {
      this.advance();
      return { kind: 'immediate', value: parseInt(tok.value, 10) };
    }

    // Character literal (CHAR immediate) — used standalone after CHAR type prefix is handled
    if (tok.type === TokenType.CHAR_LITERAL) {
      this.advance();
      return { kind: 'char_immediate', value: tok.value };
    }

    // String literal (string immediate) — for WRITE/WRITELN "text"
    if (tok.type === TokenType.STRING_LITERAL) {
      this.advance();
      return { kind: 'string_immediate', value: tok.value };
    }

    // Type prefix: TYPE [addr] or CHAR 'c'
    if (tok.type === TokenType.TYPE_PREFIX) {
      const dataType = tok.value as DataType;
      this.advance();

      // CHAR 'c' — character immediate with type
      if (dataType === DataType.CHAR && this.check(TokenType.CHAR_LITERAL)) {
        const charTok = this.current();
        this.advance();
        return { kind: 'char_immediate', value: charTok.value };
      }

      // TYPE [addr]
      this.expect(TokenType.LBRACKET, "Expected '['");
      const addrOperand = this.parseAddressExpression();
      this.expect(TokenType.RBRACKET, "Expected ']'");

      return { kind: 'memory', address: addrOperand, dataType };
    }

    // Label reference (for jump instructions and MOV reg, label)
    if (tok.type === TokenType.IDENTIFIER) {
      if (JUMP_MNEMONICS.has(context) || context === Mnemonic.MOV) {
        this.advance();
        return { kind: 'label', name: tok.value };
      }
      this.addError(`Unexpected identifier: '${tok.value}'`, tok.line, tok.col);
      this.advance();
      return null;
    }

    this.addError(`Unexpected token in operand: '${tok.value}'`, tok.line, tok.col);
    this.advance();
    return null;
  }

  private parseAddressExpression(): AddressExpression {
    const tok = this.current();
    if (tok.type === TokenType.REGISTER) {
      this.advance();
      const base = tok.value as Register;
      if (this.check(TokenType.PLUS)) {
        this.advance();
        const displacementTok = this.expect(TokenType.NUMBER, 'Expected displacement after \'+\'');
        return {
          kind: 'base_displacement',
          base,
          displacement: parseInt(displacementTok.value, 10),
        };
      }
      return base;
    }
    if (tok.type === TokenType.NUMBER) {
      this.advance();
      return parseInt(tok.value, 10);
    }
    this.addError('Expected address in the form of number, register, or register + displacement', tok.line, tok.col);
    this.advance();
    return 0;
  }

  // ── Helpers ────────────────────────────────────────────────

  private current(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: '', line: 0, col: 0 };
  }

  private check(type: TokenType): boolean {
    return this.current().type === type;
  }

  private isAtEnd(): boolean {
    return this.current().type === TokenType.EOF;
  }

  private advance(): Token {
    const tok = this.current();
    if (!this.isAtEnd()) this.pos++;
    return tok;
  }

  private expect(type: TokenType, message: string): Token {
    const tok = this.current();
    if (tok.type !== type) {
      this.addError(`${message}, got '${tok.value}' (${tok.type})`, tok.line, tok.col);
      // Return a dummy token to keep parsing
      return { type, value: '', line: tok.line, col: tok.col };
    }
    return this.advance();
  }

  private skipNewlines(): void {
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
    }
  }

  private isEndOfStatement(): boolean {
    const t = this.current().type;
    return t === TokenType.NEWLINE || t === TokenType.EOF;
  }

  private skipToEndOfLine(): void {
    while (!this.isAtEnd() && !this.check(TokenType.NEWLINE)) {
      this.advance();
    }
    this.skipNewlines();
  }

  private addError(message: string, line: number, col: number): void {
    this.errors.push(new ParseError(message, line, col));
  }
}
