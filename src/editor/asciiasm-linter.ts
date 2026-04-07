import { linter, Diagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { Lexer } from '@core/lexer';
import { Parser } from '@core/parser';
import { ParseError } from '@core/errors';

/**
 * CodeMirror 6 linter extension for AsciiAsm.
 * Runs the Lexer + Parser on document changes and reports errors.
 */
export function asciiAsmLinter() {
  return linter((view: EditorView): Diagnostic[] => {
    const source = view.state.doc.toString();
    const diagnostics: Diagnostic[] = [];

    try {
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      parser.tryParse();

      for (const err of parser.getErrors()) {
        diagnostics.push(errorToDiagnostic(view, err));
      }
    } catch (e) {
      if (e instanceof ParseError) {
        diagnostics.push(errorToDiagnostic(view, e));
      }
    }

    return diagnostics;
  }, { delay: 300 });
}

function errorToDiagnostic(view: EditorView, err: ParseError): Diagnostic {
  const line = Math.max(1, Math.min(err.line, view.state.doc.lines));
  const lineInfo = view.state.doc.line(line);
  const from = lineInfo.from + Math.max(0, err.col - 1);
  const to = Math.min(from + 1, lineInfo.to);

  return {
    from: Math.min(from, lineInfo.to),
    to: Math.max(to, from),
    severity: 'error',
    message: err.message,
  };
}
