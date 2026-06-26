/**
 * Process pool ¡ª replaces hpc/process_pool.py
 * Promise-based parallel execution for HarmonyOS.
 */

export interface TaskResult<T> { result: T | null; error: string | null; duration: number; }

export class ProcessPool {
  private maxWorkers: number;

  constructor(maxWorkers: number = 4) { this.maxWorkers = maxWorkers; }

  async map<T, R>(items: T[], fn: (item: T) => R): Promise<R[]> {
    const chunkSize = Math.ceil(items.length / this.maxWorkers);
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));

    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const r: R[] = [];
        for (const item of chunk) try { r.push(fn(item)); } catch { r.push(null as unknown as R); }
        return r;
      })
    );
    return results.flat();
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
