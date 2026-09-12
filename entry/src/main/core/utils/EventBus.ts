export type EventCallback=(...a:unknown[])=>void;
export class EventBus{
  private static _i:EventBus|null=null;
  private _l:Map<string,Set<EventCallback>>=new Map();
  private _h:{e:string;a:unknown[];t:number}[]=[];
  private static readonly MAX_HISTORY = 100;

  static getInstance(): EventBus {
    if (!EventBus._i) EventBus._i = new EventBus();
    return EventBus._i;
  }

  /**
   * Subscribe. `e` may be an exact event name or a wildcard pattern with a
   * trailing `.*` (e.g. `data.*` matches `data_changed`, `data_loaded`, ...).
   */
  on(e:string, c:EventCallback): void {
    if (!this._l.has(e)) this._l.set(e, new Set());
    this._l.get(e)!.add(c);
  }

  off(e:string, c:EventCallback): void {
    this._l.get(e)?.delete(c);
  }

  once(e:string, c:EventCallback): void {
    const w: EventCallback = (...a: unknown[]) => {
      c(...a);
      this.off(e, w);
    };
    this.on(e, w);
  }

  /** Wildcard match: trailing `*` is a prefix wildcard (`data_*`, `data.*`, or bare `*`). */
  private _matches(pattern:string, e:string): boolean {
    if (pattern === e) return true;
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) return e.startsWith(pattern.slice(0, -1));
    return false;
  }

  emit(e:string, ...a:unknown[]): void {
    this._h.push({e, a, t: Date.now()});
    if (this._h.length > EventBus.MAX_HISTORY) this._h.shift();
    // Collect exact + wildcard listeners; iterate over shallow copies to be
    // safe against modification during iteration; one listener throwing must
    // not break the others.
    const callbacks: EventCallback[] = [];
    for (const [pattern, listeners] of this._l) {
      if (this._matches(pattern, e)) callbacks.push(...listeners);
    }
    for (const c of callbacks) {
      try {
        c(...a);
      } catch (x) {
        console.error(x);
      }
    }
  }

  emitDataChanged(d:unknown): void { this.emit("data_changed", d); }
  emitMetadataChanged(s:string, i:number, m:unknown): void { this.emit("metadata_changed", s, i, m); }
  emitUndoStackChanged(): void { this.emit("undo_stack_changed"); }
  getHistory() { return [...this._h]; }
}
