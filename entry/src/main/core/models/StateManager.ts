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

// ─── LRU Cache Entry ─────────────────────────────────────────────────────────

interface LRUCacheEntry {
  value: unknown;
  size: number;           // bytes
  prev: string | null;
  next: string | null;
}

/**
 * LRU cache with size-based eviction.
 * - Max 100 entries OR 50MB total
 * - Tracks serialized byte size via Float64Array byteLength
 * - On access: move to head (most-recently-used)
 * - On overflow: evict tail (least-recently-used)
 */
class LRUCache {
  private _m: Map<string, LRUCacheEntry> = new Map();
  private _head: string | null = null;  // MRU end
  private _tail: string | null = null;  // LRU end
  private _totalBytes: number = 0;
  private _maxEntries: number = 100;
  private _maxBytes: number = 50 * 1024 * 1024; // 50 MB

  /** Serialize a result to bytes; prefer Float64Array. */
  private static serialize(r: unknown): { bytes: number; normalized: unknown } {
    if (r instanceof Float64Array) {
      return { bytes: r.byteLength, normalized: r };
    }
    if (r instanceof Float32Array) {
      return { bytes: r.byteLength, normalized: r };
    }
    if (r instanceof Uint8Array) {
      return { bytes: r.byteLength, normalized: r };
    }
    if (ArrayBuffer.isView(r)) {
      return { bytes: (r as ArrayBufferView).byteLength, normalized: r };
    }
    if (Array.isArray(r)) {
      // Try to detect numeric arrays
      const dbl = new Float64Array(r as number[]);
      return { bytes: dbl.byteLength, normalized: dbl };
    }
    if (typeof r === 'object' && r !== null) {
      try {
        const s = JSON.stringify(r);
        const b = new TextEncoder().encode(s);
        return { bytes: b.byteLength, normalized: r };
      } catch {
        return { bytes: 256, normalized: r };
      }
    }
    return { bytes: 8, normalized: r };
  }

  get(k: string): unknown | null {
    const e = this._m.get(k);
    if (!e) return null;
    this._touch(k);
    return e.value;
  }

  set(k: string, v: unknown): void {
    const existing = this._m.get(k);
    if (existing) {
      this._totalBytes -= existing.size;
      existing.value = v;
      const { bytes } = LRUCache.serialize(v);
      existing.size = bytes;
      this._totalBytes += bytes;
      this._touch(k);
      this._evictIfNeeded();
      return;
    }

    const { bytes } = LRUCache.serialize(v);
    const entry: LRUCacheEntry = { value: v, size: bytes, prev: null, next: null };

    if (!this._head) {
      this._head = k;
      this._tail = k;
    } else {
      entry.prev = this._head;
      this._m.get(this._head)!.next = k;
      this._head = k;
    }
    this._m.set(k, entry);
    this._totalBytes += bytes;
    this._evictIfNeeded();
  }

  has(k: string): boolean { return this._m.has(k); }

  clear(): void { this._m.clear(); this._head = null; this._tail = null; this._totalBytes = 0; }

  get size(): number { return this._m.size; }
  get totalBytes(): number { return this._totalBytes; }

  /** Move key to head (most recently used). */
  private _touch(k: string): void {
    if (this._head === k) return;
    const e = this._m.get(k)!;
    // Unlink from current position
    if (e.prev) { const pe = this._m.get(e.prev); if (pe) pe.next = e.next; }
    if (e.next) { const ne = this._m.get(e.next); if (ne) ne.prev = e.prev; }
    if (this._tail === k) this._tail = e.prev;
    // Insert at head
    e.prev = this._head;
    e.next = null;
    const he = this._m.get(this._head!);
    if (he) he.next = k;
    this._head = k;
    if (!this._tail) this._tail = k;
  }

  /** Evict LRU entries until within size limits. */
  private _evictIfNeeded(): void {
    while (
      (this._m.size > this._maxEntries || this._totalBytes > this._maxBytes) &&
      this._tail
    ) {
      const tk = this._tail!;
      const e = this._m.get(tk)!;
      this._totalBytes -= e.size;
      if (e.prev) { const pe = this._m.get(e.prev); if (pe) pe.next = null; }
      this._tail = e.prev;
      if (!this._tail) this._head = null;
      this._m.delete(tk);
    }
  }
}

// ─── StateManager ────────────────────────────────────────────────────────────

@Observed
export class StateManager {
  private static _i: StateManager | null = null;
  private _d: DataMatrix | null = null;
  private _c: LRUCache = new LRUCache();
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

  /** Cache statistics for diagnostics. */
  get cacheStats(): { size: number; totalBytes: number } {
    return { size: this._c.size, totalBytes: this._c.totalBytes };
  }

  // ─── Command-level undo (state_manager.py) ─────────────────────────────
  // Whole-data operations (transforms, transpose, subset) snapshot the
  // previous DataMatrix reference; undoing swaps it back. Cell-level deltas
  // remain on the separate _u stack.

  private _cmdUndo: DataMatrix[] = [];
  private _cmdRedo: DataMatrix[] = [];
  private _maxCommands = 20;

  /** Snapshot the current data before a whole-table command. */
  pushCommandSnapshot(): void {
    if (!this._d) return;
    this._cmdUndo.push(this._d);
    if (this._cmdUndo.length > this._maxCommands) this._cmdUndo.shift();
    this._cmdRedo = [];
  }

  /** Undo the latest whole-table command; returns the restored snapshot. */
  undoCommand(): DataMatrix | null {
    const prev = this._cmdUndo.pop();
    if (!prev || !this._d) return null;
    this._cmdRedo.push(this._d);
    this._d = prev;
    this._m = true;
    return prev;
  }

  /** Redo the latest undone whole-table command. */
  redoCommand(): DataMatrix | null {
    const next = this._cmdRedo.pop();
    if (!next || !this._d) return null;
    this._cmdUndo.push(this._d);
    this._d = next;
    this._m = true;
    return next;
  }

  get canUndoCommand(): boolean { return this._cmdUndo.length > 0; }
  get canRedoCommand(): boolean { return this._cmdRedo.length > 0; }

  // ─── File tracking (state_manager.py current_file / mark_saved) ────────

  private _file: string = '';

  get currentFile(): string { return this._file; }

  setCurrentFile(path: string): void {
    this._file = path;
    this._m = false; // fresh from disk
  }

  markSaved(): void { this._m = false; }

  // ─── Visualization settings (state_manager.py) ──────────────────────────

  private _viz: Record<string, number | string | boolean> = {};

  getVizSetting(key: string): number | string | boolean | undefined {
    return this._viz[key];
  }

  setVizSetting(key: string, value: number | string | boolean): void {
    this._viz[key] = value;
  }

  clearVizSettings(): void { this._viz = {}; }
}

/** Module-singleton accessor mirroring Python's models.get_state_manager(). */
export function getStateManager(): StateManager {
  return StateManager.getInstance();
}
