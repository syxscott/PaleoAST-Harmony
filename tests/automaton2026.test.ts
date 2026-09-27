/**
 * minimize() edited the DFA it was called on (2026-09-27, ninth pass).
 *
 * `makeComplete()` is a mutating operation -- it mirrors automaton.py's
 * `make_complete` and adds a DEAD state in place. `minimize()` called it on
 * `this`, so minimising a DFA grew the caller's automaton by one state, and
 * calling it twice grew it again:
 *
 *     before minimize:  q0,q1
 *     after  minimize:  q0,q1,DEAD
 *     second call:      3 -> 4 states
 *
 * The returned minimal DFA was correct throughout and the language was
 * preserved, so the algorithm was fine -- only the side effect was wrong, and
 * the method's own docstring says "Returns a new minimal DFA equivalent to this
 * one". A caller that minimised in a loop, or minimised the same shared DFA
 * from two places, grew it without bound.
 *
 * core/state_machine/ is dead code, so this is a landmine rather than a live
 * defect -- the point of the test is that whoever wires it up does not ship it.
 */
import { describe, it, expect } from './runner.ts';
import { DFA } from '../entry/src/main/core/state_machine/Automaton.ts';

/** DFA for a*b over {a,b}: q0 loops on 'a', q1 is accepting, b returns to q0. */
function abDfa(): DFA {
  const d = new DFA();
  d.alphabet = ['a', 'b'];
  const q0 = d.addState('q0');
  const q1 = d.addState('q1', true);
  d.start = q0;
  d.accept = [q1];
  d.addTransition(q0, 'a', q0);
  d.addTransition(q1, 'b', q0);
  return d;
}

const WORDS = ['', 'a', 'aa', 'aaa', 'b', 'ab', 'aab', 'ba', 'abab', 'aaba', 'aabb', 'bb', 'ababab'];

describe('audit: minimize() mutated the receiver instead of returning a new DFA', () => {
  it('leaves the receiver untouched', () => {
    const d = abDfa();
    const before = d.states.length;
    d.minimize();
    expect(d.states.length + ' vs ' + before).toBe(before + ' vs ' + before);
    // Before: minimize() appended a DEAD state to the caller's automaton.
    expect(d.states.some(s => s.name === 'DEAD') ? 'added a DEAD state' : '').toBe('');
  });

  it('is idempotent -- repeated calls do not accumulate states', () => {
    const d = abDfa();
    const before = d.states.length;
    const first = d.minimize();
    const after1 = d.states.length;
    const second = d.minimize();
    const after2 = d.states.length;
    // Before: 2 -> 3 -> 4.
    expect(after1 + ',' + after2).toBe(before + ',' + before);
    expect(second.states.length + ' vs ' + first.states.length).toBe(first.states.length + ' vs ' + first.states.length);
  });

  it('still returns a correct minimal DFA', () => {
    // The mutation fix must not have changed the algorithm: the language has to
    // survive, and the result must not shrink further.
    const d = abDfa();
    const m = d.minimize();
    const bad = WORDS.filter(w => d.matches(w) !== m.matches(w));
    expect(bad.join(',') || 'language preserved').toBe('language preserved');
    // a*b needs 2 states, not fewer and not more
    expect(m.states.length).toBe(2);
    const again = m.minimize();
    expect(again.states.length).toBe(2);
    // and the second minimisation did not edit `m` either
    expect(m.states.length).toBe(2);
  });

  it('makeComplete keeps its mutating behaviour', () => {
    // Deliberately NOT changed: makeComplete() mirrors automaton.py
    // make_complete, which mutates in place. Only minimize() had a contract
    // problem, because only minimize() advertised a fresh result.
    const d = abDfa();
    const before = d.states.length;
    d.makeComplete(['a', 'b']);
    expect(d.states.length > before ? 'grew to ' + d.states.length : 'unchanged').toBe('grew to ' + (before + 1));
    expect(d.states.some(s => s.name === 'DEAD') ? 'has DEAD' : 'no DEAD').toBe('has DEAD');
  });
});
