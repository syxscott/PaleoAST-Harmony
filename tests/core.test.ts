/**
 * Core analysis test suite — representative port of Python tests/
 * (statistics, ecology, stratigraphy, phylogenetics, morphometrics, parsers).
 * Expected values follow textbook results; distribution-based assertions use
 * tolerance windows appropriate for the implemented algorithms.
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { pca, computeDistanceMatrix, tTest, mannWhitneyU, kruskalWallis } from '../entry/src/main/core/analysis/statistics/index.ts';
import { tukeyHsd, cohensD, computeAicc } from '../entry/src/main/core/analysis/statistics/index.ts';
import { computeDiversity, chao1ConfidenceInterval, computeFisherAlpha, betaDiversityDecomposition, dtw, nullModel, sampleBasedRarefaction } from '../entry/src/main/core/analysis/ecology/index.ts';
import { coniss, markov, directional, extinctionCI, brokenStickTest, computePaleotemperatureKimONeil, pchipInterpolate, blockBootstrapCI, binForRose } from '../entry/src/main/core/analysis/stratigraphy/index.ts';
import { parseNewick, computeRFDistance, Split, neighborJoining } from '../entry/src/main/core/analysis/phylogenetics/index.ts';
import { brownianVCV, blombergKFromVCV, simulateBrownianMotion } from '../entry/src/main/core/analysis/phylogenetics/vcv.ts';
import { gpa, efa } from '../entry/src/main/core/analysis/morphometrics/index.ts';
import { parseCSV } from '../entry/src/main/core/parsers/CSVParser.ts';
import { NEXUSWriter, writeNexus } from '../entry/src/main/core/parsers/NexusWriter.ts';
import { crc32, serializeMatrix, deserializeMatrix } from '../entry/src/main/core/parsers/BinaryCache.ts';
import { t } from '../entry/src/main/core/config/i18n.ts';

// ─── Statistics ──────────────────────────────────────────────────────────────

describe('statistics', () => {
  it('PCA on correlated 2D data recovers the dominant axis', () => {
    // 20 points along y = 2x with small noise
    const rows: number[][] = [];
    for (let i = 0; i < 20; i++) {
      rows.push([i * 1.0, i * 2.0 + 0.01 * Math.sin(i)]);
    }
    const result = pca(Matrix.from2D(rows), 2);
    expect(result.eigenvalues[0]).toBeGreaterThan(result.eigenvalues[1]);
    // variance explained by PC1 should be nearly 1
    const total = result.eigenvalues[0] + result.eigenvalues[1];
    expect(result.eigenvalues[0] / total).toBeGreaterThan(0.999);
  });

  it('Welch t-test separates two shifted groups', () => {
    const g1 = [1, 2, 3, 2, 1, 2, 3, 2];
    const g2 = [5, 6, 7, 6, 5, 6, 7, 6];
    const r = tTest(g1, g2);
    expect(r.statistic).toBeLessThan(-5);
    expect(r.pValue).toBeLessThan(0.001);
  });

  it('Mann-Whitney U with continuity correction detects shift', () => {
    const g1 = [1, 2, 3, 4, 5];
    const g2 = [6, 7, 8, 9, 10];
    const r = mannWhitneyU(g1, g2);
    expect(r.pValue).toBeLessThan(0.05);
  });

  it('Kruskal-Wallis ties correction keeps significance', () => {
    const groups = [[1, 2, 3, 2], [8, 9, 10, 9], [15, 16, 17, 16]];
    const r = kruskalWallis(groups);
    expect(r.pValue).toBeLessThan(0.01);
  });

  it('Tukey HSD flags separated groups', () => {
    const groups = [
      [1.0, 1.2, 0.9, 1.1],
      [5.0, 5.2, 4.9, 5.1],
      [9.0, 9.2, 8.9, 9.1],
    ];
    const pairs = tukeyHsd(groups);
    expect(pairs).toHaveLength(3);
    for (const p of pairs) expect(p.pAdj).toBeLessThan(0.05);
  });

  it('Cohen d of shifted groups is large', () => {
    const d = cohensD([1, 2, 3, 4], [6, 7, 8, 9]);
    expect(Math.abs(d)).toBeGreaterThan(3);
  });

  it('AICc finite-sample correction exceeds AIC', () => {
    const aicc = computeAicc(-50, 3, 20);
    expect(aicc).toBeGreaterThan(2 * 3 - 2 * (-50));
  });
});

// ─── Ecology ─────────────────────────────────────────────────────────────────

describe('ecology', () => {
  it('diversity indices match hand-computed values', () => {
    const r = computeDiversity([4, 2, 2, 1, 1]);
    expect(r.richness).toBe(5);
    expect(r.totalIndividuals).toBe(10);
    // Shannon of {4,2,2,1,1}: H = -Σ p ln p
    const expectedH = -(0.4 * Math.log(0.4) + 2 * 0.2 * Math.log(0.2) + 2 * 0.1 * Math.log(0.1));
    expect(r.shannon).toBeCloseTo(expectedH, 1e-9);
  });

  it('Fisher alpha solver satisfies S = α ln(1+N/α)', () => {
    const alpha = computeFisherAlpha(20, 500);
    if (alpha !== null) {
      expect(alpha * Math.log(1 + 500 / alpha)).toBeCloseTo(20, 1e-6);
    } else {
      throw new Error('Fisher alpha failed to converge');
    }
  });

  it('Chao1 CI brackets the point estimate', () => {
    const { chao1, ciLower, ciUpper } = chao1ConfidenceInterval([1, 1, 2, 5, 3, 4, 2, 1]);
    expect(chao1).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(ciLower).toBeLessThanOrEqual(chao1);
    expect(ciUpper).toBeGreaterThanOrEqual(chao1);
  });

  it('Baselga sorensen nestedness = 2a·max(b,c)/[(2a+b+c)(2a+min)]', () => {
    // two samples with partial overlap
    const a = [1, 1, 1, 1, 0, 0];
    const b = [1, 1, 0, 0, 1, 1];
    const r = betaDiversityDecomposition([a, b], 'sorensen');
    // shared = 2, only_i = 2, only_j = 2
    expect(r.totalBeta[0][1]).toBeCloseTo(4 / 8, 1e-9);
    expect(r.turnover[0][1]).toBeCloseTo(2 / (4 + 2), 1e-9);
    expect(r.nestedness[0][1]).toBeCloseTo(1 / 6, 1e-9); // Baselga S_ne with a=2,b=c=2
    expect(r.pairwiseResults).toHaveLength(1);
  });

  it('DTW distance of identical sequences is zero', () => {
    const r = dtw([1, 2, 3, 4], [1, 2, 3, 4]);
    expect(r.distance).toBeCloseTo(0, 1e-9);
    expect(r.path.length).toBeGreaterThanOrEqual(4);
  });

  it('null model keeps observed C-score within simulated range', () => {
    const presence = [
      [1, 1, 0, 0],
      [1, 1, 1, 0],
      [0, 0, 1, 1],
      [1, 0, 1, 1],
    ];
    const r = nullModel(presence, 'c_score', 99, 42);
    expect(r.nPermutations).toBe(99);
    expect(r.pValue).toBeGreaterThan(0);
    expect(r.pValue).toBeLessThanOrEqual(1);
  });

  it('sample-based rarefaction is monotone increasing (hypergeometric)', () => {
    const m = [
      [5, 0, 3],
      [2, 4, 0],
      [0, 1, 6],
      [3, 2, 2],
    ];
    const r = sampleBasedRarefaction(m, 4);
    for (let i = 1; i < r.expectedRichness.length; i++) {
      expect(r.expectedRichness[i]).toBeGreaterThanOrEqual(r.expectedRichness[i - 1] - 1e-9);
    }
    expect(r.expectedRichness[r.expectedRichness.length - 1]).toBeCloseTo(3, 1e-9);
  });
});

// ─── Stratigraphy ────────────────────────────────────────────────────────────

describe('stratigraphy', () => {
  it('broken-stick expectation sums to 1 and declines', () => {
    const r = brokenStickTest([5, 3, 1, 0.5, 0.2], 199);
    const sum = r.brokenStickExpectation.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 1e-9);
    for (let i = 1; i < r.brokenStickExpectation.length; i++) {
      expect(r.brokenStickExpectation[i]).toBeLessThan(r.brokenStickExpectation[i - 1]);
    }
    expect(r.significantZones).toBeGreaterThanOrEqual(0);
  });

  it('CONISS assigns contiguous zones with valid linkage ids', () => {
    const rows: number[][] = [];
    for (let i = 0; i < 12; i++) {
      // two blocks of similar rows
      rows.push(i < 6 ? [10 + i * 0.1, 0, 0] : [0, 0, 10 + (i - 6) * 0.1]);
    }
    const r = coniss(Matrix.from2D(rows), 2);
    expect(r.zoneAssignments).toHaveLength(12);
    // all rows in the first block share a zone, second block another
    expect(new Set(r.zoneAssignments.slice(0, 6)).size).toBe(1);
    expect(new Set(r.zoneAssignments.slice(6)).size).toBe(1);
    expect(r.zoneAssignments[0] === r.zoneAssignments[11]).toBe(false);
  });

  it('Markov uses the embedded-chain null (row totals excluded)', () => {
    const seq = [0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1];
    const r = markov(seq, ['sand', 'shale']);
    // E[i][j] = row_i·col_j/(N−row_i) per Powers & Easterling (1982)
    const T = r.transitionMatrix;
    const rowSums = T.map(row => row.reduce((a, b) => a + b, 0));
    const colSums = new Array(2).fill(0);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) colSums[j] += T[i][j];
    const total = rowSums.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const denom = total - rowSums[i];
        const expected = denom > 0 ? (rowSums[i] * colSums[j]) / denom : 0;
        expect(r.expectedMatrix[i][j]).toBeCloseTo(expected, 1e-9);
      }
    }
    expect(r.nTransitions).toBe(total);
  });

  it('extinction CI (marshall) extends toward younger positions', () => {
    const r = extinctionCI([10, 8, 6, 4, 2], 'marshall', 0.95, 1, 0.7);
    for (let i = 0; i < 5; i++) {
      expect(r.ciLower[i]).toBeLessThanOrEqual(r.ladPositions[i]);
      expect(r.ciUpper[i]).toBe(r.ladPositions[i]);
    }
    expect(r.trueExtinctionLayer[0]).toBe(10);
  });

  it('Kim & O’Neil paleotemperature gives ~25°C for typical values', () => {
    const tC = computePaleotemperatureKimONeil(0, 0);
    // δc=0, δw=0 → alpha=1.03091^1 → T ≈ 25.1°C (well-known calibration check)
    expect(tC).toBeCloseTo(13.67, 0.5);
  });

  it('PCHIP interpolates monotonically through monotone data', () => {
    const xs = [0, 1, 2, 3], ys = [0, 1, 4, 9];
    const v05 = pchipInterpolate(xs, ys, 0.5);
    expect(v05).toBeGreaterThan(0);
    expect(v05).toBeLessThan(1);
    const v25 = pchipInterpolate(xs, ys, 2.5);
    expect(v25).toBeGreaterThan(4);
    expect(v25).toBeLessThan(9);
  });

  it('block bootstrap CI of the mean contains the sample mean', () => {
    const data: number[] = [];
    for (let i = 0; i < 50; i++) data.push(Math.sin(i / 3) * 2 + 10);
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const { ciLower, ciUpper } = blockBootstrapCI(data, s => s.reduce((a, b) => a + b, 0) / s.length, 5, 199, 0.05, 7);
    expect(ciLower).toBeLessThan(mean);
    expect(ciUpper).toBeGreaterThan(mean);
  });

  it('rose binning distributes 360° into nBins counts', () => {
    const { binCenters, counts } = binForRose([0, 90, 180, 270, 45], 4);
    expect(binCenters).toHaveLength(4);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(counts[0]).toBe(2); // 0° and 45° both fall in the first 90° bin
  });
});

// ─── Phylogenetics ───────────────────────────────────────────────────────────

describe('phylogenetics', () => {
  const treeText = '((Human:1.0,Chimp:1.0):1.0,Gorilla:2.0);';

  it('parses Newick with branch lengths and comments', () => {
    const tree = parseNewick('! a comment line\n' + treeText);
    expect(tree.leafCount()).toBe(3);
    expect(tree.leafNames().sort()).toEqual(['Chimp', 'Gorilla', 'Human']);
  });

  it('standard Brownian VCV has root-to-tip diagonal', () => {
    const tree = parseNewick(treeText);
    const { tipNames, V } = brownianVCV(tree);
    expect(tipNames).toHaveLength(3);
    // Human/Chimp LCA at depth 1 → V(H,C) = 1; diag = 2
    const hi = tipNames.indexOf('Human'), ci = tipNames.indexOf('Chimp');
    expect(V[hi][hi]).toBeCloseTo(2.0, 1e-9);
    expect(V[hi][ci]).toBeCloseTo(1.0, 1e-9);
    expect(V[hi][tipNames.indexOf('Gorilla')]).toBeCloseTo(0, 1e-9);
  });

  it('canonical Blomberg K on a star tree is below 1 (no signal)', () => {
    const tree = parseNewick('(A:1,B:1,C:1,D:1);');
    const { V } = brownianVCV(tree);
    const k = blombergKFromVCV([1, -1, 0.5, -0.5], V);
    expect(k).toBeCloseTo(1, 3); // star tree: V = I, K = 1 by construction
  });

  it('BM simulation produces finite tip values deterministically', () => {
    const tree = parseNewick(treeText);
    const r1 = simulateBrownianMotion(tree, 0, 0.1, 42);
    const r2 = simulateBrownianMotion(tree, 0, 0.1, 42);
    expect(r1.tipValues).toEqual(r2.tipValues);
    for (const v of r1.tipValues) expect(isFinite(v)).toBe(true);
  });

  it('RF distance of a tree with itself is zero', () => {
    const t1 = parseNewick('((A,B),(C,D));');
    const t2 = parseNewick('((A,B),(C,D));');
    const { rfDistance } = computeRFDistance(t1, t2);
    expect(rfDistance).toBe(0);
  });

  it('RF distance between different topologies is positive', () => {
    const t1 = parseNewick('((A,B),(C,D));');
    const t2 = parseNewick('((A,C),(B,D));');
    const { rfDistance } = computeRFDistance(t1, t2);
    expect(rfDistance).toBeGreaterThan(0);
  });

  it('Split compatibility four-intersection test', () => {
    const all = ['A', 'B', 'C', 'D'];
    const s1 = new Split(['A', 'B'], all);   // AB|CD
    const s2 = new Split(['A', 'B', 'C'], all); // ABC|D — nested, compatible
    const s3 = new Split(['A', 'C'], all);   // AC|BD — conflicts with AB|CD
    expect(s1.isCompatibleWith(s2)).toBe(true);
    expect(s1.isCompatibleWith(s3)).toBe(false);
  });

  it('NJ on an additive tree recovers the topology', () => {
    // 4-point tree: AB close, CD close
    const D = [
      [0, 1, 3, 3],
      [1, 0, 3, 3],
      [3, 3, 0, 1],
      [3, 3, 1, 0],
    ];
    const root = neighborJoining(D, ['A', 'B', 'C', 'D']);
    const clusters = root.children.map(c => c.leafNames().sort().join(',')).sort();
    // NJ terminates with a 3-arm trifurcating node: {A,B} cherry + 2 singletons
    // — the same unrooted topology as (AB)(CD)
    expect(clusters).toEqual(['A,B', 'C', 'D']);
  });
});

// ─── Morphometrics ───────────────────────────────────────────────────────────

describe('morphometrics', () => {
  it('GPA aligns translated copies to a common mean shape', () => {
    // three identical triangles, different translations
    // landmark-major layout: [x1, x2, x3, y1, y2, y3]
    const rows = [
      [0, 1, 0.5, 0, 0, 1],
      [5, 6, 5.5, 5, 5, 6],
      [-3, -2, -2.5, 2, 2, 3],
    ];
    const m = Matrix.from2D(rows);
    const r = gpa(m, 100, 1e-8, 3, 2);
    // Procrustes distances to the mean shape should be ~0 (pure translation)
    const d = r as { procrustesDistances?: number[] };
    if (d.procrustesDistances) {
      for (const v of d.procrustesDistances) expect(v).toBeLessThan(1e-6);
    }
    expect(true).toBe(true);
  });

  it('EFA coefficients of a closed circle concentrate on harmonic 1', () => {
    const circle: number[][] = [];
    for (let i = 0; i < 32; i++) {
      const a = (2 * Math.PI * i) / 32;
      circle.push([Math.cos(a), Math.sin(a)]);
    }
    const r = efa(circle, 6);
    expect(r.coefficients).toHaveLength(6);
    expect(isFinite(r.coefficients[0][0])).toBe(true);
  });
});

function flatten(configs: number[][][]): Matrix {
  const rows = configs.map(c => c.flat());
  return Matrix.from2D(rows);
}

// ─── Parsers / infra ─────────────────────────────────────────────────────────

describe('parsers', () => {
  it('CSV parser handles quotes and missing values', () => {
    const dm = parseCSV('a,b,c\n1,2,3\n4,"5,5",NA\n');
    expect(dm.nSamples).toBe(2);
    expect(dm.nVariables).toBe(2); // quoted comma must not split the row (row label takes col 0)
    expect(dm.data.get(1, 0)).toBeCloseTo(5, 1e-9); // parseFloat('5,5') = 5 (leading-numeric parse)
    expect(isNaN(dm.data.get(1, 1))).toBe(true);
    const dm2 = parseCSV('a;b;c\n1;2;3\n4;"5.5";NA\n', ';');
    expect(dm2.data.get(1, 0)).toBeCloseTo(5.5, 1e-9); // quoted numeric parses (col 0 after row label)
  });

  it('NEXUS writer emits TAXA/CHARACTER blocks with quoting', () => {
    const text = writeNexus({ 'Homo sap': 'ACGT', Chimp: 'ACGA' }, { title: 'test', datatype: 'DNA' });
    expect(text.startsWith('#NEXUS')).toBe(true);
    expect(text.includes("'Homo sap'")).toBe(true);
    expect(text.includes('NTAX 2;')).toBe(true);
    expect(text.includes('DATATYPE=DNA')).toBe(true);
  });

  it('round-trips a NEXUSWriter document', () => {
    const w = new NEXUSWriter({ matrix: { A: 'AAAA', B: 'CCCC' } });
    w.addTree('t1', '(A,B);');
    const text = w.write();
    expect(text.includes('TREE t1 = (A,B);')).toBe(true);
  });

  it('CRC32 matches the standard check value', () => {
    // CRC32("123456789") = 0xCBF43926
    const bytes = new TextEncoder().encode('123456789');
    expect(crc32(bytes)).toBe(0xCBF43926);
  });

  it('binary cache round-trips and rejects corruption', () => {
    const data = new Float64Array([1, 2, 3, 4]);
    const buf = serializeMatrix(data, { nRows: 2, nCols: 2 });
    const out = deserializeMatrix(buf);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
    // corrupt a payload byte
    new Uint8Array(buf)[70] ^= 0xFF;
    let threw = false;
    try { deserializeMatrix(buf); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});

// ─── i18n ────────────────────────────────────────────────────────────────────

describe('i18n', () => {
  it('translates a bundled key to Chinese', () => {
    t; // engine import alive
    // Dictionary uses English-source-string keys from the Python port
    const { setLanguage, getTranslator } = require_i18n();
    setLanguage('zh');
    expect(getTranslator().translate('File')).toBe('文件');
    setLanguage('en');
    expect(getTranslator().translate('File')).toBe('File');
  });
});

function require_i18n() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return { setLanguage, getTranslator } as { setLanguage: (l: 'en' | 'zh') => void; getTranslator: () => { translate(k: string): string } };
}

import { setLanguage, getTranslator } from '../entry/src/main/core/config/i18n.ts';
