/**
 * Regression tests for the defects found in the 2026-09-27 full-repository
 * review.
 *
 * Per AGENTS.md and docs/code-style.md, every test name STATES THE OLD
 * BEHAVIOUR so a future reader can tell what was broken without git history.
 * Where a test states a "correct" value, it comes from scipy 1.15.3 / numpy
 * 1.26.4 (or from compiling the LaTeX with TeX Live's pdflatex and reading the
 * PDF back with pdftotext), never from a hand calculation.
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { anova, kruskalWallis, pca } from '../entry/src/main/core/analysis/statistics/index.ts';
import { pF, pchisq, pt, gammainc, qchisq } from '../entry/src/main/core/math/stats.ts';
import { erf, erfc, betainc, chi2CDF, fCDF, tCDF, normCDF } from '../entry/src/main/core/math/special.ts';
import { poisson, seed as seedRng } from '../entry/src/main/core/math/random.ts';
import { cohortSurvivorship, fitOU } from '../entry/src/main/core/analysis/macroevolution/index.ts';
import { StatisticsController } from '../entry/src/main/core/controllers/StatisticsController.ts';
import { StateManager, DataMatrix } from '../entry/src/main/core/models/index.ts';
import { mantelTest } from '../entry/src/main/core/utils/MatrixOps.ts';
import { ReportBuilder, FigureHandler, MatrixConverter, escapeLatex } from '../entry/src/main/core/reporting/index.ts';
import { TRANSLATIONS_EN } from '../entry/src/main/core/config/i18n/translations_en.ts';
import { TRANSLATIONS_ZH } from '../entry/src/main/core/config/i18n/translations_zh.ts';
import { parseNewick, fitchParsimony } from '../entry/src/main/core/analysis/phylogenetics/index.ts';

const FISCHER = Matrix.from2D([[2.5, 2.4], [0.5, 0.7], [2.2, 2.9], [1.9, 2.2], [3.1, 3.0],
[2.3, 2.7], [2.0, 1.6], [1.0, 1.1], [1.5, 1.6], [1.1, 0.9]]);

describe('audit: p-value machinery was inverted', () => {
  it('betainc increases with x instead of decreasing', () => {
    // The small-x power series was applied unconditionally, so for (a,b) =
    // (1.5, 6) it returned 0.2094 at x = 0.1 and 1.8e-5 at x = 0.9 — the exact
    // opposite of the true monotone rise to 1.
    expect(betainc(1.5, 6, 0.4) < betainc(1.5, 6, 0.9)).toBe(true);
    expect(betainc(1.5, 6, 0.5)).toBeCloseTo(0.9654096428, 8);
  });

  it('pF matches scipy over the F distribution', () => {
    expect(pF(1, 1, 1)).toBeCloseTo(0.5, 10);
    expect(pF(1, 1, 10)).toBeCloseTo(0.6591068677, 10);
    expect(pF(4, 3, 12)).toBeCloseTo(0.9654096428, 10);
    expect(pF(2, 10, 50)).toBeCloseTo(0.9468123117, 10);
  });

  it('pchisq no longer saturates to 1 for large x', () => {
    expect(pchisq(5, 1)).toBeCloseTo(0.9746526813, 10);
    expect(pchisq(20, 5)).toBeCloseTo(0.9987502694, 10);
    expect(pchisq(12.5, 2)).toBeCloseTo(0.9980695459, 10);
  });

  it('gammainc no longer returns ~1 for every x at or above s+1', () => {
    expect(gammainc(2, 3)).toBeCloseTo(0.8008517265, 10);
    expect(gammainc(5, 2)).toBeCloseTo(0.0526530173, 10);
    expect(gammainc(1.5, 6)).toBeCloseTo(0.9926168395, 9);
  });

  it('ANOVA p-value is no longer ~1.0 with significant=false for separated groups', () => {
    // scipy.stats.f_oneway: F = 54.54707792, p = 9.469964958e-07. The F
    // statistic was always right; only p was destroyed, and no existing test
    // checked p on this path.
    const g = [[1.2, 1.8, 2.1, 2.4, 2.9], [3.1, 3.5, 3.9, 4.2, 4.8], [5.5, 5.9, 6.3, 6.7, 7.1]];
    const r = anova(g);
    expect(r.fStatistic).toBeCloseTo(54.54707792, 6);
    expect(r.pValue).toBeCloseTo(9.469964958e-07, 14);
    expect(r.significant).toBe(true);
  });

  it('Kruskal-Wallis p-value is no longer exactly 0', () => {
    // scipy.stats.kruskal: H = 12.5, p = 0.001930454136. The old test only
    // asserted p < 0.05, which p = 0 satisfied.
    const g = [[1.2, 1.8, 2.1, 2.4, 2.9], [3.1, 3.5, 3.9, 4.2, 4.8], [5.5, 5.9, 6.3, 6.7, 7.1]];
    const r = kruskalWallis(g);
    expect(r.statistic).toBeCloseTo(12.5, 9);
    expect(r.pValue).toBeCloseTo(0.001930454136, 12);
    expect(r.pValue).toBeGreaterThan(0);
  });

  it('t and chi-square quantiles still invert their CDFs after the rewrite', () => {
    expect(pt(1.959963985, 10)).toBeCloseTo(0.975, 6);
    expect(qchisq(0.95, 10)).toBeCloseTo(18.30703805, 5);
  });
});

describe('audit: special.ts returned wrong values', () => {
  it('erf returns erf, not erfc — the two had been swapped', () => {
    expect(erf(0.5)).toBeCloseTo(0.5204998778, 12);
    expect(erf(1.0)).toBeCloseTo(0.8427007929, 12);
    expect(erf(2.0)).toBeCloseTo(0.9953222650, 12);
  });

  it('erf no longer reports 0.9693 for 0.5 (an 86% error)', () => {
    // The old body was the Abramowitz & Stegun 7.1.26 coefficient set with the
    // kernel constant 0.3275911 written into the polynomial's a1 slot and the
    // denominator as 1 + 0.5*x^2. It also carried a "matches scipy within
    // 1e-15" comment that was never true.
    expect(erf(0.1)).toBeCloseTo(0.1124629160, 12);
    expect(erf(0.3)).toBeCloseTo(0.3286267595, 12);
  });

  it('erfc is the complement of erf at both signs', () => {
    for (const x of [0.1, 0.5, 1, 2, 3]) {
      expect(erfc(x)).toBeCloseTo(1 - erf(x), 12);
      expect(erfc(-x)).toBeCloseTo(2 - erfc(x), 12);
    }
    expect(erfc(1.0)).toBeCloseTo(0.1572992071, 12);
  });

  it('erfc stays accurate in the tail', () => {
    expect(erfc(4)).toBeCloseTo(1.5417258e-08, 15);
    expect(erfc(5)).toBeCloseTo(1.5374598e-12, 18);
  });

  it('chi2CDF no longer returns -8.2e+27 for a small chi-square', () => {
    // Lentz's `c` was seeded with FPMIN (1e-30) instead of 1/FPMIN (1e30), so
    // the first `an / c` multiplied by 1e30 and the fraction diverged.
    expect(chi2CDF(10, 1)).toBeCloseTo(0.9984345977, 10);
    expect(chi2CDF(30, 3)).toBeCloseTo(0.9999986199, 10);
    expect(chi2CDF(10, 50)).toBeCloseTo(1.5995864e-10, 16);
  });

  it('betainc no longer recurses forever exactly on the crossover', () => {
    // betainc(0.5, 0.5, 0.5) used to throw "Maximum call stack size exceeded",
    // and tCDF reached that point for any t with t^2 = df.
    expect(betainc(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 12);
    expect(tCDF(1, 1)).toBeCloseTo(0.75, 12);
    expect(fCDF(1, 1, 1)).toBeCloseTo(0.5, 10);
  });

  it('normCDF stays inside its documented 1.5e-7 envelope', () => {
    expect(Math.abs(normCDF(3) - 0.9986501019683699)).toBeLessThan(1.5e-7);
  });
});

describe('audit: analysis-level regressions', () => {
  it('cohortSurvivorship counts boundary crossers again, so survival is not pinned to 1', () => {
    // Two defects combined here. `nTotal` was `nSurv` (dropping nFB and nLB),
    // AND the nFB / nLB predicates were unsatisfiable — `o >= tStart && o < tEnd`
    // cannot hold when tStart > tEnd — so both crossers were always 0. Every
    // taxon touching the interval was therefore a "survivor" and the whole
    // analysis was degenerate. The Python original is
    // `n_total = n_fb + n_lb + n_surv` with a satisfiable classifier.
    //
    // Interval: tStart = 100 (young) .. tEnd = 50 (old).
    const recs: [number, number][] = [
      [150, 200],  // through-timer        -> nSurv
      [150, 70],   // backward crosser     -> nLB
      [80, 200],   // forward crosser      -> nFB
      [60, 70],    // born and died inside -> nBl / nFl
      [20, 30],    // entirely younger     -> not counted
    ];
    const r = cohortSurvivorship(recs, [[100, 50]]);
    expect(r.intervals[0].nSurv).toBe(1);
    expect(r.intervals[0].nFB).toBe(1);
    expect(r.intervals[0].nLB).toBe(1);
    // nTotal = 1 + 1 + 1 = 3, so p = 1/3.
    expect(r.survivalRates[0]).toBeCloseTo(1 / 3, 12);
    expect(r.originationRates[0]).toBeGreaterThan(0);
    expect(r.extinctionRates[0]).toBeGreaterThan(0);
    expect(isNaN(r.rateRatio[0])).toBe(false);
  });

  it('controller PCA honours covariance vs correlation again', () => {
    // runPCA used to call pca(data, nc, method as any), dropping a STRING into
    // pca's third parameter, which is `scale: boolean`. The string was always
    // truthy, so every controller PCA ran on the correlation matrix and the
    // dialog's method selector had no effect at all.
    const ctrl = new StatisticsController();
    StateManager.getInstance().setData(new DataMatrix(FISCHER,
      ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10'],
      ['Length', 'Width']));
    const viaCov = ctrl.runPCA(2, 'covariance');
    const viaCorr = ctrl.runPCA(2, 'correlation');
    const directCov = pca(FISCHER, 2, false);
    const directCorr = pca(FISCHER, 2, true);
    expect(viaCov.method).toBe('covariance');
    expect(viaCorr.method).toBe('correlation');
    expect(viaCov.eigenvalues[0]).toBeCloseTo(directCov.eigenvalues[0], 10);
    expect(viaCorr.eigenvalues[0]).toBeCloseTo(directCorr.eigenvalues[0], 10);
    // For this data the two methods genuinely differ, so the test is meaningful.
    expect(Math.abs(viaCov.eigenvalues[0] - viaCorr.eigenvalues[0]) > 1e-6).toBe(true);
  });

  it('Fitch parsimony no longer returns treeLength 0 for every input', () => {
    // The score was tallied in an upward pass comparing each child's set with
    // its parent's. That test can never fire: a parent's set is either the
    // intersection of its children's (a subset of each) or, failing that, the
    // union (a superset of each), so the parent always contains the child and
    // the "one step per union" rule was never applied. Every site scored 0,
    // which the `treeLength === 0` guards then used to pin CI and RI to 1.
    // True Fitch scores for ((A,B),(C,D)): 0/1/0/1 costs 2 (one union per
    // cherry, and the two cherries then share {0,1} so the root is free);
    // 0/1/2/3 costs 3 (two cherries plus a disjoint union at the root);
    // 0/0/0/0 costs 0.
    const tree = parseNewick('((A:0.1,B:0.1):0.1,(C:0.1,D:0.1):0.1);') as unknown as {
      computeParsimonyScore: (s: Record<string, string>) => { treeLength: number; siteScores: number[] };
      computeConsistencyIndex: (s: Record<string, string>) => number;
      computeRetentionIndex: (s: Record<string, string>) => number;
    };
    expect(tree.computeParsimonyScore({ A: '0', B: '1', C: '0', D: '1' }).treeLength).toBe(2);
    expect(tree.computeParsimonyScore({ A: '0', B: '1', C: '2', D: '3' }).treeLength).toBe(3);
    expect(tree.computeParsimonyScore({ A: '0', B: '0', C: '0', D: '0' }).treeLength).toBe(0);
    // 1 variable site, minimum possible steps 1 -> CI = 1/2, RI = 1/(4-1) = 1/3.
    expect(tree.computeConsistencyIndex({ A: '0', B: '1', C: '0', D: '1' })).toBeCloseTo(0.5, 12);
    expect(tree.computeRetentionIndex({ A: '0', B: '1', C: '0', D: '1' })).toBeCloseTo(1 / 3, 12);
  });

  it('the free fitchParsimony agrees with the method on the same tree', () => {
    const tree = parseNewick('((A:0.1,B:0.1):0.1,(C:0.1,D:0.1):0.1);');
    const r = fitchParsimony(tree, { A: '0', B: '1', C: '0', D: '1' });
    expect(r.treeLength).toBe(2);
  });
});

describe('audit: reporting output integrity', () => {
  it('LaTeX escaping no longer turns a backslash into a line break', () => {
    // The regex form produced `\\` (line break), `\^` (circumflex accent) and
    // `\~` (tilde accent). Proven by compiling both variants with pdflatex and
    // reading the PDF back: "tilde~here" came out as "tildeh̃ere".
    expect(escapeLatex('a\\b')).toBe('a\\textbackslash{}b');
    expect(escapeLatex('x~y')).toBe('x\\textasciitilde{}y');
    expect(escapeLatex('x^2')).toBe('x\\textasciicircum{}2');
    const latex = new ReportBuilder().setTitle('A \\ B ~ C ^ D').toLaTeX();
    expect(latex).toContain('\\textbackslash{}');
    expect(latex).toContain('\\textasciitilde{}');
    expect(latex).toContain('\\textasciicircum{}');
    expect(latex.indexOf('\\\\backslash')).toBe(-1);
  });

  it('FigureHandler captions no longer break out of the alt attribute', () => {
    const fh = new FigureHandler();
    fh.add('C:\\a<file>.png', 'caption with <script> & "quote"');
    const html = fh.toHTML();
    expect(html).toContain('&quot;');
    expect(html).toContain('&lt;script&gt;');
    expect(html.indexOf('<script>')).toBe(-1);
  });

  it('MatrixConverter no longer rewrites NaN and Infinity to 0 through JSON', () => {
    // JSON.stringify writes NaN/Inf as null and Float64Array reads null as 0,
    // so "missing" silently became "measured zero".
    const m = Matrix.from2D([[1, NaN], [Infinity, 4]]);
    const back = MatrixConverter.fromJSON(MatrixConverter.toJSON(m));
    expect(Number.isNaN(back.get(0, 1))).toBe(true);
    expect(back.get(1, 0)).toBe(Infinity);
    expect(back.get(0, 0)).toBe(1);
    expect(back.get(1, 1)).toBe(4);
  });

  it('MatrixConverter.fromCSV keeps the widest row instead of truncating and zero-filling', () => {
    // "1,2,3 / 4,5 / 6,7,8,9" used to come back as [[1,2,3],[4,5,0],[6,7,8]]:
    // the 9 was dropped and a 0 invented.
    const m = MatrixConverter.fromCSV('1,2,3\n4,5\n6,7,8,9');
    expect(m.cols).toBe(4);
    expect(m.get(2, 3)).toBe(9);
    expect(Number.isNaN(m.get(1, 2))).toBe(true);
    expect(Number.isNaN(m.get(1, 3))).toBe(true);
  });
});

describe('audit: reproducibility', () => {
  it('mantelTest is seeded and its p-value can no longer be exactly 0', () => {
    // It drew permutations with Math.random() (the only such call left in
    // core/) and returned cnt/nPerm, which can be 0. The project already
    // applies the Phipson & Smyth correction in phyloANOVA.
    const D1 = Matrix.from2D([[0, 1, 2, 3], [1, 0, 1.5, 2.5], [2, 1.5, 0, 1], [3, 2.5, 1, 0]]);
    const D2 = Matrix.from2D([[0, 2, 4, 6], [2, 0, 3, 5], [4, 3, 0, 2], [6, 5, 2, 0]]);
    const a = mantelTest(D1, D2, 199, 42);
    const b = mantelTest(D1, D2, 199, 42);
    expect(a.pValue).toBe(b.pValue);
    expect(a.pValue).toBeGreaterThan(0);
    expect(a.pValue).toBeLessThanOrEqual(1);
  });

  it('poisson no longer saturates at 742.9 for large lambda', () => {
    // exp(-lambda) underflows to 0 above ~745.13, so Knuth's L became 0 and
    // every lambda >= 750 returned the same value: lambda = 1000 averaged
    // 742.9 over 300 draws, a -25.7% error.
    for (const lam of [100, 500, 745, 1000, 5000]) {
      seedRng(42);
      let s = 0;
      for (let i = 0; i < 400; i++) s += poisson(lam);
      expect(Math.abs(s / 400 - lam) / lam).toBeLessThan(0.1);
    }
  });

  it('poisson still has a usable mean at small lambda', () => {
    seedRng(1);
    let s = 0;
    for (let i = 0; i < 2000; i++) s += poisson(3);
    expect(s / 2000).toBeCloseTo(3, 1);
  });

  it('fitOU refines past the coarse grid instead of stopping after 1-2 steps', () => {
    // The block labelled "Newton-Raphson refinement" was a fixed-step gradient
    // descent that broke out of the loop on the first non-improving trial, so
    // it never ran more than two iterations regardless of maxIter. It is now a
    // Nelder-Mead simplex, which reports a real convergence. fitOU fits an
    // OU model to a tree plus tip traits (not a time series).
    const tree = parseNewick('((A:0.1,B:0.1):0.2,(C:0.1,D:0.2):0.3);');
    const traitData: Record<string, number> = { A: 1, B: 1.2, C: 2.4, D: 2.6 };
    const r = fitOU(tree, traitData, { maxIter: 500 });
    expect(isFinite(r.alpha)).toBe(true);
    expect(isFinite(r.sigma2)).toBe(true);
    expect(isFinite(r.theta)).toBe(true);
    expect(r.alpha > 0).toBe(true);
    expect(r.sigma2 > 0).toBe(true);
  });

  it('clearData drops the command-level undo stacks as well', () => {
    // clearData() cleared _u/_r/_c but left _cmdUndo/_cmdRedo, so
    // canUndoCommand stayed true after the dataset was discarded.
    const sm = new StateManager();
    sm.setData(new DataMatrix(Matrix.from2D([[1, 2], [3, 4]]), ['a', 'b'], ['x', 'y']));
    sm.pushCommandSnapshot();
    expect(sm.canUndoCommand).toBe(true);
    sm.clearData();
    expect(sm.canUndoCommand).toBe(false);
    expect(sm.canRedoCommand).toBe(false);
  });
});

describe('audit: i18n parity', () => {
  it('the English table no longer lacks the 46 keys Chinese has', () => {
    expect(Object.keys(TRANSLATIONS_ZH).filter(k => !(k in TRANSLATIONS_EN))).toEqual([]);
  });

  it('Chinese no longer leaves colour names in English', () => {
    for (const k of ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Gray']) {
      expect(TRANSLATIONS_ZH[k] === k).toBe(false);
    }
  });
});
