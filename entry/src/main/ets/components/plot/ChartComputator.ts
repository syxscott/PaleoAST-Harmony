/**
 * ChartComputator — axis tick computation.
 *
 * The renderer drew a fixed 5 divisions and the SVG exporter drew the same 5
 * divisions from its own copy of the loop, so the two could drift apart. Both
 * now ask this class for the tick values and their positions.
 *
 * A plain class so the tick maths can be unit tested in Node.
 */
import { ViewPortHandler } from './ViewPortHandler';

export interface AxisTick {
  /** Data value at the tick. */
  value: number;
  /** Pixel position along the axis (x for the X axis, y for the Y axis). */
  pixel: number;
  /** Pre-formatted label. */
  label: string;
}

export class ChartComputator {
  static readonly DEFAULT_DIVISIONS: number = 5;

  /**
   * The data window the ticks must cover: whatever part of the DATA range is
   * currently visible inside the plot rectangle.
   *
   * The tick values used to be spread across the full data range while only
   * their PIXEL positions went through mapX/mapY. Zoom and pan therefore moved
   * the tick marks but left their labels on the un-zoomed values, so after
   * zooming in, labels were spaced 2x further apart in pixels and the outer
   * ones were drawn outside the plot area entirely — on the Y axis, the "0.00"
   * label of a 0..88 bar chart ended up below the axes. This affected every
   * chart type, not just bars.
   *
   * Deriving the window from the plot rect through unmapX/unmapY fixes it for
   * zoom and pan at once. The window is then intersected with the data range so
   * that the un-zoomed, un-panned case still yields exactly [min, max] — that is
   * the behaviour the rest of the renderer and the existing tests rely on — and
   * so no tick is ever labelled for data that is not there.
   */
  private static visibleWindow(
    vp: ViewPortHandler,
    axis: 'x' | 'y',
  ): [number, number] {
    if (axis === 'x') {
      const a = vp.unmapX(vp.margin.left);
      const b = vp.unmapX(vp.margin.left + vp.plotWidth);
      const lo = Math.max(vp.minX, Math.min(a, b));
      const hi = Math.min(vp.maxX, Math.max(a, b));
      return hi > lo ? [lo, hi] : [vp.minX, vp.maxX];
    }
    const a = vp.unmapY(vp.margin.top);
    const b = vp.unmapY(vp.margin.top + vp.plotHeight);
    // Y is inverted on screen, so the smaller data value is at the bottom.
    const lo = Math.max(vp.minY, Math.min(a, b));
    const hi = Math.min(vp.maxY, Math.max(a, b));
    return hi > lo ? [lo, hi] : [vp.minY, vp.maxY];
  }

  /**
   * Ticks along the X axis, evenly spaced across the visible window.
   *
   * @param formatter optional formatter; defaults to 2 decimals to preserve the
   *   previous label style.
   */
  static xTicks(
    vp: ViewPortHandler,
    divisions: number = ChartComputator.DEFAULT_DIVISIONS,
    formatter?: (v: number) => string,
  ): AxisTick[] {
    const out: AxisTick[] = [];
    const n = Math.max(1, divisions);
    const [lo, hi] = ChartComputator.visibleWindow(vp, 'x');
    const span = hi - lo;
    for (let i = 0; i <= n; i++) {
      const value = lo + (span * i) / n;
      out.push({
        value,
        pixel: vp.mapX(value),
        label: formatter ? formatter(value) : value.toFixed(2),
      });
    }
    return out;
  }

  /** Ticks along the Y axis, evenly spaced across the visible window. */
  static yTicks(
    vp: ViewPortHandler,
    divisions: number = ChartComputator.DEFAULT_DIVISIONS,
    formatter?: (v: number) => string,
  ): AxisTick[] {
    const out: AxisTick[] = [];
    const n = Math.max(1, divisions);
    const [lo, hi] = ChartComputator.visibleWindow(vp, 'y');
    const span = hi - lo;
    for (let i = 0; i <= n; i++) {
      const value = lo + (span * i) / n;
      out.push({
        value,
        pixel: vp.mapY(value),
        label: formatter ? formatter(value) : value.toFixed(2),
      });
    }
    return out;
  }

  /**
   * Layout for a vertical bar chart: bar width and the x offset for each slot,
   * given the plot width and the number of bars being laid out.
   *
   * This is pure geometry — it does NOT consult the data range. Where each bar
   * ends up is the renderer's job, and drawBar() places bars with
   * `vp.mapX(index)` / `vp.mapY(value)` so that zoom and pan move them in step
   * with the axes, exactly as they do for scatter and line. A previous attempt
   * to make the slot width zoom-aware here instead broke the case where no data
   * range has been set yet, and would have needed drawBar() to cull and offset
   * as well to stay correct.
   */
  static barLayout(vp: ViewPortHandler, count: number, gapRatio: number = 0.2): { barWidth: number; gap: number } {
    const pw = vp.plotWidth;
    const slot = pw / Math.max(1, count);
    const gap = slot * gapRatio;
    return { barWidth: Math.max(1, slot - gap), gap };
  }
}
