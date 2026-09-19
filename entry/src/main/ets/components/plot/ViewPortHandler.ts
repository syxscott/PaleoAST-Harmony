/**
 * ViewPortHandler — the single source of truth for the plot's coordinate system.
 *
 * Before this existed, the data range, zoom factor, pan offsets and the plot
 * margin lived as loose fields on the PlotCanvas component, and the value<->pixel
 * transform was duplicated between the on-screen renderer, the SVG exporter and
 * the hit-testing code. Every one of those copies had to be kept in sync by hand.
 *
 * Everything about "where does a data value land on screen" now goes through
 * this class, so:
 *   - the Canvas renderer and the SVG exporter share one transform;
 *   - hit testing inverts that same transform instead of re-deriving it;
 *   - the logic is a plain class with no ArkUI dependency, so it can be unit
 *     tested in Node alongside the core modules.
 *
 * The Y axis is inverted (larger values map to smaller pixel Y), matching the
 * convention the renderers already used.
 */

export interface ViewPortMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export class ViewPortHandler {
  static readonly MIN_ZOOM: number = 0.1;
  static readonly MAX_ZOOM: number = 10;

  /** Fraction of the data range added as padding on each side. */
  static readonly PAD_RATIO: number = 0.1;

  margin: ViewPortMargin = { top: 50, right: 40, bottom: 60, left: 70 };

  private width: number = 800;
  private height: number = 600;

  private dataMinX: number = 0;
  private dataMaxX: number = 1;
  private dataMinY: number = 0;
  private dataMaxY: number = 1;

  private zoomFactor: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;

  // ─── Geometry ──────────────────────────────────────────────────────

  /** Call whenever the canvas area changes. */
  setPlotSize(width: number, height: number): void {
    this.width = width > 0 ? width : 800;
    this.height = height > 0 ? height : 600;
  }

  get plotWidth(): number {
    return Math.max(1, this.width - this.margin.left - this.margin.right);
  }

  get plotHeight(): number {
    return Math.max(1, this.height - this.margin.top - this.margin.bottom);
  }

  // ─── Data range ────────────────────────────────────────────────────

  /**
   * Derive the data range from the series, padding by PAD_RATIO. A degenerate
   * range (all values equal, or a single point) collapses to a unit window so
   * the transform never divides by zero.
   */
  setDataRange(xs: number[], ys: number[]): void {
    this.dataMinX = xs.length > 0 ? xs.reduce((a, b) => Math.min(a, b), Infinity) : 0;
    this.dataMaxX = xs.length > 0 ? xs.reduce((a, b) => Math.max(a, b), -Infinity) : 1;
    this.dataMinY = ys.length > 0 ? ys.reduce((a, b) => Math.min(a, b), Infinity) : 0;
    this.dataMaxY = ys.length > 0 ? ys.reduce((a, b) => Math.max(a, b), -Infinity) : 1;

    if (!isFinite(this.dataMinX) || !isFinite(this.dataMaxX) || this.dataMaxX - this.dataMinX < 1e-12) {
      this.dataMinX = 0;
      this.dataMaxX = 1;
    }
    if (!isFinite(this.dataMinY) || !isFinite(this.dataMaxY) || this.dataMaxY - this.dataMinY < 1e-12) {
      this.dataMinY = 0;
      this.dataMaxY = 1;
    }
  }

  /** Reset the range to the unit window (used when a plot is cleared). */
  resetDataRange(): void {
    this.dataMinX = 0; this.dataMaxX = 1;
    this.dataMinY = 0; this.dataMaxY = 1;
  }

  get minX(): number { return this.dataMinX; }
  get maxX(): number { return this.dataMaxX; }
  get minY(): number { return this.dataMinY; }
  get maxY(): number { return this.dataMaxY; }

  /** Data values spanned by the axes, excluding padding. */
  get spanX(): number { return this.dataMaxX - this.dataMinX; }
  get spanY(): number { return this.dataMaxY - this.dataMinY; }

  private get xPadding(): number { return (this.dataMaxX - this.dataMinX) * ViewPortHandler.PAD_RATIO || 1; }
  private get yPadding(): number { return (this.dataMaxY - this.dataMinY) * ViewPortHandler.PAD_RATIO || 1; }

  // ─── Value <-> pixel ───────────────────────────────────────────────

  mapX(v: number): number {
    const pw = this.plotWidth;
    const range = this.dataMaxX - this.dataMinX + 2 * this.xPadding;
    const dataX = ((v - this.dataMinX + this.xPadding) / range) * pw;
    const center = pw / 2;
    // Zoom is applied about the plot centre, then pan is added.
    return this.margin.left + center + (dataX - center) * this.zoomFactor + this.offsetX;
  }

  mapY(v: number): number {
    const ph = this.plotHeight;
    const range = this.dataMaxY - this.dataMinY + 2 * this.yPadding;
    const dataY = ((v - this.dataMinY + this.yPadding) / range) * ph;
    const center = ph / 2;
    // Inverted: larger data values sit higher on screen.
    return this.margin.top + center - (dataY - center) * this.zoomFactor + this.offsetY;
  }

  /** Inverse of mapX — used by hit testing. */
  unmapX(px: number): number {
    const pw = this.plotWidth;
    const range = this.dataMaxX - this.dataMinX + 2 * this.xPadding;
    const dataX = pw / 2 + (px - this.margin.left - pw / 2 - this.offsetX) / this.zoomFactor;
    return this.dataMinX - this.xPadding + (dataX * range) / pw;
  }

  /** Inverse of mapY — used by hit testing. */
  unmapY(py: number): number {
    const ph = this.plotHeight;
    const range = this.dataMaxY - this.dataMinY + 2 * this.yPadding;
    const dataY = ph / 2 - (py - this.margin.top - ph / 2 - this.offsetY) / this.zoomFactor;
    return this.dataMinY - this.yPadding + (dataY * range) / ph;
  }

  // ─── Zoom / pan ────────────────────────────────────────────────────

  get zoom(): number { return this.zoomFactor; }
  get panOffsetX(): number { return this.offsetX; }
  get panOffsetY(): number { return this.offsetY; }

  zoomTo(factor: number): void {
    this.zoomFactor = Math.min(ViewPortHandler.MAX_ZOOM, Math.max(ViewPortHandler.MIN_ZOOM, factor));
  }

  /** Multiply the current zoom, clamped to [MIN_ZOOM, MAX_ZOOM]. */
  zoomBy(ratio: number): void {
    this.zoomTo(this.zoomFactor * ratio);
  }

  panBy(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  setPan(x: number, y: number): void {
    this.offsetX = x;
    this.offsetY = y;
  }

  /** Zoom and pan back to the identity view. */
  resetView(): void {
    this.zoomFactor = 1;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  resetAll(): void {
    this.resetView();
    this.resetDataRange();
  }
}
