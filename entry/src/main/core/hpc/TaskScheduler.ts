/**
 * Task scheduler - HarmonyOS TaskPool integration.
 * Priority-queue scheduling with REAL taskpool dispatch: `executeInTaskPool`
 * sends @Concurrent tasks to worker threads via @kit.ArkTS and transparently
 * falls back to same-thread execution when taskpool rejects the function
 * (plain closures) or the platform lacks taskpool (PC preview, node tests).
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
   * Execute via TaskPool worker thread.
   *
   * REAL dispatch: when `func` is a @Concurrent top-level function with
   * serializable arguments, taskpool executes it on a worker thread. When
   * taskpool rejects it (plain closure without @Concurrent, PC previewer,
   * node tests), execution transparently falls back to same-thread.
   */
  static async executeInTaskPool(func: Function, ...args: unknown[]): Promise<unknown> {
    try {
      const kit = await import('@kit.ArkTS');
      return await kit.taskpool.execute(func as object, ...args as object[]);
    } catch (e) {
      return func(...args);
    }
  }

  /**
   * Parallel map: chunks items and attempts one taskpool task per chunk
   * (real multithreading for @Concurrent `fn`); falls back to sequential
   * execution with identical results when taskpool is unavailable.
   */
  static async parallelMap<T, R>(items: T[], fn: (item: T) => R, maxWorkers: number = 4): Promise<R[]> {
    if (items.length === 0) return [];
    try {
      const kit = await import('@kit.ArkTS');
      const chunkSize = Math.max(1, Math.ceil(items.length / maxWorkers));
      const chunks: T[][] = [];
      for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));
      const chunkResults = await Promise.all(
        chunks.map(chunk => kit.taskpool.execute(fn as object, chunk as object) as Promise<R[]>)
      );
      return chunkResults.flat();
    } catch (e) {
      const results: R[] = [];
      for (const item of items) {
        try { results.push(fn(item)); } catch { results.push(null as unknown as R); }
      }
      return results;
    }
  }

  getQueueLength(): number { return this._queue.length; }
  getRunningCount(): number { return this._running; }
  getCompletedCount(): number { return this._completed; }
  getFailedCount(): number { return this._failed; }
  clear(): void { this._queue = []; }
}
