import {DataMatrix} from "./DataMatrix";
import { Observed } from '@kit.ArkUI';

interface UndoDelta {
  row: number;
  col: number;
  oldVal: number;
  newVal: number;
  timestamp: number;
}

interface UndoState {
  deltas: UndoDelta[];
  timestamp: number;
}

@Observed
export class StateManager {
  private static _i: StateManager | null = null;
  private _d: DataMatrix | null = null;
  private _c: Map<string, unknown> = new Map();
  private _m: boolean = false;
  private _u: UndoState[] = [];
  private _r: UndoState[] = [];
  private _max = 20;
  private _maxDeltasPerState = 100; // Limit deltas per undo state

  static getInstance(): StateManager {
    if (!StateManager._i) StateManager._i = new StateManager();
    return StateManager._i;
  }

  get hasData(): boolean { return this._d !== null; }
  get dataMatrix(): DataMatrix | null { return this._d; }
  get isModified(): boolean { return this._m; }

  // Estimate memory usage of undo stack (rough approximation)
  private estimateMemory(): number {
    let bytes = 0;
    for (const state of this._u) {
      bytes += state.deltas.length * 24; // Approx size per delta
    }
    return bytes;
  }

  // Push a cell change for undo tracking
  pushUndo(row: number, col: number, oldVal: number, newVal: number): void {
    // Start new undo state if needed
    if (this._u.length === 0 || this._u[this._u.length - 1].deltas.length >= this._maxDeltasPerState) {
      this._u.push({ deltas: [], timestamp: Date.now() });
      if (this._u.length > this._max) this._u.shift();
    }
    this._u[this._u.length - 1].deltas.push({ row, col, oldVal, newVal, timestamp: Date.now() });
    this._r = []; // Clear redo stack on new change
  }

  setData(d: DataMatrix): void {
    if (!d) throw new Error('DataMatrix cannot be null or undefined');
    if (this._d) {
      // Check memory before pushing
      if (this.estimateMemory() < 50 * 1024 * 1024) { // Max 50MB for undo
        this._u.push({ deltas: [], timestamp: Date.now() });
        if (this._u.length > this._max) this._u.shift();
      }
      this._r = [];
    }
    this._d = d;
    this._m = false;
  }

  clearData(): void {
    this._d = null;
    this._c.clear();
    this._m = false;
    this._u = [];
    this._r = [];
  }

  markModified(): void { this._m = true; }

  undo(): boolean {
    if (!this._u.length || !this._d) return false;
    const state = this._u.pop();
    if (!state) return false;

    // Apply reverse deltas
    for (let i = state.deltas.length - 1; i >= 0; i--) {
      const delta = state.deltas[i];
      this._d.data.set(delta.row, delta.col, delta.oldVal);
    }

    this._r.push(state);
    this._m = true;
    return true;
  }

  redo(): boolean {
    if (!this._r.length || !this._d) return false;
    const state = this._r.pop();
    if (!state) return false;

    // Apply forward deltas
    for (const delta of state.deltas) {
      this._d.data.set(delta.row, delta.col, delta.newVal);
    }

    this._u.push(state);
    this._m = true;
    return true;
  }

  canUndo(): boolean {
    // Only return true if there's at least one state with actual deltas
    for (const state of this._u) {
      if (state.deltas.length > 0) return true;
    }
    return false;
  }

  canRedo(): boolean {
    // Only return true if there's at least one state with actual deltas
    for (const state of this._r) {
      if (state.deltas.length > 0) return true;
    }
    return false;
  }

  cacheResult(k: string, r: unknown): void { this._c.set(k, r); }
  getCachedResult<T>(k: string): T | null { return (this._c.get(k) as T) ?? null; }
  hasCachedResult(k: string): boolean { return this._c.has(k); }
  clearCache(): void { this._c.clear(); }
}
