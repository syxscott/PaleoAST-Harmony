/**
 * General-purpose lexer ¡ª replaces parsers/lexer.py
 * Tokenizes text input for structured data parsing.
 */

export enum TokenType {
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  DELIMITER = 'DELIMITER',
  NEWLINE = 'NEWLINE',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export class Lexer {
  private _pos = 0;
  private _line = 1;
  private _col = 1;

  constructor(private _input: string, private _delimiters: string = ',	') {}

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this._pos < this._input.length) {
      const ch = this._input[this._pos];
      if (ch === '
') {
        tokens.push({ type: TokenType.NEWLINE, value: '
', line: this._line, column: this._col });
        this._line++; this._col = 1; this._pos++;
      } else if (this._delimiters.includes(ch)) {
        tokens.push({ type: TokenType.DELIMITER, value: ch, line: this._line, column: this._col });
        this._col++; this._pos++;
      } else if (/\s/.test(ch)) {
        this._col++; this._pos++;
      } else if (/[-\d.]/.test(ch)) {
        const start = this._pos;
        while (this._pos < this._input.length && /[\d.eE+-]/.test(this._input[this._pos])) this._pos++;
        tokens.push({ type: TokenType.NUMBER, value: this._input.slice(start, this._pos), line: this._line, column: this._col });
        this._col += this._pos - start;
      } else {
        const start = this._pos;
        while (this._pos < this._input.length && !this._delimiters.includes(this._input[this._pos]) && this._input[this._pos] !== '
') this._pos++;
        tokens.push({ type: TokenType.STRING, value: this._input.slice(start, this._pos), line: this._line, column: this._col });
        this._col += this._pos - start;
      }
    }
    tokens.push({ type: TokenType.EOF, value: '', line: this._line, column: this._col });
    return tokens;
  }
}
