/**
 * Minimal zero-dependency test runner (replaces pytest for the ArkTS port).
 * Run: node --experimental-transform-types tests/run.ts
 */

let passed = 0;
let failed = 0;
const failures: { name: string; error: string }[] = [];
let currentSuite = '';

export function describe(name: string, fn: () => void): void {
  currentSuite = name;
  fn();
}

export function it(name: string, fn: () => void | Promise<void>): void {
  // Synchronous execution only in this runner; async suites are awaited by run()
  (currentTests.push({ suite: currentSuite, name, fn }));
}

interface Test { suite: string; name: string; fn: () => void | Promise<void> }
const currentTests: Test[] = [];

export function expect(actual: unknown): Assertion {
  return new Assertion(actual);
}

export class Assertion {
  constructor(private actual: unknown) {}

  toBe(expected: unknown): void {
    if (this.actual !== expected) throw new Error(`expected ${expected}, got ${this.actual}`);
  }
  toEqual(expected: unknown): void {
    const a = JSON.stringify(this.actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`expected ${b}, got ${a}`);
  }
  toBeCloseTo(expected: number, delta: number = 1e-6): void {
    const a = this.actual as number;
    if (typeof a !== 'number' || !isFinite(a) || Math.abs(a - expected) > delta) {
      throw new Error(`expected ≈ ${expected} (±${delta}), got ${this.actual}`);
    }
  }
  toBeGreaterThan(expected: number): void {
    if (!((this.actual as number) > expected)) throw new Error(`expected > ${expected}, got ${this.actual}`);
  }
  toBeGreaterThanOrEqual(expected: number): void {
    if (!((this.actual as number) >= expected)) throw new Error(`expected >= ${expected}, got ${this.actual}`);
  }
  toBeLessThan(expected: number): void {
    if (!((this.actual as number) < expected)) throw new Error(`expected < ${expected}, got ${this.actual}`);
  }
  toBeLessThanOrEqual(expected: number): void {
    if (!((this.actual as number) <= expected)) throw new Error(`expected <= ${expected}, got ${this.actual}`);
  }
  toBeNull(): void {
    if (this.actual !== null) throw new Error(`expected null, got ${this.actual}`);
  }
  toBeUndefined(): void {
    if (this.actual !== undefined) throw new Error(`expected undefined, got ${this.actual}`);
  }
  toHaveLength(len: number): void {
    const a = this.actual as { length?: number };
    if (a?.length !== len) throw new Error(`expected length ${len}, got ${a?.length}`);
  }
  toThrow(): void {
    const fn = this.actual as () => void;
    try { fn(); } catch { return; }
    throw new Error('expected function to throw');
  }
}

export async function runAll(): Promise<boolean> {
  for (const t of currentTests) {
    const full = `${t.suite} › ${t.name}`;
    try {
      await t.fn();
      passed++;
      console.log(`  PASS ${full}`);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ name: full, error: msg });
      console.log(`  FAIL ${full}: ${msg}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${currentTests.length} total`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  }
  return failed === 0;
}
