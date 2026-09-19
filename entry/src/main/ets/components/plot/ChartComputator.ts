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
   * Ticks along the X axis, evenly spaced in DATA space.
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
    const span = vp.maxX - vp.minX;
    for (let i = 0; i <= n; i++) {
      const value = vp.minX + (span * i) / n;
      out.push({
        value,
        pixel: vp.mapX(value),
        label: formatter ? formatter(value) : value.toFixed(2),
      });
    }
    return out;
  }

  /** Ticks along the Y axis, evenly spaced in DATA space. */
  static yTicks(
    vp: ViewPortHandler,
    divisions: number = ChartComputator.DEFAULT_DIVISIONS,
    formatter?: (v: number) => string,
  ): AxisTick[] {
    const out: AxisTick[] = [];
    const n = Math.max(1, divisions);
    const span = vp.maxY - vp.minY;
    for (let i = 0; i <= n; i++) {
      const value = vp.minY + (span * i) / n;
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
   * given the plot width and the number of bars.
   */
  static barLayout(vp: ViewPortHandler, count: number, gapRatio: number = 0.2): { barWidth: number; gap: number } {
    const pw = vp.plotWidth;
    const slot = pw / Math.max(1, count);
    const gap = slot * gapRatio;
    return { barWidth: Math.max(1, slot - gap), gap };
  }
}
