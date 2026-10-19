/**
 * Regression tests for the 2026-10-19 ArkUI-layer fix pass.
 *
 * Four defects lived in the UI layer, not in the statistics:
 *
 *  1. Twenty-four dialog-routed analyses had NO dedicated drawing branch, so
 *     the chart was decided by "the first numeric array in the result object,
 *     in key order". A rarefaction therefore drew `sampleSizes` (the straight
 *     line 1, 3, 5, 7, 9) instead of `expectedTaxa`, a periodogram drew
 *     `frequencies` instead of `power`, and a diversity result (all scalars)
 *     drew nothing at all. The three analyses that DID have a dedicated
 *     branch had it in the wrong switch, where it was unreachable.
 *
 *  2. The box plot existed twice — on the canvas and in the SVG exporter —
 *     and the two disagreed about the quartiles (the canvas took the UPPER
 *     median of an even-sized sample), the whiskers (Tukey vs min/max), the
 *     X layout (hand-computed pixels vs the viewport) and the Y transform
 *     (a local formula that ignored zoom and pan).
 *
 *  3. Loading a new dataset kept the previous dataset's group labels (they
 *     were inherited BY ROW NUMBER) and wrote them into the new table on the
 *     next "Set Group" — after which ANOSIM / PERMANOVA / SIMPER / LDA
 *     reported a p-value for a grouping that had nothing to do with the new
 *     data.
 *
 *  4. The workspace tab list was capped at eight entries and the oldest one
 *     was dropped — the data table was always the oldest, so eight analyses
 *     removed the spreadsheet (and with it the only entry point for
 *     grouping) from the workspace.
 *
 * The ArkUI layer cannot execute under the Node harness, so the testable
 * parts were pulled into three pure modules (plot/plotSeries.ts,
 * plot/boxGeometry.ts, components/rowGroups.ts) and the `.ets` wiring is
 * checked as source text, in the style of ets2026.test.ts / etsDispatch.test.ts.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';
import { selectPlotSeries, isAxisOnlyField } from '../entry/src/main/ets/components/plot/plotSeries.ts';
import { computeBoxPrimitives, boxStats, quantile } from '../entry/src/main/ets/components/plot/boxGeometry.ts';
import { ViewPortHandler } from '../entry/src/main/ets/components/plot/ViewPortHandler.ts';
import { blankGroups, fitGroups, cycleGroup, UNGROUPED } from '../entry/src/main/ets/components/rowGroups.ts';
import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { computeRarefaction, computeDiversity } from '../entry/src/main/core/analysis/ecology/ecology.ts';
import { spectralAnalysis } from '../entry/src/main/core/analysis/stratigraphy/stratigraphy.ts';

const INDEX = 'entry/src/main/ets/pages/Index.ets';
const PLOT_CANVAS = 'entry/src/main/ets/components/PlotCanvas.ets';
const SPREADSHEET = 'entry/src/main/ets/components/Spreadsheet.ets';
const NULL_MODEL = 'entry/src/main/ets/components/dialogs/NullModelDialog.ets';

const readIndex = () => readFileSync(INDEX, 'utf-8');
const readPlot = () => readFileSync(PLOT_CANVAS, 'utf-8');
const readSheet = () => readFileSync(SPREADSHEET, 'utf-8');

/** Slice a method body out of an .ets source by its signature line. */
function method(src: string, signature: string, nextSignature: string): string {
  const a = src.indexOf(signature);
  if (a < 0) throw new Error('method not found: ' + signature);
  const b = src.indexOf(nextSignature, a);
  if (b < 0) throw new Error('next method not found: ' + nextSignature);
  return src.slice(a, b);
}

/**
 * Drop the comments, so a source assertion cannot be satisfied — or broken —
 * by a sentence in a comment.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

// ─── 1. The chart of a dialog-routed analysis ──────────────────────────────

describe('fix: a rarefaction drew its sample sizes instead of its dilution curve', () => {
  const result = {
    sampleName: '',
    sampleSizes: [1, 3, 5, 7, 9],
    expectedTaxa: [1, 2.142857, 2.685714, 3.114286, 3.457143],
    extrapolationFlag: true,
  };

  it('plots expectedTaxa against sampleSizes', () => {
    const sel = selectPlotSeries('Rarefaction', result);
    expect(sel.type).toBe('line');
    expect(sel.y).toEqual(result.expectedTaxa);
    expect(sel.x).toEqual(result.sampleSizes);
  });

  it('never plots the sample sizes as the response', () => {
    const sel = selectPlotSeries('Rarefaction', result);
    expect(sel.y === result.sampleSizes).toBe(false);
    // The second point of the dilution curve is 2.14 taxa, not the third
    // sample size (3).
    expect(sel.y[1]).toBeWithin(2.142857, 1e-6);
  });

  it('the real core result is drawn the same way', () => {
    // The key names the drawing rule depends on: sampleSizes / expectedTaxa.
    const real = computeRarefaction([5, 3, 2, 1, 1, 4, 2, 1], 8, 8);
    const sel = selectPlotSeries('Rarefaction', real);
    expect(sel.type).toBe('line');
    expect(sel.y).toEqual(real.expectedTaxa);
    expect(sel.x).toEqual(real.sampleSizes);
    expect(sel.x.length).toBe(sel.y.length);
  });
});

describe('fix: a periodogram drew its frequencies instead of its power spectrum', () => {
  const result = {
    frequencies: [0.0833, 0.1667, 0.25, 0.3333, 0.4167, 0.5],
    periods: [12, 6, 4, 3, 2.4, 2],
    power: [0.0061, 0.0102, 0.0571, 0.2214, 0.0088, 0.0031],
    peakFrequency: 0.3333,
    peakPeriod: 3,
    method: 'dft',
  };

  it('plots power against periods', () => {
    const sel = selectPlotSeries('Spectral', result);
    expect(sel.type).toBe('line');
    expect(sel.y).toEqual(result.power);
    expect(sel.x).toEqual(result.periods);
  });

  it('never plots the frequencies as the response', () => {
    const sel = selectPlotSeries('Spectral', result);
    expect(sel.y === result.frequencies).toBe(false);
  });

  it('the real core result is drawn the same way', () => {
    // The key names the drawing rule depends on: frequencies / periods / power.
    const real = spectralAnalysis([1, 3, 2, 5, 4, 7, 3, 6, 2, 8, 4, 9]);
    const sel = selectPlotSeries('Spectral', real);
    expect(sel.type).toBe('line');
    expect(sel.y).toEqual(real.power);
    expect(sel.x).toEqual(real.periods);
  });
});

describe('fix: a diversity result produced a fake straight line', () => {
  const result = {
    sampleName: 'Sample',
    richness: 4,
    shannon: 1.063273,
    simpson: 0.613033,
    pielou: 0.76699,
    margalef: 1.291774,
    evenness: 0.76699,
    totalIndividuals: 10.2,
    abundances: { Species_1: 5.1, Species_2: 3.5, Species_3: 1.4, Species_4: 0.2 },
    fisherAlpha: 2.423954,
    chao1: 4,
  };

  it('draws no line at all', () => {
    const sel = selectPlotSeries('Diversity Indices', result);
    expect(sel.type === 'line' || sel.type === 'scatter').toBe(false);
    expect(sel.type).toBe('none');
    expect(sel.y).toHaveLength(0);
    expect(sel.x).toHaveLength(0);
  });

  it('still reports the result in the title', () => {
    const sel = selectPlotSeries('Diversity Indices', result);
    expect(sel.title).toContain('S=4');
    expect(sel.title).toContain('H=1.06');
  });

  it('the real core result is drawn the same way', () => {
    const real = computeDiversity([5.1, 3.5, 1.4, 0.2]);
    const sel = selectPlotSeries('Diversity Indices', real);
    expect(sel.type).toBe('none');
    expect(sel.y).toHaveLength(0);
  });
});

describe('fix: a coordinate field can no longer be mistaken for the response', () => {
  it('the structural fields are blacklisted', () => {
    for (const name of ['sampleSizes', 'frequencies', 'periods', 'sampleName', 'indices',
      'labels', 'taxa', 'counts', 'depths', 'heights', 'classLabels', 'groups']) {
      expect(isAxisOnlyField(name)).toBe(true);
    }
    for (const name of ['expectedTaxa', 'power', 'values', 'axis1Scores']) {
      expect(isAxisOnlyField(name)).toBe(false);
    }
  });

  it('a result whose only array is a coordinate produces no chart', () => {
    // The old rule ("first numeric array in key order") drew sampleSizes.
    const sel = selectPlotSeries('Something Unknown', { sampleSizes: [1, 3, 5, 7, 9] });
    expect(sel.type).toBe('none');
    expect(sel.y).toHaveLength(0);
  });

  it('a response without a coordinate produces no chart, not a made-up X', () => {
    // The old rule drew centroidSizes against 1..n — a line whose X axis
    // means nothing at all.
    const sel = selectPlotSeries('GPA', { centroidSizes: [1.4, 1.5, 1.3, 1.6] });
    expect(sel.type).toBe('none');
    expect(sel.x).toHaveLength(0);
    expect(sel.y).toHaveLength(0);
  });

  it('a response WITH a coordinate is drawn against it', () => {
    const sel = selectPlotSeries('Isotope', { depths: [5.1, 4.9, 4.7], values: [3.5, 3.0, 3.2] });
    expect(sel.type).toBe('line');
    expect(sel.x).toEqual([5.1, 4.9, 4.7]);
    expect(sel.y).toEqual([3.5, 3.0, 3.2]);
  });

  it('an ordination result is a score plot, not its class labels', () => {
    // An LDA result carries `scores` (a Matrix) AND `classLabels` — the old
    // rule picked the class labels and drew a two-point line.
    const scores = new Matrix(Float64Array.from([1, 2, 3, 4, 5, 6]), 3, 2);
    const sel = selectPlotSeries('LDA', {
      scores: scores,
      classLabels: [0, 1],
      groups: [0, 1, 0],
      eigenvalues: [1.0],
    });
    expect(sel.type).toBe('scatter');
    expect(sel.x).toEqual([1, 3, 5]);
    expect(sel.y).toEqual([2, 4, 6]);
  });
});

describe('fix: each analysis decides what it plots in exactly one place', () => {
  it('the dialog path asks the shared selector', () => {
    const src = readIndex();
    expect(src.includes("import { selectPlotSeries } from '../components/plot/plotSeries';")).toBe(true);
    const body = method(src, 'private async runAnalysisWithParams(', 'private async handleAnalysis(');
    expect(body.includes('selectPlotSeries(')).toBe(true);
  });

  it('the dialog path no longer hard-codes the result keys of an analysis', () => {
    const body = stripComments(method(readIndex(), 'private async runAnalysisWithParams(', 'private async handleAnalysis('));
    // The drawing rule for a rarefaction / periodogram lives in the pure
    // module now, so the component must not name their fields.
    expect(body.includes('expectedTaxa')).toBe(false);
    expect(body.includes('sampleSizes')).toBe(false);
    expect(body.includes('peakPeriod')).toBe(false);
  });

  it('the unreachable quick-path branches are gone', () => {
    const body = method(readIndex(), 'private async handleAnalysis(', 'private handleAction(');
    // Each of the three analyses appears exactly once in handleAnalysis: the
    // line that opens its dialog. The shadowed drawing branches are gone.
    for (const name of ['Diversity Indices', 'Rarefaction', 'Spectral']) {
      const occurrences = body.split("case '" + name + "':").length - 1;
      expect(occurrences).toBe(1);
    }
    expect(body.includes('this.plotDataX = result.sampleSizes')).toBe(false);
    expect(body.includes('this.plotDataY = result.expectedTaxa')).toBe(false);
    expect(body.includes('this.plotDataY = result.power')).toBe(false);
  });

  it('the old "first numeric array in key order" rule is gone from the component', () => {
    expect(stripComments(readIndex()).includes('firstNumericSeries')).toBe(false);
  });
});

// ─── 2. The box plot is one figure, not two ───────────────────────────────

describe('fix: the box plot median of an even-sized sample was the upper median', () => {
  it('the median of [1,2,3,4] is 2.5', () => {
    const st = boxStats([1, 2, 3, 4]);
    expect(st.median).toBe(2.5);
    expect(st.median === 3).toBe(false);
  });

  it('the quartiles are the R-7 ones', () => {
    const st = boxStats([1, 2, 3, 4]);
    expect(st.q1).toBe(1.75);
    expect(st.q3).toBe(3.25);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it('the whiskers are the Tukey ones, not min and max', () => {
    const st = boxStats([1, 2, 3, 4, 100]);
    expect(st.upperWhisker).toBe(4);
    expect(st.max).toBe(100);
    expect(st.lowerWhisker).toBe(1);
  });

  it('an empty group yields no box', () => {
    const st = boxStats([]);
    expect(st.n).toBe(0);
  });
});

describe('fix: the canvas and the SVG exporter draw the same box', () => {
  const makeVp = (): ViewPortHandler => {
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    vp.setDataRange([0, 1], [1, 2, 3, 4]);
    return vp;
  };
  const groups = [
    { label: 'A', values: [1, 2, 3, 4] },
    { label: 'B', values: [2, 2, 5, 9, 100] },
  ];

  it('both renderers consume the same primitives', () => {
    const src = readPlot();
    const canvas = method(src, 'private drawBoxPlot(', 'private drawHeatmap(');
    const svg = method(src, 'private buildSVG(', 'private async requestExport(');
    expect(canvas.includes('computeBoxPrimitives(')).toBe(true);
    expect(svg.includes('computeBoxPrimitives(')).toBe(true);
  });

  it('the divergent local geometry is gone', () => {
    const src = readPlot();
    // The canvas used to compute its own quantiles, its own Y formula and
    // its own X layout.
    expect(src.includes('Math.floor(n * 0.25)')).toBe(false);
    expect(src.includes('const yPad =')).toBe(false);
    expect(src.includes('const mapY = (v: number) =>')).toBe(false);
  });

  it('the primitives are identical for identical input — bit for bit', () => {
    const vp = makeVp();
    const a = computeBoxPrimitives(vp, groups);
    const b = computeBoxPrimitives(vp, groups);
    expect(a.length).toBe(2);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].median).toBe(b[i].median);
      expect(a[i].q1).toBe(b[i].q1);
      expect(a[i].q3).toBe(b[i].q3);
      expect(a[i].lowerWhisker).toBe(b[i].lowerWhisker);
      expect(a[i].upperWhisker).toBe(b[i].upperWhisker);
      expect(a[i].centerX).toBe(b[i].centerX);
      expect(a[i].yMedian).toBe(b[i].yMedian);
    }
  });

  it('the Y transform is the viewport transform', () => {
    const vp = makeVp();
    const boxes = computeBoxPrimitives(vp, groups);
    expect(boxes[0].yMedian).toBe(vp.mapY(2.5));
    expect(boxes[0].yQ1).toBe(vp.mapY(1.75));
    expect(boxes[0].yQ3).toBe(vp.mapY(3.25));
    expect(boxes[0].centerX).toBe(vp.mapX(0));
    expect(boxes[1].centerX).toBe(vp.mapX(1));
  });

  it('zoom and pan move the boxes with the axes', () => {
    const vp = makeVp();
    const before = computeBoxPrimitives(vp, groups);
    vp.zoomTo(2.5);
    vp.panBy(30, -12);
    const after = computeBoxPrimitives(vp, groups);
    expect(after[0].yMedian).toBe(vp.mapY(2.5));
    expect(after[0].yMedian === before[0].yMedian).toBe(false);
    expect(after[0].centerX).toBe(vp.mapX(0));
  });
});

// ─── 3. Group labels of a previous dataset ────────────────────────────────

describe('fix: the group labels of a previous dataset reached the new table', () => {
  it('a new table starts ungrouped', () => {
    expect(blankGroups(3)).toEqual([UNGROUPED, UNGROUPED, UNGROUPED]);
  });

  it('a label array always has one entry per row', () => {
    expect(fitGroups(['Group_A'], 3)).toEqual(['Group_A', UNGROUPED, UNGROUPED]);
    expect(fitGroups(['Group_A', 'Group_B', 'Group_C', 'Group_D'], 2)).toEqual(['Group_A', 'Group_B']);
    expect(fitGroups([], 2)).toEqual([UNGROUPED, UNGROUPED]);
  });

  it('the labels of the previous table are not inherited by row number', () => {
    // The old rule was `rowGroups[i] ?? 'Ungrouped'` on a NEW table: the
    // first rows kept the previous table's labels.
    const previous = ['Group_A', 'Group_B', 'Group_A'];
    const fresh = blankGroups(3);
    expect(fresh).toEqual([UNGROUPED, UNGROUPED, UNGROUPED]);
    expect(fresh === previous).toBe(false);
  });

  it('"Set Group" cycles the row through the palette', () => {
    const palette = ['Group_A', 'Group_B', 'Group_C'];
    expect(cycleGroup(UNGROUPED, palette)).toBe('Group_A');
    expect(cycleGroup('Group_A', palette)).toBe('Group_B');
    expect(cycleGroup('Group_C', palette)).toBe('Group_A');
  });

  it('a new dataset is announced, and the spreadsheet resets its labels', () => {
    const index = readIndex();
    const sheet = readSheet();
    const load = method(index, 'private loadFile(', 'private exportFile(');
    expect(load.includes("emit('dataset_loaded')")).toBe(true);
    expect(sheet.includes("on('dataset_loaded'")).toBe(true);
    expect(sheet.includes("off('dataset_loaded'")).toBe(true);
    expect(sheet.includes('private resetGroups(')).toBe(true);
  });

  it('the spreadsheet no longer inherits the labels by row index', () => {
    const sheet = readSheet();
    expect(sheet.includes('this.rowGroups[i] ??')).toBe(false);
    expect(sheet.includes('fitGroups(')).toBe(true);
  });

  it('the published array always matches the current table', () => {
    const sheet = readSheet();
    const assign = method(sheet, 'private assignGroup(', 'private clearGroups(');
    // The whole array is published to the DataMatrix, so it must be fitted
    // to the current row count first.
    expect(assign.includes('fitGroups(')).toBe(true);
    expect(assign.includes('this.onGroupChanged(this.rowGroups)')).toBe(true);
  });
});

// ─── 4. The workspace must not drop the data table ────────────────────────

describe('fix: eight analyses removed the spreadsheet from the workspace', () => {
  it('the data table is not evictable', () => {
    const src = readIndex();
    const add = method(src, 'private addWidget(', 'private exportPlot(');
    expect(add.includes("w !== 'spreadsheet'")).toBe(true);
    expect(add.includes('this.workspaceWidgets.shift()')).toBe(false);
  });
});

// ─── 6. One menu entry, one analysis ──────────────────────────────────────

describe('fix: "Stratigraphic Correlation" ran two different analyses', () => {
  it('the dialog path runs the stratigraphic correlation, not a Pearson r', () => {
    const body = stripComments(method(readIndex(), 'private runDialogAnalysisCore(', 'private requireGroups('));
    // The dialog used to call runComputeCorrelation — a plain correlation
    // between two columns — so the L-curve / GLS algorithm of the core was
    // unreachable from the dialog.
    expect(body.includes('runComputeCorrelation')).toBe(false);
    expect(body.includes('runStratCorr(')).toBe(true);
  });

  it('both paths build the same sections', () => {
    const src = readIndex();
    const dialog = stripComments(method(src, 'private runDialogAnalysisCore(', 'private requireGroups('));
    const quick = stripComments(method(src, 'private runQuickAnalysisCore(', 'private recordAnalysis('));
    expect(dialog.includes('this.stratCorrSections()')).toBe(true);
    expect(quick.includes('this.stratCorrSections()')).toBe(true);
    expect(src.includes('private stratCorrSections(')).toBe(true);
  });
});

describe('fix: a phylogenetic ANOVA was run without any groups', () => {
  it('the groups come from the specimen groups of the spreadsheet', () => {
    const src = readIndex();
    const dialog = stripComments(method(src, 'private runDialogAnalysisCore(', 'private requireGroups('));
    const quick = stripComments(method(src, 'private runQuickAnalysisCore(', 'private recordAnalysis('));
    // An empty grouping is not a test: the core answered "p = 1, no
    // difference" for an analysis that never ran.
    expect(dialog.includes('traits, {},')).toBe(false);
    expect(quick.includes('traits, {})')).toBe(false);
    expect(dialog.includes('this.phyloGroups(')).toBe(true);
    expect(quick.includes('this.phyloGroups(')).toBe(true);
    expect(src.includes('dm.rowMeta.getGroup(')).toBe(true);
  });
});

describe('fix: a failed analysis reported a truncated sentence', () => {
  it('the whole message reaches the status line', () => {
    const src = readIndex();
    const dialog = stripComments(method(src, 'private async runAnalysisWithParams(', 'private async handleAnalysis('));
    const quick = stripComments(method(src, 'private async handleAnalysis(', 'private handleAction('));
    expect(dialog.includes('e instanceof Error ? e.message : String(e)')).toBe(true);
    expect(quick.includes('e instanceof Error ? e.message : String(e)')).toBe(true);
    expect(dialog.includes("String(e).substring(0, 100)")).toBe(false);
    expect(quick.includes("String(e).substring(0, 100)")).toBe(false);
  });
});

// ─── 5. The null-model dialog and the four earlier fixes ─────────────────

describe('fix: the null-model dialog had no description for the "combo" metric', () => {
  it('every option has a description', () => {
    const src = readFileSync(NULL_MODEL, 'utf-8');
    const opts = src.match(/metricOpts: string\[\] = \[([^\]]*)\]/);
    const desc = src.match(/metricDesc: string\[\] = \[([\s\S]*?)\];/);
    expect(opts !== null).toBe(true);
    expect(desc !== null).toBe(true);
    const nOpts = opts![1].split(',').filter(s => s.trim().length > 0).length;
    const nDesc = desc![1].split('\n').filter(s => s.trim().length > 0 && s.trim() !== '];').length;
    expect(nDesc).toBe(nOpts);
  });
});

describe('fix: the four earlier fixes are still in place', () => {
  it('Index.ets calls the module-level dataFingerprint, not a missing member', () => {
    expect(readIndex().includes('this.dataFingerprint(')).toBe(false);
    expect(readIndex().includes('dataFingerprint(dm)')).toBe(true);
  });

  it('PlotCanvas.ets declares `suggested` and uses it', () => {
    const src = readPlot();
    expect(src.includes('const suggested = ')).toBe(true);
    expect(src.split('const suggested = ').length - 1).toBe(1);
    // No bare `suggested` reference outside the declaration.
    const uses = src.split('suggested').length - 1;
    expect(uses >= 4).toBe(true);
    expect(src.includes('suggested)')).toBe(true);
  });
});
