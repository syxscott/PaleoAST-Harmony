/**
 * Lexer/Tokenizer — replaces state_machine/tokenizer.py::LexerTokenizer.
 *
 * Combines a regex pattern (per token type) with a NumericalFA-style matcher
 * to scan an input string into named tokens.
 */
import { RegexCompiler } from './Automaton';
import { FiniteAutomaton } from './Automaton';

export type TokenTypeValue = number;

export enum TokenType {
  IDENTIFIER = 1,
  NUMBER = 2,
  STRING = 3,
  OPERATOR = 4,
  PUNCTUATION = 5,
  KEYWORD = 6,
  WHITESPACE = 7,
  COMMENT = 8,
  EOF = 9,
  UNKNOWN = 0
}

export interface Token {
  type: TokenType;
  lexeme: string;
  line: number;
  column: number;
}

export interface LexerRule {
  pattern: string;
  type: TokenType;
  skip?: boolean;
}

export class LexerTokenizer {
  rules: LexerRule[];
  automata: RegexCompiler[];

  constructor(rules: LexerRule[] = []) {
    this.rules = rules;
    this.automata = rules.map(r => new RegexCompiler(r.pattern));
  }

  addRule(pattern: string, type: TokenType, skip = false): void {
    const rule: LexerRule = { pattern, type, skip };
    this.rules.push(rule);
    this.automata.push(new RegexCompiler(pattern));
  }

  /**
   * Longest-match scan: at each input position, try all rules and pick the
   * longest match. Returns recognised tokens (skip-flagged rules are dropped).
   */
  tokenize(input: string): Token[] {
    const out: Token[] = [];
    let pos = 0, line = 1, col = 1;
    while (pos < input.length) {
      let bestEnd = 0, bestRule: LexerRule | null = null;
      for (let r = 0; r < this.automata.length; r++) {
        const m = this._matchAt(this.automata[r], input, pos);
        if (m && m.length > bestEnd) {
          bestEnd = m.length;
          bestRule = this.rules[r];
        }
      }
      if (bestEnd === 0) {
        out.push({ type: TokenType.UNKNOWN, lexeme: input[pos], line, column: col });
        if (input[pos] === '\n') { line++; col = 1; } else col++;
        pos++;
        continue;
      }
      const lexeme = input.slice(pos, pos + bestEnd);
      if (!bestRule!.skip) out.push({ type: bestRule!.type, lexeme, line, column: col });
      for (let i = 0; i < bestEnd; i++) {
        if (input[pos + i] === '\n') { line++; col = 1; } else col++;
      }
      pos += bestEnd;
    }
    out.push({ type: TokenType.EOF, lexeme: '', line, column: col });
    return out;
  }

  /**
   * Match regex at a given position using longest-prefix semantics.
   */
  _matchAt(re: RegexCompiler, input: string, pos: number): string | null {
    let longest: string | null = null;
    for (let end = pos + 1; end <= input.length; end++) {
      const s = input.slice(pos, end);
      if (re.matches(s)) longest = s;       // keep going to find the longest
      else if (longest !== null) break;     // had a match, no longer matches → stop
    }
    return longest;
  }
}
