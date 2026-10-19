/**
 * boxGeometry — the box-plot geometry, shared by the canvas and the exporter.
 *
 * Why this file exists
 * --------------------
 * The on-screen box plot and the exported SVG used to be two implementations
 * of the same figure, and they disagreed in four ways:
 *
 *   | dimension     | canvas (drawBoxPlot)   | SVG export          |
 *   |----------------|------------------------|---------------------|
 *   | Y transform   | a local formula        | `vp.mapY` (viewport)|
 *   | X layout      | `margin.left + i*(…)`  | `vp.mapX(group)`    |
 *   | quartiles     | `sorted[floor(n*q)]`   | R-7 interpolation   |
 *   | whiskers      | Tukey 1.5xIQR          | min .. max          |
 *
 * So the exported figure was not the figure on screen, the canvas ignored
 * zoom and pan, and the canvas median of an even-sized sample was the UPPER
 * of the two middle values (`sorted[floor(n*0.5)]`) instead of their mean.
 *
 * Everything that decides a box's shape and position now lives here, and both
 * renderers consume the SAME primitives — so they cannot drift apart again.
 * The coordinate transform comes from `ViewPortHandler`, the single source of
 * truth for the plot's coordinate system.
 *
 * Plain `.ts` with no ArkUI dependency, so it can be unit tested in Node.
 */
import { ViewPortHandler } from './ViewPortHandler';
import { ChartComputator } from './ChartComputator';

/** One group of values to be summarised by a box. */
export interface BoxGroup {
  label: string;
  values: number[];
}

/** The five-number summary of one group. */
export interface BoxStats {
  /** Number of values. */
  n: number;
  /** Smallest value. */
  min: number;
  /** First quartile (25%). */
  q1: number;
  /** Median (50%). */
  median: number;
  /** Third quartile (75%). */
  q3: number;
  /** Largest value. */
  max: number;
  /** Lower whisker: the smallest value inside the 1.5*IQR fence. */
  lowerWhisker: number;
  /** Upper whisker: the largest value inside the 1.5*IQR fence. */
  upperWhisker: number;
}

/** A box, in data units and in pixels. */
export interface BoxPrimitive {
  /** Index of the group in the series. */
  index: number;
  /** Label of the group. */
  label: string;
  /** The five-number summary, in data units. */
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  lowerWhisker: number;
  upperWhisker: number;
  /** Centre of the box, in pixels. */
  centerX: number;
  /** Width of the box, in pixels. */
  boxWidth: number;
  /** Width of a whisker cap, in pixels. */
  capWidth: number;
  /** Pixel Y of the lower whisker. */
  yLower: number;
  /** Pixel Y of the first quartile. */
  yQ1: number;
  /** Pixel Y of the median. */
  yMedian: number;
  /** Pixel Y of the third quartile. */
  yQ3: number;
  /** Pixel Y of the upper whisker. */
  yUpper: number;
}

/**
 * Quantile of a SORTED sample, R-7 style (linear interpolation between the
 * two order statistics that bracket the quantile).
 *
 * R-7 is the default of R's `quantile()` and of numpy's default, and it is
 * what the SVG exporter used. The canvas used `sorted[floor(n*q)]`, which for
 * an even-sized sample takes the UPPER of the two middle values: the median
 * of [1, 2, 3, 4] was 3 instead of 2.5.
 */
export function quantile(sorted: number[], f: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = (n - 1) * f;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Five-number summary of one group, with Tukey whiskers.
 *
 * The whiskers reach the most extreme values that are still inside the
 * 1.5*IQR fences — not the absolute minimum and maximum, which is what the
 * SVG exporter drew.
 */
export function boxStats(values: number[]): BoxStats {
  const sorted = values.slice().sort((a: number, b: number) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return {
      n: 0, min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN,
      lowerWhisker: NaN, upperWhisker: NaN,
    };
  }
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  let lower = sorted[0];
  for (let i = 0; i < n; i++) {
    if (sorted[i] >= lowerFence) { lower = sorted[i]; break; }
  }
  let upper = sorted[n - 1];
  for (let i = n - 1; i >= 0; i--) {
    if (sorted[i] <= upperFence) { upper = sorted[i]; break; }
  }
  return {
    n: n,
    min: sorted[0],
    q1: q1,
    median: median,
    q3: q3,
    max: sorted[n - 1],
    lowerWhisker: lower,
    upperWhisker: upper,
  };
}

/**
 * The boxes of a box-plot chart, in pixels.
 *
 * The canvas renderer and the SVG exporter both call this, so the two draw
 * the same figure — same quartiles, same whiskers, same pixel positions.
 * The Y coordinates come from `vp.mapY` (so zoom and pan move the boxes with
 * the axes) and the X centres from `vp.mapX` (so the boxes sit on their own
 * tick, not on a hand-computed pixel offset).
 */
export function computeBoxPrimitives(vp: ViewPortHandler, groups: BoxGroup[]): BoxPrimitive[] {
  const out: BoxPrimitive[] = [];
  const boxWidth = ChartComputator.barLayout(vp, groups.length, 0.4).barWidth;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const st = boxStats(group.values);
    if (st.n === 0) continue;
    out.push({
      index: i,
      label: group.label,
      n: st.n,
      min: st.min,
      q1: st.q1,
      median: st.median,
      q3: st.q3,
      max: st.max,
      lowerWhisker: st.lowerWhisker,
      upperWhisker: st.upperWhisker,
      centerX: vp.mapX(i),
      boxWidth: boxWidth,
      capWidth: boxWidth * 0.4,
      yLower: vp.mapY(st.lowerWhisker),
      yQ1: vp.mapY(st.q1),
      yMedian: vp.mapY(st.median),
      yQ3: vp.mapY(st.q3),
      yUpper: vp.mapY(st.upperWhisker),
    });
  }
  return out;
}
