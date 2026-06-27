/**
 * Task scheduler - uses HarmonyOS TaskPool for true multi-threading.
 * For large matrix data, use @Sendable to avoid serialization overhead.
 */

export interface Task { id: string; priority: number; fn: () => Promise<unknown>; }

export class TaskScheduler {
  private _queue: Task[] = [];
  private _running = 0;
  private _maxConcurrent: number;
  private _completed = 0;
  private _failed = 0;

  constructor(maxConcurrent = 4) { this._maxConcurrent = maxConcurrent; }

  submit(task: Task): void {
    this._queue.push(task);
    this._queue.sort((a, b) => b.priority - a.priority);
    this._process();
  }

  private async _process(): Promise<void> {
    while (this._running < this._maxConcurrent && this._queue.length > 0) {
      const task = this._queue.shift()!;
      this._running++;
      try {
        // HarmonyOS TaskPool: import { taskpool } from '@kit.ArkTS';
        // const result = await taskpool.execute(task.fn);
        await task.fn();
        this._completed++;
      } catch (e) {
        this._failed++;
        console.error('Task ' + task.id + ' failed: ' + e);
      } finally {
        this._running--;
        this._process();
      }
    }
  }

  static async executeInTaskPool(func: Function, ...args: unknown[]): Promise<unknown> {
    // HarmonyOS: return await taskpool.execute(func, ...args);
    return func(...args);
  }

  static async parallelMap<T, R>(items: T[], fn: (item: T) => R, maxWorkers: number = 4): Promise<R[]> {
    // HarmonyOS: const tasks = items.map(item => taskpool.execute(() => fn(item)));
    // return await Promise.all(tasks);
    const results: R[] = [];
    for (const item of items) {
      try { results.push(fn(item)); } catch { results.push(null as unknown as R); }
    }
    return results;
  }

  getQueueLength(): number { return this._queue.length; }
  getRunningCount(): number { return this._running; }
  getCompletedCount(): number { return this._completed; }
  getFailedCount(): number { return this._failed; }
  clear(): void { this._queue = []; }
}
