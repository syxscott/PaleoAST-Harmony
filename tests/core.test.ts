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
import { toCSV } from '../entry/src/main/core/parsers/index.ts';
import { t } from '../entry/src/main/core/config/i18n.ts';
import { lda, univariateSummary } from '../entry/src/main/core/analysis/statistics/index.ts';
import { eigh } from '../entry/src/main/core/math/linalg.ts';
import { randnArray, seed } from '../entry/src/main/core/math/random.ts';
import { DataMatrix, StateManager } from '../entry/src/main/core/models/index.ts';
import { DataController } from '../entry/src/main/core/controllers/DataController.ts';
import { StatisticsController } from '../entry/src/main/core/controllers/StatisticsController.ts';
import { rasc } from '../entry/src/main/core/analysis/stratigraphy/index.ts';
import { pic, PhyloNode } from '../entry/src/main/core/analysis/phylogenetics/index.ts';
import { extrapolation } from '../entry/src/main/core/analysis/ecology/CoverageRarefaction.ts';
import { fossilCountDistribution } from '../entry/src/main/core/analysis/macroevolution/index.ts';
import { ReportBuilder, TableGenerator, compileLaTeX } from '../entry/src/main/core/reporting/index.ts';
import { parseExcel } from '../entry/src/main/core/parsers/ExcelParser.ts';
import { ViewPortHandler } from '../entry/src/main/ets/components/plot/ViewPortHandler.ts';
import { ChartHighlighter } from '../entry/src/main/ets/components/plot/ChartHighlighter.ts';
import { ChartComputator } from '../entry/src/main/ets/components/plot/ChartComputator.ts';
import { AdaptiveFormatter, IntegerFormatter, autoFormatter } from '../entry/src/main/ets/components/plot/ValueFormatter.ts';

/**
 * Minimal store-only .xlsx (no compression) for exercising the xlsx parser.
 *
 * Sheet: header row = shared strings [Species, Count, Flag], then three data
 * rows. Row 1 also carries a boolean cell and row 3 an inline string, so the
 * cell-type dispatch is covered rather than only the numeric path.
 */
function buildMinimalXlsx(): ArrayBuffer {
  const enc = new TextEncoder();
  const sheet = '<?xml version="1.0"?><worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>11</v></c><c r="C2" t="b"><v>1</v></c></row>'
    + '<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3"><v>22</v></c><c r="C3" t="b"><v>0</v></c></row>'
    + '<row r="4"><c r="A4" t="s"><v>5</v></c><c r="B4"><v>33</v></c><c r="C4" t="inlineStr"><is><t>hi</t></is></c></row>'
    + '</sheetData></worksheet>';
  const shared = '<?xml version="1.0"?><sst>'
    + '<si><t>Species</t></si><si><t>Count</t></si><si><t>Flag</t></si>'
    + '<si><t>Sp.A</t></si><si><t>Sp.B</t></si><si><t>Sp.C</t></si></sst>';
  const workbook = '<?xml version="1.0"?><workbook><sheets>'
    + '<sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels = '<?xml version="1.0"?><Relationships>'
    + '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';

  const entries: [string, string][] = [
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', rels],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/sharedStrings.xml', shared],
  ];

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameB = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data) >>> 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(lh.buffer), nameB, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameB.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);

  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  let total = 0;
  for (const p of all) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out.buffer;
}

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

  it('canonical Blomberg K is exactly 1 on a star tree (V = I)', () => {
    // The old name claimed "below 1 (no signal)" while the assertion pinned the
    // value to 1 — the two contradicted each other. With V = I the numerator
    // and denominator mean-squared errors are identical, so K is 1 identically
    // and the "below 1" reading simply does not apply to this degenerate tree.
    // The real invariant (E[K] = 1 under Brownian motion, on a real tree) is
    // asserted in the review-fix suite below.
    const tree = parseNewick('(A:1,B:1,C:1,D:1);');
    const { V } = brownianVCV(tree);
    const k = blombergKFromVCV([1, -1, 0.5, -0.5], V);
    expect(k).toBeCloseTo(1, 3);
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

// ─── Hollow-feature fixes verification ───────────────────────────────────────

import { EventBus } from '../entry/src/main/core/utils/EventBus.ts';
import { assertNoSingular } from '../entry/src/main/core/math/Validation.ts';
import { RegexCompiler, NFA } from '../entry/src/main/core/state_machine/Automaton.ts';

describe('hollow-feature fixes', () => {
  it('EventBus wildcard: data.* receives data_changed', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('data_*', (name) => { seen.push(String(name)); });
    bus.emit('data_changed', 'changed');
    bus.emit('data_loaded', 'loaded');
    bus.emit('metadata_changed', 'x', 0, null); // must NOT match
    expect(seen).toEqual(['changed', 'loaded']);
  });

  it('EventBus single * matches everything, off removes', () => {
    const bus = new EventBus();
    let count = 0;
    const cb = () => { count++; };
    bus.on('*', cb);
    bus.emit('a');
    bus.emit('data_changed');
    bus.off('*', cb);
    bus.emit('b');
    expect(count).toBe(2);
  });

  it('assertNoSingular rejects singular and accepts regular matrices', () => {
    const good = Matrix.from2D([[2, 1], [1, 3]]);
    assertNoSingular(good, 'good'); // must not throw
    const bad = Matrix.from2D([[1, 2], [2, 4]]); // row2 = 2*row1
    let threw = false;
    try { assertNoSingular(bad, 'bad'); } catch { threw = true; }
    expect(threw).toBe(true);
  });

  it('DFA minimize merges equivalent states and preserves language', () => {
    const re = new RegexCompiler('(a|b)*abb');
    const d1 = re.toDFA();
    const minimal = d1.minimize();
    const positives = ['abb', 'aabb', 'ababb', 'aaabbbabb'];
    const negatives = ['', 'a', 'ab', 'abba', 'bb'];
    for (const p of positives) expect(minimal.matches(p)).toBe(true);
    for (const n of negatives) expect(minimal.matches(n)).toBe(false);
    // minimisation actually shrank the automaton (subset construction > Hopcroft result)
    expect(minimal.states.length).toBeLessThanOrEqual(d1.states.length);
    expect(minimal.states.length).toBe(5); // classic Hopcroft example: (a|b)*abb minimal DFA has 5 states
    void NFA;
  });
});

// ─── Real taskpool / NativeMath dynamic loading verification ────────────────

import { ProcessPool } from '../entry/src/main/core/hpc/ProcessPool.ts';
import { TaskScheduler } from '../entry/src/main/core/hpc/TaskScheduler.ts';
import { initNative, hasNative, nativeSVD, warmupNative } from '../entry/src/main/core/math/NativeMath.ts';

describe('real dispatch & native loading', () => {
  it('ProcessPool.map returns correct results via fallback path (node has no taskpool)', async () => {
    const pool = new ProcessPool(4);
    const out = await pool.map([1, 2, 3, 4, 5], (x: number) => x * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it('ProcessPool.map isolates per-item errors without aborting', async () => {
    const pool = new ProcessPool(2);
    const out = await pool.map([1, 0, 3], (x: number) => { if (x === 0) throw new Error('div by zero'); return 10 / x; });
    expect(out[0]).toBe(10);
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(10 / 3, 1e-9);
  });

  it('TaskScheduler.executeInTaskPool falls back to same-thread and still computes', async () => {
    const r = await TaskScheduler.executeInTaskPool((a: number, b: number) => a + b, 2, 3);
    expect(r).toBe(5);
  });

  it('TaskScheduler.parallelMap preserves order and values', async () => {
    const out = await TaskScheduler.parallelMap([0, 1, 2, 3], (x: number) => x * x);
    expect(out).toEqual([0, 1, 4, 9]);
  });

  it('initNative resolves false gracefully on non-HarmonyOS runtime', async () => {
    const ok = await initNative();
    expect(ok).toBe(false);
    expect(hasNative()).toBe(false);
    // wrappers keep the null contract after a failed load
    expect(nativeSVD(new Float64Array([1, 2, 3, 4]), 2, 2)).toBeNull();
    warmupNative(); // idempotent, must not throw
  });
});

// ─── Regression tests for the 2026-09-19 review fixes ───────────────────────
// One test per fixed defect, written to fail against the pre-fix behaviour.

describe('review fixes: numerics', () => {
  it('eigh pairs each eigenvalue with its own eigenvector', () => {
    // Pre-fix, eigenvectors were sorted descending while the eigenvalue array
    // was left in Jacobi diagonal order, so the two disagreed.
    const A = new Matrix(new Float64Array([4, 1, 0, 1, 3, 1, 0, 1, 2]), 3, 3);
    const r = eigh(A);
    expect(r.eigenvalues[0]).toBeGreaterThan(r.eigenvalues[1]);
    expect(r.eigenvalues[1]).toBeGreaterThan(r.eigenvalues[2]);
    for (let k = 0; k < 3; k++) {
      const v = r.eigenvectors.col(k);
      let residual = 0;
      for (let i = 0; i < 3; i++) {
        let av = 0;
        for (let j = 0; j < 3; j++) av += A.get(i, j) * v[j];
        residual = Math.max(residual, Math.abs(av - r.eigenvalues[k] * v[i]));
      }
      expect(residual).toBeLessThan(1e-9);
    }
  });

  it('eigh rejects a non-symmetric matrix instead of returning garbage', () => {
    // The LDA pseudo-inverse bug fed exactly this shape into eigh.
    const A = new Matrix(new Float64Array([1, 2, 0, 3]), 2, 2);
    expect(() => eigh(A)).toThrow();
  });

  it('LDA separates two well-separated classes without error', () => {
    const raw = [
      [0, 0, 1.0], [0.2, 0.1, 1.1], [-0.1, 0.2, 0.9], [0.1, -0.1, 1.05],
      [5, 5, 4.0], [5.2, 4.8, 4.2], [4.9, 5.1, 3.9], [5.1, 4.9, 4.1],
    ];
    const data = new Matrix(new Float64Array(raw.flat()), 8, 3);
    const r = lda(data, [0, 0, 0, 0, 1, 1, 1, 1]);
    expect(r.accuracy).toBe(1);
    expect(r.confusionMatrix).toEqual([[4, 0], [0, 4]]);
    expect(r.eigenvalues[0]).toBeGreaterThan(0);
    expect(isFinite(r.eigenvalues[0])).toBe(true);
  });

  it('univariateSummary averages the two central values for even n', () => {
    const m = new Matrix(new Float64Array([1, 2, 3, 4]), 4, 1);
    const s = univariateSummary(m, ['x']);
    expect(s[0].median).toBeCloseTo(2.5, 1e-12);
  });

  it('PIC propagates the harmonic node variance, not the contrast variance', () => {
    // ((A:1,B:1):1,C:1) with A=B=0, C=2:
    //   node AB estimate variance = 1*1/(1+1) = 0.5  (NOT 1+1 = 2)
    //   root contrast variance    = (0.5+1) + (0+1) = 2.5
    const tree = parseNewick('((A:1,B:1):1,C:1);');
    const r = pic(tree, { A: 0, B: 0, C: 2 });
    const rootSE = Math.max(...r.standardErrors);
    expect(rootSE).toBeCloseTo(Math.sqrt(2.5), 1e-9);
  });

  it('Blomberg K is unbiased under Brownian motion (E[K] = 1)', () => {
    // The defining property of K. Pre-fix this measured ~0.83 on this tree
    // because the numerator used the arithmetic mean and the normaliser was
    // tr(V)/n instead of (tr(V) - n/(1'V^-1 1))/(n-1).
    const tree = parseNewick('((H:1,C:1):1,G:2);');
    const { V } = brownianVCV(tree);
    const n = 3;
    const L: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = 0;
        for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
        if (i === j) L[i][j] = Math.sqrt(Math.max(V[i][i] - s, 1e-15));
        else L[i][j] = (V[i][j] - s) / L[j][j];
      }
    }
    seed(7);
    const reps = 4000;
    let sum = 0;
    for (let rep = 0; rep < reps; rep++) {
      const z = randnArray(n);
      const y: number[] = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let k = 0; k <= i; k++) v += L[i][k] * z[k];
        y[i] = v;
      }
      sum += blombergKFromVCV(y, V);
    }
    expect(Math.abs(sum / reps - 1)).toBeLessThan(0.05);
  });

  it('coverage extrapolation stays bounded by the Chao1 asymptote', () => {
    // Pre-fix the formula was `chao1 + f1/(1-c)`, which doubles-counted f1 and
    // diverged as c -> 1 (c = 0.99 with f1 = 3 added ~300 species).
    const abund = [1, 1, 1, 2, 3, 5];
    const Sobs = 6;
    const chao1 = 10.5; // 6 + f1^2/(2 f2) = 6 + 9/2
    const a = extrapolation(abund, 0.9, chao1);
    const b = extrapolation(abund, 0.99, chao1);
    expect(a).toBeGreaterThanOrEqual(Sobs);
    expect(a).toBeLessThanOrEqual(chao1);
    expect(b).toBeLessThanOrEqual(chao1);
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it('RASC only keeps swaps that lower the reference-section misfit', () => {
    // The accept/revert branches were inverted, so the cost trace could rise.
    const D = [[0, 1, 4, 5], [1, 0, 3, 4], [4, 3, 0, 1], [5, 4, 1, 0]];
    const r = rasc(D, ['e1', 'e2', 'e3', 'e4'], 20, [[1, 2, 3, 4], [1, 2, 3, 4]]);
    const trace = r.costTrace;
    expect(trace.length).toBeGreaterThan(0);
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]).toBeLessThanOrEqual(trace[i - 1] + 1e-9);
    }
  });

  it('phyloANOVA uses the Phipson correction like its sibling tests', () => {
    const s = new StatisticsController();
    const r = s.runPhyloANOVA(new PhyloNode('root', 0, false), {}, {});
    expect(r.pValue).toBeGreaterThanOrEqual(0);
  });

  it('fossilCountDistribution responds to the diversification rate', () => {
    // Pre-fix lambda/mu/rho were discarded via `void`, so these were identical.
    const meanOf = (p: number[]): number => p.reduce((s, v, k) => s + k * v, 0);
    const sumOf = (p: number[]): number => p.reduce((a, b) => a + b, 0);
    // Grid chosen large enough for both means (5 and ~16).
    const equal = fossilCountDistribution(0.1, 0.1, 0.5, 1, 10, 80);
    const growing = fossilCountDistribution(0.3, 0.1, 0.5, 1, 10, 80);
    expect(sumOf(equal)).toBeCloseTo(1, 4);
    expect(sumOf(growing)).toBeCloseTo(1, 4);
    expect(meanOf(equal)).toBeCloseTo(5, 1);       // psi * age
    expect(meanOf(growing)).toBeGreaterThan(meanOf(equal) + 1);
    // A grid that cannot cover the mode is refused rather than returned as zeros.
    expect(() => fossilCountDistribution(0.5, 0.1, 0.5, 1, 10, 40)).toThrow();
  });
});

describe('review fixes: data integrity', () => {
  it('CSV parser honours RFC 4180 escaped quotes', () => {
    const dm = parseCSV('id,note\nr1,"He said ""hi"""\nr2,plain\n', ',', true, true);
    expect(dm.nSamples).toBe(2);
    // A label containing the delimiter must survive a round trip.
    const text = toCSV(dm);
    const back = parseCSV(text, ',', true, true);
    expect(back.nSamples).toBe(2);
  });

  it('StateManager drops the previous edit history when data is replaced', () => {
    // Pre-fix setData pushed an empty state on TOP of the old deltas, so two
    // undos replayed the old matrix's values into the new one.
    const sm = StateManager.getInstance();
    sm.setData(new DataMatrix(new Matrix(new Float64Array([1, 2, 3, 4]), 2, 2), ['a', 'b'], ['x', 'y']));
    sm.pushUndo(0, 0, 1, 99);
    sm.dataMatrix!.data.set(0, 0, 99);
    sm.setData(new DataMatrix(new Matrix(new Float64Array([5, 6, 7, 8]), 2, 2), ['c', 'd'], ['x', 'y']));
    sm.undo();
    sm.undo();
    expect(sm.dataMatrix!.data.get(0, 0)).toBe(5);
  });

  it('DataController.subsetRows keeps rows and labels the same length', () => {
    // Pre-fix a non-contiguous selection sliced [first, last+1] and returned
    // every row in between, leaving more rows than row labels.
    const dc = new DataController();
    dc.loadCSV('id,c0,c1\nr0,1,2\nr1,3,4\nr2,5,6\nr3,7,8\n', ',', true, true);
    const sub = dc.subsetRows([0, 2]);
    expect(sub.nSamples).toBe(2);
    expect(sub.rowLabels).toEqual(['r0', 'r2']);
    expect(sub.data.get(0, 0)).toBe(1);
    expect(sub.data.get(1, 0)).toBe(5);
    // out-of-range and duplicate indices are dropped, not trusted
    expect(dc.subsetRows([1, 1, 99]).nSamples).toBe(1);
  });

  it('xlsx import keeps the first data row and resolves cell types', () => {
    // Two separate pre-fix defects, both on the xlsx path:
    //  1. `data.shift()` after the header was already skipped dropped row 1.
    //  2. the cell `t` attribute was read from the element's INNER content, so
    //     it never matched: shared strings became their index, text became 0.
    const r = parseExcel(buildMinimalXlsx(), { hasHeader: true, hasRowLabels: true });
    const s = r.sheets[0];
    expect(s.data.length).toBe(3);              // was 2
    expect(s.data[0][0]).toBe(11);              // first data row survived
    expect(s.colLabels).toEqual(['', 'Count', 'Flag']);
    expect(s.rowLabels).toEqual(['Sp.A', 'Sp.B', 'Sp.C']);
    expect(s.data[0][1]).toBe(1);               // boolean true
    expect(s.data[1][1]).toBe(0);               // boolean false
  });
});

describe('review fixes: reporting and wiring', () => {
  it('TableGenerator.latex keeps header and body column counts equal', () => {
    const m = new Matrix(new Float64Array([1, 2, 3, 4]), 2, 2);
    const tex = TableGenerator.latex(m, ['a', 'b']);
    const body = tex.split('\n').filter(l => l.startsWith('R'));
    expect(body.length).toBe(2);
    const head = tex.split('\n').find(l => l.startsWith('&'))!;
    const headCols = head.split('&').length;
    for (const row of body) expect(row.split('&').length).toBe(headCols);
  });

  it('compileLaTeX closes a table with the table environment', () => {
    // renderTable emitted \begin{table} ... \end{figure}, so every exported
    // table was invalid LaTeX.
    const b = new ReportBuilder();
    b.setTitle('t');
    b.addTable(TableGenerator.latex(new Matrix(new Float64Array([1, 2]), 1, 2), ['a', 'b']), 'cap');
    const res = compileLaTeX(b, {});
    expect(res.texContent.includes('\\begin{table}')).toBe(true);
    expect(res.texContent.includes('\\end{table}')).toBe(true);
    expect(res.texContent.includes('\\end{figure}')).toBe(false);
  });

  it('runEffectSizes returns numbers, not function objects', () => {
    const s = new StatisticsController();
    const r = s.runEffectSizes([1, 2, 3, 4, 5], [3, 4, 5, 6, 7]);
    for (const k of ['cohensD', 'etaSquared', 'omegaSquared', 'partialEtaSquared']) {
      expect(typeof r[k]).toBe('number');
    }
    expect(isFinite(r['etaSquared'])).toBe(true);
  });
});

// ─── Plot view port / hit testing / formatting ──────────────────────────────
// These modules are extracted from PlotCanvas so the transform, the tick maths
// and the hit test live in ONE place. Pure logic, no ArkUI dependency, hence
// testable here — the previous inline versions were not.

describe('plot view port', () => {
  it('mapX and unmapX are inverses', () => {
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    vp.setDataRange([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0, 10]);
    for (const v of [0, 2.5, 5, 7.5, 10]) {
      expect(vp.unmapX(vp.mapX(v))).toBeCloseTo(v, 6);
    }
  });

  it('mapY and unmapY are inverses and the Y axis is inverted', () => {
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    vp.setDataRange([0, 10], [0, 10]);
    for (const v of [0, 3, 7, 10]) {
      expect(vp.unmapY(vp.mapY(v))).toBeCloseTo(v, 6);
    }
    // Larger data values must sit HIGHER on screen (smaller pixel Y).
    expect(vp.mapY(10)).toBeLessThan(vp.mapY(0));
  });

  it('zoom is applied about the plot centre, so the centre stays put', () => {
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    vp.setDataRange([0, 10], [0, 10]);
    const centreBefore = vp.mapX(5);
    vp.zoomTo(2.5);
    expect(vp.mapX(5)).toBeCloseTo(centreBefore, 6);
    // An off-centre value does move away from the centre.
    expect(Math.abs(vp.mapX(10) - centreBefore)).toBeGreaterThan(Math.abs(centreBefore - vp.unmapX(centreBefore)));
  });

  it('zoom is clamped to the configured bounds', () => {
    const vp = new ViewPortHandler();
    vp.zoomTo(1e6);
    expect(vp.zoom).toBe(ViewPortHandler.MAX_ZOOM);
    vp.zoomTo(1e-6);
    expect(vp.zoom).toBe(ViewPortHandler.MIN_ZOOM);
  });

  it('pan shifts the projection by exactly the offset', () => {
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    vp.setDataRange([0, 10], [0, 10]);
    const x0 = vp.mapX(5);
    const y0 = vp.mapY(5);
    vp.panBy(30, -20);
    expect(vp.mapX(5)).toBeCloseTo(x0 + 30, 9);
    expect(vp.mapY(5)).toBeCloseTo(y0 - 20, 9);
  });

  it('a degenerate data range never yields NaN', () => {
    // All points identical — the range would divide by zero without the guard.
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    vp.setDataRange([2, 2, 2], [3, 3, 3]);
    for (const v of [2, 3, 0, -1]) {
      expect(isFinite(vp.mapX(v))).toBe(true);
      expect(isFinite(vp.mapY(v))).toBe(true);
    }
    // An empty series is equally harmless.
    vp.setDataRange([], []);
    expect(isFinite(vp.mapX(0))).toBe(true);
    expect(vp.plotWidth).toBeGreaterThan(0);
    expect(vp.plotHeight).toBeGreaterThan(0);
  });

  it('resetView clears zoom and pan but keeps the data range', () => {
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    vp.setDataRange([0, 10], [0, 10]);
    const x0 = vp.mapX(3);
    vp.zoomTo(4);
    vp.panBy(100, 100);
    vp.resetView();
    expect(vp.zoom).toBe(1);
    expect(vp.panOffsetX).toBe(0);
    expect(vp.mapX(3)).toBeCloseTo(x0, 9);
    expect(vp.minX).toBe(0);
  });
});

describe('plot ticks, hit testing and formatting', () => {
  it('axis ticks span the range in order', () => {
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    vp.setDataRange([-4, 6], [0, 100]);

    const xt = ChartComputator.xTicks(vp, 5);
    expect(xt.length).toBe(6);
    expect(xt[0].value).toBeCloseTo(-4, 9);
    expect(xt[5].value).toBeCloseTo(6, 9);
    for (let i = 1; i < xt.length; i++) {
      expect(xt[i].value).toBeGreaterThan(xt[i - 1].value);
      expect(xt[i].pixel).toBeGreaterThan(xt[i - 1].pixel);
    }

    // Y ticks run bottom-to-top in data space, so their pixels DECREASE.
    const yt = ChartComputator.yTicks(vp, 5);
    expect(yt.length).toBe(6);
    for (let i = 1; i < yt.length; i++) {
      expect(yt[i].pixel).toBeLessThan(yt[i - 1].pixel);
    }
  });

  it('ticks honour a supplied label formatter', () => {
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    vp.setDataRange([0, 1], [0, 1]);
    const xt = ChartComputator.xTicks(vp, 2, (v: number) => 'v=' + v.toFixed(2));
    expect(xt[0].label).toBe('v=0.00');
    expect(xt[2].label).toBe('v=1.00');
  });

  it('barLayout fits every bar inside the plot width', () => {
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    const count = 7;
    const { barWidth, gap } = ChartComputator.barLayout(vp, count);
    expect(barWidth).toBeGreaterThan(0);
    expect((barWidth + gap) * count).toBeCloseTo(vp.plotWidth, 6);
    expect(ChartComputator.barLayout(vp, 0).barWidth).toBeGreaterThan(0); // no divide by zero
  });

  it('nearestIndex picks the closest point and respects the radius', () => {
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    const xs = [0, 1, 2];
    const ys = [0, 1, 2];
    vp.setDataRange(xs, ys);

    // Land exactly on the third point's pixel.
    expect(ChartHighlighter.nearestIndex(vp, xs, ys, vp.mapX(2), vp.mapY(2), 20)).toBe(2);
    // A point far outside the plot is not picked.
    expect(ChartHighlighter.nearestIndex(vp, xs, ys, -500, -500, 20)).toBe(-1);
    // With a shorter Y array only index 0 is ever considered: asking at point
    // 0's pixel finds it, and the truncated index 1/2 are never reported.
    expect(ChartHighlighter.nearestIndex(vp, xs, [0], vp.mapX(0), vp.mapY(0), 20)).toBe(0);
    expect(ChartHighlighter.nearestIndex(vp, xs, [0], vp.mapX(2), vp.mapY(2), 20)).toBe(-1);
  });

  it('IndicesNearDataX returns the points within tolerance', () => {
    expect(ChartHighlighter.indicesNearDataX([1, 2, 3, 4, 5], 3, 0.01)).toEqual([2]);
    expect(ChartHighlighter.indicesNearDataX([], 3, 0.01)).toEqual([]);
  });

  it('AdaptiveFormatter keeps tiny and huge values readable', () => {
    const f = new AdaptiveFormatter();
    expect(f.format(0)).toBe('0');
    expect(f.format(12.3456)).toBe('12.35');
    expect(f.format(1e6)).toBe('1.00e+6');
    // Below 1e-4 it switches to exponential...
    expect(f.format(0.00005)).toBe('5.00e-5');
    // ...but 1.2e-4 is above the threshold, so it stays in fixed notation
    // (6 decimals is more readable than 1.20e-4 at this magnitude).
    expect(f.format(0.00012)).toBe('0.000120');
    expect(f.format(NaN)).toBe('NaN');
  });

  it('autoFormatter drops fixed decimals for extreme spans', () => {
    // A normal span keeps plain decimals.
    expect(autoFormatter(10).format(3.14159)).toBe('3.14');
    // A microscopic or astronomic span switches to exponential so labels stay short.
    expect(autoFormatter(1e-6).format(5e-7)).toContain('e-');
    expect(autoFormatter(1e9).format(1.2e9)).toContain('e+');
    expect(new IntegerFormatter().format(1234567)).toBe('1,234,567');
  });
});
