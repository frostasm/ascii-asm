import { Token, TokenType, Register, Mnemonic, DataType } from './types';
import { ParseError } from './errors';

const REGISTERS = new Set(Object.values(Register));
const MNEMONICS = new Set(Object.values(Mnemonic));
const TYPE_PREFIXES = new Set(Object.values(DataType));
const DIRECTIVES = new Set(['#memory', '#data', '#on_overflow']);

/**
 * Lexer for the AsciiAsm language.
 * Converts source text into a stream of tokens.
 */
export class Lexer {
  private source: string;
  private pos = 0;
  private line = 1;
  private col = 1;
  private tokens: Token[] = [];

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    this.tokens = [];
    this.pos = 0;
    this.line = 1;
    this.col = 1;

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];

      // Newline
      if (ch === '\n') {
        this.pushToken(TokenType.NEWLINE, '\\n');
        this.advance();
        this.line++;
        this.col = 1;
        continue;
      }

      // Skip whitespace (not newline)
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance();
        continue;
      }

      // Comment: ; to end of line
      if (ch === ';') {
        this.skipComment();
        continue;
      }

      // Directive: #identifier  —  OR  #RRGGBB hex color literal
      if (ch === '#') {
        if (this.isHexColorAhead()) {
          this.readHexColor();
        } else {
          this.readDirective();
        }
        continue;
      }

      // Character literal: 'c'
      if (ch === "'") {
        this.readCharLiteral();
        continue;
      }

      // String literal: "..."
      if (ch === '"') {
        this.readStringLiteral();
        continue;
      }

      // Brackets
      if (ch === '[') {
        this.pushToken(TokenType.LBRACKET, '[');
        this.advance();
        continue;
      }
      if (ch === ']') {
        this.pushToken(TokenType.RBRACKET, ']');
        this.advance();
        continue;
      }
      if (ch === '+') {
        this.pushToken(TokenType.PLUS, '+');
        this.advance();
        continue;
      }

      // Comma
      if (ch === ',') {
        this.pushToken(TokenType.COMMA, ',');
        this.advance();
        continue;
      }

      // Negative number: '-' followed by digit, only in value-expected context
      if (ch === '-' && this.pos + 1 < this.source.length && this.isDigit(this.source[this.pos + 1])) {
        const prev = this.lastNonNewlineToken();
        if (!prev || prev.type === TokenType.COMMA || prev.type === TokenType.DIRECTIVE ||
            prev.type === TokenType.LBRACKET || prev.type === TokenType.MNEMONIC ||
            prev.type === TokenType.TYPE_PREFIX || prev.type === TokenType.PLUS) {
          this.readNumber();
          continue;
        }
      }

      // Positive number
      if (this.isDigit(ch)) {
        this.readNumber();
        continue;
      }

      // Identifier: register, mnemonic, type prefix, label def/ref, keyword
      if (this.isIdentStart(ch)) {
        this.readIdentifier();
        continue;
      }

      throw new ParseError(`Unexpected character: '${ch}'`, this.line, this.col);
    }

    this.pushToken(TokenType.EOF, '');
    return this.tokens;
  }

  // ── Internal helpers ───────────────────────────────────────

  private advance(): void {
    this.pos++;
    this.col++;
  }

  private pushToken(type: TokenType, value: string): void {
    this.tokens.push({ type, value, line: this.line, col: this.col });
  }

  private lastNonNewlineToken(): Token | null {
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      if (this.tokens[i].type !== TokenType.NEWLINE) return this.tokens[i];
    }
    return null;
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isHexDigit(ch: string): boolean {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
  }

  /** Returns true when the current '#' starts a #RRGGBB or #RRGGBBAA hex color literal. */
  private isHexColorAhead(): boolean {
    // Try 8-digit (#RRGGBBAA) first, then 6-digit (#RRGGBB)
    for (const len of [8, 6]) {
      let valid = true;
      for (let i = 1; i <= len; i++) {
        const c = this.source[this.pos + i];
        if (!c || !this.isHexDigit(c)) { valid = false; break; }
      }
      if (valid) {
        const after = this.source[this.pos + len + 1];
        if (!after || after === ' ' || after === '\t' || after === '\n' ||
            after === '\r' || after === ';' || after === ',') return true;
      }
    }
    return false;
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentChar(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }

  // ── Token readers ─────────────────────────────────────────

  private skipComment(): void {
    while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
      this.advance();
    }
  }

  private readDirective(): void {
    const startCol = this.col;
    let value = '#';
    this.advance();
    while (this.pos < this.source.length && this.isIdentChar(this.source[this.pos])) {
      value += this.source[this.pos];
      this.advance();
    }
    const lower = value.toLowerCase();
    if (!DIRECTIVES.has(lower)) {
      throw new ParseError(`Unknown directive: ${value}`, this.line, startCol);
    }
    this.tokens.push({ type: TokenType.DIRECTIVE, value: lower, line: this.line, col: startCol });
  }

  private readHexColor(): void {
    const startCol = this.col;
    let value = '#';
    this.advance(); // consume '#'
    // Determine if this is #RRGGBBAA (8 digits) or #RRGGBB (6 digits)
    const c7 = this.source[this.pos + 6];
    const c8 = this.source[this.pos + 7];
    const len = (c7 && this.isHexDigit(c7) && c8 && this.isHexDigit(c8)) ? 8 : 6;
    for (let i = 0; i < len; i++) {
      value += this.source[this.pos].toLowerCase();
      this.advance();
    }
    this.tokens.push({ type: TokenType.HEX_COLOR, value, line: this.line, col: startCol });
  }

  private readCharLiteral(): void {
    const startCol = this.col;
    this.advance(); // skip opening '
    if (this.pos >= this.source.length || this.source[this.pos] === '\n') {
      throw new ParseError('Unterminated character literal', this.line, startCol);
    }
    const ch = this.source[this.pos];
    this.advance();
    if (this.pos >= this.source.length || this.source[this.pos] !== "'") {
      throw new ParseError('Unterminated character literal', this.line, startCol);
    }
    this.advance(); // skip closing '
    this.tokens.push({ type: TokenType.CHAR_LITERAL, value: ch, line: this.line, col: startCol });
  }

  private readStringLiteral(): void {
    const startCol = this.col;
    this.advance(); // skip opening "
    let value = '';
    while (this.pos < this.source.length && this.source[this.pos] !== '"' && this.source[this.pos] !== '\n') {
      value += this.source[this.pos];
      this.advance();
    }
    if (this.pos >= this.source.length || this.source[this.pos] !== '"') {
      throw new ParseError('Unterminated string literal', this.line, startCol);
    }
    this.advance(); // skip closing "
    this.tokens.push({ type: TokenType.STRING_LITERAL, value, line: this.line, col: startCol });
  }

  private readNumber(): void {
    const startCol = this.col;
    let value = '';
    if (this.source[this.pos] === '-') {
      value += '-';
      this.advance();
    }
    while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
      value += this.source[this.pos];
      this.advance();
    }
    this.tokens.push({ type: TokenType.NUMBER, value, line: this.line, col: startCol });
  }

  private readIdentifier(): void {
    const startCol = this.col;
    let value = '';
    while (this.pos < this.source.length && this.isIdentChar(this.source[this.pos])) {
      value += this.source[this.pos];
      this.advance();
    }

    // Label definition: identifier followed by ':'
    if (this.pos < this.source.length && this.source[this.pos] === ':') {
      this.advance(); // consume ':'
      this.tokens.push({ type: TokenType.LABEL_DEF, value, line: this.line, col: startCol });
      return;
    }

    const upper = value.toUpperCase();

    // Register
    if (REGISTERS.has(upper as Register)) {
      this.tokens.push({ type: TokenType.REGISTER, value: upper, line: this.line, col: startCol });
      return;
    }

    // Type prefix
    if (TYPE_PREFIXES.has(upper as DataType)) {
      this.tokens.push({ type: TokenType.TYPE_PREFIX, value: upper, line: this.line, col: startCol });
      return;
    }

    // Mnemonic
    if (MNEMONICS.has(upper as Mnemonic)) {
      this.tokens.push({ type: TokenType.MNEMONIC, value: upper, line: this.line, col: startCol });
      return;
    }

    // Any other identifier: label reference or keyword (flag, halt)
    this.tokens.push({ type: TokenType.IDENTIFIER, value, line: this.line, col: startCol });
  }
}
