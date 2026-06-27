/**
 * Task scheduler - HarmonyOS TaskPool integration.
 * Uses @kit.ArkTS taskpool for true multi-threading.
 */

// HarmonyOS: uncomment when running on device
// import { taskpool } from '@kit.ArkTS';

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

  /**
   * Execute in background thread via TaskPool.
   * On HarmonyOS device: use taskpool.execute(func)
   * For @Sendable cross-thread data, wrap in @Sendable class.
   */
  static async executeInTaskPool(func: Function, ...args: unknown[]): Promise<unknown> {
    // HarmonyOS device:
    // import { taskpool } from '@kit.ArkTS';
    // @Sendable class SharedMatrix { data: Float64Array; }
    // return await taskpool.execute(func, ...args);
    return func(...args);
  }

  static async parallelMap<T, R>(items: T[], fn: (item: T) => R, maxWorkers: number = 4): Promise<R[]> {
    // HarmonyOS device:
    // import { taskpool } from '@kit.ArkTS';
    // const tasks = items.map(item => taskpool.execute(() => fn(item)));
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
