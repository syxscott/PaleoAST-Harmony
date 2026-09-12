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
@Component
export struct PlotCanvas {
  @State plotType: string = 'scatter';
  @State title: string = '';
  @State xlabel: string = '';
  @State ylabel: string = '';
  @State darkMode: boolean = false;
  @State zoomLevel: number = 1.0;
  @State panX: number = 0;
  @State panY: number = 0;
  @State hoveredPoint: number = -1;
  @State selectedPoints: Set<number> = new Set();
  @State showTooltip: boolean = false;
  @State tooltipText: string = '';
  @State mouseX: number = 0;
  @State mouseY: number = 0;
  @State canvasWidth: number = 800;
  @State canvasHeight: number = 600;

  private plotData: PlotData | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  onStatus: (msg: string) => void = (_msg: string) => {};

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

  // Cached coordinate mapping
  private xMin: number = 0;
  private xMax: number = 1;
  private yMin: number = 0;
  private yMax: number = 1;
  private margin = { top: 50, right: 40, bottom: 60, left: 70 };

  build() {
    Column() {
      // ─── Toolbar ───
      Row() {
        Button('Zoom+').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.zoomLevel = Math.min(10, this.zoomLevel * 1.2); this.redraw(); })
        Button('Zoom-').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.zoomLevel = Math.max(0.1, this.zoomLevel / 1.2); this.redraw(); })
        Button('Reset').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.zoomLevel = 1; this.panX = 0; this.panY = 0; this.redraw(); })
        Button('Select All').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.selectAll(); this.redraw(); })
        Button('Clear Sel').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.selectedPoints.clear(); this.redraw(); })
        Button('PNG').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.exportPNG(); })
        Button('SVG').fontSize(10).height(28).margin({ right: 4 })
          .onClick(() => { this.exportSVG(); })
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
          .onActionStart(() => { this.pinchStartZoom = this.zoomLevel; })
          .onActionUpdate((event: GestureEvent) => {
            this.zoomLevel = Math.min(10, Math.max(0.1, this.pinchStartZoom * event.scale));
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

  // ─── Data Setters ──────────────────────────────────────────────

  setScatterData(x: number[], y: number[], labels?: string[], groups?: number[]): void {
    this.plotData = { type: 'scatter', x, y, labels, groups };
    this.plotType = 'scatter';
    this.updateRanges();
    this.redraw();
  }

  setLineData(x: number[], y: number[], color: string = '#3498DB'): void {
    this.plotData = { type: 'line', x, y, color };
    this.plotType = 'line';
    this.updateRanges();
    this.redraw();
  }

  setBarData(labels: string[], values: number[]): void {
    this.plotData = { type: 'bar', labels, values };
    this.plotType = 'bar';
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
    this.plotType = 'boxplot';
    this.redraw();
  }

  setHeatmapData(matrix: number[][], rowLabels: string[], colLabels: string[]): void {
    this.plotData = { type: 'heatmap', matrix, rowLabels, colLabels };
    this.plotType = 'heatmap';
    this.redraw();
  }

  setTitle(t: string): void { this.title = t; this.redraw(); }
  setLabels(x: string, y: string): void { this.xlabel = x; this.ylabel = y; this.redraw(); }
  setDarkMode(d: boolean): void { this.darkMode = d; this.redraw(); }

  // ─── Coordinate Mapping ────────────────────────────────────────

  private updateRanges(): void {
    if (!this.plotData?.x) return;
    this.xMin = this.plotData.x.reduce((a, b) => Math.min(a, b), Infinity);
    this.xMax = this.plotData.x.reduce((a, b) => Math.max(a, b), -Infinity);
    this.yMin = this.plotData.y!.reduce((a, b) => Math.min(a, b), Infinity);
    this.yMax = this.plotData.y!.reduce((a, b) => Math.max(a, b), -Infinity);
  }

  private mapX(v: number): number {
    const w = this.canvasWidth || 800;
    const pw = w - this.margin.left - this.margin.right;
    const xPad = (this.xMax - this.xMin) * 0.1 || 1;
    const range = (this.xMax - this.xMin + 2 * xPad);
    // Zoom relative to plot center, not margin.left
    const dataX = ((v - this.xMin + xPad) / range) * pw;
    const centerX = pw / 2;
    return this.margin.left + centerX + (dataX - centerX) * this.zoomLevel + this.panX;
  }

  private mapY(v: number): number {
    const h = this.canvasHeight || 600;
    const ph = h - this.margin.top - this.margin.bottom;
    const yPad = (this.yMax - this.yMin) * 0.1 || 1;
    const range = (this.yMax - this.yMin + 2 * yPad);
    // Y-axis: higher data values → higher screen position (lower pixel Y)
    const dataY = ((v - this.yMin + yPad) / range) * ph;
    const centerY = ph / 2;
    return this.margin.top + centerY - (dataY - centerY) * this.zoomLevel + this.panY;
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
    const w = this.canvasWidth || 800;
    const h = this.canvasHeight || 600;
    const pw = w - this.margin.left - this.margin.right;
    const ph = h - this.margin.top - this.margin.bottom;

    // Clear
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.darkMode ? '#1a1a2e' : '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    // Draw plot area background
    ctx.fillStyle = this.darkMode ? '#0f3460' : '#FAFBFC';
    ctx.fillRect(this.margin.left, this.margin.top, pw, ph);

    // Grid
    ctx.strokeStyle = this.darkMode ? '#333' : '#E4E7EB';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const gy = this.margin.top + (ph * i) / 5;
      ctx.beginPath(); ctx.moveTo(this.margin.left, gy); ctx.lineTo(this.margin.left + pw, gy); ctx.stroke();
      const gx = this.margin.left + (pw * i) / 5;
      ctx.beginPath(); ctx.moveTo(gx, this.margin.top); ctx.lineTo(gx, this.margin.top + ph); ctx.stroke();
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
    ctx.moveTo(this.margin.left, this.margin.top);
    ctx.lineTo(this.margin.left, this.margin.top + ph);
    ctx.lineTo(this.margin.left + pw, this.margin.top + ph);
    ctx.stroke();

    // Tick labels
    ctx.fillStyle = this.darkMode ? '#aaa' : '#7F8C8D';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 5; i++) {
      const xVal = this.xMin + ((this.xMax - this.xMin) * i) / 5;
      const yVal = this.yMin + ((this.yMax - this.yMin) * i) / 5;
      ctx.fillText(xVal.toFixed(2), this.margin.left + (pw * i) / 5, this.margin.top + ph + 15);
      ctx.textAlign = 'right';
      ctx.fillText(yVal.toFixed(2), this.margin.left - 5, this.margin.top + ph - (ph * i) / 5 + 4);
      ctx.textAlign = 'center';
    }

    // Axis labels
    if (this.xlabel) {
      ctx.fillStyle = this.darkMode ? '#ccc' : '#7F8C8D';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.xlabel, this.margin.left + pw / 2, h - 10);
    }
    if (this.ylabel) {
      ctx.save();
      ctx.translate(15, this.margin.top + ph / 2);
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
    if (this.xMin < 0 && this.xMax > 0) {
      ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.mapX(0), this.margin.top); ctx.lineTo(this.mapX(0), this.margin.top + ph); ctx.stroke();
    }
    if (this.yMin < 0 && this.yMax > 0) {
      ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.margin.left, this.mapY(0)); ctx.lineTo(this.margin.left + pw, this.mapY(0)); ctx.stroke();
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
        const y = this.margin.top + 20 + i * 15;
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath(); ctx.arc(this.margin.left + pw - 80, y, 5, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = this.darkMode ? '#ccc' : '#2C3E50';
        ctx.textAlign = 'left';
        ctx.fillText('Group ' + uniqueGroups[i], this.margin.left + pw - 70, y + 3);
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

  private drawBar(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    const data = this.plotData!;
    const labels = data.labels!, values = data.values!;
    const maxVal = values.reduce((a, b) => Math.max(a, b), 1);
    const barW = pw / labels.length * 0.7;
    const gap = pw / labels.length * 0.3;
    const colors = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6'];

    for (let i = 0; i < labels.length; i++) {
      const x = this.margin.left + (i * (barW + gap)) + gap / 2;
      const barH = (values[i] / maxVal) * ph;
      ctx.fillStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x, this.margin.top + ph - barH, barW, barH);
      ctx.globalAlpha = 1;

      // Value label
      ctx.fillStyle = this.darkMode ? '#ccc' : '#2C3E50';
      ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(values[i].toFixed(2), x + barW / 2, this.margin.top + ph - barH - 3);

      // X label (rotated)
      ctx.save();
      ctx.translate(x + barW / 2, this.margin.top + ph + 5);
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
    const mapY = (v: number) => this.margin.top + ph - ((v - (yMin - yPad)) / ((yMax + yPad) - (yMin - yPad))) * ph;
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
      const cx = this.margin.left + (i * (boxW + gap)) + gap / 2 + boxW / 2;

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
      ctx.fillText(groups[i].label, cx, this.margin.top + ph + 15);
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
      ctx.fillRect(this.margin.left + j * cellW, this.margin.top + i * cellH, cellW - 1, cellH - 1);

      // Value annotation
      if (cellW > 30 && cellH > 20) {
        ctx.fillStyle = norm > 0.5 ? '#fff' : '#2C3E50';
        ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(matrix[i][j].toFixed(2), this.margin.left + j * cellW + cellW / 2, this.margin.top + i * cellH + cellH / 2 + 3);
      }
    }

    // Labels
    ctx.fillStyle = this.darkMode ? '#ccc' : '#2C3E50';
    ctx.font = '9px sans-serif';
    for (let i = 0; i < nRows; i++) {
      ctx.textAlign = 'right';
      ctx.fillText(rowLabels[i] ?? '', this.margin.left - 5, this.margin.top + i * cellH + cellH / 2 + 3);
    }
    for (let j = 0; j < nCols; j++) {
      ctx.save();
      ctx.translate(this.margin.left + j * cellW + cellW / 2, this.margin.top + ph + 5);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillText(colLabels[j] ?? '', 0, 0);
      ctx.restore();
    }

    // Color bar — pre-compute gradient segments
    const barX = this.margin.left + pw + 10, barW = 15;
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
      ctx.fillRect(barX, this.margin.top + i, barW, 1);
    }
    ctx.fillStyle = this.darkMode ? '#ccc' : '#2C3E50';
    ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(maxV.toFixed(2), barX + barW + 3, this.margin.top + 8);
    ctx.fillText(minV.toFixed(2), barX + barW + 3, this.margin.top + ph);
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
    if (!this.plotData?.x) return;
    let minDist = Infinity, closest = -1;
    for (let i = 0; i < this.plotData.x.length; i++) {
      const dx = x - this.mapX(this.plotData.x[i]);
      const dy = y - this.mapY(this.plotData.y![i]);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist && d < 20) { minDist = d; closest = i; }
    }

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
    if (!this.plotData?.x) return;
    let minDist = Infinity, closest = -1;
    for (let i = 0; i < this.plotData.x.length; i++) {
      const dx = x - this.mapX(this.plotData.x[i]);
      const dy = y - this.mapY(this.plotData.y![i]);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist && d < 20) { minDist = d; closest = i; }
    }
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
      this.touchStartPanX = this.panX;
      this.touchStartPanY = this.panY;
      this.touchMoved = false;
    } else if (event.type === TouchType.Move) {
      const dx = t.x - this.touchStartX;
      const dy = t.y - this.touchStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { this.touchMoved = true; }
      if (this.touchMoved) {
        this.panX = this.touchStartPanX + dx;
        this.panY = this.touchStartPanY + dy;
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
    let svg = '<svg width="' + this.canvasWidth + '" height="' + this.canvasHeight + '" xmlns="http://www.w3.org/2000/svg">';
    svg += '<rect width="100%" height="100%" fill="' + (this.darkMode ? '#1a1a2e' : '#FFFFFF') + '"/>';

    // Title
    if (this.title) {
      svg += '<text x="' + (this.canvasWidth / 2) + '" y="25" text-anchor="middle" font-size="14" font-weight="bold" fill="' + (this.darkMode ? '#fff' : '#2C3E50') + '">' + this.escapeXml(this.title) + '</text>';
    }

    // Axes
    const pw = this.canvasWidth - this.margin.left - this.margin.right;
    const ph = this.canvasHeight - this.margin.top - this.margin.bottom;
    svg += '<line x1="' + this.margin.left + '" y1="' + this.margin.top + '" x2="' + this.margin.left + '" y2="' + (this.margin.top + ph) + '" stroke="' + (this.darkMode ? '#ccc' : '#2C3E50') + '" stroke-width="1.5"/>';
    svg += '<line x1="' + this.margin.left + '" y1="' + (this.margin.top + ph) + '" x2="' + (this.margin.left + pw) + '" y2="' + (this.margin.top + ph) + '" stroke="' + (this.darkMode ? '#ccc' : '#2C3E50') + '" stroke-width="1.5"/>';

    // Grid lines
    svg += '<g stroke="' + (this.darkMode ? '#333' : '#E4E7EB') + '" stroke-width="0.5">';
    for (let i = 0; i <= 5; i++) {
      const gy = this.margin.top + (ph * i) / 5;
      svg += '<line x1="' + this.margin.left + '" y1="' + gy + '" x2="' + (this.margin.left + pw) + '" y2="' + gy + '"/>';
      const gx = this.margin.left + (pw * i) / 5;
      svg += '<line x1="' + gx + '" y1="' + this.margin.top + '" x2="' + gx + '" y2="' + (this.margin.top + ph) + '"/>';
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
            const maxVal = this.plotData.values.reduce((a, b) => Math.max(a, b), 1);
            const barW = pw / this.plotData.labels.length * 0.7;
            const gap = pw / this.plotData.labels.length * 0.3;
            const barColors = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6'];
            for (let i = 0; i < this.plotData.labels.length; i++) {
              const x = this.margin.left + (i * (barW + gap)) + gap / 2;
              const barH = (this.plotData.values[i] / maxVal) * ph;
              svg += '<rect x="' + x + '" y="' + (this.margin.top + ph - barH) + '" width="' + barW + '" height="' + barH + '" fill="' + barColors[i % barColors.length] + '" opacity="0.8"/>';
            }
          }
          break;
      }
    }

    svg += '</svg>';
    return svg;
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
