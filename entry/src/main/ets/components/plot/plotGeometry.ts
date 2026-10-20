/**
 * plotGeometry — the scatter / line / histogram / bar geometry, shared by the
 * canvas renderer and the exporter.
 *
 * Why this file exists
 * --------------------
 * The box plot was fixed on 2026-10-19 the same way this file fixes the other
 * four chart types: the on-screen figure and the exported figure were two
 * implementations of the same geometry, and each had to be kept in step with
 * the other by hand.
 *
 * For the scatter, line, histogram and bar charts the two renderers lived in
 * the same file, so the duplication was less obvious — but it was there:
 *
 *   | chart    | canvas branch                | SVG branch                |
 *   |----------|------------------------------|---------------------------|
 *   | scatter  | `drawScatter()`              | `buildSVG()` case 'scatter'|
 *   | line     | `drawLine()`                 | `buildSVG()` case 'line'  |
 *   | bar      | `drawBar()` + `visibleBarRange()` | `buildSVG()` case 'bar'|
 *   | histogram| `setHistogramData()`         | (stored as a bar chart)   |
 *
 * Every coordinate was computed twice, and the rules that decide them — which
 * bars are visible, where the baseline is, how a value is binned, which
 * palette slot a point gets — were written twice as well. A change to one
 * copy was not a change to the figure.
 *
 * Everything that decides a coordinate now lives here, and both renderers
 * consume the SAME primitives — so they cannot drift apart again. The
 * coordinate transform comes from `ViewPortHandler`, the single source of truth
 * for the plot's coordinate system.
 *
 * Plain `.ts` with no ArkUI dependency, so it can be unit tested in Node.
 */
import { ViewPortHandler } from './ViewPortHandler';
import { ChartComputator } from './ChartComputator';

/** One point of a series, in pixels. */
export interface PointPrimitive {
  /** Index of the point in the series. */
  index: number;
  /** Pixel X of the point. */
  px: number;
  /** Pixel Y of the point. */
  py: number;
}

/** The scatter plot's geometry. */
export interface ScatterPrimitives {
  /** The points of the series, in pixels. */
  points: PointPrimitive[];
  /**
   * Pixel X of the vertical zero line, or `null` when no zero line is drawn.
   *
   * The canvas draws the zero lines; the SVG exporter does not (it never did).
   * The DECISION lives here, so the two cannot answer it differently.
   */
  zeroX: number | null;
  /** Pixel Y of the horizontal zero line, or `null` when there is none. */
  zeroY: number | null;
}

/** The line chart's geometry. */
export interface LinePrimitives {
  /**
   * The polyline's vertices, in pixels.
   *
   * The same array is the marker positions: the canvas draws a small circle on
   * every vertex, and the exporter draws only the polyline.
   */
  points: PointPrimitive[];
}

/** One bar of a categorical bar chart (or one histogram bin). */
export interface BarPrimitive {
  /** Index of the bar in the series. */
  index: number;
  /** The bar's value. */
  value: number;
  /** Pixel X of the bar's centre. */
  centerX: number;
  /** Pixel X of the bar's left edge. */
  x: number;
  /** Pixel Y of the bar's top edge — the smaller of the value and the baseline. */
  y: number;
  /** Width of the bar, in pixels. */
  width: number;
  /** Height of the bar, in pixels — the distance from the baseline. */
  height: number;
}

/** The index range of the visible bars. */
export interface VisibleRange {
  /** Index of the first visible bar. */
  iStart: number;
  /** Index of the last visible bar (`iStart - 1` when nothing is visible). */
  iEnd: number;
}

/** The bar chart's geometry. */
export interface BarPrimitives {
  /** Index of the first visible bar. */
  iStart: number;
  /** Index of the last visible bar (`iStart - 1` when nothing is visible). */
  iEnd: number;
  /** Width of every visible bar, in pixels. */
  barWidth: number;
  /** Pixel Y of the zero baseline the bars grow from. */
  baseline: number;
  /** The visible bars, in order. */
  bars: BarPrimitive[];
}

/** The histogram's bins. */
export interface HistogramBins {
  /** Smallest value of the sample. */
  min: number;
  /** Largest value of the sample. */
  max: number;
  /** Width of one bin. */
  binWidth: number;
  /** Number of observations per bin. */
  counts: number[];
  /** The bin labels: the lower edge of each bin, to one decimal. */
  labels: string[];
}

/** The axis range of a categorical chart. */
export interface AxisRange {
  /** X values — the category indices. */
  xs: number[];
  /** Y values — the baseline plus the bar values. */
  ys: number[];
}

// ─── Heat maps ────────────────────────────────────────────────────────────

/** One cell of a heat map. */
export interface HeatCell {
  /** Row index in the matrix. */
  row: number;
  /** Column index in the matrix. */
  col: number;
  /** The cell's value. */
  value: number;
  /** The value normalised to 0..1 across the whole matrix. */
  norm: number;
  /** Pixel X of the cell's left edge. */
  x: number;
  /** Pixel Y of the cell's top edge. */
  y: number;
  /** Width of the cell, in pixels. */
  width: number;
  /** Height of the cell, in pixels. */
  height: number;
  /** Pixel X of the cell's centre. */
  centerX: number;
  /** Pixel Y of the cell's centre. */
  centerY: number;
  /** The cell's fill colour, as `rgb(r,g,b)`. */
  fill: string;
}

/** The heat map's geometry. */
export interface HeatmapPrimitives {
  /** Number of rows. */
  rows: number;
  /** Number of columns. */
  cols: number;
  /** Smallest value in the matrix. */
  min: number;
  /** Largest value in the matrix. */
  max: number;
  /** The value span (max - min), or 1 when every value is the same. */
  range: number;
  /** Width of one cell, in pixels. */
  cellWidth: number;
  /** Height of one cell, in pixels. */
  cellHeight: number;
  /** The cells, row by row. */
  cells: HeatCell[];
}

/**
 * The fill colour of a heat-map cell.
 *
 * A diverging scale: blue at the low end, a muted neutral in the middle,
 * orange at the high end. The green channel is capped at 100 on purpose, so
 * that the middle of the scale stays grey instead of washing out.
 *
 * The exporter used a different scale (cyan to white, never dark, and rounded
 * instead of floored), so the exported figure was not the figure on screen.
 */
export function heatCellColor(norm: number): string {
  const r = Math.floor(norm * 255);
  const g = Math.floor(100 * (1 - Math.abs(norm - 0.5) * 2));
  const b = Math.floor((1 - norm) * 255);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

/**
 * The cells of a heat map, in pixels.
 *
 * The grid divides the plot rectangle into equal cells: `plotWidthPx /
 * cols` wide and `plotHeightPx / rows` tall, the first cell starting at the
 * plot rectangle's top-left corner. That is the rule the canvas used, and it
 * is the one that keeps the whole grid INSIDE the plot rectangle.
 *
 * The exporter used the viewport's cell pitch instead (`mapX(1) - mapX(0)`),
 * which is wider because the viewport pads the data range by 10 %. The last
 * column therefore started half a pitch too far right and ran out of the plot
 * area, over the margin — the exported grid was not the grid on screen.
 *
 * `plotWidthPx` / `plotHeightPx` are the caller's own values, which are NOT
 * the same as `vp.plotWidth` / `vp.plotHeight` when the canvas is smaller
 * than the margins.
 */
export function computeHeatmapPrimitives(
  vp: ViewPortHandler,
  matrix: number[][],
  plotWidthPx: number,
  plotHeightPx: number,
): HeatmapPrimitives {
  const nRows = matrix.length;
  const nCols = nRows > 0 ? (matrix[0]?.length ?? 0) : 0;
  let minV = Infinity, maxV = -Infinity;
  for (const row of matrix) for (const v of row) { minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
  const range = maxV - minV || 1;
  const cellWidth = plotWidthPx / nCols;
  const cellHeight = plotHeightPx / nRows;
  const cells: HeatCell[] = [];
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      const norm = (matrix[i][j] - minV) / range;
      const x = vp.margin.left + j * cellWidth;
      const y = vp.margin.top + i * cellHeight;
      cells.push({
        row: i,
        col: j,
        value: matrix[i][j],
        norm: norm,
        x: x,
        y: y,
        width: cellWidth,
        height: cellHeight,
        centerX: x + cellWidth / 2,
        centerY: y + cellHeight / 2,
        fill: heatCellColor(norm),
      });
    }
  }
  return {
    rows: nRows,
    cols: nCols,
    min: minV,
    max: maxV,
    range: range,
    cellWidth: cellWidth,
    cellHeight: cellHeight,
    cells: cells,
  };
}

// ─── Points ───────────────────────────────────────────────────────────────

/**
 * The pixel position of every point of a series.
 *
 * The loop runs over the X series, so a Y series that is shorter than the X
 * series produces `NaN` pixel positions for the missing points — exactly what
 * the renderers computed before, when each of them did this loop on its own.
 */
export function computePointPrimitives(vp: ViewPortHandler, x: number[], y: number[]): PointPrimitive[] {
  const points: PointPrimitive[] = [];
  for (let i = 0; i < x.length; i++) {
    points.push({ index: i, px: vp.mapX(x[i]), py: vp.mapY(y[i]) });
  }
  return points;
}

/**
 * The scatter plot's geometry: the points plus the two zero lines.
 *
 * A zero line is drawn only when the data range straddles zero — the rule the
 * canvas used, kept as it is.
 */
export function computeScatterPrimitives(vp: ViewPortHandler, x: number[], y: number[]): ScatterPrimitives {
  return {
    points: computePointPrimitives(vp, x, y),
    zeroX: (vp.minX < 0 && vp.maxX > 0) ? vp.mapX(0) : null,
    zeroY: (vp.minY < 0 && vp.maxY > 0) ? vp.mapY(0) : null,
  };
}

/** The line chart's geometry: the polyline's vertices. */
export function computeLinePrimitives(vp: ViewPortHandler, x: number[], y: number[]): LinePrimitives {
  return { points: computePointPrimitives(vp, x, y) };
}

// ─── Bars and histograms ──────────────────────────────────────────────────

/**
 * Which bars of a categorical X axis fall inside the plot rectangle.
 *
 * Two passes, because the bar width depends on how many bars are visible:
 *   1. take the index range whose CENTRES are inside the plot rect
 *   2. drop an edge bar whose rectangle would stick out past the axes, then
 *      recompute the width for the smaller count
 * Step 2 matters because ArkUI's Canvas does not clip: a bar drawn past the
 * plot edge simply paints over the axis and the margin. The loop terminates
 * because every pass removes at least one index.
 *
 * `plotWidthPx` is the width of the plot rectangle in pixels — the caller's
 * own value, which is NOT the same as `vp.plotWidth` when the canvas is
 * smaller than the margins.
 */
export function visibleBarRange(
  vp: ViewPortHandler,
  labelCount: number,
  plotWidthPx: number,
): VisibleRange {
  const leftPx = vp.margin.left;
  const rightPx = leftPx + plotWidthPx;
  const a = vp.unmapX(leftPx);
  const b = vp.unmapX(rightPx);
  let iStart = Math.max(0, Math.ceil(Math.min(a, b)));
  let iEnd = Math.min(labelCount - 1, Math.floor(Math.max(a, b)));
  let changed = true;
  while (changed && iEnd >= iStart && labelCount > 0) {
    changed = false;
    const w = ChartComputator.barLayout(vp, iEnd - iStart + 1, 0.3).barWidth;
    if (vp.mapX(iStart) - w / 2 < leftPx) { iStart++; changed = true; }
    if (iEnd >= iStart && vp.mapX(iEnd) + w / 2 > rightPx) { iEnd--; changed = true; }
  }
  return { iStart: iStart, iEnd: iEnd };
}

/**
 * The bars of a categorical bar chart, in pixels.
 *
 * The canvas renderer and the SVG exporter both call this, so the two draw the
 * same figure — same visible range, same width, same baseline, same rectangles.
 * The Y coordinates come from `vp.mapY` (so zoom and pan move the bars with
 * the axes) and the X centres from `vp.mapX` (so the bars sit on their own
 * tick, not on a hand-computed pixel offset).
 */
export function computeBarPrimitives(
  vp: ViewPortHandler,
  labelCount: number,
  values: number[],
  plotWidthPx: number,
): BarPrimitives {
  const range = visibleBarRange(vp, labelCount, plotWidthPx);
  const iStart = range.iStart;
  const iEnd = range.iEnd;
  const barWidth = ChartComputator.barLayout(vp, iEnd - iStart + 1, 0.3).barWidth;
  const baseline = vp.mapY(0);
  const bars: BarPrimitive[] = [];
  for (let i = iStart; i <= iEnd; i++) {
    const centerX = vp.mapX(i);
    const top = vp.mapY(values[i]);
    bars.push({
      index: i,
      value: values[i],
      centerX: centerX,
      x: centerX - barWidth / 2,
      y: Math.min(top, baseline),
      width: barWidth,
      height: Math.abs(baseline - top),
    });
  }
  return {
    iStart: iStart,
    iEnd: iEnd,
    barWidth: barWidth,
    baseline: baseline,
    bars: bars,
  };
}

/**
 * The axis range of a categorical bar chart (a bar chart or a histogram).
 *
 * X is the category index, Y spans the baseline (0) and the tallest bar, so
 * the bars grow from a zero baseline and the axis labels are readable.
 */
export function barAxisRange(values: number[]): AxisRange | null {
  if (!values || values.length === 0) return null;
  return {
    xs: values.map((_: number, i: number) => i),
    ys: [0].concat(values),
  };
}

/**
 * The bins of a histogram.
 *
 * The bin edges are `min + i * binWidth`, the value of a sample goes into the
 * bin `floor((v - min) / binWidth)` — so a sample that sits exactly on an
 * edge goes into the UPPER bin — and the largest sample is clamped into the
 * LAST bin. The labels are the lower edges, to one decimal.
 *
 * A sample whose bin index would be negative is dropped. A degenerate range
 * (every sample equal) falls back to a bin width of 1, so all the samples
 * land in the first bin.
 */
export function computeHistogramBins(data: number[], nBins: number = 30): HistogramBins {
  const min = data.reduce((a: number, b: number) => Math.min(a, b), Infinity);
  const max = data.reduce((a: number, b: number) => Math.max(a, b), -Infinity);
  const binWidth = (max - min) / nBins || 1;
  const counts = new Array(nBins).fill(0);
  for (const v of data) {
    const idx = Math.min(Math.floor((v - min) / binWidth), nBins - 1);
    if (idx >= 0) counts[idx]++;
  }
  const labels = counts.map((_: number, i: number) => (min + i * binWidth).toFixed(1));
  return { min: min, max: max, binWidth: binWidth, counts: counts, labels: labels };
}

// ─── Palette ──────────────────────────────────────────────────────────────

/**
 * The colour slot of an item: its index modulo the palette length.
 *
 * Both renderers picked the palette entry the same way, but each wrote the
 * expression out for itself. `index % length` is kept exactly as it was — in
 * particular it is NOT clamped, so a negative index still selects a
 * non-existent slot (and therefore no colour at all), as before.
 */
export function paletteSlot(index: number, paletteLength: number): number {
  return index % paletteLength;
}

/**
 * The colour slot of a scatter point: its group, or the first slot when the
 * series carries no groups.
 */
export function scatterPaletteSlot(
  groups: number[] | undefined,
  index: number,
  paletteLength: number,
): number {
  return groups ? groups[index] % paletteLength : 0;
}
