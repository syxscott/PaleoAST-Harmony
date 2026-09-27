/**
 * Test entry point: registers suites then executes.
 * Run: node --experimental-transform-types tests/run.ts
 */
import { runAll } from './runner.ts';

// Import test suites (side-effect: registers describe/it callbacks)
import './core.test.ts';
import './audit2026.test.ts';
import './morpho3d2026.test.ts';
import './distmetrics2026.test.ts';
import './parsers2026.test.ts';
import './statistics2026.test.ts';

const ok = await runAll();
process.exit(ok ? 0 : 1);
