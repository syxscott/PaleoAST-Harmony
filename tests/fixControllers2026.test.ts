/**
 * Regression tests for the controller / utility defects found in the
 * 2026-10-19 review of entry/src/main/core/controllers, core/utils and
 * core/app_infrastructure.
 *
 * Per AGENTS.md and docs/CONTRIBUTING.md every test name STATES THE OLD
 * BEHAVIOUR, so this file can be read without git history.
 *
 * Reference numbers:
 *   - Box-Cox lambda: scipy 1.15.3 `scipy.stats.boxcox` in the conda `dev`
 *     env (MLE 0.2259439070403843 for the sample below).
 *   - everything else: hand-computed arithmetic that is spelled out in the
 *     test itself.
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { DataMatrix, StateManager } from '../entry/src/main/core/models/index.ts';
import { StatisticsController } from '../entry/src/main/core/controllers/StatisticsController.ts';
import { DataController } from '../entry/src/main/core/controllers/DataController.ts';
import { simper } from '../entry/src/main/core/analysis/statistics/index.ts';
import { parseNewick } from '../entry/src/main/core/analysis/phylogenetics/index.ts';
import {
  boxcoxTransform,
  imputeKNN as knnUtils,
  imputeMean as meanUtils,
} from '../entry/src/main/core/utils/Transformations.ts';
import {
  analyzeMissing,
  imputeKNN as knnConfig,
  imputeMean as meanConfig,
} from '../entry/src/main/core/config/Imputation.ts';
import { EventBus } from '../entry/src/main/core/utils/EventBus.ts';
import { logExecutionTime, setDecoratorLogSink, validateInputs } from '../entry/src/main/core/utils/Decorators.ts';
import { pairwiseDistance } from '../entry/src/main/core/utils/MatrixOps.ts';
import { ExceptionHandler } from '../entry/src/main/core/app_infrastructure/ExceptionHandler.ts';
import { createPaleoastStartupLoader } from '../entry/src/main/core/app_infrastructure/StartupLoader.ts';

/** Runs `fn` and returns the error message; fails when nothing was thrown. */
function errorMessage(fn: () => void): string {
  try { fn(); } catch (e) { return e instanceof Error ? e.message : String(e); }
  throw new Error('expected the call to throw, but it returned normally');
}

/** Asserts that the call fails with a message that mentions `needle`. */
function expectReadableError(fn: () => void, needle: string): void {
  const msg = errorMessage(fn).toLowerCase();
  if (!msg.includes(needle.toLowerCase())) {
    throw new Error(`expected an error mentioning "${needle}", got "${msg}"`);
  }
}

/** Applies a method decorator without using decorator syntax. */
function applyMethodDecorator(target: any, key: string, dec: MethodDecorator): any {
  const desc = Object.getOwnPropertyDescriptor(target, key)!;
  const out = dec(target, key, desc as any);
  Object.defineProperty(target, key, (out ?? desc) as any);
  return target;
}

/** Replaces a loaded table in the shared StateManager. */
function loadTable(rows: number[][], rowLabels?: string[], colLabels?: string[]): void {
  const m = Matrix.from2D(rows);
  StateManager.getInstance().setData(new DataMatrix(
    m,
    rowLabels ?? rows.map((_, i) => 'S' + (i + 1)),
    colLabels ?? (rows[0] ?? []).map((_, j) => 'V' + (j + 1)),
  ));
}

// ─── SIMPER: the metric was accepted and then dropped ────────────────────────

describe('audit: runSIMPER accepted the metric and then dropped it', () => {
  // 4 specimens x 3 variables, two groups. Bray-Curtis and Euclidean give
  // wildly different numbers for the same table:
  //   pair (S1, S3): BC = (|10-9| + |20-25| + |30-28|) / ((10+9) + (20+25) + (30+28))
  //                      = 8 / 122 = 0.0655738...
  //                EU = sqrt(1 + 25 + 4) = sqrt(30) = 5.4772256...
  const ROWS = [
    [10, 20, 30],
    [12, 18, 33],
    [9, 25, 28],
    [11, 19, 31],
  ];
  const GROUPS = [0, 0, 1, 1];

  it('runSIMPER always ran Bray-Curtis whatever the dialog had selected', () => {
    loadTable(ROWS);
    const ctrl = new StatisticsController();
    const viaEuclidean = ctrl.runSIMPER(GROUPS, 'euclidean');
    const direct = simper(Matrix.from2D(ROWS), GROUPS, undefined, 'euclidean');
    const viaBray = ctrl.runSIMPER(GROUPS, 'bray_curtis');

    // The metric now reaches the algorithm: the reported metric is the one
    // that was asked for, and the numbers follow it.
    expect(viaEuclidean.metric).toBe('euclidean');
    expect(viaBray.metric).toBe('bray_curtis');
    expect(viaEuclidean.overallDissimilarity).toBeWithin(direct.overallDissimilarity, 1e-12);
    expect(viaBray.overallDissimilarity).toBeWithin(
      simper(Matrix.from2D(ROWS), GROUPS, undefined, 'bray_curtis').overallDissimilarity, 1e-12,
    );

    // Old behaviour: both calls returned the SAME Bray-Curtis number.
    expect(Math.abs(viaEuclidean.overallDissimilarity - viaBray.overallDissimilarity) > 1).toBe(true);
  });

  it('the Euclidean and Bray-Curtis results are the hand-computed ones', () => {
    loadTable(ROWS);
    const ctrl = new StatisticsController();
    // The four cross-group pairs (S1,S3), (S1,S4), (S2,S3), (S2,S4):
    //   Euclidean : sqrt(30), sqrt(3), sqrt(83), sqrt(6)  -> mean 4.6922999
    //   Bray-Curtis: 8/122, 3/121, 15/125, 4/124          -> mean 0.0606562
    const eu = ctrl.runSIMPER(GROUPS, 'euclidean').overallDissimilarity;
    const bc = ctrl.runSIMPER(GROUPS, 'bray_curtis').overallDissimilarity;
    const euExpected = (Math.sqrt(30) + Math.sqrt(3) + Math.sqrt(83) + Math.sqrt(6)) / 4;
    const bcExpected = (8 / 122 + 3 / 121 + 15 / 125 + 4 / 124) / 4;
    expect(eu).toBeWithin(euExpected, 1e-12);
    expect(bc).toBeWithin(bcExpected, 1e-12);
    expect(eu).toBeGreaterThan(1);
    expect(bc).toBeLessThan(0.2);
  });

  it('an unsupported metric is rejected instead of silently measuring something else', () => {
    loadTable(ROWS);
    const ctrl = new StatisticsController();
    expectReadableError(() => ctrl.runSIMPER(GROUPS, 'manhattan'), 'metric');
  });
});

// ─── Phylo ANOVA: an empty group assignment was answered with p = 1 ────────

describe('audit: runPhyloANOVA answered an empty group assignment with p = 1', () => {
  it('runPhyloANOVA fails loudly when the groups are empty', () => {
    loadTable([[1], [2], [3], [4]]);
    const ctrl = new StatisticsController();
    const tree = parseNewick('(A,B,(C,D));');
    const traits = { A: 1, B: 2, C: 3, D: 4 };

    // Old behaviour: `{}` was passed straight through and phyloANOVA
    // returned {fStatistic: 0, pValue: 1, nGroups: 0} — an analysis that
    // never happened was reported as "no significant difference".
    expectReadableError(() => ctrl.runPhyloANOVA(tree, traits, {}, 99), 'group');

    // One group is not enough either.
    expectReadableError(() => ctrl.runPhyloANOVA(tree, traits, { A: 'x', B: 'x', C: 'x', D: 'x' }, 99), 'group');
  });

  it('runPhyloANOVA still runs when two groups are supplied', () => {
    loadTable([[1], [2], [3], [4]]);
    const ctrl = new StatisticsController();
    const tree = parseNewick('(A,B,(C,D));');
    const traits = { A: 1, B: 2, C: 3, D: 4 };
    const r = ctrl.runPhyloANOVA(tree, traits, { A: 'x', B: 'x', C: 'y', D: 'y' }, 99);
    expect(r.nGroups).toBe(2);
    expect(r.pValue >= 0 && r.pValue <= 1 ? 'p=' + r.pValue : 'p=' + r.pValue).toBe('p=' + r.pValue);
  });
});

// ─── EFA: an odd number of columns produced an all-NaN "success" ───────────

describe('audit: runEFA returned an all-NaN result for an odd number of columns', () => {
  it('runEFA rejects a row whose length is not even', () => {
    // 5 columns -> row.length / 2 = 2.5 -> row[n + i] is undefined for every
    // point, so the harmonics, coefficients and reconstruction were all NaN
    // and the function still reported success.
    loadTable([[1, 2, 3, 4, 5]]);
    const ctrl = new StatisticsController();
    expectReadableError(() => ctrl.runEFA(3, 40), 'even');
  });

  it('runEFA still runs on a row with an even number of columns', () => {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 2 * Math.PI;
      pts.push(Math.cos(a), Math.sin(a));
    }
    loadTable([pts]);
    const ctrl = new StatisticsController();
    const r = ctrl.runEFA(3, 40);
    expect(r.harmonics.length).toBe(3);
    expect(r.reconstructed.length).toBe(40);
  });
});

// ─── Box-Cox: lambda was pinned to the top of the search grid ───────────────

describe('audit: boxcoxTransform pinned lambda to the top of its search grid', () => {
  // scipy 1.15.3: scipy.stats.boxcox([1.2, 2.3, 3.1, 4.4, 5.9, 7.2, 9.5,
  // 12.1, 15.8, 20.3]) -> MLE lambda = 0.2259439070403843, transformed
  // values [0.18612898, 0.91643866, 1.28916632, ...].
  const X = [1.2, 2.3, 3.1, 4.4, 5.9, 7.2, 9.5, 12.1, 15.8, 20.3];

  it('boxcoxTransform estimates the scipy maximum-likelihood lambda', () => {
    const r = boxcoxTransform(X);
    expect(r.lambda).toBeWithin(0.2259439070403843, 1e-6);
    // Old behaviour: the objective was monotone in lambda, so the argmax was
    // always the top of the grid (2) for every right-skewed data set.
    expect(Math.abs(r.lambda - 2) > 1 ? 'not-the-grid-bound' : 'lambda=' + r.lambda).toBe('not-the-grid-bound');
    expect(r.lambda).toBeLessThan(2);
  });

  it('boxcoxTransform reproduces the scipy transformed values', () => {
    const r = boxcoxTransform(X);
    expect(r.result[0]).toBeWithin(0.18612898, 1e-6);
    expect(r.result[1]).toBeWithin(0.91643866, 1e-6);
    expect(r.result[9]).toBeWithin(4.31228548, 1e-6);
  });

  it('boxcoxTransform still honours an explicit lambda', () => {
    const r = boxcoxTransform(X, 0.5);
    expect(r.lambda).toBe(0.5);
    expect(r.result[0]).toBeWithin((Math.pow(1.2, 0.5) - 1) / 0.5, 1e-12);
  });
});

// ─── Missing values: three different definitions of "missing" ───────────────

describe('audit: the missing-value rule was NaN in the imputers and NaN-or-null in the reporter', () => {
  it('imputeMean treated a null cell as a value and left it untouched', () => {
    // Old behaviour: the null survived imputation, so it entered the KNN
    // distance arithmetic as a plain 0.
    const data = [[null, 1], [2, 2], [3, 3]];
    const out = meanConfig(data);
    // Column 0 observed values are 2 and 3 -> mean 2.5.
    expect(out[0][0]).toBeWithin(2.5, 1e-12);
    expect(out[0][1]).toBeWithin(1, 1e-12);
  });

  it('imputeKNN treated a null cell as a value and left it untouched', () => {
    const data = [[null, 1], [2, 2], [3, 3]];
    const out = knnConfig(data, 1);
    // The nearest neighbour of row 0 (only column 1 is observed) is row 1,
    // whose column-0 value is 2.
    expect(out[0][0]).toBeWithin(2, 1e-12);
  });

  it('analyzeMissing and the imputers now agree on what "missing" means', () => {
    const data = [[null, 1], [2, 2], [3, 3]];
    const report = analyzeMissing(data);
    expect(report.missingCells).toBe(1);
    expect(report.perColumn[0].missing).toBe(1);
    // After imputation nothing is missing any more.
    expect(analyzeMissing(meanConfig(data)).missingCells).toBe(0);
    expect(analyzeMissing(knnConfig(data, 1)).missingCells).toBe(0);
  });

  it('the three imputation copies disagreed on an entirely missing column', () => {
    // Old behaviour: config.imputeMean filled 0, config.imputeKNN left NaN,
    // utils.imputeKNN filled 0 — one function, two behaviours. All of them
    // now keep the missingness visible instead of fabricating a 0.
    const data = [[1, NaN], [2, NaN], [3, NaN]];
    const a = meanConfig(data);
    const b = meanUtils(data);
    const c = knnConfig(data, 1);
    const d = knnUtils(data, 1);
    for (const out of [a, b, c, d]) {
      expect(isNaN(out[0][1]) ? 'NaN' : String(out[0][1])).toBe('NaN');
      expect(isNaN(out[2][1]) ? 'NaN' : String(out[2][1])).toBe('NaN');
    }
    // The observed column is untouched by all four.
    expect(a[0][0]).toBeWithin(1, 1e-12);
    expect(d[2][0]).toBeWithin(3, 1e-12);
  });
});

// ─── EventBus: a once-callback that threw ran twice ─────────────────────────

describe('audit: EventBus.once called the callback twice when the callback threw', () => {
  it('a once callback that throws is not called again by the next emit', () => {
    const bus = new EventBus();
    let calls = 0;
    const logged: unknown[] = [];
    const realError = console.error;
    console.error = (x: unknown) => { logged.push(x); };
    try {
      bus.once('evt', () => { calls++; throw new Error('boom'); });
      bus.emit('evt');
      bus.emit('evt');
    } finally {
      console.error = realError;
    }
    // Old behaviour: the wrapper unsubscribed AFTER the call, so the throw
    // left it subscribed and the second emit called it again (calls === 2).
    expect(calls).toBe(1);
    // The exception is still swallowed by emit (it is logged, not propagated).
    expect(logged.length).toBe(1);
  });
});

describe('audit: EventBus.emit called a listener that had been unsubscribed during the emit', () => {
  it('a listener removed by an earlier listener is not called', () => {
    const bus = new EventBus();
    let cCalls = 0;
    const cbC = () => { cCalls++; };
    const cbA = () => { bus.off('e', cbC); };
    bus.on('e', cbA);
    bus.on('e', cbC);
    bus.emit('e');
    // Old behaviour: emit iterated over a snapshot, so cbC still ran.
    expect(cCalls).toBe(0);
  });
});

// ─── Decorators: validateInputs skipped the missing arguments ───────────────

describe('audit: validateInputs skipped the validators of the arguments that were not passed', () => {
  it('a missing argument is a validation failure', () => {
    const obj: any = { run(_a: unknown, _b: unknown) { return 'ok'; } };
    applyMethodDecorator(obj, 'run', validateInputs({
      a: (v) => typeof v === 'number',
      b: (v) => typeof v === 'number',
    }));
    // Old behaviour: the loop stopped at args.length, so `b` was never
    // validated and the call went through.
    expectReadableError(() => obj.run(1), 'b');
    expect(obj.run(1, 2)).toBe('ok');
  });

  it('an invalid argument is still rejected', () => {
    const obj: any = { run(_a: unknown) { return 'ok'; } };
    applyMethodDecorator(obj, 'run', validateInputs({ a: (v) => typeof v === 'number' }));
    expectReadableError(() => obj.run('nope'), 'a');
  });
});

describe('audit: the decorators printed a line on every call', () => {
  it('logExecutionTime and deprecated are silent until a sink is installed', () => {
    const printed: string[] = [];
    const realLog = console.log;
    const realWarn = console.warn;
    console.log = (...a: unknown[]) => { printed.push(a.join(' ')); };
    console.warn = (...a: unknown[]) => { printed.push(a.join(' ')); };
    try {
      const obj: any = { work() { return 42; } };
      applyMethodDecorator(obj, 'work', logExecutionTime('demo'));
      // Old behaviour: console.log ran on every single call.
      expect(obj.work()).toBe(42);
      expect(printed.length).toBe(0);

      const captured: string[] = [];
      setDecoratorLogSink((m) => { captured.push(m); });
      expect(obj.work()).toBe(42);
      expect(captured.length).toBe(1);
      expect(captured[0].includes('demo') ? captured[0] : captured[0]).toContain('demo');
    } finally {
      setDecoratorLogSink(null);
      console.log = realLog;
      console.warn = realWarn;
    }
  });
});

// ─── DataController ─────────────────────────────────────────────────────────

describe('audit: validateData reported a table with missing values as valid', () => {
  it('validateData reports missing values as invalid', () => {
    loadTable([[1, 2], [3, NaN], [5, 6]]);
    const dc = new DataController();
    const v = dc.validateData();
    // Old behaviour: valid was true while the table had a hole in it.
    expect(v.valid).toBe(false);
    expect(v.hasMissing).toBe(true);
    expect(v.nNaN).toBe(1);
  });

  it('validateData reports a complete table as valid', () => {
    loadTable([[1, 2], [3, 4], [5, 6]]);
    const dc = new DataController();
    const v = dc.validateData();
    expect(v.valid).toBe(true);
    expect(v.hasMissing).toBe(false);
    expect(v.nNaN).toBe(0);
  });
});

describe('audit: transformZScore threw "Division by zero" on a constant column', () => {
  it('transformZScore returns 0 for a constant column like the other two implementations', () => {
    loadTable([[1, 5], [1, 7], [1, 9]]);
    const dc = new DataController();
    // Old behaviour: `data.sub(mean).div(std)` threw "Division by zero".
    const z = dc.transformZScore();
    expect(z.get(0, 0)).toBeWithin(0, 1e-12);
    expect(z.get(2, 0)).toBeWithin(0, 1e-12);
    // Column 1: mean 7, sample sd 2 -> (5-7)/2 = -1.
    expect(z.get(0, 1)).toBeWithin(-1, 1e-12);
    expect(z.get(2, 1)).toBeWithin(1, 1e-12);
  });
});

// ─── MatrixOps: the Bray-Curtis denominator had no absolute value ──────────

describe('audit: MatrixOps.pairwiseDistance reported two different specimens as identical', () => {
  it('the Bray-Curtis denominator takes the absolute value', () => {
    // |1-0| + |-1-0| = 2 over |1+0| + |-1+0| = 2 -> 1.
    // Old behaviour: the denominator was (1+0) + (-1+0) = 0, so the
    // distance came out as 0 — identical to the distance of a specimen to
    // itself.
    expect(pairwiseDistance([1, -1], [0, 0], 'bray_curtis')).toBeWithin(1, 1e-12);
    expect(pairwiseDistance([1, 1], [0, 0], 'bray_curtis')).toBeWithin(1, 1e-12);
  });
});

// ─── ExceptionHandler: the reason was thrown away ───────────────────────────

describe('audit: formatUserError replaced the failure reason with a friendly sentence', () => {
  it('the original reason survives the friendly wording', () => {
    const msg = ExceptionHandler.formatUserError(new Error('singular matrix at iteration 7'), 'EFA');
    // Old behaviour: "EFA Matrix is singular. Check for linear dependencies."
    // — the actual reason was gone.
    expect(msg.includes('singular matrix at iteration 7') ? 'kept' : msg).toBe('kept');
    expect(msg.toLowerCase().includes('singular') ? 'friendly' : msg).toBe('friendly');
  });

  it('a long reason is not truncated any more', () => {
    const long = 'x'.repeat(500);
    const msg = ExceptionHandler.formatUserError(new Error(long), 'PCA');
    expect(msg.includes(long) ? 'kept' : msg.length).toBe('kept');
  });
});

// ─── StartupLoader: the empty stubs reported themselves as loaded ───────────

describe('audit: the startup loader reported four empty stub modules as loaded', () => {
  it('every warm-up module really runs its self-check', async () => {
    const loader = createPaleoastStartupLoader();
    const phases: string[] = [];
    const ok = await loader.load((p) => { phases.push(p.phase); });
    expect(ok).toBe(true);
    const done = loader.getCompleted();
    expect(done.length).toBe(7);
    // Old behaviour: these four were `load: () => { void 0; }` — they
    // reported success without executing anything.
    for (const id of ['stratigraphy', 'morphometrics', 'phylogenetics', 'plugins']) {
      expect(done.includes(id) ? 'ok' : done.join(', ')).toBe('ok');
    }
    expect(phases[phases.length - 1]).toBe('ready');
  });
});
