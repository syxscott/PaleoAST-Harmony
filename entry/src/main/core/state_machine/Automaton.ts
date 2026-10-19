/**
 * Finite-state automata and regular-expression compilation.
 * Port of state_machine/automaton.py (DFA, NFA, FiniteAutomaton, RegexCompiler).
 *
 * FSM = (Q, Σ, δ, q0, F)
 *  - Q: states
 *  - Σ: alphabet
 *  - δ: transition function
 *  - q0: initial state
 *  - F: accept states
 *
 * Uses Thompson's NFA construction + subset construction (Rabin-Scott) for regex → DFA.
 */

import { State, Transition } from './Base';

// ─── Character classes ──────────────────────────────────────────────

/**
 * A character class: a set of characters, optionally negated.
 *
 * The regex compiler used to treat every character of the pattern as a
 * literal, so `[0-9]+(\.[0-9]+)?` was compiled into an NFA that matched the
 * LITERAL text "[0-9]+...". Every rule of the basic lexer was therefore
 * unmatchable and every token came out as UNKNOWN.
 */
export interface CharClass {
  /** Inclusive code-point ranges. */
  ranges: number[][];
  /** When true the class matches every character EXCEPT the ranges. */
  negated: boolean;
}

/** Marks a transition key that holds a character class instead of a literal. */
const CLASS_PREFIX = '\u0000';

/** The usual shorthand classes (\d \s \w and their negations). */
const SHORTHAND_CLASSES: Record<string, CharClass> = {
  'd': { 'ranges': [[48, 57]], 'negated': false },                            // 0-9
  'D': { 'ranges': [[48, 57]], 'negated': true },
  's': { 'ranges': [[9, 13], [32, 32]], 'negated': false },                     // \t \n \v \f \r, space
  'S': { 'ranges': [[9, 13], [32, 32]], 'negated': true },
  'w': { 'ranges': [[48, 57], [65, 90], [95, 95], [97, 122]], 'negated': false }, // 0-9 A-Z _ a-z
  'W': { 'ranges': [[48, 57], [65, 90], [95, 95], [97, 122]], 'negated': true },
};

/** The transition key that holds a class. */
function classKey(cls: CharClass): string {
  const body = cls.ranges.map(r => `${r[0]}-${r[1]}`).join(',');
  return CLASS_PREFIX + (cls.negated ? '!' : '') + body;
}

/** Read a class back from its transition key (null for a literal key). */
function parseClassKey(key: string): CharClass | null {
  if (!key.startsWith(CLASS_PREFIX)) return null;
  const body = key.slice(CLASS_PREFIX.length);
  const negated = body.startsWith('!');
  const rest = negated ? body.slice(1) : body;
  const ranges: number[][] = [];
  if (rest.length > 0) {
    for (const part of rest.split(',')) {
      if (!part) continue;
      const dash = part.indexOf('-');
      ranges.push([parseInt(part.slice(0, dash), 10), parseInt(part.slice(dash + 1), 10)]);
    }
  }
  return { ranges, negated };
}

/** Does the class match this character? */
function classMatches(cls: CharClass, ch: string): boolean {
  const code = ch.charCodeAt(0);
  let inside = false;
  for (const r of cls.ranges) {
    if (code >= r[0] && code <= r[1]) { inside = true; break; }
  }
  return cls.negated ? !inside : inside;
}

/**
 * All transition targets of a state for one input character: the literal
 * transition plus every character class that contains the character.
 */
function targetsFor(state: State, ch: string): State[] {
  const out: State[] = [];
  const literal = state.transitions.get(ch);
  if (literal) for (const t of literal) out.push(t);
  for (const [sym, targets] of state.transitions) {
    if (sym.length === 0 || !sym.startsWith(CLASS_PREFIX)) continue;
    const cls = parseClassKey(sym);
    if (cls && classMatches(cls, ch)) for (const t of targets) out.push(t);
  }
  return out;
}

/** One token of a compiled pattern: a literal character or a character class. */
interface PatternToken {
  /** The literal character ('' for a class token). */
  ch: string;
  /** The character class (null for a literal token). */
  cls: CharClass | null;
}

/** Parse a `[...]` character class starting at `start`. */
function parseCharClass(pattern: string, start: number): { cls: CharClass; next: number } {
  let i = start + 1;
  let negated = false;
  if (pattern[i] === '^') { negated = true; i++; }
  const ranges: number[][] = [];
  while (i < pattern.length && pattern[i] !== ']') {
    let ch: string;
    if (pattern[i] === '\\') {
      i++;
      const e = pattern[i];
      if (e === undefined) throw new Error('RegexCompiler: unterminated escape in a character class');
      const shorthand = SHORTHAND_CLASSES[e];
      if (shorthand) {
        for (const r of shorthand.ranges) ranges.push([r[0], r[1]]);
        i++;
        continue;
      }
      ch = e;
      i++;
    } else {
      ch = pattern[i];
      i++;
    }
    const lo = ch.charCodeAt(0);
    if (pattern[i] === '-' && i + 1 < pattern.length && pattern[i + 1] !== ']') {
      i++;
      let hi: string;
      if (pattern[i] === '\\') { i++; hi = pattern[i] ?? ''; i++; }
      else { hi = pattern[i]; i++; }
      ranges.push([lo, hi.charCodeAt(0)]);
    } else {
      ranges.push([lo, lo]);
    }
  }
  if (pattern[i] !== ']') throw new Error('RegexCompiler: unterminated character class');
  return { cls: { ranges, negated }, next: i + 1 };
}


/** Generic finite-state automaton (DFA or NFA). */
export class FiniteAutomaton {
  states: State[];
  start: State;
  accept: State[];
  alphabet: string[];

  constructor(states: State[] = [], start: State | null = null, accept: State[] = [], alphabet: string[] = []) {
    this.states = states;
    this.start = start as State;
    this.accept = accept;
    this.alphabet = alphabet;
  }

  addState(name: string, isAccept = false): State {
    const s = new State(name, isAccept);
    this.states.push(s);
    return s;
  }

  addTransition(from: State, symbol: string, to: State): void {
    from.transitions.set(symbol, [...(from.transitions.get(symbol) ?? []), to]);
  }

  /** Collect the non-epsilon input symbols used by any transition. */
  _inferAlphabet(): string[] {
    const set = new Set<string>();
    for (const s of this.states) for (const [sym] of s.transitions) if (sym && sym.length > 0) set.add(sym);
    return Array.from(set);
  }

  /** Deterministic-Finite-Automaton matcher. */
  matches(input: string): boolean {
    if (!this.start) return false;
    let current: Set<State> = new Set([this.start]);
    for (const ch of input) {
      const next: Set<State> = new Set();
      for (const s of current) {
        for (const t of targetsFor(s, ch)) next.add(t);
      }
      current = next;
      if (current.size === 0) return false;
    }
    for (const s of current) if (s.isAccept) return true;
    return false;
  }
}

/** Deterministic finite automaton. */
export class DFA extends FiniteAutomaton {
  matches(input: string): boolean { return super.matches(input); }

  /**
   * Complete the DFA: add a dead (trap) state so every state has exactly one
   * transition per alphabet symbol (automaton.py make_complete).
   */
  makeComplete(alphabet?: string[]): DFA {
    const sigma = alphabet ?? (this.alphabet.length > 0 ? this.alphabet : this._inferAlphabet());
    const dead = this.addState('DEAD');
    for (const s of this.states) {
      for (const sym of sigma) {
        const t = s.transitions.get(sym) ?? [];
        if (t.length === 0) this.addTransition(s, sym, dead);
      }
    }
    // dead state loops to itself on everything
    for (const sym of sigma) this.addTransition(dead, sym, dead);
    return this;
  }

  /**
   * Hopcroft's algorithm (1971): partition refinement minimisation, O(n log n).
   * Returns a new minimal DFA equivalent to this one
   * (automaton.py minimize_hopcroft).
   */
  minimize(): DFA {
    const sigma = this.alphabet.length > 0 ? this.alphabet : this._inferAlphabet();

    // 0) Complete a COPY so the transition function is total. makeComplete()
    //    is a mutating operation (it mirrors automaton.py make_complete and
    //    adds a DEAD state in place); calling it on `this` grew the caller's
    //    automaton by one state per call, and repeatedly, even though the
    //    returned DFA was already correct. This method documents itself as
    //    returning "a new minimal DFA equivalent to this one" -- it must not
    //    edit the receiver, so every read below comes from the copy.
    const work = new DFA();
    work.alphabet = sigma;
    const srcIndex = new Map<State, number>();
    this.states.forEach((s, i) => srcIndex.set(s, i));
    const copies: State[] = this.states.map(s => work.addState(s.name, s.isAccept));
    copies.forEach((c, i) => {
      for (const [sym, targets] of this.states[i].transitions) {
        c.transitions.set(sym, targets.map(t => copies[srcIndex.get(t)!]));
      }
    });
    work.start = copies[srcIndex.get(this.start)!];
    work.accept = this.accept.map(a => copies[srcIndex.get(a)!]);
    work.makeComplete(sigma);

    // 1) initial partition: accepting vs non-accepting
    const stateIndex = new Map<State, number>();
    work.states.forEach((s, i) => stateIndex.set(s, i));
    let partition: number[] = work.states.map(s => (s.isAccept ? 0 : 1));
    let numBlocks = 2;

    // 2) refinement loop (Moore-style partition refinement; equivalent fixed
    //    point to Hopcroft, O(n²·|Σ|), correct and simple)
    let changed = true;
    while (changed) {
      changed = false;
      const signatures = new Map<string, number>();
      const newPartition: number[] = new Array(work.states.length).fill(0);
      for (let i = 0; i < work.states.length; i++) {
        const s = work.states[i];
        const sigParts: string[] = [String(partition[i])];
        for (const sym of sigma) {
          const t = (s.transitions.get(sym) ?? [])[0];
          sigParts.push(String(t ? partition[stateIndex.get(t)!] : -1));
        }
        const sig = sigParts.join('|');
        if (!signatures.has(sig)) signatures.set(sig, signatures.size);
        newPartition[i] = signatures.get(sig)!;
      }
      const nextBlocks = new Set(newPartition).size;
      if (nextBlocks !== numBlocks) { numBlocks = nextBlocks; changed = true; }
      partition = newPartition;
    }

    // 3) build the minimal DFA: one state per block
    const minimal = new DFA();
    const blockStates = new Map<number, State>();
    for (let i = 0; i < work.states.length; i++) {
      const b = partition[i];
      if (!blockStates.has(b)) {
        blockStates.set(b, minimal.addState(`M${b}`, work.states[i].isAccept));
      }
    }
    for (let i = 0; i < work.states.length; i++) {
      if (work.states[i] === work.start) minimal.start = blockStates.get(partition[i])!;
    }
    for (const s of work.states) {
      if (s.isAccept && !minimal.accept.includes(blockStates.get(partition[stateIndex.get(s)!])!)) {
        minimal.accept.push(blockStates.get(partition[stateIndex.get(s)!])!);
      }
      for (const sym of sigma) {
        const t = (s.transitions.get(sym) ?? [])[0];
        if (t) {
          const from = blockStates.get(partition[stateIndex.get(s)!])!;
          const to = blockStates.get(partition[stateIndex.get(t)!])!;
          // deterministic: single transition per symbol
          from.transitions.set(sym, [to]);
        }
      }
    }
    if (!minimal.start && minimal.states.length > 0) minimal.start = minimal.states[0];
    return minimal;
  }
}

/**
 * Nondeterministic finite automaton with ε-transitions.
 * Matches via subset construction on-the-fly.
 */
export class NFA extends FiniteAutomaton {
  matches(input: string): boolean {
    // ε-closure of start
    const startSet = this._epsilonClosure(new Set([this.start]));
    const step = (states: Set<State>, ch: string): Set<State> => {
      const moved = new Set<State>();
      for (const s of states) {
        for (const t of targetsFor(s, ch)) moved.add(t);
      }
      return this._epsilonClosure(moved);
    };
    let current = startSet;
    for (const ch of input) {
      current = step(current, ch);
      if (current.size === 0) return false;
    }
    for (const s of current) if (s.isAccept) return true;
    return false;
  }

  /**
   * The longest prefix of `input[pos..]` this NFA accepts, or null.
   *
   * This is what a lexer needs, and it cannot be emulated by trying every
   * prefix and stopping at the first failure: for a pattern with an optional
   * part ("a(ab)?") the prefix "aa" does not match while the whole "aab"
   * does, so a scan that stops at the first failure returns "a".
   */
  longestMatch(input: string, pos: number): string | null {
    let current = this._epsilonClosure(new Set([this.start]));
    let best = -1;
    for (let i = pos; i < input.length; i++) {
      const moved = new Set<State>();
      for (const s of current) {
        for (const t of targetsFor(s, input[i])) moved.add(t);
      }
      if (moved.size === 0) break;
      current = this._epsilonClosure(moved);
      for (const s of current) {
        if (s.isAccept) { best = i; break; }
      }
    }
    return best < 0 ? null : input.slice(pos, best + 1);
  }

  /** ε-closure under labelled '' / 'ε' transition. */
  _epsilonClosure(set: Set<State>): Set<State> {
    const closure = new Set(set);
    const stack = Array.from(set);
    while (stack.length > 0) {
      const s = stack.pop()!;
      for (const sym of ['', 'ε', 'EPS']) {
        const t = s.transitions.get(sym) ?? [];
        for (const ns of t) {
          if (!closure.has(ns)) { closure.add(ns); stack.push(ns); }
        }
      }
    }
    return closure;
  }

  /** Convert NFA to equivalent DFA via subset construction. */
  toDFA(): DFA {
    const dfa = new DFA();
    const dfaStates = new Map<string, State>();
    const initial = this._epsilonClosure(new Set([this.start]));
    const initialKey = _key(initial);
    const initialDfa = dfa.addState('S0', _isAccept(initial, this.accept));
    dfaStates.set(initialKey, initialDfa);
    dfa.start = initialDfa;
    const work: { nfaSet: Set<State>; dfaState: State }[] = [{ nfaSet: initial, dfaState: initialDfa }];
    const alphabet = this.alphabet.length > 0 ? this.alphabet : this._inferAlphabet();
    while (work.length > 0) {
      const { nfaSet, dfaState } = work.pop()!;
      for (const sym of alphabet) {
        const moved = new Set<State>();
        for (const s of nfaSet) {
          const t = s.transitions.get(sym) ?? [];
          for (const ns of t) moved.add(ns);
        }
        const closed = this._epsilonClosure(moved);
        if (closed.size === 0) continue;
        const key = _key(closed);
        let targetDfa = dfaStates.get(key);
        if (!targetDfa) {
          targetDfa = dfa.addState('S' + dfa.states.length, _isAccept(closed, this.accept));
          dfaStates.set(key, targetDfa);
          work.push({ nfaSet: closed, dfaState: targetDfa });
        }
        dfa.addTransition(dfaState, sym, targetDfa);
      }
    }
    return dfa;
  }

}

function _key(set: Set<State>): string {
  return Array.from(set).map(s => s.name).sort().join('|');
}

function _isAccept(set: Set<State>, acceptStates: State[]): boolean {
  for (const a of acceptStates) if (set.has(a)) return true;
  return false;
}

/**
 * Build a regexp matcher over an alphabet using Thompson's NFA construction.
 * Supports: literal characters, character classes (`[a-z]`, `[^...]`) and
 * their shorthands (`\d \D \s \S \w \W`), escapes (`\.` `\\` ...),
 * concatenation, | (alternation), * (Kleene), + (one-or-more),
 * ? (zero-or-one), ( ) grouping.
 */
export class RegexCompiler {
  alphabet: string[];
  private nfa: NFA;

  constructor(pattern: string, alphabet?: string[]) {
    this.alphabet = alphabet ?? RegexCompiler._patternChars(pattern);
    this.nfa = RegexCompiler._buildFromRegex(pattern);
  }

  /** Test whether a string matches the regex. */
  matches(input: string): boolean { return this.nfa.matches(input); }

  /**
   * The longest match of the pattern at `pos`, or null when there is none.
   * A lexer needs this: trying every prefix and stopping at the first
   * failure loses matches whenever an optional part is involved.
   */
  longestMatch(input: string, pos: number): string | null {
    return this.nfa.longestMatch(input, pos);
  }

  /** DFA version (slower for one-shot, faster for repeated matching). */
  toDFA(): DFA { return this.nfa.toDFA(); }

  /** Every character the pattern can match (literals + positive classes). */
  private static _patternChars(pattern: string): string[] {
    const chars = new Set<string>();
    for (const tok of RegexCompiler._tokenize(pattern)) {
      if (tok.cls === null) {
        if (tok.ch.length === 1) chars.add(tok.ch);
        continue;
      }
      // A negated class matches an unbounded set of characters, so it is not
      // enumerated; it is matched at run time instead.
      if (tok.cls.negated) continue;
      for (const r of tok.cls.ranges) {
        for (let code = r[0]; code <= r[1]; code++) chars.add(String.fromCharCode(code));
      }
    }
    return [...chars].sort();
  }

  private static _buildFromRegex(pattern: string): NFA {
    const tokens = RegexCompiler._tokenize(pattern);
    let pos = 0;
    const isOp = (tok: PatternToken | undefined, ch: string): boolean =>
      tok !== undefined && tok.cls === null && tok.ch === ch;
    // Recursive-descent parser
    function parse(): { start: State; accept: State } {
      return parseAlt();
    }
    function parseAlt(): { start: State; accept: State } {
      let left = parseConcat();
      while (pos < tokens.length && isOp(tokens[pos], '|')) {
        pos++;
        const right = parseConcat();
        const s = new State('s' + RegexCompiler._id(), false);
        const a = new State('a' + RegexCompiler._id(), true);
        _addSilent(s, left.start);
        _addSilent(s, right.start);
        _addSilent(left.accept, a);
        _addSilent(right.accept, a);
        left.accept.isAccept = false;
        right.accept.isAccept = false;
        left = { start: s, accept: a };
      }
      return left;
    }
    function parseConcat(): { start: State; accept: State } {
      const list: { start: State; accept: State }[] = [];
      while (pos < tokens.length && !isOp(tokens[pos], ')') && !isOp(tokens[pos], '|')) {
        list.push(parseUnary());
      }
      if (list.length === 0) {
        const s = new State('eps' + RegexCompiler._id(), false);
        const a = new State('eps' + RegexCompiler._id(), true);
        _addSilent(s, a);
        return { start: s, accept: a };
      }
      for (let i = 0; i < list.length - 1; i++) {
        _addSilent(list[i].accept, list[i + 1].start);
        list[i].accept.isAccept = false;
      }
      return { start: list[0].start, accept: list[list.length - 1].accept };
    }
    function parseUnary(): { start: State; accept: State } {
      const atom = parseAtom();
      const op = tokens[pos];
      if (op !== undefined && op.cls === null && op.ch === '*') {
        pos++;
        const s = new State('s' + RegexCompiler._id(), false);
        const a = new State('a' + RegexCompiler._id(), true);
        _addSilent(s, atom.start);
        _addSilent(s, a);
        _addSilent(atom.accept, atom.start);
        _addSilent(atom.accept, a);
        atom.accept.isAccept = false;
        return { start: s, accept: a };
      } else if (op !== undefined && op.cls === null && op.ch === '+') {
        pos++;
        const s = new State('s' + RegexCompiler._id(), false);
        const a = new State('a' + RegexCompiler._id(), true);
        _addSilent(s, atom.start);
        _addSilent(atom.accept, atom.start);
        _addSilent(atom.accept, a);
        atom.accept.isAccept = false;
        return { start: s, accept: a };
      } else if (op !== undefined && op.cls === null && op.ch === '?') {
        pos++;
        const s = new State('s' + RegexCompiler._id(), false);
        const a = new State('a' + RegexCompiler._id(), true);
        _addSilent(s, atom.start);
        _addSilent(s, a);
        _addSilent(atom.accept, a);
        atom.accept.isAccept = false;
        return { start: s, accept: a };
      }
      return atom;
    }
    function parseAtom(): { start: State; accept: State } {
      const tok = tokens[pos++];
      if (tok.cls !== null) {
        const s = new State('s' + RegexCompiler._id(), false);
        const a = new State('a' + RegexCompiler._id(), true);
        if (tok.cls.negated) {
          // A negated class is unbounded, so it stays a class transition and
          // is matched at run time.
          _addClass(s, tok.cls, a);
        } else {
          for (const r of tok.cls.ranges) {
            for (let code = r[0]; code <= r[1]; code++) {
              _addSymbol(s, String.fromCharCode(code), a);
            }
          }
        }
        return { start: s, accept: a };
      }
      if (tok.ch === '(') {
        const inner = parseAlt();
        if (isOp(tokens[pos], ')')) pos++;
        return inner;
      }
      const s = new State('s' + RegexCompiler._id(), false);
      const a = new State('a' + RegexCompiler._id(), true);
      _addSymbol(s, tok.ch, a);
      return { start: s, accept: a };
    }
    const { start, accept } = parse();
    accept.isAccept = true;
    const nfa = new NFA([start, accept], start, [accept], []);
    RegexCompiler._wireStates(nfa, start);
    return nfa;
  }

  private static _wireStates(nfa: NFA, root: State, visited: Set<State> = new Set()): void {
    if (visited.has(root)) return;
    visited.add(root);
    nfa.states.push(root);
    for (const [, tos] of root.transitions) for (const t of tos) RegexCompiler._wireStates(nfa, t, visited);
  }

  /**
   * Split a pattern into literal characters, character classes and escapes.
   *
   * The old tokenizer pushed every character as its own literal token, so
   * `[0-9]` became the four literals "[", "0", "-", "9" and the pattern was
   * compiled into an NFA matching that literal text.
   */
  private static _tokenize(pattern: string): PatternToken[] {
    const out: PatternToken[] = [];
    let i = 0;
    while (i < pattern.length) {
      const c = pattern[i];
      if (c === '(' || c === ')' || c === '|' || c === '*' || c === '+' || c === '?') {
        out.push({ ch: c, cls: null });
        i++;
      } else if (c === '\\') {
        i++;
        const e = pattern[i];
        if (e === undefined) throw new Error('RegexCompiler: the pattern ends with a backslash');
        const shorthand = SHORTHAND_CLASSES[e];
        if (shorthand) {
          out.push({ ch: '', cls: shorthand });
        } else {
          out.push({ ch: e, cls: null });
        }
        i++;
      } else if (c === '[') {
        const parsed = parseCharClass(pattern, i);
        out.push({ ch: '', cls: parsed.cls });
        i = parsed.next;
      } else {
        out.push({ ch: c, cls: null });
        i++;
      }
    }
    return out;
  }

  private static _id = (() => {
    let i = 0;
    return () => ++i;
  })();
}

function _addSilent(from: State, to: State): void {
  from.transitions.set('', [...(from.transitions.get('') ?? []), to]);
}

function _addSymbol(from: State, sym: string, to: State): void {
  from.transitions.set(sym, [...(from.transitions.get(sym) ?? []), to]);
}

/** Add a character-class transition (matched at run time). */
function _addClass(from: State, cls: CharClass, to: State): void {
  const key = classKey(cls);
  from.transitions.set(key, [...(from.transitions.get(key) ?? []), to]);
}

// ─── Misc parity exports (automaton.py AutomatonType, lexer.py factory) ─────

/** Kind tag for automaton instances (automaton.py AutomatonType). */
export enum AutomatonType {
  DFA = 'dfa',
  NFA = 'nfa',
}

/**
 * Convenience factory mirroring create_basic_lexer: builds a LexerTokenizer
 * with the common scientific-data token set (numbers, identifiers, strings,
 * whitespace, delimiters).
 *
 * The patterns are written with DOUBLED backslashes on purpose: in a
 * JavaScript/ArkTS string literal `'\s'` is just "s" (the backslash is
 * dropped), so the rule has to be written `'\\s+'` to reach the regex engine
 * as `\s+`. With the single backslash the rule was the literal text "s+",
 * which never matched a space.
 */
export function createBasicLexer(): Tokenizer_LexerTokenizer {
  const t = new Tokenizer_LexerTokenizer();
  t.addRule('[0-9]+(\\.[0-9]+)?([eE][+-]?[0-9]+)?', TokenType.NUMBER);
  t.addRule('[A-Za-z_][A-Za-z0-9_]*', TokenType.STRING);
  t.addRule('"[^"]*"', TokenType.STRING);
  t.addRule('[,;:|]', TokenType.PUNCTUATION);
  t.addRule('\\(', TokenType.PUNCTUATION);
  t.addRule('\\)', TokenType.PUNCTUATION);
  t.addRule('\\s+', TokenType.STRING, true); // skip whitespace
  return t;
}
import { LexerTokenizer as Tokenizer_LexerTokenizer, TokenType } from './Tokenizer';
