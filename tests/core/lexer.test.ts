import { describe, it, expect } from 'vitest';
import { Lexer } from '@core/lexer';
import { TokenType } from '@core/types';

describe('Lexer', () => {
  it('tokenizes empty source', () => {
    const lexer = new Lexer('');
    const tokens = lexer.tokenize();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe(TokenType.EOF);
  });

  it('tokenizes directives', () => {
    const lexer = new Lexer('#memory 100, 32');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.DIRECTIVE, value: '#memory' });
    expect(tokens[1]).toMatchObject({ type: TokenType.NUMBER, value: '100' });
    expect(tokens[2]).toMatchObject({ type: TokenType.COMMA, value: ',' });
    expect(tokens[3]).toMatchObject({ type: TokenType.NUMBER, value: '32' });
  });

  it('tokenizes #data directive', () => {
    const lexer = new Lexer('#data 0, DWORD 42');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.DIRECTIVE, value: '#data' });
    expect(tokens[1]).toMatchObject({ type: TokenType.NUMBER, value: '0' });
    expect(tokens[2]).toMatchObject({ type: TokenType.COMMA });
    expect(tokens[3]).toMatchObject({ type: TokenType.TYPE_PREFIX, value: 'DWORD' });
    expect(tokens[4]).toMatchObject({ type: TokenType.NUMBER, value: '42' });
  });

  it('tokenizes #on_overflow directive', () => {
    const lexer = new Lexer('#on_overflow halt');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.DIRECTIVE, value: '#on_overflow' });
    expect(tokens[1]).toMatchObject({ type: TokenType.MNEMONIC, value: 'HALT' });
  });

  it('tokenizes mnemonics and registers', () => {
    const lexer = new Lexer('MOV AX, 42');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.MNEMONIC, value: 'MOV' });
    expect(tokens[1]).toMatchObject({ type: TokenType.REGISTER, value: 'AX' });
    expect(tokens[2]).toMatchObject({ type: TokenType.COMMA });
    expect(tokens[3]).toMatchObject({ type: TokenType.NUMBER, value: '42' });
  });

  it('tokenizes case-insensitively', () => {
    const lexer = new Lexer('mov ax, bx');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.MNEMONIC, value: 'MOV' });
    expect(tokens[1]).toMatchObject({ type: TokenType.REGISTER, value: 'AX' });
    expect(tokens[3]).toMatchObject({ type: TokenType.REGISTER, value: 'BX' });
  });

  it('tokenizes SI and DI registers', () => {
    const lexer = new Lexer('MOV SI, DI');
    const tokens = lexer.tokenize();
    expect(tokens[1]).toMatchObject({ type: TokenType.REGISTER, value: 'SI' });
    expect(tokens[3]).toMatchObject({ type: TokenType.REGISTER, value: 'DI' });
  });

  it('tokenizes BP and SP registers', () => {
    const lexer = new Lexer('MOV BP, SP');
    const tokens = lexer.tokenize();
    expect(tokens[1]).toMatchObject({ type: TokenType.REGISTER, value: 'BP' });
    expect(tokens[3]).toMatchObject({ type: TokenType.REGISTER, value: 'SP' });
  });

  it('tokenizes IP register', () => {
    const lexer = new Lexer('MOV AX, IP');
    const tokens = lexer.tokenize();
    expect(tokens[3]).toMatchObject({ type: TokenType.REGISTER, value: 'IP' });
  });

  it('tokenizes label definitions', () => {
    const lexer = new Lexer('_start:');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.LABEL_DEF, value: '_start' });
  });

  it('tokenizes label references (identifiers)', () => {
    const lexer = new Lexer('JMP done');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.MNEMONIC, value: 'JMP' });
    expect(tokens[1]).toMatchObject({ type: TokenType.IDENTIFIER, value: 'done' });
  });

  it('tokenizes CALL and RET mnemonics', () => {
    const lexer = new Lexer('CALL fn\nRET');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.MNEMONIC, value: 'CALL' });
    expect(tokens[1]).toMatchObject({ type: TokenType.IDENTIFIER, value: 'fn' });
    expect(tokens[3]).toMatchObject({ type: TokenType.MNEMONIC, value: 'RET' });
  });

  it('tokenizes character literals', () => {
    const lexer = new Lexer("CHAR 'A'");
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.TYPE_PREFIX, value: 'CHAR' });
    expect(tokens[1]).toMatchObject({ type: TokenType.CHAR_LITERAL, value: 'A' });
  });

  it('tokenizes string literals', () => {
    const lexer = new Lexer('"Hello, World!$"');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.STRING_LITERAL, value: 'Hello, World!$' });
  });

  it('tokenizes memory operands', () => {
    const lexer = new Lexer('MOV AX, DWORD [0]');
    const tokens = lexer.tokenize();
    expect(tokens[3]).toMatchObject({ type: TokenType.TYPE_PREFIX, value: 'DWORD' });
    expect(tokens[4]).toMatchObject({ type: TokenType.LBRACKET });
    expect(tokens[5]).toMatchObject({ type: TokenType.NUMBER, value: '0' });
    expect(tokens[6]).toMatchObject({ type: TokenType.RBRACKET });
  });

  it('tokenizes base + displacement memory operands', () => {
    const lexer = new Lexer('MOV AX, DWORD [BX + 4]');
    const tokens = lexer.tokenize();
    expect(tokens[5]).toMatchObject({ type: TokenType.REGISTER, value: 'BX' });
    expect(tokens[6]).toMatchObject({ type: TokenType.PLUS, value: '+' });
    expect(tokens[7]).toMatchObject({ type: TokenType.NUMBER, value: '4' });
    expect(tokens[8]).toMatchObject({ type: TokenType.RBRACKET });
  });

  it('tokenizes negative numbers', () => {
    const lexer = new Lexer('#data 0, WORD -4');
    const tokens = lexer.tokenize();
    expect(tokens[3]).toMatchObject({ type: TokenType.TYPE_PREFIX, value: 'WORD' });
    expect(tokens[4]).toMatchObject({ type: TokenType.NUMBER, value: '-4' });
  });

  it('skips comments', () => {
    const lexer = new Lexer('MOV AX, 1 ; this is a comment');
    const tokens = lexer.tokenize();
    const nonNewlineTokens = tokens.filter(t => t.type !== TokenType.NEWLINE && t.type !== TokenType.EOF);
    expect(nonNewlineTokens).toHaveLength(4); // MOV, AX, COMMA, 1
  });

  it('handles newlines', () => {
    const lexer = new Lexer('MOV AX, 1\nADD AX, 2');
    const tokens = lexer.tokenize();
    const types = tokens.map(t => t.type);
    expect(types).toContain(TokenType.NEWLINE);
  });

  it('tracks line and column numbers', () => {
    const lexer = new Lexer('MOV AX, 1\nADD BX, 2');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ line: 1, col: 1 }); // MOV
    // After newline, ADD should be on line 2
    const addToken = tokens.find(t => t.value === 'ADD');
    expect(addToken).toBeDefined();
    expect(addToken!.line).toBe(2);
  });

  it('tokenizes HALT', () => {
    const lexer = new Lexer('HALT');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.MNEMONIC, value: 'HALT' });
  });

  it('tokenizes WRITELN without params', () => {
    const lexer = new Lexer('WRITELN');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.MNEMONIC, value: 'WRITELN' });
  });

  it('tokenizes full program', () => {
    const source = `#memory 32
#data 0, TEXT "Hello, World!$"

_start:
    WRITELN TEXT [0]
    HALT
`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    // Should not throw
    expect(tokens.length).toBeGreaterThan(5);
    expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF);
  });

  it('throws on unknown directive', () => {
    const lexer = new Lexer('#unknown');
    expect(() => lexer.tokenize()).toThrow('Unknown directive');
  });

  it('throws on unterminated string', () => {
    const lexer = new Lexer('"hello');
    expect(() => lexer.tokenize()).toThrow('Unterminated string literal');
  });

  it('throws on unterminated char literal', () => {
    const lexer = new Lexer("'A");
    expect(() => lexer.tokenize()).toThrow('Unterminated character literal');
  });

  // ── HEX_COLOR token ───────────────────────────────────────

  it('tokenizes lowercase hex color literal', () => {
    const lexer = new Lexer('#ff0000');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.HEX_COLOR, value: '#ff0000' });
  });

  it('tokenizes uppercase hex color literal and normalizes to lowercase', () => {
    const lexer = new Lexer('#FF00FF');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.HEX_COLOR, value: '#ff00ff' });
  });

  it('tokenizes mixed-case hex color literal', () => {
    const lexer = new Lexer('#4488Ff');
    const tokens = lexer.tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.HEX_COLOR, value: '#4488ff' });
  });

  it('tokenizes hex color as part of #data directive line', () => {
    const lexer = new Lexer('#data 0, WORD 42, #4488ff');
    const tokens = lexer.tokenize().filter(t => t.type !== TokenType.NEWLINE && t.type !== TokenType.EOF);
    expect(tokens[0]).toMatchObject({ type: TokenType.DIRECTIVE,  value: '#data'   });
    expect(tokens[1]).toMatchObject({ type: TokenType.NUMBER,     value: '0'       });
    expect(tokens[2]).toMatchObject({ type: TokenType.COMMA                        });
    expect(tokens[3]).toMatchObject({ type: TokenType.TYPE_PREFIX, value: 'WORD'   });
    expect(tokens[4]).toMatchObject({ type: TokenType.NUMBER,     value: '42'      });
    expect(tokens[5]).toMatchObject({ type: TokenType.COMMA                        });
    expect(tokens[6]).toMatchObject({ type: TokenType.HEX_COLOR,  value: '#4488ff' });
  });

  it('does not confuse hex color with a directive', () => {
    // #data is a directive, #ff0000 must NOT be treated as a directive
    const lexer = new Lexer('#data 0, CHAR \'A\', #aabbcc');
    const tokens = lexer.tokenize();
    const hexToken = tokens.find(t => t.type === TokenType.HEX_COLOR);
    expect(hexToken).toBeDefined();
    expect(hexToken!.value).toBe('#aabbcc');
    // no error about unknown directive
  });

  it('still throws on unknown plain directive after hex color addition', () => {
    const lexer = new Lexer('#unknown');
    expect(() => lexer.tokenize()).toThrow('Unknown directive');
  });
});
