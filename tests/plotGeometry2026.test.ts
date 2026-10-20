/**
 * Regression tests for the shared scatter / line / histogram / bar geometry.
 *
 * The box plot was fixed on 2026-10-19 by pulling its geometry into a pure
 * module (plot/boxGeometry.ts) that the canvas renderer and the SVG exporter
 * both consume. The same duplication was still sitting on the other four
 * chart types:
 *
 *   - the scatter points, the line vertices, the bar rectangles and the
 *     histogram bins were each computed TWICE — once in the canvas branch
 *     (drawScatter / drawLine / drawBar / setHistogramData) and once in the
 *     SVG exporter (buildSVG) — so a change to one copy was not a change to
 *     the figure;
 *   - the rule that decides which bars are visible (a two-pass cull, because
 *     ArkUI's Canvas does not clip) lived in a PRIVATE method of the
 *     component, where no test could reach it;
 *   - the histogram binning (the bin edge rule, the clamping of the largest
 *     sample into the last bin, the label format) lived in the component
 *     too, so it could not be pinned by a test at all.
 *
 * Everything that decides a coordinate now lives in plot/plotGeometry.ts —
 * a plain `.ts` with no ArkUI dependency, so it can be unit tested in Node.
 *
 * These tests therefore pin TWO things:
 *
 *   1. the OLD behaviour, number for number — the figures must not change
 *      (this is a refactor, not a fix);
 *   2. the fact that the canvas and the exporter now read ONE implementation.
 *
 * The test names state what the old behaviour was, so a future change that
 * alters a figure says out loud which figure it altered.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';
import {
  computePointPrimitives,
  computeScatterPrimitives,
  computeLinePrimitives,
  computeBarPrimitives,
  computeHistogramBins,
  computeHeatmapPrimitives,
  heatCellColor,
  barAxisRange,
  visibleBarRange,
  paletteSlot,
  scatterPaletteSlot,
} from '../entry/src/main/ets/components/plot/plotGeometry.ts';
import { ViewPortHandler } from '../entry/src/main/ets/components/plot/ViewPortHandler.ts';

const PLOT_CANVAS = 'entry/src/main/ets/components/PlotCanvas.ets';
const PLOT_GEOMETRY = 'entry/src/main/ets/components/plot/plotGeometry.ts';

const readPlot = () => readFileSync(PLOT_CANVAS, 'utf-8');
const readGeometry = () => readFileSync(PLOT_GEOMETRY, 'utf-8');

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

/**
 * A plot 800x600 with the default margins (left 70, right 40, top 50,
 * bottom 60), so the plot rectangle is 690 x 490.
 */
function makeVp(minX: number, maxX: number, minY: number, maxY: number): ViewPortHandler {
  const vp = new ViewPortHandler();
  vp.setPlotSize(800, 600);
  vp.setDataRange([minX, maxX], [minY, maxY]);
  return vp;
}

// ─── Scatter ──────────────────────────────────────────────────────────────

describe('refactor: the scatter geometry is computed once, and it is the old geometry', () => {
  // X spans 0..1 and Y spans 1..4, so the viewport pads both by 10 %.
  // mapX(0) = 70 + 345 + (57.5 - 345) = 127.5 and mapX(1) = 702.5;
  // mapY(2) = 295 + (245 - 176.944444) = 363.055555...
  const vp = makeVp(0, 1, 1, 4);

  it('the scatter points sit at the viewport transform, as the canvas used to draw them', () => {
    const prim = computeScatterPrimitives(vp, [0, 1], [2, 3]);
    expect(prim.points).toHaveLength(2);
    expect(prim.points[0].px).toBe(127.5);
    expect(prim.points[1].px).toBe(702.5);
    expect(prim.points[0].py).toBeWithin(363.0555555555555, 1e-9);
    expect(prim.points[1].py).toBeWithin(226.94444444444446, 1e-9);
  });

  it('the scatter point positions ARE the viewport positions, bit for bit', () => {
    const prim = computeScatterPrimitives(vp, [0, 1], [2, 3]);
    expect(prim.points[0].px).toBe(vp.mapX(0));
    expect(prim.points[0].py).toBe(vp.mapY(2));
    expect(prim.points[1].px).toBe(vp.mapX(1));
    expect(prim.points[1].py).toBe(vp.mapY(3));
  });

  it('the zero line is drawn only when the data range straddles zero, as before', () => {
    // A range that does not straddle zero gets no zero line — the rule the
    // canvas used (`vp.minX < 0 && vp.maxX > 0`).
    const noZero = computeScatterPrimitives(vp, [0, 1], [2, 3]);
    expect(noZero.zeroX).toBeNull();
    expect(noZero.zeroY).toBeNull();

    const straddling = computeScatterPrimitives(makeVp(-1, 1, -2, 2), [-1, 0, 1], [-2, 0, 2]);
    // X spans -1..1 padded by 0.2, so 0 lands in the middle: 70 + 345 = 415.
    expect(straddling.zeroX).toBe(415);
    // Y spans -2..2 padded by 0.4, so 0 lands in the middle: 50 + 245 = 295.
    expect(straddling.zeroY).toBe(295);
  });

  it('the scatter colour slot is the group index modulo the palette length, as before', () => {
    expect(scatterPaletteSlot([0, 3, 5], 1, 6)).toBe(3);
    expect(scatterPaletteSlot([0, 3, 5], 2, 6)).toBe(5);
    // A group index beyond the palette wraps around — the old
    // `colors[groups[i] % colors.length]`.
    expect(scatterPaletteSlot([0, 7], 1, 6)).toBe(1);
  });

  it('an ungrouped scatter series takes the first palette slot, as before', () => {
    expect(scatterPaletteSlot(undefined, 0, 6)).toBe(0);
    expect(scatterPaletteSlot(undefined, 4, 6)).toBe(0);
  });

  it('the bar colour slot is the bar index modulo the palette length, as before', () => {
    expect(paletteSlot(0, 5)).toBe(0);
    expect(paletteSlot(7, 5)).toBe(2);
  });
});

// ─── Line ─────────────────────────────────────────────────────────────────

describe('refactor: the line geometry is computed once, and it is the old geometry', () => {
  const vp = makeVp(0, 1, 1, 4);

  it('the line vertices sit at the viewport transform, as the canvas used to draw them', () => {
    const prim = computeLinePrimitives(vp, [0, 1], [2, 3]);
    expect(prim.points).toHaveLength(2);
    expect(prim.points[0].px).toBe(127.5);
    expect(prim.points[1].px).toBe(702.5);
    expect(prim.points[0].py).toBeWithin(363.0555555555555, 1e-9);
    expect(prim.points[1].py).toBeWithin(226.94444444444446, 1e-9);
  });

  it('the line and the scatter agree on the same series — one implementation', () => {
    const x = [0, 0.5, 1];
    const y = [2, 2.5, 3];
    const line = computeLinePrimitives(vp, x, y);
    const scatter = computeScatterPrimitives(vp, x, y);
    expect(line.points.length).toBe(scatter.points.length);
    for (let i = 0; i < line.points.length; i++) {
      expect(line.points[i].px).toBe(scatter.points[i].px);
      expect(line.points[i].py).toBe(scatter.points[i].py);
    }
  });

  it('the point positions are the same list the line vertices come from', () => {
    const x = [0, 1];
    const y = [2, 3];
    const points = computePointPrimitives(vp, x, y);
    const line = computeLinePrimitives(vp, x, y);
    expect(line.points[0].px).toBe(points[0].px);
    expect(line.points[0].py).toBe(points[0].py);
  });

  it('a Y series shorter than the X series still yields one vertex per X value', () => {
    // The old loops ran over the X series, so a missing Y produced a NaN
    // pixel position rather than a shorter polyline.
    const prim = computeLinePrimitives(vp, [0, 1], [2]);
    expect(prim.points).toHaveLength(2);
    expect(isNaN(prim.points[1].py)).toBe(true);
  });
});

// ─── Bars ─────────────────────────────────────────────────────────────────

describe('refactor: the bar geometry is computed once, and it is the old geometry', () => {
  // X spans 0..9 (ten categories) and Y spans 0..10.
  const vp = makeVp(0, 9, 0, 10);
  // The first bar is NEGATIVE on purpose: it hangs below the baseline, which
  // is where the `min(top, baseline)` / `abs(baseline - top)` pair matters.
  const values = [-5, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  it('the bar rectangle grows from the zero baseline, as before', () => {
    const prim = computeBarPrimitives(vp, 10, values, 690);
    expect(prim.iStart).toBe(0);
    expect(prim.iEnd).toBe(9);
    // The baseline is mapY(0); one unit of Y is 490 / 12 = 40.8333... px.
    expect(prim.baseline).toBeWithin(499.1666666666667, 1e-9);
    // The slot is 690 / 10 = 69 px, the gap is 30 % of it, so the bar is
    // 48.3 px wide.
    expect(prim.barWidth).toBeWithin(48.3, 1e-9);

    const first = prim.bars[0];
    expect(first.index).toBe(0);
    expect(first.value).toBe(-5);
    expect(first.centerX).toBe(127.5);
    expect(first.x).toBeWithin(103.35, 1e-9);
    expect(first.width).toBe(prim.barWidth);
    // A negative bar hangs BELOW the baseline: its top edge IS the baseline.
    expect(first.y).toBe(prim.baseline);
    expect(first.height).toBeWithin(204.16666666666657, 1e-9);
  });

  it('a positive bar is drawn upwards from the baseline, as before', () => {
    const prim = computeBarPrimitives(vp, 10, values, 690);
    const second = prim.bars[1];
    expect(second.value).toBe(1);
    expect(second.centerX).toBeWithin(191.38888888888886, 1e-9);
    expect(second.x).toBeWithin(167.23888888888885, 1e-9);
    expect(second.y).toBeWithin(458.33333333333337, 1e-9);
    expect(second.height).toBeWithin(40.833333333333314, 1e-9);
    // The top edge is above the baseline, and the height is the distance
    // between the two.
    expect(second.y < prim.baseline).toBe(true);
    expect(second.height).toBeWithin(prim.baseline - second.y, 1e-9);
  });

  it('the bar positions ARE the viewport positions, bit for bit', () => {
    const prim = computeBarPrimitives(vp, 10, values, 690);
    expect(prim.bars[0].centerX).toBe(vp.mapX(0));
    expect(prim.bars[3].centerX).toBe(vp.mapX(3));
    expect(prim.baseline).toBe(vp.mapY(0));
  });

  it('an edge bar that would stick out of the plot rectangle is culled, as before', () => {
    // Zoomed in twice, the first and the last category stick out of the plot
    // rectangle: ArkUI's Canvas does not clip, so they have to be dropped —
    // and the bar width recomputed for the smaller count.
    const zoomed = makeVp(0, 9, 0, 10);
    zoomed.zoomTo(2);
    const range = visibleBarRange(zoomed, 10, 690);
    expect(range.iStart).toBe(3);
    expect(range.iEnd).toBe(6);

    const prim = computeBarPrimitives(zoomed, 10, values, 690);
    expect(prim.bars).toHaveLength(4);
    expect(prim.bars[0].index).toBe(3);
    expect(prim.bars[3].index).toBe(6);
    // Four visible bars: the slot is 690 / 4 = 172.5 px, the bar is 70 % of it.
    expect(prim.barWidth).toBeWithin(120.75, 1e-9);
  });

  it('an unzoomed bar chart keeps every bar, as before', () => {
    const range = visibleBarRange(vp, 10, 690);
    expect(range.iStart).toBe(0);
    expect(range.iEnd).toBe(9);
  });

  it('a chart with no bar at all draws nothing, as before', () => {
    const prim = computeBarPrimitives(vp, 0, [], 690);
    expect(prim.bars).toHaveLength(0);
    expect(prim.iEnd < prim.iStart).toBe(true);
  });
});

// ─── Histogram ────────────────────────────────────────────────────────────

describe('refactor: the histogram binning is computed once, and it is the old binning', () => {
  it('the largest sample still goes into the last bin', () => {
    // 0..9 in five bins of width 1.8: the sample 9 lands on bin 5 and is
    // clamped back into the last bin.
    const bins = computeHistogramBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
    expect(bins.min).toBe(0);
    expect(bins.max).toBe(9);
    expect(bins.binWidth).toBeWithin(1.8, 1e-9);
    expect(bins.counts).toEqual([2, 2, 2, 2, 2]);
  });

  it('a sample that sits exactly on a bin edge goes into the UPPER bin, as before', () => {
    // 0, 1.8 and 3.6 in three bins of width 1.2: 1.8 is bin 1 (not bin 0),
    // and 3.6 would be bin 3, clamped into bin 2.
    const bins = computeHistogramBins([0, 1.8, 3.6], 3);
    expect(bins.counts).toEqual([1, 1, 1]);
  });

  it('the histogram labels are the lower bin edges to one decimal, as before', () => {
    const bins = computeHistogramBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
    expect(bins.labels).toEqual(['0.0', '1.8', '3.6', '5.4', '7.2']);
  });

  it('a degenerate range falls back to a bin width of 1, as before', () => {
    // Every sample equal: the range is zero, so the width falls back to 1
    // and all the samples land in the first bin.
    const bins = computeHistogramBins([2, 2, 2], 3);
    expect(bins.binWidth).toBe(1);
    expect(bins.counts).toEqual([3, 0, 0]);
    expect(bins.labels).toEqual(['2.0', '3.0', '4.0']);
  });

  it('the histogram has as many bins as it was asked for, as before', () => {
    const bins = computeHistogramBins([1, 2, 3], 7);
    expect(bins.counts).toHaveLength(7);
    expect(bins.labels).toHaveLength(7);
  });
});

// ─── The categorical axis range ───────────────────────────────────────────

describe('refactor: the bar axis range is computed once, and it is the old range', () => {
  it('the bar axis spans the zero baseline and the bar values, as before', () => {
    const range = barAxisRange([3, 1, 2]);
    expect(range === null).toBe(false);
    if (range === null) throw new Error('no axis range');
    expect(range.xs).toEqual([0, 1, 2]);
    expect(range.ys).toEqual([0, 3, 1, 2]);
  });

  it('a bar chart with no values has no axis range, as before', () => {
    expect(barAxisRange([])).toBeNull();
  });
});

// ─── The heat map ─────────────────────────────────────────────────────────

describe('fix: the heat map on the canvas and in the export were two different figures', () => {
  // A 4x4 matrix in an 800x600 canvas: the plot rectangle is 690 x 490 and
  // the cells divide it into four columns and four rows.
  const matrix = [
    [1, -0.5, 0.2, 0.9],
    [-0.3, 1, 0.4, -0.7],
    [0.1, 0.6, 1, 0.2],
    [0.8, -0.1, 0.3, 1],
  ];
  const makeHeatVp = (): ViewPortHandler => {
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    vp.setDataRange([0, matrix[0].length - 1], [0, matrix.length - 1]);
    return vp;
  };
  const PW = 690, PH = 490;

  it('the cells divide the plot rectangle, as the canvas used to draw them', () => {
    const vp = makeHeatVp();
    const prim = computeHeatmapPrimitives(vp, matrix, PW, PH);
    expect(prim.rows).toBe(4);
    expect(prim.cols).toBe(4);
    expect(prim.cellWidth).toBeWithin(172.5, 1e-9);
    expect(prim.cellHeight).toBeWithin(122.5, 1e-9);
    // The first cell starts at the plot rectangle's top-left corner.
    expect(prim.cells[0].x).toBe(70);
    expect(prim.cells[0].y).toBe(50);
    expect(prim.cells[0].width).toBe(prim.cellWidth);
    expect(prim.cells[0].height).toBe(prim.cellHeight);
  });

  it('the whole grid stays inside the plot rectangle', () => {
    // This is the assertion that was RED before the fix: the exporter laid
    // its cells out with the viewport's cell pitch, which is wider than the
    // plot rectangle (the viewport pads the data range by 10 %), so the LAST
    // column ran 134 px out of the plot area, over the right margin.
    const vp = makeHeatVp();
    const prim = computeHeatmapPrimitives(vp, matrix, PW, PH);
    const right = vp.margin.left + PW;
    const bottom = vp.margin.top + PH;
    for (const cell of prim.cells) {
      expect(cell.x >= vp.margin.left - 1e-9).toBe(true);
      expect(cell.y >= vp.margin.top - 1e-9).toBe(true);
      expect(cell.x + cell.width <= right + 1e-9).toBe(true);
      expect(cell.y + cell.height <= bottom + 1e-9).toBe(true);
    }
    // The grid ends exactly on the plot rectangle's edge.
    expect(prim.cells[3].x + prim.cells[3].width).toBeWithin(right, 1e-9);
    expect(prim.cells[12].y + prim.cells[12].height).toBeWithin(bottom, 1e-9);
  });

  it('the exporter rule that was used before did not fit — the old cell pitch overflowed', () => {
    // The old exporter rule, spelled out, so the defect stays documented.
    const vp = makeHeatVp();
    const cw = Math.abs(vp.mapX(1) - vp.mapX(0));
    const oldLastRight = Math.min(vp.mapX(3), vp.mapX(4)) + cw;
    expect(oldLastRight > vp.margin.left + PW).toBe(true);
  });

  it('row 0 is at the top, as the canvas used to draw it', () => {
    // The exporter put row 0 at the BOTTOM (the viewport's Y axis is
    // inverted), so the exported matrix was upside down.
    const vp = makeHeatVp();
    const prim = computeHeatmapPrimitives(vp, matrix, PW, PH);
    expect(prim.cells[0].y < prim.cells[12].y).toBe(true);
    expect(prim.cells[0].row).toBe(0);
    expect(prim.cells[12].row).toBe(3);
  });

  it('the cell colours are the diverging scale of the canvas, not the cyan-to-white of the exporter', () => {
    // Blue at the low end, a muted mauve in the middle, red at the high end.
    expect(heatCellColor(0)).toBe('rgb(0,0,255)');
    expect(heatCellColor(0.5)).toBe('rgb(127,100,127)');
    expect(heatCellColor(1)).toBe('rgb(255,0,0)');
    // What the exporter used to write for the same value: cyan, and a
    // midpoint that is not neutral.
    expect('rgb(' + Math.round(0.5 * 255) + ',' + Math.round((1 - Math.abs(0.5 - 0.5) * 2) * 255) + ',255)')
      .toBe('rgb(128,255,255)');
  });

  it('the value annotation sits at the centre of its cell, as the canvas used to put it', () => {
    const vp = makeHeatVp();
    const prim = computeHeatmapPrimitives(vp, matrix, PW, PH);
    const cell = prim.cells[5];
    expect(cell.centerX).toBeWithin(cell.x + cell.width / 2, 1e-9);
    expect(cell.centerY).toBeWithin(cell.y + cell.height / 2, 1e-9);
    expect(cell.row).toBe(1);
    expect(cell.col).toBe(1);
  });

  it('the value range is the one the canvas used, with the same fallback', () => {
    const vp = makeHeatVp();
    const prim = computeHeatmapPrimitives(vp, matrix, PW, PH);
    expect(prim.min).toBe(-0.7);
    expect(prim.max).toBe(1);
    expect(prim.range).toBeWithin(1.7, 1e-9);
    // A matrix whose values are all equal falls back to a range of 1.
    const flat = computeHeatmapPrimitives(vp, [[2, 2], [2, 2]], PW, PH);
    expect(flat.range).toBe(1);
    expect(flat.cells[0].norm).toBe(0);
  });
});

// ─── The EPS export ──────────────────────────────────────────────────────

describe('fix: the EPS export was a third copy of the scatter geometry', () => {
  it('the EPS export consumes the same scatter primitives as the canvas', () => {
    const code = stripComments(readPlot());
    const eps = method(code, 'private buildEPS(', 'exportEPS(');
    expect(eps.includes('computeScatterPrimitives(')).toBe(true);
    // The third copy of the geometry is gone.
    expect(eps.includes('this.mapX(')).toBe(false);
    expect(eps.includes('this.mapY(')).toBe(false);
  });

  it('the EPS export keeps the PostScript Y flip', () => {
    const code = stripComments(readPlot());
    const eps = method(code, 'private buildEPS(', 'exportEPS(');
    // PostScript's origin is the bottom-left corner, so the Y axis is
    // flipped; the X axis is not.
    expect(eps.includes('this.canvasHeight -')).toBe(true);
  });

  it('the EPS points are bit for bit the points the old inline formula produced', () => {
    // The differential: the old EPS formula (mapX / canvasHeight - mapY)
    // against the shared primitives.
    const vp = new ViewPortHandler();
    vp.setPlotSize(800, 600);
    vp.setDataRange([0, 1], [1, 2, 3, 4]);
    vp.zoomTo(2.5);
    vp.panBy(30, -12);
    const canvasHeight = 600;
    const x = [0, 0.5, 1];
    const y = [2, 2.5, 3];
    const prim = computeScatterPrimitives(vp, x, y);
    for (let i = 0; i < x.length; i++) {
      const oldPx = vp.mapX(x[i]).toFixed(1);
      const oldPy = (canvasHeight - vp.mapY(y[i])).toFixed(1);
      expect(prim.points[i].px.toFixed(1)).toBe(oldPx);
      expect((canvasHeight - prim.points[i].py).toFixed(1)).toBe(oldPy);
    }
  });
});

// ─── The two renderers read the same implementation ───────────────────────

describe('refactor: the canvas renderer and the SVG exporter read ONE geometry', () => {
  const src = readPlot();

  it('the canvas branches consume the shared primitives', () => {
    const code = stripComments(src);
    expect(method(code, 'private drawScatter(', 'private drawLine(').includes('computeScatterPrimitives(')).toBe(true);
    expect(method(code, 'private drawLine(', 'private drawBar(').includes('computeLinePrimitives(')).toBe(true);
    expect(method(code, 'private drawBar(', 'private drawBoxPlot(').includes('computeBarPrimitives(')).toBe(true);
    // The signature has to be specific: `setHistogramData(` also occurs at
    // the call site in ingestInputData().
    expect(method(code, 'setHistogramData(data: number[]', 'setBoxPlotData(groups:').includes('computeHistogramBins(')).toBe(true);
  });

  it('the SVG exporter consumes the same shared primitives', () => {
    const code = stripComments(src);
    const svg = method(code, 'private buildSVG(', 'private async requestExport(');
    expect(svg.includes('computeScatterPrimitives(')).toBe(true);
    expect(svg.includes('computeLinePrimitives(')).toBe(true);
    expect(svg.includes('computeBarPrimitives(')).toBe(true);
  });

  it('the private geometry helpers are gone from the component', () => {
    const code = stripComments(src);
    // The visible-bar-range rule used to be a PRIVATE method of the
    // component, where no test could reach it.
    expect(code.includes('private visibleBarRange(')).toBe(false);
    // The histogram binning used to be inline in setHistogramData().
    expect(method(code, 'setHistogramData(data: number[]', 'setBoxPlotData(groups:').includes('Math.floor((v - min) / binW)')).toBe(false);
  });

  it('the component no longer computes the bar rectangles on its own', () => {
    const code = stripComments(src);
    expect(method(code, 'private drawBar(', 'private drawBoxPlot(').includes('ChartComputator.barLayout(')).toBe(false);
    expect(method(code, 'private buildSVG(', 'private async requestExport(').includes('ChartComputator.barLayout(')).toBe(false);
  });

  it('the canvas and the exporter now read the SAME heat map cells', () => {
    const code = stripComments(src);
    // This assertion was RED before the fix: the exporter computed its own
    // cell pitch and its own colour scale, so the exported heat map was a
    // different figure from the one on screen.
    expect(method(code, 'private drawHeatmap(', 'private handleHover(').includes('computeHeatmapPrimitives(')).toBe(true);
    const svg = method(code, 'private buildSVG(', 'private async requestExport(');
    expect(svg.includes('computeHeatmapPrimitives(')).toBe(true);
    // Neither branch lays the cells out on its own any more.
    expect(code.includes('const cellW = pw / nCols')).toBe(false);
    expect(code.includes('Math.abs(this.mapX(1) - this.mapX(0))')).toBe(false);
    expect(code.includes('Math.round(t * 255)')).toBe(false);
  });

  it('the shared geometry module has no ArkUI dependency', () => {
    // It has to be importable from a plain Node test.
    const code = readGeometry();
    expect(code.includes('@kit.')).toBe(false);
    expect(code.includes('@ohos.')).toBe(false);
    expect(code.includes('@ohos')).toBe(false);
  });
});
