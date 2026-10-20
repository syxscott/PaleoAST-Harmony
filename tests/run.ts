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
import './morphometrics2026.test.ts';
import './models2026.test.ts';
import './utils2026.test.ts';
import './ets2026.test.ts';
import './etsSyntax.test.ts';
import './etsDispatch.test.ts';
import './etsImports.test.ts';
import './componentCount2026.test.ts';
import './permutationCount2026.test.ts';
import './binaryExport2026.test.ts';
import './brayCurtis2026.test.ts';
import './metricsVsScipy.test.ts';
import './bootstrapNumerics2026.test.ts';
import './automaton2026.test.ts';
import './processPool2026.test.ts';
import './history2026.test.ts';
// 2026-10-19 全仓审查的回归套件：每个文件对应一个被修的缺陷族。
// 断言风格：`toBeCloseTo(expected, numDigits)` 的第二参数是**小数位**（Jest 语义）；
// 需要绝对容差时用 `toBeWithin(expected, absDelta)`。
import './fixMath2026.test.ts';
import './fixMathSpecial2026.test.ts';
import './fixRandom2026.test.ts';
import './fixStatistics2026.test.ts';
import './fixStratigraphy2026.test.ts';
import './fixMacro2026.test.ts';
import './fixEcology2026.test.ts';
import './fixPhylo2026.test.ts';
import './fixMorpho2026.test.ts';
import './fixParsers2026.test.ts';
import './fixReporting2026.test.ts';
import './fixControllers2026.test.ts';
import './fixEts2026.test.ts';

const ok = await runAll();
process.exit(ok ? 0 : 1);
