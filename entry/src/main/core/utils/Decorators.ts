/**
 * Utility decorators — replaces utils/decorators.py.
 */

// ─── Diagnostic sink ──────────────────────────────────────────────────────────

/**
 * Where `logExecutionTime` and `deprecated` write their diagnostics.
 *
 * NULL by default, and that is deliberate: these are DECORATORS, so a
 * `console.log` inside them prints on EVERY call of a production method.
 * `core/app_infrastructure/CodeAudit.ts` lists stray console statements as a
 * defect, and a silent-by-default sink is the only way a decorator can stay
 * in a production code path.
 *
 * Turn the diagnostics on explicitly, e.g. in a debug build:
 *   `setDecoratorLogSink((m) => console.log(m));`
 */
let decoratorLogSink: ((message: string) => void) | null = null;

/** Install (or, with `null`, remove) the decorator diagnostic sink. */
export function setDecoratorLogSink(sink: ((message: string) => void) | null): void {
  decoratorLogSink = sink;
}

/** The currently installed decorator diagnostic sink (null = silent). */
export function getDecoratorLogSink(): ((message: string) => void) | null {
  return decoratorLogSink;
}

// ─── thread_safe ────────────────────────────────────────────────────────────────
// Mark a class method as mutually exclusive (mirrors threading.RLock wrapping).
// Correctly unwraps inner Promises returned by the wrapped function so callers
// never receive `Promise<Promise<T>>`.

export function threadSafe(): MethodDecorator {
  const locks = new WeakMap<object, Map<string, { busy: boolean; q: Array<() => void> }>>();
  return (_target, key, descriptor) => {
    const orig = descriptor.value as Function;
    descriptor.value = function (...args: unknown[]) {
      const k = String(key);
      let per = locks.get(this as object);
      if (!per) { per = new Map(); locks.set(this as object, per); }
      let slot = per.get(k);
      if (!slot) { slot = { busy: false, q: [] }; per.set(k, slot); }
      const run = (): unknown => {
        slot!.busy = true;
        try {
          let r: unknown;
          try { r = orig.apply(this, args); }
          catch (e) {
            slot!.busy = false;
            const next = slot!.q.shift();
            if (next) Promise.resolve().then(next);
            throw e;
          }
          // If orig returned a Promise, await it before releasing the lock.
          if (r && typeof (r as { then?: unknown }).then === 'function') {
            return (r as Promise<unknown>).finally(() => {
              slot!.busy = false;
              const next = slot!.q.shift();
              if (next) Promise.resolve().then(next);
            });
          }
          slot!.busy = false;
          const next = slot!.q.shift();
          if (next) Promise.resolve().then(next);
          return r;
        } catch (err) {
          slot!.busy = false;
          throw err;
        }
      };
      if (slot.busy) {
        return new Promise((resolve, reject) =>
          slot!.q.push(() => { try { resolve(run()); } catch (e) { reject(e); } })
        );
      }
      return run();
    } as any;
    return descriptor;
  };
}

// ─── memoize ────────────────────────────────────────────────────────────────────
// Cache results by JSON-stringified arguments.

export function memoize(): MethodDecorator {
  const caches = new WeakMap<object, Map<string, { input: string; result: unknown }>>();
  return (_target, key, descriptor) => {
    const orig = descriptor.value as Function;
    descriptor.value = function (...args: unknown[]) {
      let per = caches.get(this);
      if (!per) { per = new Map(); caches.set(this, per); }
      const sig = JSON.stringify(args);
      const cached = per.get(String(key));
      if (cached && cached.input === sig) return cached.result;
      const r = orig.apply(this, args);
      per.set(String(key), { input: sig, result: r });
      return r;
    } as any;
    return descriptor;
  };
}

// ─── logExecutionTime ──────────────────────────────────────────────────────────
// Reports the execution time through the injectable diagnostic sink. The sink
// is silent by default (see `setDecoratorLogSink`), so applying this
// decorator to a production method does not print on every call.

export function logExecutionTime(label?: string): MethodDecorator {
  return (_target, key, descriptor) => {
    const orig = descriptor.value as Function;
    descriptor.value = function (...args: unknown[]) {
      const name = label || String(key);
      const t0 = Date.now();
      const r = orig.apply(this, args);
      const dt = Date.now() - t0;
      // Async-aware: if return is a Promise, also measure after resolution.
      if (r && typeof (r as any).then === 'function') {
        return (r as Promise<unknown>).then(v => {
          decoratorLogSink?.(`[time] ${name}: ${Date.now() - t0}ms`);
          return v;
        });
      }
      decoratorLogSink?.(`[time] ${name}: ${dt}ms`);
      return r;
    } as any;
    return descriptor;
  };
}

// ─── validateInputs ─────────────────────────────────────────────────────────────
// Map arg-name → validator function. Throws ValidationError if any input fails.
//
// Every entry of the map is checked, even when the caller passed FEWER
// arguments than there are validators. The loop used to be
// `i < names.length && i < args.length`, so the trailing validators were
// silently skipped and an invalid input passed through.

type Validator = (v: unknown) => boolean | string;

export function validateInputs(map: Record<string, Validator>): MethodDecorator {
  return (_target, key, descriptor) => {
    const orig = descriptor.value as Function;
    descriptor.value = function (...args: unknown[]) {
      const names = Object.keys(map);
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (i >= args.length) {
          throw new Error(`Validation failed on arg "${name}" of ${String(key)}: argument is missing`);
        }
        const r = map[name](args[i]);
        if (r !== true) throw new Error(`Validation failed on arg "${name}" of ${String(key)}: ${r}`);
      }
      return orig.apply(this, args);
    } as any;
    return descriptor;
  };
}

// ─── cacheResult ────────────────────────────────────────────────────────────────
// TTL-aware memoize with explicit key extraction.

export function cacheResult(ttlMs: number = 60000, keyFn?: (...args: unknown[]) => string): MethodDecorator {
  const caches = new WeakMap<object, Map<string, { value: unknown; time: number }>>();
  return (_target, key, descriptor) => {
    const orig = descriptor.value as Function;
    descriptor.value = function (...args: unknown[]) {
      let per = caches.get(this);
      if (!per) { per = new Map(); caches.set(this, per); }
      const sig = keyFn ? keyFn(...args) : JSON.stringify(args);
      const cached = per.get(sig);
      if (cached && Date.now() - cached.time < ttlMs) return cached.value;
      const r = orig.apply(this, args);
      per.set(sig, { value: r, time: Date.now() });
      return r;
    } as any;
    return descriptor;
  };
}

// ─── deprecated ────────────────────────────────────────────────────────────────
// Reports the deprecation through the injectable diagnostic sink. The sink is
// silent by default, so the warning has to be switched on explicitly (see
// `setDecoratorLogSink`) — a decorator must not print on every call.

export function deprecated(msg = ''): MethodDecorator {
  return (_target, key, descriptor) => {
    const orig = descriptor.value as Function;
    descriptor.value = function (...args: unknown[]) {
      decoratorLogSink?.(`Deprecated: ${String(key)} ${msg ? '- ' + msg : ''}`);
      return orig.apply(this, args);
    } as any;
    return descriptor;
  };
}

// ─── cache (TTL) ───────────────────────────────────────────────────────────────
export function cache(ttlMs = 60000): MethodDecorator {
  return (_target, _key, descriptor) => {
    const orig = descriptor.value as Function;
    let cached: { value: unknown; time: number } | null = null;
    descriptor.value = function (...args: unknown[]) {
      if (cached && Date.now() - cached.time < ttlMs) return cached.value;
      const result = orig.apply(this, args);
      cached = { value: result, time: Date.now() };
      return result;
    } as any;
    return descriptor;
  };
}
