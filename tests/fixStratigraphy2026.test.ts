/**
 * Regression tests for the stratigraphy defects found in the 2026-10-19
 * review of entry/src/main/core/analysis/stratigraphy.
 *
 * Per AGENTS.md and docs/CONTRIBUTING.md every test name STATES THE OLD
 * BEHAVIOUR, so this file can be read without git history.
 *
 * Reference numbers:
 *   - chi-square p-values: scipy 1.15.3 `chi2.sf` in the conda `dev` env.
 *   - everything else: hand-computed arithmetic that is spelled out in the
 *     test itself.
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import {
  coniss, markov, directional, extinctionCI, spectralAnalysis, isotopeAnalysis,
  stratigraphicCorrelation, movingAverage, detectExcursions, filterEndemic,
  buildARMAModel, armaPredict, rasc, unitaryAssociations, buildAgeModel,
  computeSedimentationRate, blockBootstrapCI,
} from '../entry/src/main/core/analysis/stratigraphy/index.ts';

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

/** Deterministic LCG so the random sweeps are reproducible. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

describe('audit: the Markov p-value came out of a diverging continued fraction', () => {
  // χ² and the degrees of freedom are unchanged by the fix; only the
  // survival function was wrong. Reference p-values: scipy 1.15.3 chi2.sf.
  const CASES: { seq: number[]; chi2: number; df: number; p: number }[] = [
    // 20 alternating states: χ² = 19.211, df = 1 → p = 1.17e-05.
    // The old code reported p = -4.92e+23 here.
    { seq: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], chi2: 19.21111111111111, df: 1, p: 1.170302326896851e-05 },
    { seq: [0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1], chi2: 6.2155555555555555, df: 1, p: 0.012663260774581487 },
    { seq: [0, 1, 2, 0, 1, 2, 0, 1, 2], chi2: 12.266666666666667, df: 4, p: 0.015474609422704592 },
    { seq: [0, 0, 0, 1, 1, 1, 2, 2, 2, 0, 1, 2], chi2: 5.8353174603174605, df: 4, p: 0.21178905621910638 },
    { seq: [0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0], chi2: 7.14172335600907, df: 1, p: 0.007531075025800292 },
    { seq: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3], chi2: 35.11363636363636, df: 9, p: 5.6894970898303636e-05 },
    { seq: [1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 2, 2], chi2: 11.721666666666668, df: 4, p: 0.01954561290027754 },
    { seq: [0, 0, 1, 2, 1, 0, 2, 1, 1, 0, 1, 2, 1, 0, 1, 0, 1, 1, 1, 1, 0], chi2: 11.432337122176694, df: 4, p: 0.022111648591009832 },
  ];

  it('markov p-value stays inside [0, 1] instead of exploding to negative or huge values', () => {
    // Old behaviour: 287 of 400 random chains (72%) produced a p-value
    // outside [0, 1] — 139 of them negative.
    for (const c of CASES) {
      const r = markov(c.seq);
      expect(r.pValue >= 0 && r.pValue <= 1 ? `p=${r.pValue}` : `p=${r.pValue} out of range`).toBe(`p=${r.pValue}`);
    }
  });

  it('markov p-value agrees with scipy chi2.sf to twelve significant digits', () => {
    for (const c of CASES) {
      const r = markov(c.seq);
      expect(r.chiSquared).toBeWithin(c.chi2, 1e-12);
      expect(r.df).toBe(c.df);
      expect(r.pValue).toBeWithin(c.p, Math.abs(c.p) * 1e-11);
    }
  });

  it('markov isMarkovian agrees with the scipy verdict instead of contradicting it', () => {
    // Old behaviour: 14% of the chains got the opposite significance
    // verdict (χ² = 11.65, df = 4 → real p = 0.0202 → significant, but the
    // code reported p = 2.96e+27 and called it non-significant).
    for (const c of CASES) {
      const r = markov(c.seq);
      expect(r.isMarkovian).toBe(c.p < 0.05);
    }
  });

  it('markov p-value is inside [0, 1] for 400 random chains', () => {
    const rnd = lcg(20261019);
    let outside = 0;
    for (let t = 0; t < 400; t++) {
      const len = 8 + Math.floor(rnd() * 24);
      const seq: number[] = [];
      for (let i = 0; i < len; i++) seq.push(Math.floor(rnd() * (1 + Math.floor(rnd() * 4))));
      const p = markov(seq).pValue;
      if (!(p >= 0 && p <= 1)) outside++;
    }
    expect(outside).toBe(0);
  });
});

describe('audit: RASC ignored the observed sections', () => {
  const D = [[0, 1, 4, 5], [1, 0, 3, 4], [4, 3, 0, 1], [5, 4, 1, 0]];
  const NAMES = ['e1', 'e2', 'e3', 'e4'];

  it('RASC gives a different ranking for different section data', () => {
    // Old behaviour: `_refQuality` never looked at its `sectionData`
    // argument, so two completely opposite observations produced bit
    // identical rankings and reference sections.
    const secA = [[1, 1, 0, 0], [1, 1, 0, 0]];   // e1 and e2 always together
    const secB = [[0, 0, 1, 1], [0, 0, 1, 1]];   // e3 and e4 always together
    const a = rasc(D, NAMES, 50, secA);
    const b = rasc(D, NAMES, 50, secB);
    expect(JSON.stringify(a.ranking) === JSON.stringify(b.ranking)
      ? `both ${JSON.stringify(a.ranking)}` : 'different').toBe('different');
    expect(JSON.stringify(a.referenceSection) === JSON.stringify(b.referenceSection)
      ? 'same reference section' : 'different reference sections').toBe('different reference sections');
  });

  it('RASC keeps the events that co-occur in a section next to each other', () => {
    const secA = [[1, 1, 0, 0], [1, 1, 0, 0]];
    const secB = [[0, 0, 1, 1], [0, 0, 1, 1]];
    const a = rasc(D, NAMES, 50, secA);
    const b = rasc(D, NAMES, 50, secB);
    expect(Math.abs(a.ranking.indexOf('e1') - a.ranking.indexOf('e2'))).toBe(1);
    expect(Math.abs(b.ranking.indexOf('e3') - b.ranking.indexOf('e4'))).toBe(1);
  });
});

describe('audit: coniss returned a different number of zones than requested', () => {
  it('coniss returns exactly the number of zones that were asked for', () => {
    // Old behaviour: 6 rows with nZones = 2 came back with 3 zones and
    // 7 rows with nZones = 4 came back with 3 zones; 1236 of 2400 random
    // inputs (51.5%) had the wrong zone count.
    const six = [[0.6, 1.9], [1, 1.3], [0.6, 0.5], [0.8, 0.7], [1.2, 1.5], [1.5, 1.2]];
    const r6 = coniss(Matrix.from2D(six), 2);
    expect(r6.nZones).toBe(2);
    expect(new Set(r6.zoneAssignments).size).toBe(2);

    const seven = [[2, 0.2], [0.7, 1.5], [0.4, 1.9], [1.4, 1.3], [0.4, 1.6], [1.7, 1.5], [1.4, 0.2]];
    const r7 = coniss(Matrix.from2D(seven), 4);
    expect(r7.nZones).toBe(4);
    expect(new Set(r7.zoneAssignments).size).toBe(4);
  });

  it('coniss reports the number of zones it actually produced', () => {
    // Old behaviour: nZones = 10 on three samples reported "nZones: 10"
    // while only three zones existed.
    const r = coniss(Matrix.from2D([[1, 0], [2, 0], [10, 10]]), 10);
    expect(r.nZones).toBe(3);
    expect(r.requestedZones).toBe(10);
    expect(new Set(r.zoneAssignments).size).toBe(3);
  });

  it('coniss gives the requested zone count and contiguous zones for 400 random sections', () => {
    const rnd = lcg(4242);
    let wrong = 0, notContiguous = 0;
    for (let t = 0; t < 400; t++) {
      const n = 6 + Math.floor(rnd() * 8);
      const rows: number[][] = [];
      for (let i = 0; i < n; i++) rows.push([rnd() * 4, rnd() * 4, rnd() * 4]);
      const nz = 2 + Math.floor(rnd() * 4);
      const r = coniss(Matrix.from2D(rows), nz);
      if (new Set(r.zoneAssignments).size !== Math.min(nz, n)) wrong++;
      for (let i = 1; i < n; i++) if (r.zoneAssignments[i] < r.zoneAssignments[i - 1]) { notContiguous++; break; }
    }
    expect(wrong).toBe(0);
    expect(notContiguous).toBe(0);
  });
});

describe('audit: the euclidean correlation compared the height grid', () => {
  const S1 = { name: 'S1', heights: [0, 1, 2, 3], values: [1, 2, 3, 4] };
  const S2 = { name: 'S2', heights: [0, 1, 2, 3], values: [4, 3, 2, 1] };

  it('the euclidean method compares the value series, not the sampling grid', () => {
    // Old behaviour: euclidean = 1.0 for two mirror-image sections because
    // it added up (heights[k] - heights[k])² — the heights are identical.
    const euc = stratigraphicCorrelation([S1, S2], 'euclidean').correlationMatrix[0][1];
    expect(euc < 1).toBe(true);
    expect(euc).toBeWithin(0.4721359549995794, 1e-12);
  });

  it('the euclidean similarity points the same way as pearson and spearman', () => {
    const identical = { name: 'S3', heights: [0, 1, 2, 3], values: [1, 2, 3, 4] };
    const same = stratigraphicCorrelation([S1, identical], 'euclidean').correlationMatrix[0][1];
    const mirrored = stratigraphicCorrelation([S1, S2], 'euclidean').correlationMatrix[0][1];
    // Identical values → perfect similarity; mirror images → clearly less.
    expect(same).toBeWithin(1, 1e-12);
    expect(mirrored).toBeLessThan(same);
    // … and pearson/spearman call the same pair perfectly anti-correlated.
    expect(stratigraphicCorrelation([S1, S2], 'pearson').correlationMatrix[0][1]).toBeWithin(-1, 1e-12);
    expect(stratigraphicCorrelation([S1, S2], 'spearman').correlationMatrix[0][1]).toBeWithin(-1, 1e-12);
  });
});

describe('audit: the spline age model extrapolated to negative ages', () => {
  const SECTION = { name: 'S', heights: [0, 10, 20, 30, 40, 50, 100] };
  const CONSTRAINTS: [number, number, number][] = [[0, 100, 1], [10, 95, 1], [20, 80, 1], [30, 70, 1]];

  it('the spline age model does not report negative ages below the deepest constraint', () => {
    // Old behaviour: the cubic Hermite basis was extrapolated, so the last
    // sample came back as -784 Ma (the linear model gave 70 Ma for it).
    const r = buildAgeModel(SECTION, CONSTRAINTS, 'spline');
    expect(r.modeledAges.every(a => a >= 0)).toBe(true);
    expect(r.modeledAges[4]).toBeWithin(60, 1e-9);   // linear extrapolation
    expect(r.modeledAges[5]).toBeWithin(50, 1e-9);
    expect(r.modeledAges[6]).toBeWithin(0, 1e-9);
    // The constrained samples are untouched.
    expect(r.modeledAges[0]).toBeWithin(100, 1e-9);
    expect(r.modeledAges[1]).toBeWithin(95, 1e-9);
    expect(r.modeledAges[2]).toBeWithin(80, 1e-9);
    expect(r.modeledAges[3]).toBeWithin(70, 1e-9);
  });

  it('the age model flags the samples that lie outside the constrained interval', () => {
    const r = buildAgeModel(SECTION, CONSTRAINTS, 'spline');
    expect(r.extrapolated).toEqual([false, false, false, false, true, true, true]);
  });

  it('a duplicated age constraint fails loudly instead of turning the curve into NaN', () => {
    // Old behaviour: the repeated height made the PCHIP secant 0/0 = NaN and
    // the whole age curve became NaN (modeledAges = [NaN, NaN, NaN]).
    expectReadableError(
      () => buildAgeModel({ name: 'S', heights: [0, 10, 20] }, [[0, 100, 1], [10, 90, 1], [10, 90, 1], [20, 80, 1]], 'spline'),
      'duplicate');
  });
});

describe('audit: unitaryAssociations returned matrices that did not match its own event list', () => {
  it('the returned FAD/LAD matrices have the same number of columns as the event list', () => {
    // Old behaviour: the filtered event list had three names next to
    // four-column matrices (the unfiltered input was returned).
    const ua = unitaryAssociations(
      [[1, 2, 3, 4], [1, 2, 3, 4], [1, NaN, 3, 4]],
      [[2, 3, 4, 5], [2, 3, 4, 5], [2, NaN, 4, 5]],
      undefined, ['e1', 'e2', 'e3', 'e4'], 3);
    expect(ua.events).toEqual(['e1', 'e3', 'e4']);
    expect(ua.fadMatrix[0]).toHaveLength(3);
    expect(ua.ladMatrix[0]).toHaveLength(3);
    expect(ua.fadMatrix[0]).toEqual([1, 3, 4]);
    expect(ua.ladMatrix[0]).toEqual([2, 4, 5]);
    // The original column of every retained event stays traceable.
    expect(ua.eventIndexMap).toEqual([0, 2, 3]);
  });
});

describe('audit: armaPredict returned NaN forecasts for p > n', () => {
  it('an AR order larger than the sample size fails loudly instead of returning NaN forecasts', () => {
    // Old behaviour: armaPredict(buildARMAModel([1,2,3], 4, ...), 3) read
    // fitted[-1] and returned NaN for every prediction and interval.
    expectReadableError(() => {
      const model = buildARMAModel([1, 2, 3], 4, 0, 0, true);
      armaPredict(model, 3);
    }, 'observations');
  });

  it('a fitted model still forecasts finite numbers', () => {
    const model = buildARMAModel([1, 2, 3, 4, 5, 6, 7, 8], 1, 0, 0, true);
    const f = armaPredict(model, 3);
    expect(f.predictions.length).toBe(3);
    expect(f.predictions.every(v => isFinite(v))).toBe(true);
    expect(f.lowerCI.every(v => isFinite(v))).toBe(true);
  });
});

describe('audit: blockBootstrapCI reported a one-point "95% interval"', () => {
  const mean = (s: number[]): number => s.reduce((a, b) => a + b, 0) / s.length;
  const DATA = [1, 2, 3, 4, 5, 6, 7, 8];

  it('fewer than two bootstrap resamples fail loudly instead of returning undefined or a zero-width interval', () => {
    // Old behaviour: nBootstrap = 0 returned undefined (the caller crashed
    // on .toFixed()) and nBootstrap = 1 returned {ciLower: 5, ciUpper: 5}.
    expectReadableError(() => blockBootstrapCI(DATA, mean, undefined, 0), 'nBootstrap');
    expectReadableError(() => blockBootstrapCI(DATA, mean, undefined, 1), 'nBootstrap');
  });
});

describe('audit: the Marshall extinction CI collapsed to zero width at a detection probability of 0', () => {
  it('a detection probability of 0 gives an unbounded lower bound', () => {
    // Old behaviour: p = 0 took the p = 1 path (gap = 0) and reported
    // ciLower === ciUpper === [10, 8, 6].
    const r = extinctionCI([10, 8, 6], 'marshall', 0.95, 1, 0);
    expect(r.ciLower[0]).toBeWithin(0, 1e-12);
    expect(r.ciLower[1]).toBeWithin(0, 1e-12);
    expect(r.ciLower[2]).toBeWithin(0, 1e-12);
    expect(r.ciUpper[0]).toBeWithin(10, 1e-12);
    expect(r.ciLower[0] < r.ciUpper[0]).toBe(true);
  });

  it('a detection probability of 1 still gives a zero-width interval', () => {
    const r = extinctionCI([10, 8, 6], 'marshall', 0.95, 1, 1);
    expect(r.ciLower[0]).toBeWithin(10, 1e-12);
    expect(r.ciUpper[0]).toBeWithin(10, 1e-12);
  });
});

describe('audit: the sedimentation-rate smoother was fed the placeholder rate of the first sample', () => {
  it('the smoothed rate is not dragged down at the top of the section', () => {
    // Old behaviour: rates[0] = 0 (a placeholder — there is no interval
    // above the first sample) went into the LOWESS fit, so a constant rate
    // of 5 came back as 1.862 / 3.042 / 4.141 for the first three samples.
    const heights = Array.from({ length: 24 }, (_, i) => i * 5);
    const ages = Array.from({ length: 24 }, (_, i) => 100 - i);
    const r = computeSedimentationRate({ name: 'S', heights, ages }, true);
    expect(r.rates[0]).toBe(0);
    expect(r.rates[1]).toBeWithin(5, 1e-9);
    expect(r.smoothedRates[0]).toBeWithin(5, 1e-9);
    expect(r.smoothedRates[1]).toBeWithin(5, 1e-9);
    expect(r.smoothedRates[2]).toBeWithin(5, 1e-9);
  });
});

describe('audit: detectExcursions counted the merged segments instead of the excursion points', () => {
  it('nExcursions counts the excursion points and nSegments the merged runs', () => {
    // Old behaviour: two outliers in one run reported nExcursions = 1.
    const depths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 10];
    const r = detectExcursions(depths, values, 2, 2);
    expect(r.excursions.length).toBe(2);
    expect(r.nExcursions).toBe(2);
    expect(r.nSegments).toBe(1);
  });
});

describe('audit: filterEndemic was off by one section', () => {
  it('a species found in exactly minOccurrence sections is widespread, not endemic', () => {
    // Old behaviour: `<= minOccurrence` called all three species endemic
    // (endemicCount 3) although one of them occurs in two sections.
    const r = filterEndemic([[1, 1, 0], [0, 1, 0], [0, 0, 1]], 2);
    expect(r.widespread).toEqual([1]);
    expect(r.endemic).toEqual([0, 2]);
    expect(r.endemicCount).toBe(2);
    expect(r.widespreadCount).toBe(1);
  });
});

describe('audit: degenerate inputs produced NaN or undefined instead of an error', () => {
  it('movingAverage with a negative window fails loudly instead of returning NaN', () => {
    // Old behaviour: movingAverage([1,2,3,4], -1) returned [NaN, NaN, NaN, NaN].
    expectReadableError(() => movingAverage([1, 2, 3, 4], -1), 'windowSize');
  });

  it('isotopeAnalysis with mismatched depths and values fails loudly instead of reporting "no trend"', () => {
    // Old behaviour: isotopeAnalysis([1,2], [1,2,3,4]) reported trend = 0.
    expectReadableError(() => isotopeAnalysis([1, 2], [1, 2, 3, 4]), 'same length');
  });

  it('directional with no angles fails loudly instead of returning NaN', () => {
    expectReadableError(() => directional([]), 'no angles');
  });

  it('spectralAnalysis with a single sample fails loudly instead of returning undefined peak fields', () => {
    // Old behaviour: the peak fields were undefined and the caller crashed
    // on result.peakPeriod.toFixed(2).
    expectReadableError(() => spectralAnalysis([1]), 'at least 2 samples');
  });

  it('a Lomb-Scargle periodogram of a constant series fails loudly instead of returning NaN power', () => {
    expectReadableError(() => spectralAnalysis([5, 5, 5, 5], 'lomb-scargle'), 'zero variance');
  });
});
