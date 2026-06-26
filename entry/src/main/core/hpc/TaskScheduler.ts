/**
 * Task scheduler ¡ª replaces hpc/task_scheduler.py
 * Priority-based task queue with concurrency control.
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

  getQueueLength(): number { return this._queue.length; }
  getRunningCount(): number { return this._running; }
  getCompletedCount(): number { return this._completed; }
  getFailedCount(): number { return this._failed; }
  clear(): void { this._queue = []; }
}
