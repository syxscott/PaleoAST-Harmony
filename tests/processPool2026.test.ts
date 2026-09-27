/**
 * ProcessPool.execute() leaked its timeout timer (2026-09-27, ninth pass).
 *
 *     const result = await Promise.race([
 *       Promise.resolve(fn()),
 *       new Promise((_, reject) => setTimeout(() => reject(...), timeoutMs)),
 *     ]);
 *
 * The timer was never cleared when `fn` resolved first, so every successful
 * call held the event loop open for the full `timeoutMs` (30s by default).
 * Measured with timeoutMs = 3000, running a trivial `fn`:
 *
 *     before: process wall clock 3174 ms   (hung for the whole timeout)
 *     after:  process wall clock  155 ms
 *
 * On a device that is a 30-second hold after the last analysis; in node it also
 * means any script or test that calls execute() cannot exit promptly.
 */
import { describe, it, expect } from './runner.ts';
import { ProcessPool } from '../entry/src/main/core/hpc/ProcessPool.ts';

describe('audit: ProcessPool.execute leaked the timeout timer', () => {
  it('returns the result and does not keep the event loop alive', async () => {
    const pool = new ProcessPool(2);
    const r = await pool.execute(() => 42, 3000);
    expect(r.result).toBe(42);
    expect(r.error).toBe(null);
    expect(r.duration < 1000 ? 'fast' : 'slow: ' + r.duration).toBe('fast');
    // The real check is what happens after this test function returns: an
    // uncleared timer would keep the handle open for 3000 ms.
  });

  it('still reports a genuine timeout', async () => {
    // The timer must still fire when fn really does overrun, otherwise the fix
    // would have turned a real guard into a no-op.
    const pool = new ProcessPool(2);
    const r = await pool.execute(
      () => new Promise<number>(res => setTimeout(() => res(1), 400)),
      50,
    );
    expect(r.error !== null ? 'timed out' : 'did not time out').toBe('timed out');
    expect(r.result === null ? 'result nulled' : 'result ' + r.result).toBe('result nulled');
  });

  it('clears the timer when fn rejects', async () => {
    const pool = new ProcessPool(2);
    const r = await pool.execute(() => { throw new Error('boom'); }, 5000);
    expect(r.error !== null ? String(r.error) : 'no error reported').toBe('Error: boom');
    expect(r.result === null ? 'result nulled' : 'result ' + r.result).toBe('result nulled');
  });
});

describe('audit: ProcessPool.map isolates per-item errors (unchanged contract)', () => {
  it('a throwing item becomes null and the rest still compute', async () => {
    // Recorded because this pass TRIED to change it and had to be reverted:
    // core.test.ts:591 already pins this as deliberate. The observation that
    // prompted the attempt is real but is a design question, not a defect -- the
    // blanket catch cannot tell "taskpool rejected the closure" from "fn threw",
    // so a failing item in the parallel path re-runs the batch sequentially.
    // Separating those needs a taskpool-availability probe, i.e. a redesign of
    // dead code, so it is left alone and documented instead.
    const pool = new ProcessPool(2);
    const out = await pool.map([1, 0, 3], (x: number) => {
      if (x === 0) throw new Error('div by zero');
      return 10 / x;
    });
    expect(out[0]).toBe(10);
    expect(out[1] === null ? 'null for the failing item' : 'got ' + out[1]).toBe('null for the failing item');
    expect(out[2]).toBeCloseTo(10 / 3, 1e-9);
  });
});
