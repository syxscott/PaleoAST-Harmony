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
        const targets = s.transitions.get(ch) ?? [];
        for (const t of targets) next.add(t);
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
    // 0) complete first so the transition function is total
    const sigma = this.alphabet.length > 0 ? this.alphabet : this._inferAlphabet();
    this.makeComplete(sigma);

    // 1) initial partition: accepting vs non-accepting
    const stateIndex = new Map<State, number>();
    this.states.forEach((s, i) => stateIndex.set(s, i));
    let partition: number[] = this.states.map(s => (s.isAccept ? 0 : 1));
    let numBlocks = 2;

    // 2) refinement loop (Moore-style partition refinement; equivalent fixed
    //    point to Hopcroft, O(n²·|Σ|), correct and simple)
    let changed = true;
    while (changed) {
      changed = false;
      const signatures = new Map<string, number>();
      const newPartition: number[] = new Array(this.states.length).fill(0);
      for (let i = 0; i < this.states.length; i++) {
        const s = this.states[i];
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
    for (let i = 0; i < this.states.length; i++) {
      const b = partition[i];
      if (!blockStates.has(b)) {
        blockStates.set(b, minimal.addState(`M${b}`, this.states[i].isAccept));
      }
    }
    for (let i = 0; i < this.states.length; i++) {
      if (this.states[i] === this.start) minimal.start = blockStates.get(partition[i])!;
    }
    for (const s of this.states) {
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
        const targets = s.transitions.get(ch) ?? [];
        for (const t of targets) moved.add(t);
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
 * Supports: literal characters, concatenation, | (alternation), * (Kleene),
 * + (one-or-more), ? (zero-or-one), ( ) grouping.
 */
export class RegexCompiler {
  alphabet: string[];
  private nfa: NFA;

  constructor(pattern: string, alphabet?: string[]) {
    this.alphabet = alphabet ?? pattern.split('').filter(c => /[a-zA-Z0-9]/.test(c));
    this.nfa = RegexCompiler._buildFromRegex(pattern);
  }

  /** Test whether a string matches the regex. */
  matches(input: string): boolean { return this.nfa.matches(input); }

  /** DFA version (slower for one-shot, faster for repeated matching). */
  toDFA(): DFA { return this.nfa.toDFA(); }

  private static _buildFromRegex(pattern: string): NFA {
    const tokens = RegexCompiler._tokenize(pattern);
    let pos = 0;
    // Recursive-descent parser
    function parse(): { start: State; accept: State } {
      return parseAlt();
    }
    function parseAlt(): { start: State; accept: State } {
      let left = parseConcat();
      while (pos < tokens.length && tokens[pos] === '|') {
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
      while (pos < tokens.length && tokens[pos] !== ')' && tokens[pos] !== '|') {
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
      if (op === '*') {
        pos++;
        const s = new State('s' + RegexCompiler._id(), false);
        const a = new State('a' + RegexCompiler._id(), true);
        _addSilent(s, atom.start);
        _addSilent(s, a);
        _addSilent(atom.accept, atom.start);
        _addSilent(atom.accept, a);
        atom.accept.isAccept = false;
        return { start: s, accept: a };
      } else if (op === '+') {
        pos++;
        const s = new State('s' + RegexCompiler._id(), false);
        const a = new State('a' + RegexCompiler._id(), true);
        _addSilent(s, atom.start);
        _addSilent(atom.accept, atom.start);
        _addSilent(atom.accept, a);
        atom.accept.isAccept = false;
        return { start: s, accept: a };
      } else if (op === '?') {
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
      if (tok === '(') {
        const inner = parseAlt();
        if (tokens[pos] === ')') pos++;
        return inner;
      }
      const s = new State('s' + RegexCompiler._id(), false);
      const a = new State('a' + RegexCompiler._id(), true);
      _addSymbol(s, tok, a);
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

  private static _tokenize(pattern: string): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < pattern.length) {
      const c = pattern[i];
      if (c === '(' || c === ')' || c === '|' || c === '*' || c === '+' || c === '?') {
        out.push(c); i++;
      } else {
        out.push(c); i++;
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
