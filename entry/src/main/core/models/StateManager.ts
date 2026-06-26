import { DataMatrix } from "./DataMatrix";

/**
 * StateManager — replaces models/state_manager.py (595 lines).
 * Singleton global state with data, cache, undo stack, and observers.
 */
export class StateManager {
  private static _instance: StateManager | null = null;
  private _data: DataMatrix | null = null;
  private _cache: Map<string, unknown> = new Map();
  private _modified: boolean = false;
  private _undoStack: DataMatrix[] = [];
  private _redoStack: DataMatrix[] = [];
  private _maxUndo: number = 20;

  static getInstance(): StateManager {
    if (!StateManager._instance) StateManager._instance = new StateManager();
    return StateManager._instance;
  }

  // ─── Data Access ────────────────────────────────────────────────

  get hasData(): boolean { return this._data !== null; }
  get dataMatrix(): DataMatrix | null { return this._data; }
  get isModified(): boolean { return this._modified; }

  setData(dm: DataMatrix): void {
    if (this._data) {
      this._undoStack.push(this._data);
      if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
      this._redoStack = [];
    }
    this._data = dm;
    this._modified = false;
  }

  clearData(): void {
    this._data = null;
    this._cache.clear();
    this._modified = false;
    this._undoStack = [];
    this._redoStack = [];
  }

  markModified(): void { this._modified = true; }

  // ─── Undo/Redo ──────────────────────────────────────────────────

  undo(): boolean {
    if (this._undoStack.length === 0) return false;
    if (this._data) this._redoStack.push(this._data);
    this._data = this._undoStack.pop()!;
    this._modified = true;
    return true;
  }

  redo(): boolean {
    if (this._redoStack.length === 0) return false;
    if (this._data) this._undoStack.push(this._data);
    this._data = this._redoStack.pop()!;
    this._modified = true;
    return true;
  }

  canUndo(): boolean { return this._undoStack.length > 0; }
  canRedo(): boolean { return this._redoStack.length > 0; }

  // ─── Cache ──────────────────────────────────────────────────────

  cacheResult(key: string, result: unknown): void { this._cache.set(key, result); }
  getCachedResult<T>(key: string): T | null { return (this._cache.get(key) as T) ?? null; }
  hasCachedResult(key: string): boolean { return this._cache.has(key); }
  clearCache(): void { this._cache.clear(); }
}
