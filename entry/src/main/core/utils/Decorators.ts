export function deprecated(msg = ''): MethodDecorator {
  return (_target, _key, descriptor) => {
    const orig = descriptor.value as Function;
    descriptor.value = function (...args: unknown[]) {
      console.warn('Deprecated: ' + String(_key) + (msg ? ' - ' + msg : ''));
      return orig.apply(this, args);
    } as any;
    return descriptor;
  };
}

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
