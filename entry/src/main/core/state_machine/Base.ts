/**
 * State machine ¡ª replaces state_machine/base.py
 * Core state/transition/machine abstractions.
 */

export class State {
  constructor(
    public name: string,
    public isAccept: boolean = false,
    public transitions: Map<string, State[]> = new Map(),
  ) {}
}

export class Transition {
  constructor(
    public from: State,
    public symbol: string,
    public to: State,
  ) {}
}

export class StateMachine {
  private _states: State[] = [];
  private _startState: State | null = null;

  addState(state: State): void { this._states.push(state); }
  setStart(state: State): void { this._startState = state; }
  getStart(): State | null { return this._startState; }
  getStates(): State[] { return this._states; }
  getAcceptStates(): State[] { return this._states.filter(s => s.isAccept); }

  addTransition(from: State, symbol: string, to: State): void {
    if (!from.transitions.has(symbol)) from.transitions.set(symbol, []);
    from.transitions.get(symbol)!.push(to);
  }

  match(input: string): boolean {
    if (!this._startState) return false;
    let current = new Set([this._startState]);
    for (const ch of input) {
      const next = new Set<State>();
      for (const s of current) {
        const targets = s.transitions.get(ch) ?? [];
        for (const t of targets) next.add(t);
      }
      current = next;
      if (!current.size) return false;
    }
    for (const s of current) if (s.isAccept) return true;
    return false;
  }
}
