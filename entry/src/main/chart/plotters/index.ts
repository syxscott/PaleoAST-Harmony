/**
 * Chart rendering engine using ArkUI Canvas 2D API.
 * Replaces matplotlib for all plot types.
 */

export interface PlotConfig {
  width: number;
  height: number;
  title: string;
  xlabel: string;
  ylabel: string;
  gridEnabled: boolean;
  darkMode: boolean;
}

const DEFAULT_CONFIG: PlotConfig = {
  width: 800, height: 600, title: '', xlabel: '', ylabel: '',
  gridEnabled: true, darkMode: false,
};

const COLORS = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6', '#1ABC9C'];

export function getColors(): string[] { return COLORS; }

/**
 * Draw a scatter plot on a Canvas 2D context.
 */
export function drawScatter(
  ctx: CanvasRenderingContext2D,
  x: number[], y: number[],
  config: Partial<PlotConfig> = {},
  groups?: number[],
  labels?: string[],
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 30, bottom: 60, left: 70 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;

  // Clear
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  // Data range
  const xMin = Math.min(...x), xMax = Math.max(...x);
  const yMin = Math.min(...y), yMax = Math.max(...y);
  const xPad = (xMax - xMin) * 0.1 || 1;
  const yPad = (yMax - yMin) * 0.1 || 1;
  const xLo = xMin - xPad, xHi = xMax + xPad;
  const yLo = yMin - yPad, yHi = yMax + yPad;

  const mapX = (v: number) => margin.left + ((v - xLo) / (xHi - xLo)) * pw;
  const mapY = (v: number) => margin.top + ph - ((v - yLo) / (yHi - yLo)) * ph;

  // Grid
  if (cfg.gridEnabled) {
    ctx.strokeStyle = cfg.darkMode ? '#333' : '#E4E7EB';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const gy = margin.top + (ph * i) / 5;
      ctx.beginPath(); ctx.moveTo(margin.left, gy); ctx.lineTo(w - margin.right, gy); ctx.stroke();
      const gx = margin.left + (pw * i) / 5;
      ctx.beginPath(); ctx.moveTo(gx, margin.top); ctx.lineTo(gx, h - margin.bottom); ctx.stroke();
    }
  }

  // Axes
  ctx.strokeStyle = cfg.darkMode ? '#ccc' : '#2C3E50';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(margin.left, margin.top); ctx.lineTo(margin.left, h - margin.bottom); ctx.lineTo(w - margin.right, h - margin.bottom); ctx.stroke();

  // Zero lines
  if (xLo < 0 && xHi > 0) {
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mapX(0), margin.top); ctx.lineTo(mapX(0), h - margin.bottom); ctx.stroke();
  }
  if (yLo < 0 && yHi > 0) {
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(margin.left, mapY(0)); ctx.lineTo(w - margin.right, mapY(0)); ctx.stroke();
  }

  // Points
  for (let i = 0; i < x.length; i++) {
    const color = groups ? COLORS[groups[i] % COLORS.length] : COLORS[0];
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(mapX(x[i]), mapY(y[i]), 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (labels && labels[i]) {
      ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50';
      ctx.font = '10px sans-serif';
      ctx.fillText(labels[i], mapX(x[i]) + 7, mapY(y[i]) - 3);
    }
  }

  // Title
  if (cfg.title) {
    ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(cfg.title, w / 2, 25);
  }

  // Axis labels
  if (cfg.xlabel) {
    ctx.fillStyle = cfg.darkMode ? '#ccc' : '#7F8C8D';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(cfg.xlabel, w / 2, h - 10);
  }
  if (cfg.ylabel) {
    ctx.save();
    ctx.translate(15, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(cfg.ylabel, 0, 0);
    ctx.restore();
  }

  // Tick labels
  ctx.fillStyle = cfg.darkMode ? '#aaa' : '#7F8C8D';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 5; i++) {
    const xVal = xLo + ((xHi - xLo) * i) / 5;
    const yVal = yLo + ((yHi - yLo) * i) / 5;
    ctx.fillText(xVal.toFixed(1), margin.left + (pw * i) / 5, h - margin.bottom + 15);
    ctx.textAlign = 'right';
    ctx.fillText(yVal.toFixed(1), margin.left - 5, margin.top + ph - (ph * i) / 5 + 4);
    ctx.textAlign = 'center';
  }
}

/**
 * Draw a bar chart.
 */
export function drawBar(
  ctx: CanvasRenderingContext2D,
  labels: string[], values: number[],
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 30, bottom: 80, left: 70 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  const maxVal = Math.max(...values, 1);
  const barWidth = pw / labels.length * 0.7;
  const gap = pw / labels.length * 0.3;

  for (let i = 0; i < labels.length; i++) {
    const x = margin.left + (i * (barWidth + gap)) + gap / 2;
    const barH = (values[i] / maxVal) * ph;
    const y = margin.top + ph - barH;

    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, y, barWidth, barH);
    ctx.globalAlpha = 1;

    // Value label
    ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(values[i].toFixed(2), x + barWidth / 2, y - 5);

    // X label
    ctx.save();
    ctx.translate(x + barWidth / 2, h - margin.bottom + 10);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign = 'right';
    ctx.fillText(labels[i], 0, 0);
    ctx.restore();
  }

  if (cfg.title) {
    ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(cfg.title, w / 2, 25);
  }
}

/**
 * Draw a histogram.
 */
export function drawHistogram(
  ctx: CanvasRenderingContext2D,
  data: number[],
  nBins: number = 30,
  config: Partial<PlotConfig> = {},
): void {
  const min = Math.min(...data), max = Math.max(...data);
  const binWidth = (max - min) / nBins || 1;
  const bins = new Array(nBins).fill(0);
  for (const v of data) {
    const idx = Math.min(Math.floor((v - min) / binWidth), nBins - 1);
    if (idx >= 0) bins[idx]++;
  }
  const binLabels = bins.map((_, i) => (min + i * binWidth).toFixed(1));
  drawBar(ctx, binLabels, bins, { ...config, xlabel: config.xlabel || 'Value', ylabel: config.ylabel || 'Frequency' });
}

/**
 * Draw a line plot.
 */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  x: number[], y: number[],
  config: Partial<PlotConfig> = {},
  color: string = COLORS[0],
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 30, bottom: 60, left: 70 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  const xMin = Math.min(...x), xMax = Math.max(...x);
  const yMin = Math.min(...y), yMax = Math.max(...y);
  const xPad = (xMax - xMin) * 0.05 || 1;
  const yPad = (yMax - yMin) * 0.1 || 1;
  const xLo = xMin - xPad, xHi = xMax + xPad;
  const yLo = yMin - yPad, yHi = yMax + yPad;

  const mapX = (v: number) => margin.left + ((v - xLo) / (xHi - xLo)) * pw;
  const mapY = (v: number) => margin.top + ph - ((v - yLo) / (yHi - yLo)) * ph;

  // Line
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < x.length; i++) {
    if (i === 0) ctx.moveTo(mapX(x[i]), mapY(y[i]));
    else ctx.lineTo(mapX(x[i]), mapY(y[i]));
  }
  ctx.stroke();

  // Points
  for (let i = 0; i < x.length; i++) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(mapX(x[i]), mapY(y[i]), 3, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Title & labels
  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 25); }
  if (cfg.xlabel) { ctx.fillStyle = cfg.darkMode ? '#ccc' : '#7F8C8D'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.xlabel, w / 2, h - 10); }
}

/**
 * Draw a box plot.
 */
export function drawBoxPlot(
  ctx: CanvasRenderingContext2D,
  groups: { label: string; values: number[] }[],
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 30, bottom: 80, left: 70 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  const allVals = groups.flatMap(g => g.values);
  const yMin = Math.min(...allVals), yMax = Math.max(...allVals);
  const yPad = (yMax - yMin) * 0.1 || 1;
  const mapY = (v: number) => margin.top + ph - ((v - (yMin - yPad)) / ((yMax + yPad) - (yMin - yPad))) * ph;

  const boxW = pw / groups.length * 0.6;
  const gap = pw / groups.length * 0.4;

  for (let i = 0; i < groups.length; i++) {
    const sorted = [...groups[i].values].sort((a, b) => a - b);
    const n = sorted.length;
    if (n === 0) continue;
    const q1 = sorted[Math.floor(n * 0.25)];
    const med = sorted[Math.floor(n * 0.5)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const whiskerLo = Math.max(sorted[0], q1 - 1.5 * iqr);
    const whiskerHi = Math.min(sorted[n - 1], q3 + 1.5 * iqr);

    const cx = margin.left + (i * (boxW + gap)) + gap / 2 + boxW / 2;

    // Whiskers
    ctx.strokeStyle = COLORS[i % COLORS.length];
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, mapY(whiskerLo)); ctx.lineTo(cx, mapY(q1)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, mapY(q3)); ctx.lineTo(cx, mapY(whiskerHi)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - boxW * 0.2, mapY(whiskerLo)); ctx.lineTo(cx + boxW * 0.2, mapY(whiskerLo)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - boxW * 0.2, mapY(whiskerHi)); ctx.lineTo(cx + boxW * 0.2, mapY(whiskerHi)); ctx.stroke();

    // Box
    ctx.fillStyle = COLORS[i % COLORS.length] + '40';
    ctx.strokeStyle = COLORS[i % COLORS.length];
    ctx.lineWidth = 2;
    ctx.fillRect(cx - boxW / 2, mapY(q3), boxW, mapY(q1) - mapY(q3));
    ctx.strokeRect(cx - boxW / 2, mapY(q3), boxW, mapY(q1) - mapY(q3));

    // Median line
    ctx.strokeStyle = '#E74C3C';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx - boxW / 2, mapY(med)); ctx.lineTo(cx + boxW / 2, mapY(med)); ctx.stroke();

    // Label
    ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(groups[i].label, cx, h - margin.bottom + 15);
  }

  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 25); }
}

/**
 * Draw a heatmap.
 */
export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  matrix: number[][],
  rowLabels: string[],
  colLabels: string[],
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 80, bottom: 80, left: 80 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  const nRows = matrix.length, nCols = matrix[0]?.length ?? 0;
  if (nRows === 0 || nCols === 0) return;

  const cellW = pw / nCols, cellH = ph / nRows;
  let minVal = Infinity, maxVal = -Infinity;
  for (const row of matrix) for (const v of row) { minVal = Math.min(minVal, v); maxVal = Math.max(maxVal, v); }
  const range = maxVal - minVal || 1;

  for (let i = 0; i < nRows; i++) for (let j = 0; j < nCols; j++) {
    const norm = (matrix[i][j] - minVal) / range;
    const r = Math.floor(norm * 255);
    const b = Math.floor((1 - norm) * 255);
    ctx.fillStyle = `rgb(${r}, ${Math.floor(100 * (1 - Math.abs(norm - 0.5) * 2))}, ${b})`;
    ctx.fillRect(margin.left + j * cellW, margin.top + i * cellH, cellW - 1, cellH - 1);
  }

  // Labels
  ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50';
  ctx.font = '9px sans-serif';
  for (let i = 0; i < nRows; i++) {
    ctx.textAlign = 'right';
    ctx.fillText(rowLabels[i] ?? '', margin.left - 4, margin.top + i * cellH + cellH / 2 + 3);
  }
  for (let j = 0; j < nCols; j++) {
    ctx.save();
    ctx.translate(margin.left + j * cellW + cellW / 2, h - margin.bottom + 4);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign = 'right';
    ctx.fillText(colLabels[j] ?? '', 0, 0);
    ctx.restore();
  }

  // Color bar
  const barX = w - margin.right + 10, barW = 15;
  for (let i = 0; i < ph; i++) {
    const norm = 1 - i / ph;
    const r = Math.floor(norm * 255), b = Math.floor((1 - norm) * 255);
    ctx.fillStyle = `rgb(${r}, ${Math.floor(100 * (1 - Math.abs(norm - 0.5) * 2))}, ${b})`;
    ctx.fillRect(barX, margin.top + i, barW, 1);
  }
  ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(maxVal.toFixed(2), barX + barW + 3, margin.top + 8);
  ctx.fillText(minVal.toFixed(2), barX + barW + 3, margin.top + ph);

  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 25); }
}

/**
 * Draw a dendrogram (tree diagram).
 */
export function drawDendrogram(
  ctx: CanvasRenderingContext2D,
  linkageMatrix: number[][],
  labels: string[],
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 40, right: 30, bottom: 60, left: 80 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  const n = linkageMatrix.length + 1;
  const maxDist = Math.max(...linkageMatrix.map(row => row[2]), 1);

  // Compute leaf positions
  const leafOrder: number[] = [];
  const leafPositions = new Map<number, number>();
  const nodePositions = new Map<number, { x: number; y: number }>();

  // Simple layout: leaves at bottom, evenly spaced
  for (let i = 0; i < n; i++) { leafOrder.push(i); leafPositions.set(i, i); }

  for (let i = 0; i < linkageMatrix.length; i++) {
    const [c1, c2, dist, size] = linkageMatrix[i];
    const nodeId = n + i;
    const x = margin.left + (dist / maxDist) * pw;
    const y1 = margin.top + ((leafPositions.get(c1) ?? 0) / (n - 1)) * ph;
    const y2 = margin.top + ((leafPositions.get(c2) ?? 0) / (n - 1)) * ph;
    nodePositions.set(nodeId, { x, y: (y1 + y2) / 2 });

    // Draw horizontal lines
    ctx.strokeStyle = cfg.darkMode ? '#aaa' : '#2C3E50';
    ctx.lineWidth = 1.5;
    const parentX = margin.left + (dist / maxDist) * pw;
    const childX1 = c1 < n ? margin.left : (nodePositions.get(c1)?.x ?? margin.left);
    const childX2 = c2 < n ? margin.left : (nodePositions.get(c2)?.x ?? margin.left);

    ctx.beginPath(); ctx.moveTo(parentX, y1); ctx.lineTo(childX1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(parentX, y2); ctx.lineTo(childX2, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(parentX, y1); ctx.lineTo(parentX, y2); ctx.stroke();

    // Update positions
    leafPositions.set(nodeId, (leafPositions.get(c1)! + leafPositions.get(c2)!) / 2);
  }

  // Leaf labels
  ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i < n; i++) {
    const y = margin.top + (i / (n - 1)) * ph;
    ctx.fillText(labels[i] ?? `Sample ${i}`, margin.left - 5, y + 4);
  }

  // Distance axis
  ctx.strokeStyle = cfg.darkMode ? '#ccc' : '#2C3E50';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(margin.left, h - margin.bottom + 10); ctx.lineTo(w - margin.right, h - margin.bottom + 10); ctx.stroke();
  for (let i = 0; i <= 5; i++) {
    const x = margin.left + (pw * i) / 5;
    const val = (maxDist * i) / 5;
    ctx.beginPath(); ctx.moveTo(x, h - margin.bottom + 8); ctx.lineTo(x, h - margin.bottom + 12); ctx.stroke();
    ctx.fillStyle = cfg.darkMode ? '#aaa' : '#7F8C8D';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(val.toFixed(2), x, h - margin.bottom + 24);
  }

  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 20); }
}

/**
 * Draw a pie chart.
 */
export function drawPie(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  values: number[],
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return;

  const cx = w / 2, cy = h / 2 + 10;
  const radius = Math.min(w, h) / 2 - 60;

  let startAngle = -Math.PI / 2;
  for (let i = 0; i < values.length; i++) {
    const sliceAngle = (values[i] / total) * 2 * Math.PI;
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    const midAngle = startAngle + sliceAngle / 2;
    const labelX = cx + (radius + 20) * Math.cos(midAngle);
    const labelY = cy + (radius + 20) * Math.sin(midAngle);
    ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50';
    ctx.font = '10px sans-serif';
    ctx.textAlign = Math.cos(midAngle) > 0 ? 'left' : 'right';
    ctx.fillText(`${labels[i]} (${(values[i] / total * 100).toFixed(1)}%)`, labelX, labelY);

    startAngle += sliceAngle;
  }

  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 25); }
}

/**
 * Draw a rose diagram (circular histogram).
 */
export function drawRose(
  ctx: CanvasRenderingContext2D,
  binCenters: number[],
  counts: number[],
  meanDirection: number,
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2 + 10;
  const radius = Math.min(w, h) / 2 - 60;
  const maxCount = Math.max(...counts, 1);

  // Draw circular grid
  ctx.strokeStyle = cfg.darkMode ? '#333' : '#E4E7EB';
  ctx.lineWidth = 0.5;
  for (let r = 1; r <= 4; r++) {
    ctx.beginPath(); ctx.arc(cx, cy, radius * r / 4, 0, 2 * Math.PI); ctx.stroke();
  }
  for (let a = 0; a < 360; a += 30) {
    const rad = a * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)); ctx.stroke();
  }

  // Draw bars
  const binWidth = (2 * Math.PI) / binCenters.length;
  for (let i = 0; i < binCenters.length; i++) {
    const angle = binCenters[i] * Math.PI / 180 - Math.PI / 2;
    const r = (counts[i] / maxCount) * radius;
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle - binWidth / 2, angle + binWidth / 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Mean direction arrow
  const meanRad = meanDirection * Math.PI / 180 - Math.PI / 2;
  ctx.strokeStyle = '#E74C3C';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + radius * 0.9 * Math.cos(meanRad), cy + radius * 0.9 * Math.sin(meanRad));
  ctx.stroke();

  // Arrow head
  const arrowX = cx + radius * 0.9 * Math.cos(meanRad);
  const arrowY = cy + radius * 0.9 * Math.sin(meanRad);
  ctx.fillStyle = '#E74C3C';
  ctx.beginPath();
  ctx.moveTo(arrowX, arrowY);
  ctx.lineTo(arrowX - 10 * Math.cos(meanRad - 0.3), arrowY - 10 * Math.sin(meanRad - 0.3));
  ctx.lineTo(arrowX - 10 * Math.cos(meanRad + 0.3), arrowY - 10 * Math.sin(meanRad + 0.3));
  ctx.closePath();
  ctx.fill();

  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 25); }
}

/**
 * Draw a Shepard diagram (original vs ordination distances).
 */
export function drawShepard(
  ctx: CanvasRenderingContext2D,
  originalDist: number[],
  ordinationDist: number[],
  stress: number,
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const x = originalDist, y = ordinationDist;
  drawScatter(ctx, x, y, { ...cfg, title: cfg.title || `Shepard Diagram (stress=${stress.toFixed(3)})`, xlabel: 'Original Distance', ylabel: 'Ordination Distance' });

  // Add 1:1 line
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 30, bottom: 60, left: 70 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;
  const allVals = [...x, ...y];
  const maxV = Math.max(...allVals);
  const mapX = (v: number) => margin.left + (v / maxV) * pw;
  const mapY = (v: number) => margin.top + ph - (v / maxV) * ph;

  ctx.strokeStyle = '#E74C3C';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(mapX(0), mapY(0)); ctx.lineTo(mapX(maxV), mapY(maxV)); ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Draw a scree plot (eigenvalue bar + cumulative line).
 */
export function drawScree(
  ctx: CanvasRenderingContext2D,
  eigenvalues: number[],
  explainedVar: number[],
  cumulativeVar: number[],
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 50, bottom: 60, left: 70 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  const n = eigenvalues.length;
  const maxVar = Math.max(...explainedVar, 1);
  const barW = pw / n * 0.7;
  const gap = pw / n * 0.3;

  // Bars
  for (let i = 0; i < n; i++) {
    const x = margin.left + (i * (barW + gap)) + gap / 2;
    const barH = (explainedVar[i] / maxVar) * ph;
    ctx.fillStyle = '#3498DB';
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, margin.top + ph - barH, barW, barH);
    ctx.globalAlpha = 1;
  }

  // Cumulative line
  ctx.strokeStyle = '#E74C3C';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = margin.left + (i * (barW + gap)) + gap / 2 + barW / 2;
    const y = margin.top + ph - (cumulativeVar[i] / 100) * ph;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Kaiser line
  const kaiserY = margin.top + ph - (100 / n / maxVar) * ph;
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(margin.left, kaiserY); ctx.lineTo(w - margin.right, kaiserY); ctx.stroke();
  ctx.setLineDash([]);

  // Axes
  ctx.fillStyle = cfg.darkMode ? '#ccc' : '#7F8C8D';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const x = margin.left + (i * (barW + gap)) + gap / 2 + barW / 2;
    ctx.fillText(`PC${i + 1}`, x, h - margin.bottom + 15);
  }

  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 25); }
}

/**
 * Draw a rarefaction curve with optional confidence interval.
 */
export function drawRarefactionCurve(
  ctx: CanvasRenderingContext2D,
  sampleSizes: number[],
  expectedTaxa: number[],
  ciLower?: number[],
  ciUpper?: number[],
  config: Partial<PlotConfig> = {},
): void {
  drawLine(ctx, sampleSizes, expectedTaxa, config, '#3498DB');
  if (ciLower && ciUpper) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const { width: w, height: h } = cfg;
    const margin = { top: 50, right: 30, bottom: 60, left: 70 };
    const pw = w - margin.left - margin.right, ph = h - margin.top - margin.bottom;
    const allY = [...expectedTaxa, ...ciLower, ...ciUpper];
    const yMin = Math.min(...allY), yMax = Math.max(...allY);
    const xMin = Math.min(...sampleSizes), xMax = Math.max(...sampleSizes);
    const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.1 || 1;
    const mapX = (v: number) => margin.left + ((v - xMin + xPad) / (xMax - xMin + 2 * xPad)) * pw;
    const mapY = (v: number) => margin.top + ph - ((v - yMin + yPad) / (yMax - yMin + 2 * yPad)) * ph;
    ctx.fillStyle = '#3498DB20';
    ctx.beginPath();
    for (let i = 0; i < sampleSizes.length; i++) { if (i === 0) ctx.moveTo(mapX(sampleSizes[i]), mapY(ciUpper[i])); else ctx.lineTo(mapX(sampleSizes[i]), mapY(ciUpper[i])); }
    for (let i = sampleSizes.length - 1; i >= 0; i--) ctx.lineTo(mapX(sampleSizes[i]), mapY(ciLower[i]));
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Draw a Q-Q plot for normality assessment.
 */
export function drawQQPlot(
  ctx: CanvasRenderingContext2D,
  data: number[],
  config: Partial<PlotConfig> = {},
): void {
  const sorted = [...data].filter(v => !isNaN(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n < 3) return;
  const theoretical: number[] = [];
  for (let i = 0; i < n; i++) { const p = (i + 0.5) / n; theoretical.push(normInvQQ(p)); }
  drawScatter(ctx, theoretical, sorted, { ...config, title: config.title || 'Q-Q Plot', xlabel: 'Theoretical', ylabel: 'Sample' });
}

function normInvQQ(p: number): number {
  if (p <= 0) return -4; if (p >= 1) return 4;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, -4.374664141464968, -2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p <= 0.97575) { const q = p - 0.5, r = q * q; return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1); }
  const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

/**
 * Draw a confidence ellipse around a group of 2D points.
 */
export function drawConfidenceEllipse(
  ctx: CanvasRenderingContext2D,
  points: number[][],
  color: string,
  confidence: number = 0.95,
): void {
  const n = points.length;
  if (n < 3) return;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of points) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  sxx /= n - 1; sxy /= n - 1; syy /= n - 1;
  const trace = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const l1 = trace / 2 + disc, l2 = Math.max(0, trace / 2 - disc);
  const angle = sxy !== 0 ? Math.atan2(l1 - sxx, sxy) : (sxx >= syy ? 0 : Math.PI / 2);
  const chi2Scale = confidence === 0.99 ? 3.035 : 2.447;
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.beginPath();
  for (let theta = 0; theta <= 2 * Math.PI + 0.1; theta += 0.1) {
    const ex = chi2Scale * Math.sqrt(Math.max(0, l1)) * Math.cos(theta);
    const ey = chi2Scale * Math.sqrt(Math.max(0, l2)) * Math.sin(theta);
    const rx = mx + ex * Math.cos(angle) - ey * Math.sin(angle);
    const ry = my + ex * Math.sin(angle) + ey * Math.cos(angle);
    if (theta === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
  }
  ctx.stroke(); ctx.setLineDash([]);
}

/**
 * Draw a null model histogram with observed score line.
 */
export function drawNullModelHistogram(
  ctx: CanvasRenderingContext2D,
  simulated: number[],
  observed: number,
  ses: number,
  pValue: number,
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 30, bottom: 60, left: 70 };
  const pw = w - margin.left - margin.right, ph = h - margin.top - margin.bottom;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  const nBins = 50;
  const minV = Math.min(...simulated, observed), maxV = Math.max(...simulated, observed);
  const binW = (maxV - minV) / nBins || 1;
  const bins = new Array(nBins).fill(0);
  for (const v of simulated) { const idx = Math.min(Math.floor((v - minV) / binW), nBins - 1); if (idx >= 0) bins[idx]++; }
  const maxBin = Math.max(...bins, 1);
  for (let i = 0; i < nBins; i++) {
    const x = margin.left + (i / nBins) * pw;
    const barH = (bins[i] / maxBin) * ph;
    ctx.fillStyle = '#3498DB'; ctx.globalAlpha = 0.7;
    ctx.fillRect(x, margin.top + ph - barH, pw / nBins - 1, barH);
    ctx.globalAlpha = 1;
  }
  const obsX = margin.left + ((observed - minV) / (maxV - minV)) * pw;
  ctx.strokeStyle = '#E74C3C'; ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
  ctx.beginPath(); ctx.moveTo(obsX, margin.top); ctx.lineTo(obsX, margin.top + ph); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`Observed: ${observed.toFixed(3)}, SES: ${ses.toFixed(2)}, p=${pValue.toFixed(3)}`, margin.left + 5, margin.top + 15);
  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 25); }
}

/**
 * Draw a phylogenetic tree (simplified rectangular cladogram).
 */
export function drawPhyloTree(
  ctx: CanvasRenderingContext2D,
  leaves: string[],
  linkageOrTree: any,
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 40, right: 100, bottom: 30, left: 80 };
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  const n = leaves.length;
  if (n === 0) return;
  const pw = w - margin.left - margin.right, ph = h - margin.top - margin.bottom;
  // Simple rectangular layout
  for (let i = 0; i < n; i++) {
    const y = margin.top + (i / (n - 1 || 1)) * ph;
    ctx.strokeStyle = cfg.darkMode ? '#aaa' : '#2C3E50'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + pw * 0.7, y); ctx.stroke();
    ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(leaves[i], margin.left + pw * 0.7 + 5, y + 4);
  }
  // Draw internal structure (simplified)
  if (n >= 2) {
    const yTop = margin.top, yBot = margin.top + ph;
    const xMid = margin.left + pw * 0.35;
    ctx.beginPath(); ctx.moveTo(xMid, yTop); ctx.lineTo(xMid, yBot); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin.left, (yTop + yBot) / 2); ctx.lineTo(xMid, (yTop + yBot) / 2); ctx.stroke();
  }
  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 20); }
}

/**
 * Draw a PCA biplot (scores + loading arrows).
 */
export function drawPCABiplot(
  ctx: CanvasRenderingContext2D,
  scores: number[][],
  loadings: number[][],
  loadingLabels: string[],
  groups?: number[],
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 30, bottom: 60, left: 70 };
  const pw = w - margin.left - margin.right, ph = h - margin.top - margin.bottom;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  const allX = scores.map(s => s[0]), allY = scores.map(s => s[1]);
  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const xPad = (xMax - xMin) * 0.15 || 1, yPad = (yMax - yMin) * 0.15 || 1;
  const mapX = (v: number) => margin.left + ((v - xMin + xPad) / (xMax - xMin + 2 * xPad)) * pw;
  const mapY = (v: number) => margin.top + ph - ((v - yMin + yPad) / (yMax - yMin + 2 * yPad)) * ph;
  // Zero lines
  ctx.strokeStyle = cfg.darkMode ? '#444' : '#ccc'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(mapX(0), margin.top); ctx.lineTo(mapX(0), margin.top + ph); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(margin.left, mapY(0)); ctx.lineTo(margin.left + pw, mapY(0)); ctx.stroke();
  // Points
  for (let i = 0; i < scores.length; i++) {
    const color = groups ? COLORS[groups[i] % COLORS.length] : '#2C3E50';
    ctx.fillStyle = color; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(mapX(scores[i][0]), mapY(scores[i][1]), 5, 0, 2 * Math.PI); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Loading arrows
  const maxScore = Math.max(Math.abs(xMax - xMin), Math.abs(yMax - yMin));
  const maxLoading = Math.max(...loadings.map(l => Math.sqrt(l[0] ** 2 + l[1] ** 2)), 1e-10);
  const arrowScale = (maxScore * 0.7) / maxLoading;
  for (let i = 0; i < loadings.length; i++) {
    const dx = loadings[i][0] * arrowScale, dy = loadings[i][1] * arrowScale;
    const cx = mapX(0), cy = mapY(0);
    ctx.strokeStyle = '#E74C3C'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + dx, cy - dy); ctx.stroke();
    const angle = Math.atan2(-dy, dx);
    ctx.fillStyle = '#E74C3C'; ctx.beginPath();
    ctx.moveTo(cx + dx, cy - dy);
    ctx.lineTo(cx + dx - 8 * Math.cos(angle - 0.4), cy - dy + 8 * Math.sin(angle - 0.4));
    ctx.lineTo(cx + dx - 8 * Math.cos(angle + 0.4), cy - dy + 8 * Math.sin(angle + 0.4));
    ctx.closePath(); ctx.fill();
    if (loadingLabels[i]) { ctx.fillStyle = '#E74C3C'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(loadingLabels[i], cx + dx * 1.15, cy - dy * 1.15); }
  }
  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 25); }
}

/**
 * Draw a SIMPER contribution bar chart.
 */
export function drawSIMPERBar(
  ctx: CanvasRenderingContext2D,
  contributions: { name: string; average: number; cumulative: number }[],
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 30, bottom: 80, left: 70 };
  const pw = w - margin.left - margin.right, ph = h - margin.top - margin.bottom;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF'; ctx.fillRect(0, 0, w, h);
  const n = Math.min(contributions.length, 15);
  const barW = pw / n * 0.7, gap = pw / n * 0.3;
  const maxVal = Math.max(...contributions.slice(0, n).map(c => c.average), 1);
  for (let i = 0; i < n; i++) {
    const x = margin.left + (i * (barW + gap)) + gap / 2;
    const barH = (contributions[i].average / maxVal) * ph;
    ctx.fillStyle = COLORS[i % COLORS.length]; ctx.globalAlpha = 0.8;
    ctx.fillRect(x, margin.top + ph - barH, barW, barH); ctx.globalAlpha = 1;
    const cumY = margin.top + ph - (contributions[i].cumulative * ph);
    ctx.fillStyle = '#E74C3C'; ctx.beginPath(); ctx.arc(x + barW / 2, cumY, 3, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50'; ctx.font = '9px sans-serif';
    ctx.save(); ctx.translate(x + barW / 2, h - margin.bottom + 5); ctx.rotate(-Math.PI / 4);
    ctx.textAlign = 'right'; ctx.fillText(contributions[i].name, 0, 0); ctx.restore();
  }
  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 25); }
}

/**
 * Draw an abundance rank plot (log-log).
 */
export function drawAbundanceRank(
  ctx: CanvasRenderingContext2D,
  abundances: number[],
  config: Partial<PlotConfig> = {},
): void {
  const sorted = [...abundances].filter(v => v > 0).sort((a, b) => b - a);
  const ranks = sorted.map((_, i) => Math.log10(i + 1));
  const logAbund = sorted.map(v => Math.log10(v));
  drawLine(ctx, ranks, logAbund, { ...config, title: config.title || 'Abundance-Rank', xlabel: 'log10(Rank)', ylabel: 'log10(Abundance)' }, '#3498DB');
}

/**
 * Draw a survivorship curve with optional CI.
 */
export function drawSurvivorshipCurve(
  ctx: CanvasRenderingContext2D,
  times: number[],
  survivalRates: number[],
  ciLower?: number[],
  ciUpper?: number[],
  config: Partial<PlotConfig> = {},
): void {
  drawLine(ctx, times, survivalRates, { ...config, title: config.title || 'Survivorship', xlabel: 'Time', ylabel: 'Survival Rate' }, '#3498DB');
  if (ciLower && ciUpper) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const { width: w, height: h } = cfg;
    const margin = { top: 50, right: 30, bottom: 60, left: 70 };
    const pw = w - margin.left - margin.right, ph = h - margin.top - margin.bottom;
    const xMin = Math.min(...times), xMax = Math.max(...times);
    const xPad = (xMax - xMin) * 0.05 || 1;
    const mapX = (v: number) => margin.left + ((v - xMin + xPad) / (xMax - xMin + 2 * xPad)) * pw;
    const mapY = (v: number) => margin.top + ph - v * ph;
    ctx.fillStyle = '#3498DB20'; ctx.beginPath();
    for (let i = 0; i < times.length; i++) { if (i === 0) ctx.moveTo(mapX(times[i]), mapY(ciUpper[i])); else ctx.lineTo(mapX(times[i]), mapY(ciUpper[i])); }
    for (let i = times.length - 1; i >= 0; i--) ctx.lineTo(mapX(times[i]), mapY(ciLower[i]));
    ctx.closePath(); ctx.fill();
  }
}

/**
 * Draw an extinction CI range chart.
 */
export function drawExtinctionCI(
  ctx: CanvasRenderingContext2D,
  taxonNames: string[],
  ladPositions: number[],
  ciLower: number[],
  ciUpper: number[],
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 30, bottom: 60, left: 100 };
  const pw = w - margin.left - margin.right, ph = h - margin.top - margin.bottom;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF'; ctx.fillRect(0, 0, w, h);
  const n = taxonNames.length;
  const allVals = [...ladPositions, ...ciLower, ...ciUpper];
  const minV = Math.min(...allVals), maxV = Math.max(...allVals);
  const pad = (maxV - minV) * 0.1 || 1;
  const mapX = (v: number) => margin.left + ((v - minV + pad) / (maxV - minV + 2 * pad)) * pw;
  for (let i = 0; i < n; i++) {
    const y = margin.top + (i + 0.5) / n * ph;
    ctx.strokeStyle = '#3498DB'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(mapX(ciLower[i]), y); ctx.lineTo(mapX(ciUpper[i]), y); ctx.stroke();
    ctx.fillStyle = '#E74C3C'; ctx.beginPath(); ctx.arc(mapX(ladPositions[i]), y, 5, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(taxonNames[i], margin.left - 5, y + 3);
  }
  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 25); }
}

/**
 * Draw a spectral periodogram with peak marker.
 */
export function drawPeriodogram(
  ctx: CanvasRenderingContext2D,
  periods: number[],
  power: number[],
  peakPeriod: number,
  config: Partial<PlotConfig> = {},
): void {
  drawLine(ctx, periods, power, { ...config, title: config.title || 'Power Spectrum', xlabel: 'Period', ylabel: 'Power' }, '#2C3E50');
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 30, bottom: 60, left: 70 };
  const pw = w - margin.left - margin.right;
  const xMin = Math.min(...periods), xMax = Math.max(...periods);
  const xPad = (xMax - xMin) * 0.05 || 1;
  const peakX = margin.left + ((peakPeriod - xMin + xPad) / (xMax - xMin + 2 * xPad)) * pw;
  ctx.strokeStyle = '#E74C3C'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(peakX, margin.top); ctx.lineTo(peakX, margin.top + (h - margin.top - margin.bottom)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#E74C3C'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`Peak: ${peakPeriod.toFixed(2)}`, peakX, margin.top + 15);
}

/**
 * Draw a wavelet scalogram (time-scale heatmap).
 */
export function drawScalogram(
  ctx: CanvasRenderingContext2D,
  power: number[][],
  scales: number[],
  timePoints: number[],
  config: Partial<PlotConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { width: w, height: h } = cfg;
  const margin = { top: 50, right: 60, bottom: 60, left: 70 };
  const pw = w - margin.left - margin.right, ph = h - margin.top - margin.bottom;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cfg.darkMode ? '#1a1a2e' : '#FFFFFF'; ctx.fillRect(0, 0, w, h);
  const nScales = scales.length, nTimes = timePoints.length;
  const cellW = pw / nTimes, cellH = ph / nScales;
  let maxP = 0;
  for (const row of power) for (const v of row) maxP = Math.max(maxP, v);
  if (maxP === 0) maxP = 1;
  for (let i = 0; i < nScales; i++) for (let j = 0; j < nTimes; j++) {
    const norm = (power[i]?.[j] ?? 0) / maxP;
    const r = Math.floor(norm * 255), b = Math.floor((1 - norm) * 255);
    ctx.fillStyle = `rgb(${r}, ${Math.floor(100 * (1 - Math.abs(norm - 0.5) * 2))}, ${b})`;
    ctx.fillRect(margin.left + j * cellW, margin.top + i * cellH, cellW + 1, cellH + 1);
  }
  ctx.fillStyle = cfg.darkMode ? '#ccc' : '#2C3E50'; ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i < nScales; i += Math.max(1, Math.floor(nScales / 5))) {
    ctx.fillText(scales[i].toFixed(0), margin.left - 5, margin.top + i * cellH + cellH / 2 + 3);
  }
  if (cfg.title) { ctx.fillStyle = cfg.darkMode ? '#fff' : '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cfg.title, w / 2, 25); }
}
