/**
 * Utility decorators — replaces utils/decorators.py.
 */

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
// Logs execution time via console.time when supported.

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
          console.log(`[time] ${name}: ${Date.now() - t0}ms`);
          return v;
        });
      }
      console.log(`[time] ${name}: ${dt}ms`);
      return r;
    } as any;
    return descriptor;
  };
}

// ─── validateInputs ─────────────────────────────────────────────────────────────
// Map arg-name → validator function. Throws ValidationError if any input fails.

type Validator = (v: unknown) => boolean | string;

export function validateInputs(map: Record<string, Validator>): MethodDecorator {
  return (_target, key, descriptor) => {
    const orig = descriptor.value as Function;
    descriptor.value = function (...args: unknown[]) {
      const names = Object.keys(map);
      for (let i = 0; i < names.length && i < args.length; i++) {
        const r = map[names[i]](args[i]);
        if (r !== true) throw new Error(`Validation failed on arg "${names[i]}" of ${String(key)}: ${r}`);
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
export function deprecated(msg = ''): MethodDecorator {
  return (_target, key, descriptor) => {
    const orig = descriptor.value as Function;
    descriptor.value = function (...args: unknown[]) {
      console.warn(`Deprecated: ${String(key)} ${msg ? '- ' + msg : ''}`);
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
