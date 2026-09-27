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
    ctx.fillStyle = this.darkMode ? '#aaa' : '#95A5A6';
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
        Text(this.title).fontSize(11).fontColor('#7F8C8D')
      }.width('100%').height(32).padding({ left: 8, right: 8 })
        .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA')

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
          .fontSize(10).fontColor('#2C3E50').padding(6)
          .backgroundColor('#FFFFCC').borderRadius(4)
          .position({ x: this.mouseX + 10, y: this.mouseY - 20 })
      }

      // ─── Status ───
      Row() {
        if (this.hoveredPoint >= 0) {
          Text(this.tooltipText).fontSize(10).fontColor('#7F8C8D')
        } else if (this.selectedPoints.size > 0) {
          Text(this.selectedPoints.size + ' points selected').fontSize(10).fontColor('#3498DB')
        } else {
          Text(this.plotType).fontSize(10).fontColor('#BDC3C7')
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

  setLineData(x: number[], y: number[], color: string = '#3498DB'): void {
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
    const min = data.reduce((a, b) => Math.min(a, b), Infinity);
    const max = data.reduce((a, b) => Math.max(a, b), -Infinity);
    const binW = (max - min) / nBins || 1;
    const bins = new Array(nBins).fill(0);
    for (const v of data) { const idx = Math.min(Math.floor((v - min) / binW), nBins - 1); if (idx >= 0) bins[idx]++; }
    const labels = bins.map((_, i) => (min + i * binW).toFixed(1));
    this.setBarData(labels, bins);
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
      if (this.plotType === 'line') this.setLineData(o.dataX, o.dataY, o.color ?? '#3498DB');
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
   *   heatmap        — X spans the column indices, Y the row indices, matching
   *                    the cell geometry drawHeatmap() computes
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
      case 'bar':
        if (d.values && d.values.length > 0) {
          xs = d.values.map((_: number, i: number) => i);
          ys = [0].concat(d.values);
        }
        break;
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
    ctx.fillStyle = this.darkMode ? '#1a1a2e' : '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    // Draw plot area background
    ctx.fillStyle = this.darkMode ? '#0f3460' : '#FAFBFC';
    ctx.fillRect(this.vp.margin.left, this.vp.margin.top, pw, ph);

    // Grid — horizontal from the Y ticks, vertical from the X ticks.
    ctx.strokeStyle = this.darkMode ? '#333' : '#E4E7EB';
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
    ctx.strokeStyle = this.darkMode ? '#ccc' : '#2C3E50';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.vp.margin.left, this.vp.margin.top);
    ctx.lineTo(this.vp.margin.left, this.vp.margin.top + ph);
    ctx.lineTo(this.vp.margin.left + pw, this.vp.margin.top + ph);
    ctx.stroke();

    // Tick labels — positions and labels come from ChartComputator so the
    // Canvas renderer and the SVG exporter cannot drift apart.
    ctx.fillStyle = this.darkMode ? '#aaa' : '#7F8C8D';
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
      ctx.fillStyle = this.darkMode ? '#ccc' : '#7F8C8D';
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
      ctx.fillStyle = this.darkMode ? '#fff' : '#2C3E50';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.title, w / 2, 25);
    }
  }

  private drawScatter(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    const data = this.plotData!;
    const x = data.x!, y = data.y!;
    const colors = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6', '#1ABC9C'];
    const n = x.length;

    // Zero lines
    if (this.vp.minX < 0 && this.vp.maxX > 0) {
      ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.mapX(0), this.vp.margin.top); ctx.lineTo(this.mapX(0), this.vp.margin.top + ph); ctx.stroke();
    }
    if (this.vp.minY < 0 && this.vp.maxY > 0) {
      ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.vp.margin.left, this.mapY(0)); ctx.lineTo(this.vp.margin.left + pw, this.mapY(0)); ctx.stroke();
    }

    // ── Batched Path2D rendering for large datasets (N > 1000) ──
    if (n > 1000) {
      // Pre-compute mapped coordinates to avoid repeated mapX/mapY calls
      const mapped: { mx: number; my: number; color: string; isHovered: boolean; isSelected: boolean }[] = new Array(n);
      for (let i = 0; i < n; i++) {
        mapped[i] = {
          mx: this.mapX(x[i]),
          my: this.mapY(y[i]),
          color: data.groups ? colors[data.groups[i] % colors.length] : colors[0],
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
          ctx.fillStyle = this.darkMode ? '#ccc' : '#2C3E50';
          ctx.font = '10px sans-serif';
          ctx.fillText(data.labels[i], pt.mx + 10, pt.my - 5);
        }
      }
    } else {
      // ── Standard per-point rendering for small datasets ──
      for (let i = 0; i < n; i++) {
        const color = data.groups ? colors[data.groups[i] % colors.length] : colors[0];
        const isHovered = this.hoveredPoint === i;
        const isSelected = this.selectedPoints.has(i);
        const mx = this.mapX(x[i]), my = this.mapY(y[i]);
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
          ctx.fillStyle = this.darkMode ? '#ccc' : '#2C3E50';
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
        ctx.fillStyle = this.darkMode ? '#ccc' : '#2C3E50';
        ctx.textAlign = 'left';
        ctx.fillText('Group ' + uniqueGroups[i], this.vp.margin.left + pw - 70, y + 3);
      }
    }
  }

  private drawLine(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    const data = this.plotData!;
    const x = data.x!, y = data.y!;
    const color = data.color ?? '#3498DB';

    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < x.length; i++) {
      if (i === 0) ctx.moveTo(this.mapX(x[i]), this.mapY(y[i]));
      else ctx.lineTo(this.mapX(x[i]), this.mapY(y[i]));
    }
    ctx.stroke();

    // Points
    for (let i = 0; i < x.length; i++) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(this.mapX(x[i]), this.mapY(y[i]), 3, 0, 2 * Math.PI); ctx.fill();
    }

    // Hovered point
    if (this.hoveredPoint >= 0 && this.hoveredPoint < x.length) {
      const i = this.hoveredPoint;
      ctx.strokeStyle = '#E74C3C'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.mapX(x[i]), this.mapY(y[i]), 8, 0, 2 * Math.PI); ctx.stroke();
    }
  }

  /**
   * Which bars of a categorical X axis fall inside the plot rectangle.
   *
   * Shared by drawBar() and the SVG exporter so the two cannot disagree.
   *
   * Two passes, because the bar width depends on how many bars are visible:
   *   1. take the index range whose CENTRES are inside the plot rect
   *   2. drop an edge bar whose rectangle would stick out past the axes, then
   *      recompute the width for the smaller count
   * Step 2 matters because ArkUI's Canvas does not clip: a bar drawn past the
   * plot edge simply paints over the axis and the margin. The loop terminates
   * because every pass removes at least one index.
   */
  private visibleBarRange(labelCount: number, plotWidthPx: number): { iStart: number; iEnd: number } {
    const leftPx = this.vp.margin.left;
    const rightPx = leftPx + plotWidthPx;
    const a = this.vp.unmapX(leftPx);
    const b = this.vp.unmapX(rightPx);
    let iStart = Math.max(0, Math.ceil(Math.min(a, b)));
    let iEnd = Math.min(labelCount - 1, Math.floor(Math.max(a, b)));
    let changed = true;
    while (changed && iEnd >= iStart && labelCount > 0) {
      changed = false;
      const w = ChartComputator.barLayout(this.vp, iEnd - iStart + 1, 0.3).barWidth;
      if (this.vp.mapX(iStart) - w / 2 < leftPx) { iStart++; changed = true; }
      if (iEnd >= iStart && this.vp.mapX(iEnd) + w / 2 > rightPx) { iEnd--; changed = true; }
    }
    return { iStart, iEnd };
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
    const iStart = this.visibleBarRange(labels.length, pw);
    if (iStart.iEnd < iStart.iStart) return;
    const { barWidth } = ChartComputator.barLayout(this.vp, iStart.iEnd - iStart.iStart + 1, 0.3);
    const colors = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6'];
    const baseline = this.vp.mapY(0);

    for (let i = iStart.iStart; i <= iStart.iEnd; i++) {
      const centre = this.mapX(i);
      const x = centre - barWidth / 2;
      const top = this.mapY(values[i]);
      ctx.fillStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x, Math.min(top, baseline), barWidth, Math.abs(baseline - top));
      ctx.globalAlpha = 1;

      // Value label
      ctx.fillStyle = this.darkMode ? '#ccc' : '#2C3E50';
      ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(this.tickLabel(values[i]), centre, Math.min(top, baseline) - 3);

      // X label (rotated)
      ctx.save();
      ctx.translate(centre, this.vp.margin.top + ph + 5);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillText(labels[i], 0, 0);
      ctx.restore();
    }
  }

  private drawBoxPlot(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    const data = this.plotData!;
    const groups = data.boxGroups!;
    const allVals = groups.flatMap(g => g.values);
    const yMin = allVals.reduce((a, b) => Math.min(a, b), Infinity);
    const yMax = allVals.reduce((a, b) => Math.max(a, b), -Infinity);
    const yPad = (yMax - yMin) * 0.1 || 1;
    const mapY = (v: number) => this.vp.margin.top + ph - ((v - (yMin - yPad)) / ((yMax + yPad) - (yMin - yPad))) * ph;
    const boxW = pw / groups.length * 0.6;
    const gap = pw / groups.length * 0.4;
    const colors = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6'];

    for (let i = 0; i < groups.length; i++) {
      const sorted = [...groups[i].values].sort((a, b) => a - b);
      const n = sorted.length;
      if (n === 0) continue;
      const q1 = sorted[Math.floor(n * 0.25)];
      const med = sorted[Math.floor(n * 0.5)];
      const q3 = sorted[Math.floor(n * 0.75)];
      const iqr = q3 - q1;
      const wLo = Math.max(sorted[0], q1 - 1.5 * iqr);
      const wHi = Math.min(sorted[n - 1], q3 + 1.5 * iqr);
      const cx = this.vp.margin.left + (i * (boxW + gap)) + gap / 2 + boxW / 2;

      ctx.strokeStyle = colors[i % colors.length]; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, mapY(wLo)); ctx.lineTo(cx, mapY(q1)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, mapY(q3)); ctx.lineTo(cx, mapY(wHi)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - boxW * 0.2, mapY(wLo)); ctx.lineTo(cx + boxW * 0.2, mapY(wLo)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - boxW * 0.2, mapY(wHi)); ctx.lineTo(cx + boxW * 0.2, mapY(wHi)); ctx.stroke();

      ctx.fillStyle = colors[i % colors.length] + '40';
      ctx.strokeStyle = colors[i % colors.length]; ctx.lineWidth = 2;
      ctx.fillRect(cx - boxW / 2, mapY(q3), boxW, mapY(q1) - mapY(q3));
      ctx.strokeRect(cx - boxW / 2, mapY(q3), boxW, mapY(q1) - mapY(q3));

      ctx.strokeStyle = '#E74C3C'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx - boxW / 2, mapY(med)); ctx.lineTo(cx + boxW / 2, mapY(med)); ctx.stroke();

      ctx.fillStyle = this.darkMode ? '#ccc' : '#2C3E50';
      ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(groups[i].label, cx, this.vp.margin.top + ph + 15);
    }
  }

  private drawHeatmap(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    const data = this.plotData!;
    const matrix = data.matrix!, rowLabels = data.rowLabels!, colLabels = data.colLabels!;
    const nRows = matrix.length, nCols = matrix[0]?.length ?? 0;
    const cellW = pw / nCols, cellH = ph / nRows;
    let minV = Infinity, maxV = -Infinity;
    for (const row of matrix) for (const v of row) { minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
    const range = maxV - minV || 1;

    // Pre-compute normalized values + derived colors once
    const normVals: number[][] = new Array(nRows);
    const rChans: number[][] = new Array(nRows);
    const bChans: number[][] = new Array(nRows);
    const gChans: number[][] = new Array(nRows); // green channel (blue-ish diverging)
    for (let i = 0; i < nRows; i++) {
      normVals[i] = new Array(nCols);
      rChans[i] = new Array(nCols);
      bChans[i] = new Array(nCols);
      gChans[i] = new Array(nCols);
      for (let j = 0; j < nCols; j++) {
        const norm = (matrix[i][j] - minV) / range;
        normVals[i][j] = norm;
        rChans[i][j] = Math.floor(norm * 255);
        bChans[i][j] = Math.floor((1 - norm) * 255);
        gChans[i][j] = Math.floor(100 * (1 - Math.abs(norm - 0.5) * 2));
      }
    }

    // Draw cells using pre-computed values
    for (let i = 0; i < nRows; i++) for (let j = 0; j < nCols; j++) {
      const norm = normVals[i][j];
      const r = rChans[i][j], b = bChans[i][j], g = gChans[i][j];
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(this.vp.margin.left + j * cellW, this.vp.margin.top + i * cellH, cellW - 1, cellH - 1);

      // Value annotation
      if (cellW > 30 && cellH > 20) {
        ctx.fillStyle = norm > 0.5 ? '#fff' : '#2C3E50';
        ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(matrix[i][j].toFixed(2), this.vp.margin.left + j * cellW + cellW / 2, this.vp.margin.top + i * cellH + cellH / 2 + 3);
      }
    }

    // Labels
    ctx.fillStyle = this.darkMode ? '#ccc' : '#2C3E50';
    ctx.font = '9px sans-serif';
    for (let i = 0; i < nRows; i++) {
      ctx.textAlign = 'right';
      ctx.fillText(rowLabels[i] ?? '', this.vp.margin.left - 5, this.vp.margin.top + i * cellH + cellH / 2 + 3);
    }
    for (let j = 0; j < nCols; j++) {
      ctx.save();
      ctx.translate(this.vp.margin.left + j * cellW + cellW / 2, this.vp.margin.top + ph + 5);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillText(colLabels[j] ?? '', 0, 0);
      ctx.restore();
    }

    // Color bar — pre-compute gradient segments
    const barX = this.vp.margin.left + pw + 10, barW = 15;
    const barNormVals: number[] = new Array(Math.ceil(ph));
    const barR: number[] = new Array(barNormVals.length);
    const barB: number[] = new Array(barNormVals.length);
    const barG: number[] = new Array(barNormVals.length);
    for (let i = 0; i < barNormVals.length; i++) {
      const norm = 1 - i / ph;
      barNormVals[i] = norm;
      barR[i] = Math.floor(norm * 255);
      barB[i] = Math.floor((1 - norm) * 255);
      barG[i] = Math.floor(100 * (1 - Math.abs(norm - 0.5) * 2));
    }
    for (let i = 0; i < barNormVals.length; i++) {
      ctx.fillStyle = 'rgb(' + barR[i] + ',' + barG[i] + ',' + barB[i] + ')';
      ctx.fillRect(barX, this.vp.margin.top + i, barW, 1);
    }
    ctx.fillStyle = this.darkMode ? '#ccc' : '#2C3E50';
    ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(maxV.toFixed(2), barX + barW + 3, this.vp.margin.top + 8);
    ctx.fillText(minV.toFixed(2), barX + barW + 3, this.vp.margin.top + ph);
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
    svg += '<rect width="100%" height="100%" fill="' + (this.darkMode ? '#1a1a2e' : '#FFFFFF') + '"/>';

    // Title
    if (this.title) {
      svg += '<text x="' + (this.canvasWidth / 2) + '" y="25" text-anchor="middle" font-size="14" font-weight="bold" fill="' + (this.darkMode ? '#fff' : '#2C3E50') + '">' + this.escapeXml(this.title) + '</text>';
    }

    // Axes
    const pw = this.canvasWidth - this.vp.margin.left - this.vp.margin.right;
    const ph = this.canvasHeight - this.vp.margin.top - this.vp.margin.bottom;
    svg += '<line x1="' + this.vp.margin.left + '" y1="' + this.vp.margin.top + '" x2="' + this.vp.margin.left + '" y2="' + (this.vp.margin.top + ph) + '" stroke="' + (this.darkMode ? '#ccc' : '#2C3E50') + '" stroke-width="1.5"/>';
    svg += '<line x1="' + this.vp.margin.left + '" y1="' + (this.vp.margin.top + ph) + '" x2="' + (this.vp.margin.left + pw) + '" y2="' + (this.vp.margin.top + ph) + '" stroke="' + (this.darkMode ? '#ccc' : '#2C3E50') + '" stroke-width="1.5"/>';

    // Grid lines — horizontal from the Y ticks, vertical from the X ticks.
    svg += '<g stroke="' + (this.darkMode ? '#333' : '#E4E7EB') + '" stroke-width="0.5">';
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
            const colors = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6', '#1ABC9C'];
            for (let i = 0; i < this.plotData.x.length; i++) {
              const px = this.mapX(this.plotData.x[i]).toFixed(1);
              const py = this.mapY(this.plotData.y![i]).toFixed(1);
              const color = this.plotData.groups ? colors[this.plotData.groups[i] % colors.length] : colors[0];
              svg += '<circle cx="' + px + '" cy="' + py + '" r="5" fill="' + color + '" opacity="0.7"/>';
            }
          }
          break;
        case 'line':
          if (this.plotData.x && this.plotData.y) {
            const color = this.plotData.color ?? '#3498DB';
            let path = 'M ' + this.mapX(this.plotData.x[0]).toFixed(1) + ' ' + this.mapY(this.plotData.y[0]).toFixed(1);
            for (let i = 1; i < this.plotData.x.length; i++) {
              path += ' L ' + this.mapX(this.plotData.x[i]).toFixed(1) + ' ' + this.mapY(this.plotData.y[i]).toFixed(1);
            }
            svg += '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
          }
          break;
        case 'bar':
          if (this.plotData.labels && this.plotData.values) {
            // Same viewport-driven geometry AND the same visible range as
            // drawBar(), otherwise the exported figure would disagree with the
            // canvas exactly as the old pair did.
            const range = this.visibleBarRange(this.plotData.labels.length, pw);
            const iStart = range.iStart, iEnd = range.iEnd;
            if (iEnd >= iStart) {
              const barW = ChartComputator.barLayout(this.vp, iEnd - iStart + 1, 0.3).barWidth;
              const barColors = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6'];
              const baseline = this.vp.mapY(0);
              for (let i = iStart; i <= iEnd; i++) {
                const centre = this.mapX(i);
                const top = this.mapY(this.plotData.values[i]);
                const y = Math.min(top, baseline), h = Math.abs(baseline - top);
                svg += '<rect x="' + (centre - barW / 2).toFixed(1) + '" y="' + y.toFixed(1)
                  + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1)
                  + '" fill="' + barColors[i % barColors.length] + '" opacity="0.8"/>';
              }
            }
          }
          break;
        case 'boxplot':
          if (this.plotData.boxGroups) {
            const groups = this.plotData.boxGroups;
            const gw = ChartComputator.barLayout(this.vp, groups.length, 0.4).barWidth;
            const stroke = this.darkMode ? '#ccc' : '#2C3E50';
            for (let g = 0; g < groups.length; g++) {
              const vals = groups[g].values.slice().sort((a, b) => a - b);
              if (vals.length === 0) continue;
              const q = (f: number): number => {
                const idx = (vals.length - 1) * f;
                const lo = Math.floor(idx), hi = Math.ceil(idx);
                return vals[lo] + (vals[hi] - vals[lo]) * (idx - lo);
              };
              const q1 = q(0.25), med = q(0.5), q3 = q(0.75);
              const lo = vals[0], hi = vals[vals.length - 1];
              const centre = this.mapX(g);
              const x = centre - gw / 2;
              const yTop = this.mapY(hi), yBot = this.mapY(lo);
              svg += '<rect x="' + x.toFixed(1) + '" y="' + Math.min(yTop, this.mapY(q3)).toFixed(1)
                + '" width="' + gw.toFixed(1) + '" height="' + Math.abs(this.mapY(q3) - this.mapY(q1)).toFixed(1)
                + '" fill="none" stroke="' + stroke + '" stroke-width="1.5"/>';
              svg += '<line x1="' + x.toFixed(1) + '" y1="' + yTop.toFixed(1) + '" x2="' + (x + gw).toFixed(1)
                + '" y2="' + yTop.toFixed(1) + '" stroke="' + stroke + '" stroke-width="1.5"/>';
              svg += '<line x1="' + x.toFixed(1) + '" y1="' + yBot.toFixed(1) + '" x2="' + (x + gw).toFixed(1)
                + '" y2="' + yBot.toFixed(1) + '" stroke="' + stroke + '" stroke-width="1.5"/>';
              // Median line across the box.
              svg += '<line x1="' + x.toFixed(1) + '" y1="' + this.mapY(med).toFixed(1) + '" x2="' + (x + gw).toFixed(1)
                + '" y2="' + this.mapY(med).toFixed(1) + '" stroke="' + stroke + '" stroke-width="2"/>';
            }
          }
          break;
        case 'heatmap':
          if (this.plotData.matrix) {
            const m = this.plotData.matrix;
            const rows = m.length, cols = m.length > 0 ? m[0].length : 0;
            if (rows > 0 && cols > 0) {
              let lo = Infinity, hi = -Infinity;
              for (const r of m) for (const v of r) { if (v < lo) lo = v; if (v > hi) hi = v; }
              const span = hi - lo || 1;
              const cw = Math.abs(this.mapX(1) - this.mapX(0));
              const ch = Math.abs(this.mapY(0) - this.mapY(1));
              for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                  const t = (m[r][c] - lo) / span;
                  const x = Math.min(this.mapX(c), this.mapX(c + 1));
                  const y = Math.min(this.mapY(r), this.mapY(r + 1));
                  svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + cw.toFixed(1)
                    + '" height="' + ch.toFixed(1) + '" fill="rgb(' + Math.round(t * 255) + ','
                    + Math.round((1 - Math.abs(t - 0.5) * 2) * 255) + ',255)"/>';
                }
              }
            }
          }
          break;
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
    svg += '<g font-family="sans-serif" font-size="10" fill="' + (this.darkMode ? '#aaa' : '#7F8C8D') + '">';
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
    const safe = label.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').replace(/^_+|_+$/g, '');
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
      for (let i = 0; i < this.plotData.x.length; i++) {
        const px = this.mapX(this.plotData.x[i]).toFixed(1);
        const py = (this.canvasHeight - this.mapY(this.plotData.y![i])).toFixed(1);
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
  color: '#3498DB',
};

/** 合并默认值与覆盖项（浅合并，数组整体替换）。 */
export function mergePlotOptions(overrides: PlotOptions): PlotOptions {
  return { ...DEFAULT_PLOT_OPTIONS, ...overrides };
}
