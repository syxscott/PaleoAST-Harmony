const COLORS = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6', '#1ABC9C'];

export function drawConfusionMatrix(
  ctx: CanvasRenderingContext2D,
  matrix: number[][],
  labels: string[],
  title: string = 'Confusion Matrix',
): void {
  const w = 600, h = 500;
  const margin = { top: 50, right: 30, bottom: 60, left: 80 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);

  const n = labels.length;
  const cellW = pw / n, cellH = ph / n;
  const maxVal = Math.max(...matrix.flat(), 1);

  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const norm = matrix[i][j] / maxVal;
    const isDiag = i === j;
    const alpha = Math.floor(norm * 200);
    ctx.fillStyle = isDiag ? 'rgba(39,174,96,' + norm + ')' : 'rgba(231,76,60,' + norm * 0.5 + ')';
    ctx.fillRect(margin.left + j * cellW, margin.top + i * cellH, cellW - 1, cellH - 1);
    ctx.fillStyle = norm > 0.5 ? '#fff' : '#2C3E50';
    ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(matrix[i][j]), margin.left + j * cellW + cellW / 2, margin.top + i * cellH + cellH / 2 + 4);
  }

  ctx.fillStyle = '#2C3E50'; ctx.font = '10px sans-serif';
  for (let i = 0; i < n; i++) {
    ctx.textAlign = 'right'; ctx.fillText(labels[i], margin.left - 5, margin.top + i * cellH + cellH / 2 + 3);
    ctx.textAlign = 'center'; ctx.fillText(labels[i], margin.left + i * cellW + cellW / 2, margin.top + ph + 15);
  }
  ctx.textAlign = 'center'; ctx.fillText('Predicted', margin.left + pw / 2, margin.top + ph + 40);
  ctx.save(); ctx.translate(15, margin.top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('Actual', 0, 0); ctx.restore();
  ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(title, w / 2, 25);
}

export function drawStratColumn(
  ctx: CanvasRenderingContext2D,
  depths: number[],
  lithologies: string[],
  title: string = 'Stratigraphic Column',
): void {
  const w = 600, h = 800;
  const margin = { top: 40, right: 30, bottom: 30, left: 80 };
  const pw = w - margin.left - margin.right, ph = h - margin.top - margin.bottom;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);

  const lithColors: Record<string, string> = {
    sandstone: '#F5DEB3', shale: '#A9A9A9', limestone: '#87CEEB',
    mudstone: '#D2B48C', siltstone: '#C0C0C0', coal: '#2C2C2C',
    claystone: '#D2691E', dolomite: '#ADD8E6', default: '#E4E7EB',
  };

  const n = depths.length;
  for (let i = 0; i < n; i++) {
    const y = margin.top + (i / n) * ph;
    const height = ph / n;
    const lith = lithologies[i]?.toLowerCase() ?? 'default';
    ctx.fillStyle = lithColors[lith] ?? lithColors['default'];
    ctx.fillRect(margin.left, y, pw, height - 1);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 0.5;
    ctx.strokeRect(margin.left, y, pw, height - 1);
    ctx.fillStyle = '#2C3E50'; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(depths[i].toFixed(1), margin.left - 5, y + height / 2 + 3);
    ctx.textAlign = 'center';
    ctx.fillText(lithologies[i] ?? '', margin.left + pw / 2, y + height / 2 + 3);
  }

  ctx.fillStyle = '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(title, w / 2, 20);
}

export function drawCCATriplot(
  ctx: CanvasRenderingContext2D,
  siteScores: number[][],
  speciesScores: number[][],
  envScores: number[][],
  envLabels: string[],
  groups?: number[],
  title: string = 'CCA Triplot',
): void {
  const w = 800, h = 600;
  const margin = { top: 50, right: 30, bottom: 60, left: 70 };
  const pw = w - margin.left - margin.right, ph = h - margin.top - margin.bottom;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);

  const allX = [...siteScores.map(s => s[0]), ...speciesScores.map(s => s[0])];
  const allY = [...siteScores.map(s => s[1]), ...speciesScores.map(s => s[1])];
  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const xPad = (xMax - xMin) * 0.15 || 1, yPad = (yMax - yMin) * 0.15 || 1;
  const mapX = (v: number) => margin.left + ((v - xMin + xPad) / (xMax - xMin + 2 * xPad)) * pw;
  const mapY = (v: number) => margin.top + ph - ((v - yMin + yPad) / (yMax - yMin + 2 * yPad)) * ph;

  // Site scores
  for (let i = 0; i < siteScores.length; i++) {
    const color = groups ? COLORS[groups[i] % COLORS.length] : '#3498DB';
    ctx.fillStyle = color; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(mapX(siteScores[i][0]), mapY(siteScores[i][1]), 5, 0, 2 * Math.PI); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Species scores
  ctx.fillStyle = '#E74C3C';
  for (let i = 0; i < speciesScores.length; i++) {
    const x = mapX(speciesScores[i][0]), y = mapY(speciesScores[i][1]);
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x - 4, y + 3); ctx.lineTo(x + 4, y + 3); ctx.closePath(); ctx.fill();
  }

  // Env arrows
  const maxScore = Math.max(Math.abs(xMax - xMin), Math.abs(yMax - yMin));
  const maxEnv = Math.max(...envScores.map(e => Math.sqrt(e[0]**2 + e[1]**2)), 1e-10);
  const arrowScale = (maxScore * 0.6) / maxEnv;
  for (let i = 0; i < envScores.length; i++) {
    const dx = envScores[i][0] * arrowScale, dy = envScores[i][1] * arrowScale;
    const cx = mapX(0), cy = mapY(0);
    ctx.strokeStyle = '#27AE60'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + dx, cy - dy); ctx.stroke();
    if (envLabels[i]) {
      ctx.fillStyle = '#27AE60'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(envLabels[i], cx + dx * 1.15, cy - dy * 1.15);
    }
  }

  ctx.fillStyle = '#2C3E50'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(title, w / 2, 25);
}
