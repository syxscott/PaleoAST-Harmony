/**
 * Test entry point: registers suites then executes.
 * Run: node --experimental-transform-types tests/run.ts
 */
import { runAll } from './runner.ts';

// Import test suites (side-effect: registers describe/it callbacks)
import './core.test.ts';

const ok = await runAll();
process.exit(ok ? 0 : 1);
