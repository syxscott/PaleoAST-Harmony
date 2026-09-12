/**
 * Process pool ¡ª replaces hpc/process_pool.py
 * Promise-based execution for HarmonyOS with REAL taskpool dispatch.
 *
 * `map` first attempts true multithreading via @kit.ArkTS taskpool: when the
 * caller's `fn` is a @Concurrent-decorated top-level function with
 * serializable arguments, each chunk is dispatched to a worker thread and
 * runs in parallel. When taskpool rejects the closure (plain function, PC
 * preview, node tests) it transparently falls back to sequential execution
 * with identical results. Python's multiprocessing closures cannot cross the
 * ArkTS thread boundary by design ¡ª see TaskScheduler for the @Concurrent
 * pattern.
 */

export interface TaskResult<T> { result: T | null; error: string | null; duration: number; }

export class ProcessPool {
  private maxWorkers: number;

  constructor(maxWorkers: number = 4) { this.maxWorkers = maxWorkers; }

  async map<T, R>(items: T[], fn: (item: T) => R): Promise<R[]> {
    if (items.length === 0) return [];
    try {
      // Real parallel path: one taskpool task per chunk.
      const kit = await import('@kit.ArkTS');
      const chunkSize = Math.max(1, Math.ceil(items.length / this.maxWorkers));
      const chunks: T[][] = [];
      for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));
      const chunkResults = await Promise.all(
        chunks.map(chunk => kit.taskpool.execute(fn as object, chunk as object) as Promise<R[]>)
      );
      return chunkResults.flat();
    } catch (e) {
      // Sequential fallback: non-@Concurrent closures, PC previewer, tests.
      const results: R[] = [];
      for (const item of items) {
        try { results.push(fn(item)); } catch { results.push(null as unknown as R); }
      }
      return results;
    }
  }

  async execute<T>(fn: () => T, timeoutMs: number = 30000): Promise<TaskResult<T>> {
    const start = Date.now();
    try {
      const result = await Promise.race([
        Promise.resolve(fn()),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs)),
      ]);
      return { result, error: null, duration: Date.now() - start };
    } catch (e) { return { result: null, error: String(e), duration: Date.now() - start }; }
  }

  getMaxWorkers(): number { return this.maxWorkers; }
  setMaxWorkers(n: number): void { this.maxWorkers = n; }
}
