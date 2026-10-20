import { DataMatrix } from '../../core/models/index';
import { componentSnapshot } from '@kit.ArkUI';
import { image } from '@kit.ImageKit';
import { BusinessError } from '@kit.BasicServicesKit';
import fs from '@ohos.file.fs';

/**
 * Interactive Plot Canvas — replaces views/ui_plot_canvas.py (2,892 lines)
 * Full interactive chart with hover tooltips, zoom, pan, selection, export.
 * Supports: scatter, line, bar, histogram, boxplot, heatmap.
 */
import { ViewPortHandler } from './plot/ViewPortHandler';
import { ChartHighlighter } from './plot/ChartHighlighter';
import { ChartComputator } from './plot/ChartComputator';
import { AdaptiveFormatter, autoFormatter } from './plot/ValueFormatter';
import type { IValueFormatter } from './plot/ValueFormatter';
import { computeBoxPrimitives } from './plot/boxGeometry';
import type { BoxGroup } from './plot/boxGeometry';
import {
  computeScatterPrimitives,
  computeLinePrimitives,
  computeBarPrimitives,
  computeHistogramBins,
  computeHeatmapPrimitives,
  heatCellColor,
  barAxisRange,
  paletteSlot,
  scatterPaletteSlot,
} from './plot/plotGeometry';
import type { PointPrimitive } from './plot/plotGeometry';
import { token } from '../theme/tokens';

/**
 * Pick radius (in vp) shared by hover and tap selection, and the grid
 * divisions per axis. Module-level rather than struct members: ArkTS
 * `struct` declarations do not support `static` members (the repo's other
 * `static readonly` usages are all plain classes).
 */
const HOVER_RADIUS: number = 20;
const TICK_DIVISIONS: number = 5;

@Component
export struct PlotCanvas {
  // 样式/类型属性用 @Prop + @Watch：父级（WorkspaceView）变化时同步并触发
  // Canvas 重绘（@State 只在创建时取值，主题切换和二次分析不会生效）
  //
  // plotType gets its OWN watcher rather than sharing onStyleChanged, because a
  // type change has to re-ingest the series, not merely repaint. The old
  // onStyleChanged only called redraw(), so whichever order the parent assigned
  // dataX/dataY and plotType in, the chart kept whatever the previous run had
  // built. Index.ets assigns the data first and the type last, and because the
  // setters below used to overwrite this @Prop, a second run of a histogram
  // analysis dispatched on the stale local type 'bar' and drew the RAW scores
  // as bars while the legend still said "histogram".
  @Prop @Watch('onPlotTypeChanged') plotType: string = 'scatter';
  @Prop @Watch('onStyleChanged') title: string = '';
  @Prop @Watch('onStyleChanged') darkMode: boolean = false;
  @State xlabel: string = '';
  @State ylabel: string = '';
  // zoom / pan / data range / margin now live in ViewPortHandler (see below);
  // nothing in build() renders them, so they need no reactive state.
  @State hoveredPoint: number = -1;
  @State selectedPoints: Set<number> = new Set();
  @State showTooltip: boolean = false;
  @State tooltipText: string = '';
  @State mouseX: number = 0;
  @State mouseY: number = 0;
  @State canvasWidth: number = 800;
  @State canvasHeight: number = 600;

  // 父组件注入的数据（ArkUI 无法从父级调用子组件方法，命令式 setXXXData
  // 仅限组件内部使用；数据经 @Prop 单向同步 + @Watch 重新摄入）
  @Prop @Watch('onInputDataChanged') dataX: number[] = [];
  @Prop @Watch('onInputDataChanged') dataY: number[] = [];

  aboutToAppear(): void {
    this.ingestInputData();
  }

  private onStyleChanged(): void {
    this.redraw();
  }

  /**
   * A plot-type change must rebuild the series, not just repaint it.
   *
   * This is what makes the parent free to assign dataX/dataY and plotType in
   * either order: whichever arrives second, the second pass converges on the
   * right chart. Previously a type change only reached redraw(), so the canvas
   * kept the geometry built for the previous type.
   */
  private onPlotTypeChanged(): void {
    this.ingestInputData();
  }

  private onInputDataChanged(): void {
    this.ingestInputData();
  }

  /**
   * Clear the surface and drop the loaded series.
   *
   * `redraw()` bails out as soon as `plotData` is null, so merely nulling the
   * data leaves the PREVIOUS chart painted on the canvas. Clearing explicitly
   * (plus a short placeholder) is what makes a stale plot impossible.
   */
  private clearPlot(message: string): void {
    this.plotData = null;
    this.vp.resetDataRange();
    this.selectedPoints = new Set();
    this.hoveredPoint = -1;
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvasWidth || 800;
    const h = this.canvasHeight || 600;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = token('text_axis', this.darkMode);
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(message, w / 2, h / 2);
    ctx.textAlign = 'left';
  }

  /**
   * Load the parent-injected X/Y series for the current plot type.
   *
   * Two rules that the previous version broke:
   *  1. An empty series must CLEAR the canvas instead of returning early —
   *     otherwise switching to an analysis that supplies no series kept the
   *     last chart on screen while the header showed the new analysis name.
   *  2. Every type with a data setter is fed from the single X/Y channel, since
   *     the parent has no other way to inject data (it never calls the
   *     imperative setters). Types that genuinely need a matrix/tree/interval
   *     structure are cleared rather than left showing something unrelated.
   */
  private ingestInputData(): void {
    const hasSeries = this.dataX.length > 0 && this.dataX.length === this.dataY.length;
    if (!hasSeries) {
      this.clearPlot('No series to plot for this analysis');
      return;
    }
    switch (this.plotType) {
      case 'bar':
        this.setBarData(this.dataX.map(v => String(v)), this.dataY);
        break;
      case 'histogram':
        this.setHistogramData(this.dataY);
        break;
      case 'boxplot':
        this.setBoxPlotData([{ label: this.xlabel || 'values', values: this.dataY }]);
        break;
      case 'none':
        this.clearPlot('No chart available for this analysis');
        break;
      case 'heatmap':
      case 'dendrogram':
      case 'range':
        this.clearPlot('Plot type "' + this.plotType + '" needs a matrix or tree structure');
        break;
      case 'scatter':
        this.setScatterData(this.dataX, this.dataY);
        break;
      case 'line':
      default:
        this.setLineData(this.dataX, this.dataY);
        break;
    }
  }

  private plotData: PlotData | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  onStatus: (msg: string) => void = (_msg: string) => {};

  /**
   * Receives an encoded figure from the PNG / SVG toolbar buttons.
   *
   * Plain (non-decorated) field, so the parent passes it once through the
   * component-argument object — the same pattern `onStatus` already uses. The
   * default is a no-op, and requestExport() says so out loud rather than
   * failing silently, which is what the old path did.
   *
   * `payload` is the SVG markup for 'svg' and the packed bytes for 'png'.
   */
  onExportData: (format: string, payload: string | ArrayBuffer, suggestedName: string) => void =
    (_format: string, _payload: string | ArrayBuffer, _suggestedName: string) => {};

  // Render scheduling — avoids duplicate RAF-driven renders
  private canvasRenderScheduled: boolean = false;
  private pendingRenderFrame: number = -1;

  // Fold/unfold transitions fire a burst of area changes; coalesce redraws
  // so the canvas re-renders once after the resize settles (smoothness).
  private resizeTimerId: number = -1;

  // Hover throttle: max 1 hover update per 16ms (60fps)
  private hoverRafId: number = -1;
  private pendingHover: { x: number; y: number } | null = null;

  // Touch state: single-finger drag = pan, tap = select
  private touchStartX: number = 0;
  private touchStartY: number = 0;
  private touchStartPanX: number = 0;
  private touchStartPanY: number = 0;
  private touchMoved: boolean = false;
  private pinchStartZoom: number = 1;

  aboutToDisappear(): void {
    if (this.pendingRenderFrame >= 0) { clearTimeout(this.pendingRenderFrame); }
    if (this.hoverRafId >= 0) { clearTimeout(this.hoverRafId); }
    if (this.resizeTimerId >= 0) { clearTimeout(this.resizeTimerId); }
  }

  /**
   * Single source of truth for the coordinate system: data range, zoom, pan,
   * margin and the value<->pixel transform. The renderer, the SVG exporter and
   * the hit tester all read from here instead of each keeping their own copy.
   */
  private vp: ViewPortHandler = new ViewPortHandler();
  /** Formatter for axis ticks and value labels. */
  private fmt: IValueFormatter = new AdaptiveFormatter();

  build() {
    Column() {
      // ─── Toolbar ───
      Row() {
        Button('Zoom+').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.vp.zoomBy(1.2); this.redraw(); })
        Button('Zoom-').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.vp.zoomBy(1 / 1.2); this.redraw(); })
        Button('Reset').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.vp.resetView(); this.redraw(); })
        Button('Select All').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.selectAll(); this.redraw(); })
        Button('Clear Sel').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.selectedPoints.clear(); this.redraw(); })
        Button('PNG').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.requestExport('png'); })
        Button('SVG').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.requestExport('svg'); })
        Blank()
        Text(this.title).fontSize(11).fontColor($r('app.color.text_secondary'))
      }.width('100%').height(32).padding({ left: 8, right: 8 })
        .backgroundColor($r('app.color.bg_secondary'))

      // ─── Canvas ───
      Canvas((ctx: CanvasRenderingContext2D) => {
        this.ctx = ctx;
        this.redraw();
      })
      .id('plotCanvas')
      .width('100%').layoutWeight(1)
      .onAreaChange((_: Area, newArea: Area) => {
        // 折叠/展开动画期间 area 会连续变化：尺寸即时更新（映射用），
        // 重绘合并到动画结束后的一次（防抖），保证切换流畅。
        this.canvasWidth = newArea.width as number;
        this.canvasHeight = newArea.height as number;
        this.syncPlotSize();
        if (this.resizeTimerId >= 0) { clearTimeout(this.resizeTimerId); }
        this.resizeTimerId = setTimeout(() => {
          this.resizeTimerId = -1;
          this.redraw();
        }, 80);
      })
      .onMouse((event: MouseEvent) => {
        this.mouseX = event.x;
        this.mouseY = event.y;
        if (event.action === MouseAction.Move) {
          this.handleHover(event.x, event.y);
        } else if (event.action === MouseAction.Press) {
          this.handleClick(event.x, event.y);
        }
      })
      .onTouch((event: TouchEvent) => {
        this.handleTouch(event);
      })
      .gesture(
        PinchGesture({ fingers: 2 })
          .onActionStart(() => { this.pinchStartZoom = this.vp.zoom; })
          .onActionUpdate((event: GestureEvent) => {
            this.vp.zoomTo(this.pinchStartZoom * event.scale);
            this.redraw();
          })
      )

      // ─── Tooltip ───
      if (this.showTooltip && this.hoveredPoint >= 0) {
        Text(this.tooltipText)
          .fontSize(10).fontColor($r('app.color.text_primary')).padding(6)
          .backgroundColor($r('app.color.bg_notice')).borderRadius(4)
          .position({ x: this.mouseX + 10, y: this.mouseY - 20 })
      }

      // ─── Status ───
      Row() {
        if (this.hoveredPoint >= 0) {
          Text(this.tooltipText).fontSize(10).fontColor($r('app.color.text_secondary'))
        } else if (this.selectedPoints.size > 0) {
          Text(this.selectedPoints.size + ' points selected').fontSize(10).fontColor($r('app.color.primary'))
        } else {
          Text(this.plotType).fontSize(10).fontColor($r('app.color.text_disabled'))
        }
      }.width('100%').height(20).padding({ left: 8 })
    }.width('100%').height('100%')
  }

  // ─── Data Setters ─────────────────────────────────────────────────────────
  //
  // None of these assign `this.plotType` any more. Writing a @Prop from inside
  // the component that declares it desynchronises the local copy from the
  // parent's, and because ingestInputData() dispatches on `this.plotType`, the
  // next run inherited the previous run's type — a second histogram run
  // dispatched on the stale local 'bar' and drew the RAW scores as bars while
  // the legend still read "histogram". The parent's plotType is the single
  // source of truth; the concrete geometry lives in plotData.type, which is
  // what _redrawCore() dispatches on.
  //
  // Every setter also calls updateRanges(). Only scatter and line used to, so a
  // bar / box-plot / heat-map inherited the PREVIOUS analysis's data range (or
  // the unit window that clearPlot() resets to) while the grid, axes and tick
  // labels all come from the viewport — see updateRanges() for the per-type
  // mapping.

  setScatterData(x: number[], y: number[], labels?: string[], groups?: number[]): void {
    this.plotData = { type: 'scatter', x, y, labels, groups };
    this.updateRanges();
    this.redraw();
  }

  setLineData(x: number[], y: number[], color: string = token('primary', this.darkMode)): void {
    this.plotData = { type: 'line', x, y, color };
    this.updateRanges();
    this.redraw();
  }

  setBarData(labels: string[], values: number[]): void {
    this.plotData = { type: 'bar', labels, values };
    this.updateRanges();
    this.redraw();
  }

  setHistogramData(data: number[], nBins: number = 30): void {
    // The binning is the SHARED implementation (plot/plotGeometry.ts): one
    // rule decides the bin edges, the counts and the labels. The component
    // only turns the result into a bar chart, which is what the SVG exporter
    // draws as well.
    const bins = computeHistogramBins(data, nBins);
    this.setBarData(bins.labels, bins.counts);
  }

  setBoxPlotData(groups: { label: string; values: number[] }[]): void {
    // Box-plot groups have their own field: PlotData.groups stays number[]
    this.plotData = { type: 'boxplot', boxGroups: groups };
    this.updateRanges();
    this.redraw();
  }

  setHeatmapData(matrix: number[][], rowLabels: string[], colLabels: string[]): void {
    this.plotData = { type: 'heatmap', matrix, rowLabels, colLabels };
    this.updateRanges();
    this.redraw();
  }

  setTitle(t: string): void { this.title = t; this.redraw(); }
  setLabels(x: string, y: string): void { this.xlabel = x; this.ylabel = y; this.redraw(); }
  setDarkMode(d: boolean): void { this.darkMode = d; this.redraw(); }

  /**
   * Options-object API（mcCharts 模式）：一次调用应用类型/标题/轴/主题/数据。
   * 只传覆盖项，未提供的字段沿用默认值。
   */
  applyOptions(overrides: PlotOptions): void {
    const o = mergePlotOptions(overrides);
    this.plotType = o.plotType ?? this.plotType;
    this.title = o.title ?? this.title;
    this.xlabel = o.xlabel ?? this.xlabel;
    this.ylabel = o.ylabel ?? this.ylabel;
    this.darkMode = o.darkMode ?? this.darkMode;
    if (o.dataX && o.dataY && o.dataX.length > 0 && o.dataX.length === o.dataY.length) {
      if (this.plotType === 'line') this.setLineData(o.dataX, o.dataY, o.color ?? token('primary', this.darkMode));
      else this.setScatterData(o.dataX, o.dataY);
    } else {
      this.redraw();
    }
  }

  // ─── Coordinate Mapping ────────────────────────────────────────

  /** Keep the viewport's plot size in step with the canvas. */
  private syncPlotSize(): void {
    this.vp.setPlotSize(this.canvasWidth || 800, this.canvasHeight || 600);
  }

  /**
   * Recompute the viewport's data range and pick a formatter suited to its span.
   *
   * The range has to be derived PER CHART TYPE, because only scatter and line
   * carry numeric x/y series. The old version read `plotData.x` / `plotData.y`
   * unconditionally and simply returned early for the other three types, so a
   * bar / box-plot / heat-map kept whatever range the previous analysis left in
   * the viewport — or the unit window that clearPlot() resets to. The grid, the
   * axis lines and the tick LABELS all read that range, so a bar chart of bin
   * counts 3…88 was drawn with a Y axis labelled 0.00 … 1.00. Reproduced with
   * the real ViewPortHandler/ChartComputator: tick "1" sat at pixel 90.8 while
   * the value-88 bar top mapped to pixel −35434.
   *
   * Per type:
   *   scatter / line  — the x/y series as given
   *   bar            — X is categorical and the renderer lays bars out by index,
   *                    so the axis spans 0…n−1; Y spans 0…max because bars grow
   *                    from a zero baseline
   *   boxplot        — X spans the group indices, Y the pooled group values
   *   heatmap        — X spans the column indices, Y the row indices. The
   *                    cells themselves divide the plot rectangle (see
   *                    plot/plotGeometry.ts), so this range drives the tick
   *                    labels only.
   */
  private updateRanges(): void {
    const d = this.plotData;
    if (!d) return;
    let xs: number[] | null = null;
    let ys: number[] | null = null;
    switch (d.type) {
      case 'scatter':
      case 'line':
        xs = d.x ?? null;
        ys = d.y ?? null;
        break;
      case 'bar': {
        // The categorical axis range is the SHARED implementation
        // (plot/plotGeometry.ts): X is the category index, Y spans the zero
        // baseline and the tallest bar.
        const barRange = barAxisRange(d.values ?? []);
        if (barRange) { xs = barRange.xs; ys = barRange.ys; }
        break;
      }
      case 'boxplot':
        if (d.boxGroups && d.boxGroups.length > 0) {
          xs = d.boxGroups.map((_: { label: string; values: number[] }, i: number) => i);
          ys = d.boxGroups.flatMap((g: { label: string; values: number[] }) => g.values);
        }
        break;
      case 'heatmap':
        if (d.matrix && d.matrix.length > 0) {
          xs = [0, Math.max(0, d.matrix[0].length - 1)];
          ys = [0, Math.max(0, d.matrix.length - 1)];
        }
        break;
    }
    if (!xs || !ys) return;
    this.vp.setDataRange(xs, ys);
    // Re-pick the formatter whenever the span changes class (tiny/huge/normal)
    // so axis labels stay readable across analyses.
    this.fmt = autoFormatter(this.vp.spanY, 2);
  }

  private mapX(v: number): number {
    return this.vp.mapX(v);
  }

  private mapY(v: number): number {
    return this.vp.mapY(v);
  }

  private tickLabel(v: number): string {
    return this.fmt.format(v);
  }

  // ─── Rendering ─────────────────────────────────────────────────

  private redraw(): void {
    if (!this.ctx || !this.plotData) return;
    if (this.canvasRenderScheduled) return;
    this.canvasRenderScheduled = true;
    // requestAnimationFrame is a Web API and does not exist in ArkTS — use setTimeout
    this.pendingRenderFrame = setTimeout(() => {
      this.canvasRenderScheduled = false;
      this.pendingRenderFrame = -1;
      this._redrawCore();
    }, 16);
  }

  /** Internal render — called once per RAF cycle. */
  private _redrawCore(): void {
    if (!this.ctx || !this.plotData) return;
    const ctx = this.ctx;
    // Guarantee the viewport knows the current plot size even if onAreaChange
    // has not fired yet (first paint, or a programmatic resize).
    this.syncPlotSize();
    const w = this.canvasWidth || 800;
    const h = this.canvasHeight || 600;
    const pw = w - this.vp.margin.left - this.vp.margin.right;
    const ph = h - this.vp.margin.top - this.vp.margin.bottom;

    // Clear
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = token('start_window_background', this.darkMode);
    ctx.fillRect(0, 0, w, h);

    // Draw plot area background
    ctx.fillStyle = token('bg_elevated', this.darkMode);
    ctx.fillRect(this.vp.margin.left, this.vp.margin.top, pw, ph);

    // Grid — horizontal from the Y ticks, vertical from the X ticks.
    ctx.strokeStyle = token('border_light', this.darkMode);
    ctx.lineWidth = 0.5;
    for (const tick of ChartComputator.yTicks(this.vp, TICK_DIVISIONS)) {
      const gy = tick.pixel;
      ctx.beginPath(); ctx.moveTo(this.vp.margin.left, gy); ctx.lineTo(this.vp.margin.left + pw, gy); ctx.stroke();
    }
    for (const tick of ChartComputator.xTicks(this.vp, TICK_DIVISIONS)) {
      const gx = tick.pixel;
      ctx.beginPath(); ctx.moveTo(gx, this.vp.margin.top); ctx.lineTo(gx, this.vp.margin.top + ph); ctx.stroke();
    }

    // Draw by type
    switch (this.plotData.type) {
      case 'scatter': this.drawScatter(ctx, pw, ph); break;
      case 'line': this.drawLine(ctx, pw, ph); break;
      case 'bar': this.drawBar(ctx, pw, ph); break;
      case 'boxplot': this.drawBoxPlot(ctx, pw, ph); break;
      case 'heatmap': this.drawHeatmap(ctx, pw, ph); break;
    }

    // Axes
    ctx.strokeStyle = token('text_primary', this.darkMode);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.vp.margin.left, this.vp.margin.top);
    ctx.lineTo(this.vp.margin.left, this.vp.margin.top + ph);
    ctx.lineTo(this.vp.margin.left + pw, this.vp.margin.top + ph);
    ctx.stroke();

    // Tick labels — positions and labels come from ChartComputator so the
    // Canvas renderer and the SVG exporter cannot drift apart.
    ctx.fillStyle = token('text_secondary', this.darkMode);
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (const tick of ChartComputator.xTicks(this.vp, TICK_DIVISIONS, (v: number) => this.tickLabel(v))) {
      ctx.fillText(tick.label, tick.pixel, this.vp.margin.top + ph + 15);
    }
    ctx.textAlign = 'right';
    for (const tick of ChartComputator.yTicks(this.vp, TICK_DIVISIONS, (v: number) => this.tickLabel(v))) {
      ctx.fillText(tick.label, this.vp.margin.left - 5, tick.pixel + 4);
    }
    ctx.textAlign = 'center';

    // Axis labels
    if (this.xlabel) {
      ctx.fillStyle = token('axis_line', this.darkMode);
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.xlabel, this.vp.margin.left + pw / 2, h - 10);
    }
    if (this.ylabel) {
      ctx.save();
      ctx.translate(15, this.vp.margin.top + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(this.ylabel, 0, 0);
      ctx.restore();
    }

    // Title
    if (this.title) {
      ctx.fillStyle = token('text_strong', this.darkMode);
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.title, w / 2, 25);
    }
  }

  private drawScatter(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    const data = this.plotData!;
    const x = data.x!, y = data.y!;
    const colors = [token('primary', this.darkMode), token('danger', this.darkMode), token('success', this.darkMode), token('warning', this.darkMode), token('series_5', this.darkMode), token('series_6', this.darkMode)];
    const n = x.length;

    // The geometry comes from the SHARED implementation (plot/plotGeometry.ts),
    // which the SVG exporter calls as well, so the exported figure cannot
    // disagree with the figure on screen. Only the DECISION to draw the zero
    // lines stays with the canvas — the exporter has never drawn them.
    const prim = computeScatterPrimitives(this.vp, x, y);

    // Zero lines
    if (prim.zeroX !== null) {
      ctx.strokeStyle = token('text_muted', this.darkMode); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(prim.zeroX, this.vp.margin.top); ctx.lineTo(prim.zeroX, this.vp.margin.top + ph); ctx.stroke();
    }
    if (prim.zeroY !== null) {
      ctx.strokeStyle = token('text_muted', this.darkMode); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.vp.margin.left, prim.zeroY); ctx.lineTo(this.vp.margin.left + pw, prim.zeroY); ctx.stroke();
    }

    // ── Batched Path2D rendering for large datasets (N > 1000) ──
    if (n > 1000) {
      // Pre-compute mapped coordinates to avoid repeated mapX/mapY calls
      const mapped: { mx: number; my: number; color: string; isHovered: boolean; isSelected: boolean }[] = new Array(n);
      for (let i = 0; i < n; i++) {
        mapped[i] = {
          mx: prim.points[i].px,
          my: prim.points[i].py,
          color: colors[scatterPaletteSlot(data.groups, i, colors.length)],
          isHovered: this.hoveredPoint === i,
          isSelected: this.selectedPoints.has(i)
        };
      }
      // Build one Path2D per color group
      for (let ci = 0; ci < colors.length; ci++) {
        const path = new Path2D();
        let count = 0;
        for (let i = 0; i < n; i++) {
          const pt = mapped[i];
          if (pt.color !== colors[ci]) continue;
          if (pt.isHovered || pt.isSelected) continue;
          const r = pt.isSelected ? 7 : 5;
          // Circle approximated as rect for speed (no arc per-point)
          path.arc(pt.mx, pt.my, r, 0, 2 * Math.PI);
          count++;
        }
        if (count > 0) {
          ctx.fillStyle = colors[ci];
          ctx.globalAlpha = 0.7;
          ctx.fill(path);
        }
      }
      ctx.globalAlpha = 1;
      // Hovered / selected drawn individually (on top, thin count)
      for (let i = 0; i < n; i++) {
        const pt = mapped[i];
        if (!pt.isHovered && !pt.isSelected) continue;
        const r = pt.isHovered ? 8 : 7;
        ctx.fillStyle = pt.color;
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.arc(pt.mx, pt.my, r, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = pt.color; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt.mx, pt.my, pt.isHovered ? 11 : 9, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (pt.isHovered && data.labels?.[i]) {
          ctx.fillStyle = token('text_primary', this.darkMode);
          ctx.font = '10px sans-serif';
          ctx.fillText(data.labels[i], pt.mx + 10, pt.my - 5);
        }
      }
    } else {
      // ── Standard per-point rendering for small datasets ──
      for (let i = 0; i < n; i++) {
        const color = colors[scatterPaletteSlot(data.groups, i, colors.length)];
        const isHovered = this.hoveredPoint === i;
        const isSelected = this.selectedPoints.has(i);
        const mx = prim.points[i].px, my = prim.points[i].py;
        ctx.fillStyle = color;
        ctx.globalAlpha = isHovered ? 1.0 : (isSelected ? 0.9 : 0.7);
        ctx.beginPath();
        ctx.arc(mx, my, isHovered ? 8 : (isSelected ? 7 : 5), 0, 2 * Math.PI);
        ctx.fill();
        if (isHovered || isSelected) {
          ctx.strokeStyle = color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(mx, my, isHovered ? 11 : 9, 0, 2 * Math.PI); ctx.stroke();
        }
        ctx.globalAlpha = 1;

        if (isHovered && data.labels?.[i]) {
          ctx.fillStyle = token('text_primary', this.darkMode);
          ctx.font = '10px sans-serif';
          ctx.fillText(data.labels[i], mx + 10, my - 5);
        }
      }
    }

    // Legend
    if (data.groups && new Set(data.groups).size > 1) {
      const uniqueGroups = [...new Set(data.groups)];
      ctx.font = '10px sans-serif';
      for (let i = 0; i < uniqueGroups.length; i++) {
        const y = this.vp.margin.top + 20 + i * 15;
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath(); ctx.arc(this.vp.margin.left + pw - 80, y, 5, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = token('text_primary', this.darkMode);
        ctx.textAlign = 'left';
        ctx.fillText('Group ' + uniqueGroups[i], this.vp.margin.left + pw - 70, y + 3);
      }
    }
  }

  private drawLine(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    const data = this.plotData!;
    const x = data.x!, y = data.y!;
    const color = data.color ?? token('primary', this.darkMode);

    // The geometry comes from the SHARED implementation (plot/plotGeometry.ts),
    // which the SVG exporter calls as well: the same vertices, at the same
    // pixel positions. (The canvas also draws a marker on every vertex; the
    // exporter has never drawn one.)
    const prim = computeLinePrimitives(this.vp, x, y);

    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < prim.points.length; i++) {
      if (i === 0) ctx.moveTo(prim.points[i].px, prim.points[i].py);
      else ctx.lineTo(prim.points[i].px, prim.points[i].py);
    }
    ctx.stroke();

    // Points
    for (let i = 0; i < prim.points.length; i++) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(prim.points[i].px, prim.points[i].py, 3, 0, 2 * Math.PI); ctx.fill();
    }

    // Hovered point
    if (this.hoveredPoint >= 0 && this.hoveredPoint < x.length) {
      const i = this.hoveredPoint;
      ctx.strokeStyle = token('danger', this.darkMode); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(prim.points[i].px, prim.points[i].py, 8, 0, 2 * Math.PI); ctx.stroke();
    }
  }

  private drawBar(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    const data = this.plotData!;
    const labels = data.labels!, values = data.values!;
    // Bars are placed through the viewport, exactly as scatter and line points
    // are, so zoom and pan move the marks together with the axes, the grid and
    // the tick labels. This version laid them out from `margin.left + i*(w+gap)`
    // and scaled their height by value/max against the RAW plot height, so
    // neither X nor Y zoom had any effect on a bar chart: the axes and labels
    // moved and the bars stayed put.
    //
    // updateRanges() sets the bar axis to span 0..max, so `vp.mapY(0)` is the
    // baseline and `vp.mapY(value)` the bar top — no separate maxVal
    // normalisation is needed, and the two can no longer disagree.
    //
    // The geometry itself — the visible range, the width, the baseline and the
    // rectangles — comes from the SHARED implementation (plot/plotGeometry.ts),
    // which the SVG exporter calls as well.
    const prim = computeBarPrimitives(this.vp, labels.length, values, pw);
    if (prim.bars.length === 0) return;
    const colors = [token('primary', this.darkMode), token('danger', this.darkMode), token('success', this.darkMode), token('warning', this.darkMode), token('series_5', this.darkMode)];

    for (const bar of prim.bars) {
      ctx.fillStyle = colors[paletteSlot(bar.index, colors.length)];
      ctx.globalAlpha = 0.8;
      ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
      ctx.globalAlpha = 1;

      // Value label
      ctx.fillStyle = token('text_primary', this.darkMode);
      ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(this.tickLabel(bar.value), bar.centerX, bar.y - 3);

      // X label (rotated)
      ctx.save();
      ctx.translate(bar.centerX, this.vp.margin.top + ph + 5);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillText(labels[bar.index], 0, 0);
      ctx.restore();
    }
  }

  private drawBoxPlot(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    const data = this.plotData!;
    const groups = data.boxGroups!;
    // The geometry comes from the SHARED implementation (plot/boxGeometry.ts),
    // which the SVG exporter calls as well. This method used to compute its
    // own: a local Y formula without zoom/pan, a hand-rolled X layout, the
    // upper of the two middle values as the median of an even-sized sample,
    // and Tukey whiskers the exporter never drew. The exported figure was
    // therefore not the figure on screen.
    const boxes = computeBoxPrimitives(this.vp, toBoxGroups(groups));
    const colors = [token('primary', this.darkMode), token('danger', this.darkMode), token('success', this.darkMode), token('warning', this.darkMode), token('series_5', this.darkMode)];

    for (const box of boxes) {
      const color = colors[box.index % colors.length];
      const left = box.centerX - box.boxWidth / 2;
      const right = box.centerX + box.boxWidth / 2;
      const capHalf = box.capWidth / 2;

      // Whisker stems and caps
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(box.centerX, box.yLower); ctx.lineTo(box.centerX, box.yQ1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(box.centerX, box.yQ3); ctx.lineTo(box.centerX, box.yUpper); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(box.centerX - capHalf, box.yLower); ctx.lineTo(box.centerX + capHalf, box.yLower); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(box.centerX - capHalf, box.yUpper); ctx.lineTo(box.centerX + capHalf, box.yUpper); ctx.stroke();

      // Box
      ctx.fillStyle = color + '40';
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.fillRect(left, box.yQ3, box.boxWidth, box.yQ1 - box.yQ3);
      ctx.strokeRect(left, box.yQ3, box.boxWidth, box.yQ1 - box.yQ3);

      // Median
      ctx.strokeStyle = token('danger', this.darkMode); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(left, box.yMedian); ctx.lineTo(right, box.yMedian); ctx.stroke();

      // Group label
      ctx.fillStyle = token('text_primary', this.darkMode);
      ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(box.label, box.centerX, this.vp.margin.top + ph + 15);
    }
  }

  private drawHeatmap(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    const data = this.plotData!;
    const matrix = data.matrix!, rowLabels = data.rowLabels!, colLabels = data.colLabels!;
    // The geometry comes from the SHARED implementation (plot/plotGeometry.ts),
    // which the SVG exporter calls as well: the same cells, at the same places,
    // in the same colours, so the exported figure IS the figure on screen.
    // The exporter used the viewport's cell pitch, which is wider than the
    // plot rectangle because the viewport pads the data range — the last
    // column ran out of the plot area, over the margin.
    const prim = computeHeatmapPrimitives(this.vp, matrix, pw, ph);
    const nRows = prim.rows, nCols = prim.cols;

    // Draw cells using the shared geometry
    for (const cell of prim.cells) {
      ctx.fillStyle = cell.fill;
      // One pixel is left free between two neighbouring cells, so that the
      // grid lines show.
      ctx.fillRect(cell.x, cell.y, cell.width - 1, cell.height - 1);

      // Value annotation
      if (cell.width > 30 && cell.height > 20) {
        ctx.fillStyle = cell.norm > 0.5 ? token('bg_primary', this.darkMode) : token('text_primary', this.darkMode);
        ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(cell.value.toFixed(2), cell.centerX, cell.centerY + 3);
      }
    }

    // Labels
    ctx.fillStyle = token('text_primary', this.darkMode);
    ctx.font = '9px sans-serif';
    for (let i = 0; i < nRows; i++) {
      ctx.textAlign = 'right';
      ctx.fillText(rowLabels[i] ?? '', this.vp.margin.left - 5, this.vp.margin.top + i * prim.cellHeight + prim.cellHeight / 2 + 3);
    }
    for (let j = 0; j < nCols; j++) {
      ctx.save();
      ctx.translate(this.vp.margin.left + j * prim.cellWidth + prim.cellWidth / 2, this.vp.margin.top + ph + 5);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillText(colLabels[j] ?? '', 0, 0);
      ctx.restore();
    }

    // Color bar — the same scale as the cells
    const barX = this.vp.margin.left + pw + 10, barW = 15;
    const barNormVals: number[] = new Array(Math.ceil(ph));
    for (let i = 0; i < barNormVals.length; i++) {
      barNormVals[i] = 1 - i / ph;
      ctx.fillStyle = heatCellColor(barNormVals[i]);
      ctx.fillRect(barX, this.vp.margin.top + i, barW, 1);
    }
    ctx.fillStyle = token('text_primary', this.darkMode);
    ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(prim.max.toFixed(2), barX + barW + 3, this.vp.margin.top + 8);
    ctx.fillText(prim.min.toFixed(2), barX + barW + 3, this.vp.margin.top + ph);
  }

  // ─── Interaction ───────────────────────────────────────────────

  private handleHover(x: number, y: number): void {
    // Throttle: at most 1 hover update per 16ms (60fps)
    if (this.hoverRafId >= 0) {
      this.pendingHover = { x, y };
      return;
    }
    this.hoverRafId = setTimeout(() => {
      this.hoverRafId = -1;
      const target = this.pendingHover ?? { x, y };
      this.pendingHover = null;
      this._doHover(target.x, target.y);
    }, 16);
  }

  /** Actual hover logic — called at most once per 16ms. */
  private _doHover(x: number, y: number): void {
    if (!this.plotData?.x || !this.plotData.y) return;
    // One shared hit test instead of a scan duplicated per interaction.
    const closest = ChartHighlighter.nearestIndex(
      this.vp, this.plotData.x, this.plotData.y, x, y, HOVER_RADIUS);

    if (closest !== this.hoveredPoint) {
      this.hoveredPoint = closest;
      if (closest >= 0) {
        const i = closest;
        const xv = this.plotData.x[i].toFixed(3);
        const yv = this.plotData.y![i].toFixed(3);
        const label = this.plotData.labels?.[i] ?? '';
        this.tooltipText = label ? label + ': x=' + xv + ', y=' + yv : 'x=' + xv + ', y=' + yv;
        this.showTooltip = true;
      } else {
        this.showTooltip = false;
      }
      this.redraw();
    }
  }

  private handleClick(x: number, y: number): void {
    this._doHover(x, y);
    this._selectAt(x, y);
  }

  /** Shared by mouse click and touch tap: toggle selection of nearest point. */
  private _selectAt(x: number, y: number): void {
    if (!this.plotData?.x || !this.plotData.y) return;
    const closest = ChartHighlighter.nearestIndex(
      this.vp, this.plotData.x, this.plotData.y, x, y, HOVER_RADIUS);
    if (closest >= 0) {
      if (this.selectedPoints.has(closest)) {
        this.selectedPoints.delete(closest);
      } else {
        this.selectedPoints.add(closest);
      }
      this.redraw();
    }
  }

  /** Touch: single-finger drag pans, tap selects (shares hover/select logic). */
  private handleTouch(event: TouchEvent): void {
    const t = event.touches[0];
    if (!t) return;
    if (event.type === TouchType.Down) {
      this.touchStartX = t.x;
      this.touchStartY = t.y;
      this.touchStartPanX = this.vp.panOffsetX;
      this.touchStartPanY = this.vp.panOffsetY;
      this.touchMoved = false;
    } else if (event.type === TouchType.Move) {
      const dx = t.x - this.touchStartX;
      const dy = t.y - this.touchStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { this.touchMoved = true; }
      if (this.touchMoved) {
        this.vp.setPan(this.touchStartPanX + dx, this.touchStartPanY + dy);
        this.redraw();
      }
    } else if (event.type === TouchType.Up) {
      if (!this.touchMoved) {
        // Tap: treat as click (hover + select at point)
        this.mouseX = t.x;
        this.mouseY = t.y;
        this._doHover(t.x, t.y);
        this._selectAt(t.x, t.y);
      }
    }
  }

  private selectAll(): void {
    if (!this.plotData?.x) return;
    for (let i = 0; i < this.plotData.x.length; i++) this.selectedPoints.add(i);
  }

  getSelectedIndices(): number[] { return [...this.selectedPoints]; }

  // ─── Export ─────────────────────────────────────────────────────

  /**
   * PNG export via componentSnapshot: captures the canvas node by id,
   * packs the PixelMap to PNG and writes it to `path` (@ohos.file.fs).
   * Throws when no path is given.
   */
  async exportPNG(path: string = ''): Promise<void> {
    try {
      if (!path || path.length === 0) {
        throw new Error('no export path');
      }
      const pixelMap = await componentSnapshot.get('plotCanvas');
      const packer = image.createImagePacker();
      const data = await packer.pack(pixelMap, { format: 'image/png', quality: 100 });
      const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      fs.writeSync(file.fd, data);
      fs.closeSync(file.fd);
      packer.release();
      pixelMap.release();
      if (this.onStatus) this.onStatus('PNG exported: ' + this.title + ' (' + Math.round(this.canvasWidth) + 'x' + Math.round(this.canvasHeight) + ')');
    } catch (e) {
      const err = e as BusinessError;
      if (this.onStatus) this.onStatus('PNG export failed: ' + (err.message ?? String(e)));
    }
  }

  /**
   * Pure string builder for the SVG markup (no I/O).
   */
  private buildSVG(): string {
    // Same viewport as the Canvas renderer — the exporter must not carry its own
    // copy of the transform (it used to, and the two could disagree).
    this.syncPlotSize();
    let svg = '<svg width="' + this.canvasWidth + '" height="' + this.canvasHeight + '" xmlns="http://www.w3.org/2000/svg">';
    svg += '<rect width="100%" height="100%" fill="' + (token('start_window_background', this.darkMode)) + '"/>';

    // Title
    if (this.title) {
      svg += '<text x="' + (this.canvasWidth / 2) + '" y="25" text-anchor="middle" font-size="14" font-weight="bold" fill="' + (token('text_strong', this.darkMode)) + '">' + this.escapeXml(this.title) + '</text>';
    }

    // Axes
    const pw = this.canvasWidth - this.vp.margin.left - this.vp.margin.right;
    const ph = this.canvasHeight - this.vp.margin.top - this.vp.margin.bottom;
    svg += '<line x1="' + this.vp.margin.left + '" y1="' + this.vp.margin.top + '" x2="' + this.vp.margin.left + '" y2="' + (this.vp.margin.top + ph) + '" stroke="' + (token('text_primary', this.darkMode)) + '" stroke-width="1.5"/>';
    svg += '<line x1="' + this.vp.margin.left + '" y1="' + (this.vp.margin.top + ph) + '" x2="' + (this.vp.margin.left + pw) + '" y2="' + (this.vp.margin.top + ph) + '" stroke="' + (token('text_primary', this.darkMode)) + '" stroke-width="1.5"/>';

    // Grid lines — horizontal from the Y ticks, vertical from the X ticks.
    svg += '<g stroke="' + (token('border_light', this.darkMode)) + '" stroke-width="0.5">';
    for (const tick of ChartComputator.yTicks(this.vp, TICK_DIVISIONS)) {
      const gy = tick.pixel;
      svg += '<line x1="' + this.vp.margin.left + '" y1="' + gy + '" x2="' + (this.vp.margin.left + pw) + '" y2="' + gy + '"/>';
    }
    for (const tick of ChartComputator.xTicks(this.vp, TICK_DIVISIONS)) {
      const gx = tick.pixel;
      svg += '<line x1="' + gx + '" y1="' + this.vp.margin.top + '" x2="' + gx + '" y2="' + (this.vp.margin.top + ph) + '"/>';
    }
    svg += '</g>';

    // Plot data
    if (this.plotData) {
      switch (this.plotData.type) {
        case 'scatter':
          if (this.plotData.x) {
            const colors = [token('primary', this.darkMode), token('danger', this.darkMode), token('success', this.darkMode), token('warning', this.darkMode), token('series_5', this.darkMode), token('series_6', this.darkMode)];
            // The SAME primitives the canvas renderer uses (see drawScatter):
            // identical pixel positions, so the exported figure IS the figure
            // on screen. The exporter has never drawn the zero lines.
            const scatterPrim = computeScatterPrimitives(this.vp, this.plotData.x, this.plotData.y!);
            for (let i = 0; i < scatterPrim.points.length; i++) {
              const px = scatterPrim.points[i].px.toFixed(1);
              const py = scatterPrim.points[i].py.toFixed(1);
              const color = colors[scatterPaletteSlot(this.plotData.groups, i, colors.length)];
              svg += '<circle cx="' + px + '" cy="' + py + '" r="5" fill="' + color + '" opacity="0.7"/>';
            }
          }
          break;
        case 'line':
          if (this.plotData.x && this.plotData.y) {
            const color = this.plotData.color ?? token('primary', this.darkMode);
            // The SAME vertices the canvas renderer uses (see drawLine).
            const linePrim = computeLinePrimitives(this.vp, this.plotData.x, this.plotData.y);
            // The old exporter read x[0]/y[0] directly, so an EMPTY series
            // produced "M NaN NaN" instead of an error. Keep that output.
            const empty: PointPrimitive = { index: 0, px: NaN, py: NaN };
            const head = linePrim.points.length > 0 ? linePrim.points[0] : empty;
            let path = 'M ' + head.px.toFixed(1) + ' ' + head.py.toFixed(1);
            for (let i = 1; i < linePrim.points.length; i++) {
              path += ' L ' + linePrim.points[i].px.toFixed(1) + ' ' + linePrim.points[i].py.toFixed(1);
            }
            svg += '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
          }
          break;
        case 'bar':
          if (this.plotData.labels && this.plotData.values) {
            // The SAME primitives the canvas renderer uses (see drawBar):
            // the same visible range, the same width, the same baseline and
            // the same rectangles, so the exported figure IS the figure on
            // screen.
            const barPrim = computeBarPrimitives(this.vp, this.plotData.labels.length, this.plotData.values, pw);
            const barColors = [token('primary', this.darkMode), token('danger', this.darkMode), token('success', this.darkMode), token('warning', this.darkMode), token('series_5', this.darkMode)];
            for (const bar of barPrim.bars) {
              svg += '<rect x="' + bar.x.toFixed(1) + '" y="' + bar.y.toFixed(1)
                + '" width="' + bar.width.toFixed(1) + '" height="' + bar.height.toFixed(1)
                + '" fill="' + barColors[paletteSlot(bar.index, barColors.length)] + '" opacity="0.8"/>';
            }
          }
          break;
        case 'boxplot': {
          if (this.plotData.boxGroups) {
            // The SAME primitives the canvas renderer uses (see
            // drawBoxPlot): identical quartiles, whiskers and pixel
            // positions, so the exported figure IS the figure on screen.
            // The exporter used to draw its own R-7 quartiles with min/max
            // whiskers at `mapX(group)` centres, while the canvas drew
            // Tukey whiskers with the upper median at a hand-computed X.
            const boxes = computeBoxPrimitives(this.vp, toBoxGroups(this.plotData.boxGroups));
            const stroke = token('text_primary', this.darkMode);
            for (const box of boxes) {
              const left = box.centerX - box.boxWidth / 2;
              const right = box.centerX + box.boxWidth / 2;
              const capHalf = box.capWidth / 2;
              const cx = box.centerX.toFixed(1);
              svg += '<rect x="' + left.toFixed(1) + '" y="' + box.yQ3.toFixed(1)
                + '" width="' + box.boxWidth.toFixed(1) + '" height="' + (box.yQ1 - box.yQ3).toFixed(1)
                + '" fill="none" stroke="' + stroke + '" stroke-width="1.5"/>';
              // Whisker stems
              svg += '<line x1="' + cx + '" y1="' + box.yLower.toFixed(1) + '" x2="' + cx
                + '" y2="' + box.yQ1.toFixed(1) + '" stroke="' + stroke + '" stroke-width="1.5"/>';
              svg += '<line x1="' + cx + '" y1="' + box.yQ3.toFixed(1) + '" x2="' + cx
                + '" y2="' + box.yUpper.toFixed(1) + '" stroke="' + stroke + '" stroke-width="1.5"/>';
              // Whisker caps
              svg += '<line x1="' + (box.centerX - capHalf).toFixed(1) + '" y1="' + box.yLower.toFixed(1)
                + '" x2="' + (box.centerX + capHalf).toFixed(1) + '" y2="' + box.yLower.toFixed(1)
                + '" stroke="' + stroke + '" stroke-width="1.5"/>';
              svg += '<line x1="' + (box.centerX - capHalf).toFixed(1) + '" y1="' + box.yUpper.toFixed(1)
                + '" x2="' + (box.centerX + capHalf).toFixed(1) + '" y2="' + box.yUpper.toFixed(1)
                + '" stroke="' + stroke + '" stroke-width="1.5"/>';
              // Median line across the box.
              svg += '<line x1="' + left.toFixed(1) + '" y1="' + box.yMedian.toFixed(1) + '" x2="' + right.toFixed(1)
                + '" y2="' + box.yMedian.toFixed(1) + '" stroke="' + stroke + '" stroke-width="2"/>';
            }
          }
          break;
        }
        case 'heatmap': {
          if (this.plotData.matrix) {
            // The SAME cells the canvas renderer draws (see drawHeatmap):
            // the same rectangles, at the same places, in the same colours,
            // so the exported figure IS the figure on screen. The exporter
            // used the viewport's cell pitch, which is wider than the plot
            // rectangle — the last column ran out of the plot area.
            const heatPrim = computeHeatmapPrimitives(this.vp, this.plotData.matrix, pw, ph);
            for (const cell of heatPrim.cells) {
              svg += '<rect x="' + cell.x.toFixed(1) + '" y="' + cell.y.toFixed(1) + '" width="' + cell.width.toFixed(1)
                + '" height="' + cell.height.toFixed(1) + '" fill="' + cell.fill + '"/>';
            }
          }
          break;
        }
      }
    }

    // Tick labels and axis titles.
    //
    // These were MISSING entirely, so an exported figure carried grid lines and
    // axes with no numbers on them — unusable as a publication figure, and in
    // direct contradiction of the comment above claiming the exporter and the
    // canvas renderer cannot drift apart. Positions and labels come from the
    // same ChartComputator the canvas uses, so the two are identical by
    // construction.
    svg += '<g font-family="sans-serif" font-size="10" fill="' + (token('text_secondary', this.darkMode)) + '">';
    for (const tick of ChartComputator.xTicks(this.vp, TICK_DIVISIONS, (v: number) => this.tickLabel(v))) {
      svg += '<text x="' + tick.pixel.toFixed(1) + '" y="' + (this.vp.margin.top + ph + 15)
        + '" text-anchor="middle">' + this.escapeXml(tick.label) + '</text>';
    }
    for (const tick of ChartComputator.yTicks(this.vp, TICK_DIVISIONS, (v: number) => this.tickLabel(v))) {
      svg += '<text x="' + (this.vp.margin.left - 5) + '" y="' + (tick.pixel + 4)
        + '" text-anchor="end">' + this.escapeXml(tick.label) + '</text>';
    }
    if (this.xlabel) {
      svg += '<text x="' + (this.vp.margin.left + pw / 2) + '" y="' + (this.canvasHeight - 10)
        + '" text-anchor="middle" font-size="12">' + this.escapeXml(this.xlabel) + '</text>';
    }
    if (this.ylabel) {
      svg += '<text x="15" y="' + (this.vp.margin.top + ph / 2) + '" text-anchor="middle" font-size="12"'
        + ' transform="rotate(-90, 15, ' + (this.vp.margin.top + ph / 2) + ')">'
        + this.escapeXml(this.ylabel) + '</text>';
    }
    svg += '</g>';

    svg += '</svg>';
    return svg;
  }

  /**
   * Encode the current figure and hand it to whoever owns the file dialogs.
   *
   * This is what the PNG / SVG toolbar buttons call.
   *
   * They used to call `exportPNG()` / `exportSVG()` with no argument. Both
   * require a path (`throw new Error('no export path')` when it is empty), the
   * exception was caught, and the failure was reported through `onStatus` —
   * which no parent ever assigned, so it stayed the no-op default. Clicking
   * either button therefore produced NO file, NO dialog and NO message: a
   * completely silent failure.
   *
   * PlotCanvas keeps ownership of pixels-to-bytes (only it can snapshot its own
   * canvas) while the parent owns the save dialog and the status line, which is
   * the same split `Index.exportFile` already uses for CSV and scripts.
   */
  private async requestExport(format: 'png' | 'svg'): Promise<void> {
    const label = this.title.length > 0 ? this.title : 'plot';
    // Keep ASCII word characters, dots, dashes AND CJK: this project's UI is
    // bilingual, and `\w` alone is ASCII-only, so a Chinese analysis title would
    // have every character replaced and yield "paleoast_______.png".
    const safe = label.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').replace(/^_+|_+$/g, '') || 'plot';
    // The file name the system save dialog pre-fills. It MUST carry the
    // extension, otherwise the picker suggests an extension-less file.
    // (The old code computed `safe` and then referenced an undeclared
    // `suggested`, which is a compile error — TS2304.)
    const suggested = safe + '.' + format;
    try {
      if (format === 'svg') {
        const svg = this.buildSVG();
        if (this.onExportData) {
          this.onExportData('svg', svg, suggested);
        } else {
          this.onStatus('SVG built (' + svg.length + ' bytes) but no exporter is attached');
        }
        return;
      }
      const pixelMap = await componentSnapshot.get('plotCanvas');
      try {
        const packer = image.createImagePacker();
        try {
          const data = await packer.pack(pixelMap, { format: 'image/png', quality: 100 });
          if (this.onExportData) {
            this.onExportData('png', data as ArrayBuffer, suggested);
          } else {
            this.onStatus('PNG built but no exporter is attached');
          }
        } finally {
          packer.release();
        }
      } finally {
        pixelMap.release();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.onStatus(format.toUpperCase() + ' export failed: ' + msg);
    }
  }

  exportSVG(path: string = ''): void {
    try {
      const svg = this.buildSVG();
      this.saveTextFile(path, svg);
      if (this.onStatus) this.onStatus('SVG exported: ' + this.title + ' (' + svg.length + ' bytes)');
    } catch (e) {
      if (this.onStatus) this.onStatus('SVG export failed: ' + String(e));
    }
  }

  /** Write text content to a user-selected path via @ohos.file.fs. */
  private saveTextFile(path: string, content: string): void {
    if (!path || path.length === 0) {
      throw new Error('no export path');
    }
    fs.writeTextSync(path, content);
  }

  private escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  exportPDF(): void {
    // PDF export requires a native PDF library which is not bundled.
    if (this.onStatus) this.onStatus('PDF: not supported yet — use SVG export instead');
  }

  /**
   * Pure string builder for PostScript (EPS) markup (no I/O).
   */
  private buildEPS(): string {
    let ps = '%!PS-Adobe-3.0\n';
    ps += '%%Title: ' + this.escapeXml(this.title) + '\n';
    ps += '%%BoundingBox: 0 0 ' + Math.round(this.canvasWidth) + ' ' + Math.round(this.canvasHeight) + '\n';
    ps += '0.2 setgray\n';
    ps += 'newpath 0 0 moveto ' + Math.round(this.canvasWidth) + ' 0 lineto ' + Math.round(this.canvasWidth) + ' ' + Math.round(this.canvasHeight) + ' lineto 0 ' + Math.round(this.canvasHeight) + ' lineto closepath fill\n';

    if (this.plotData?.type === 'scatter' && this.plotData.x) {
      ps += '0.2 0.6 0.8 setrgbcolor\n';
      // The SAME points the canvas draws and the SVG exports (see
      // drawScatter / buildSVG) — the EPS exporter used to be the third copy
      // of this geometry. PostScript's origin is the bottom-left corner, so
      // the Y axis is flipped here; the X axis is not.
      const epsPrim = computeScatterPrimitives(this.vp, this.plotData.x, this.plotData.y!);
      for (const pt of epsPrim.points) {
        const px = pt.px.toFixed(1);
        const py = (this.canvasHeight - pt.py).toFixed(1);
        ps += px + ' ' + py + ' 5 0 360 arc fill\n';
      }
    }
    ps += 'showpage\n';
    return ps;
  }

  exportEPS(path: string = ''): void {
    try {
      const ps = this.buildEPS();
      this.saveTextFile(path, ps);
      if (this.onStatus) this.onStatus('EPS exported: ' + this.title);
    } catch (e) {
      if (this.onStatus) this.onStatus('EPS export failed: ' + String(e));
    }
  }

  exportTIFF(): void {
    // TIFF encoding is not provided by @ohos.multimedia.image; no third-party codec bundled.
    if (this.onStatus) this.onStatus('TIFF: not supported yet — use PNG export instead');
  }
}

interface BoxGroupData {
  label: string;
  values: number[];
}

/**
 * The plot's box groups in the shape the shared geometry expects.
 *
 * Module level (not a struct member): ArkTS structs do not support `static`,
 * and a free function keeps the renderer free of type gymnastics.
 */
function toBoxGroups(groups: BoxGroupData[]): BoxGroup[] {
  const out: BoxGroup[] = [];
  for (const g of groups) {
    out.push({ label: g.label, values: g.values });
  }
  return out;
}

interface PlotData {
  type: string;
  x?: number[];
  y?: number[];
  labels?: string[];
  groups?: number[];
  values?: number[];
  matrix?: number[][];
  rowLabels?: string[];
  colLabels?: string[];
  color?: string;
  boxGroups?: BoxGroupData[];
}

// ─── Options-object API（mcCharts 模式：接口 + 默认值 + 覆盖合并） ──────────

export interface PlotOptions {
  plotType?: string;
  title?: string;
  xlabel?: string;
  ylabel?: string;
  darkMode?: boolean;
  /** 传入数据（等价于 setScatterData/setLineData 的声明式形式）。 */
  dataX?: number[];
  dataY?: number[];
  color?: string;
}

/** PlotCanvas 的默认配置（mcCharts defaultOption 模式）。 */
export const DEFAULT_PLOT_OPTIONS: PlotOptions = {
  plotType: 'scatter',
  title: '',
  xlabel: '',
  ylabel: '',
  darkMode: false,
  dataX: [],
  dataY: [],
  color: token('primary', this.darkMode),
};

/** 合并默认值与覆盖项（浅合并，数组整体替换）。 */
export function mergePlotOptions(overrides: PlotOptions): PlotOptions {
  return { ...DEFAULT_PLOT_OPTIONS, ...overrides };
}
