/**
 * ChartHighlighter — maps a screen position to the nearest data point.
 *
 * Hit testing used to be inlined in PlotCanvas: the same "scan every point,
 * keep the closest within a radius" loop was written out separately for hover
 * and for click, each with its own copy of the inverse transform. Both now call
 * this one predicate, which also means the selection radius is defined once.
 *
 * A plain class (no ArkUI dependency) so it can be unit tested in Node.
 */
import { ViewPortHandler } from './ViewPortHandler';

export class ChartHighlighter {
  /** Default pick radius in vp. */
  static readonly DEFAULT_RADIUS: number = 10;

  /**
   * Index of the point closest to (px, py), or -1 when nothing is within
   * `radius`. Plots a dense series differently from a sparse one by accepting
   * the caller's radius rather than baking in a constant.
   */
  static nearestIndex(
    vp: ViewPortHandler,
    xs: number[],
    ys: number[],
    px: number,
    py: number,
    radius: number = ChartHighlighter.DEFAULT_RADIUS,
  ): number {
    const n = Math.min(xs.length, ys.length);
    let best = -1;
    let bestDist = radius * radius;
    for (let i = 0; i < n; i++) {
      const dx = px - vp.mapX(xs[i]);
      const dy = py - vp.mapY(ys[i]);
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDist) {
        bestDist = d2;
        best = i;
      }
    }
    return best;
  }

  /**
   * All indices whose data-space X falls within ±span*ratio of `dataX`.
   * Used by the box-select style interaction.
   */
  static indicesNearDataX(xs: number[], dataX: number, ratio: number = 0.02): number[] {
    const out: number[] = [];
    if (xs.length === 0) {
      return out;
    }
    const lo = xs.reduce((a, b) => Math.min(a, b), Infinity);
    const hi = xs.reduce((a, b) => Math.max(a, b), -Infinity);
    const tol = (hi - lo) * ratio || 1e-9;
    for (let i = 0; i < xs.length; i++) {
      if (Math.abs(xs[i] - dataX) <= tol) {
        out.push(i);
      }
    }
    return out;
  }
}
