import { DataMatrix } from '../../core/data/index';

@Component
export struct PlotCanvas {
  @State plotType: string = 'scatter';
  @State title: string = '';
  @State darkMode: boolean = false;
  @State zoomLevel: number = 1.0;
  @State hoveredPoint: number = -1;
  private plotData: any = null;

  build() {
    Column() {
      Row() {
        Button('Zoom+').fontSize(10).height(24).onClick(() => { this.zoomLevel *= 1.2; })
        Button('Zoom-').fontSize(10).height(24).onClick(() => { this.zoomLevel = Math.max(0.1, this.zoomLevel / 1.2); })
        Button('Reset').fontSize(10).height(24).onClick(() => { this.zoomLevel = 1; })
        Blank()
        Text(this.title).fontSize(11).fontColor('#7F8C8D')
      }.width('100%').height(32).padding(8).backgroundColor('#F8F9FA')

      Canvas((ctx: CanvasRenderingContext2D) => { this.renderPlot(ctx); })
        .width('100%').layoutWeight(1)
    }.width('100%').height('100%')
  }

  setScatterData(x: number[], y: number[], labels?: string[], groups?: number[]): void {
    this.plotData = { type: 'scatter', x, y, labels, groups };
    this.plotType = 'scatter';
  }

  setLineData(x: number[], y: number[]): void {
    this.plotData = { type: 'line', x, y };
  }

  setBarData(labels: string[], values: number[]): void {
    this.plotData = { type: 'bar', labels, values };
  }

  private renderPlot(ctx: CanvasRenderingContext2D): void {
    if (!this.plotData) return;
    const w = 800, h = 600;
    const margin = { top: 50, right: 30, bottom: 60, left: 70 };
    const pw = w - margin.left - margin.right;
    const ph = h - margin.top - margin.bottom;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.darkMode ? '#1a1a2e' : '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    if (this.plotData.type === 'scatter') {
      const x = this.plotData.x, y = this.plotData.y;
      const xMin = Math.min(...x), xMax = Math.max(...x);
      const yMin = Math.min(...y), yMax = Math.max(...y);
      const xPad = (xMax - xMin) * 0.1 || 1, yPad = (yMax - yMin) * 0.1 || 1;
      const mapX = (v: number) => margin.left + ((v - xMin + xPad) / (xMax - xMin + 2 * xPad)) * pw;
      const mapY = (v: number) => margin.top + ph - ((v - yMin + yPad) / (yMax - yMin + 2 * yPad)) * ph;

      // Grid
      ctx.strokeStyle = '#E4E7EB'; ctx.lineWidth = 0.5;
      for (let i = 0; i <= 5; i++) {
        const gy = margin.top + (ph * i) / 5;
        ctx.beginPath(); ctx.moveTo(margin.left, gy); ctx.lineTo(margin.left + pw, gy); ctx.stroke();
      }

      // Points
      const colors = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12'];
      for (let i = 0; i < x.length; i++) {
        const color = this.plotData?.groups ? colors[this.plotData.groups[i] % colors.length] : colors[0];
        ctx.fillStyle = color; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.arc(mapX(x[i]), mapY(y[i]), 5, 0, 2 * Math.PI); ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Axes
      ctx.strokeStyle = '#2C3E50'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, margin.top + ph); ctx.lineTo(margin.left + pw, margin.top + ph); ctx.stroke();
    }

    if (this.title) {
      ctx.fillStyle = '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(this.title, w / 2, 25);
    }
  }

  setScatterData(x: number[], y: number[], labels?: string[], groups?: number[]): void {
    this.plotData = { type: 'scatter', x, y, labels, groups };
    this.plotType = 'scatter';
  }

  setLineData(x: number[], y: number[]): void {
    this.plotData = { type: 'line', x, y };
    this.plotType = 'line';
  }

  setBarData(labels: string[], values: number[]): void {
    this.plotData = { type: 'bar', labels, values };
    this.plotType = 'bar';
  }

  setBoxPlotData(groups: { label: string; values: number[] }[]): void {
    this.plotData = { type: 'boxplot', groups };
    this.plotType = 'boxplot';
  }

  setHeatmapData(matrix: number[][], rowLabels: string[], colLabels: string[]): void {
    this.plotData = { type: 'heatmap', matrix, rowLabels, colLabels };
    this.plotType = 'heatmap';
  }

  exportPNG(): void { console.log('Export PNG'); }
  exportSVG(): void { console.log('Export SVG'); }
}
