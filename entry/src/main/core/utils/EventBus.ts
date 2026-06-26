export type EventCallback = (...args: unknown[]) => void;

export class EventBus {
  private static _instance: EventBus | null = null;
  private _listeners: Map<string, Set<EventCallback>> = new Map();

  static getInstance(): EventBus {
    if (!EventBus._instance) EventBus._instance = new EventBus();
    return EventBus._instance;
  }

  on(event: string, callback: EventCallback): void {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    this._listeners.get(event)?.delete(callback);
  }

  emit(event: string, ...args: unknown[]): void {
    const listeners = this._listeners.get(event);
    if (listeners) for (const cb of listeners) try { cb(...args); } catch (e) { console.error('EventBus error:', e); }
  }

  emitDataChanged(data: unknown): void { this.emit('data_changed', data); }
  emitMetadataChanged(scope: string, index: number, meta: unknown): void { this.emit('metadata_changed', scope, index, meta); }
}
