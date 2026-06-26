import { Matrix } from '../math/Matrix';
import { DataMatrix } from '../data/index';

export function parseCSV(text: string, delimiter = ',', hasHeader = true, hasRowLabels = true, naValues: string[] = ['NA','NaN','-','','nan','null']): DataMatrix {
  const lines = text.trim().split(/?
/).filter(l => l.trim());
  if (lines.length === 0) throw new Error('Empty CSV');
  const splitRow = (line: string): string[] => {
    const fields: string[] = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === delimiter && !inQ) { fields.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    fields.push(cur.trim()); return fields;
  };
  let startRow = 0; let colLabels: string[] = [];
  if (hasHeader) { const hf = splitRow(lines[0]); colLabels = hasRowLabels ? hf.slice(1) : hf; startRow = 1; }
  const rowLabels: string[] = []; const dataRows: number[][] = [];
  for (let i = startRow; i < lines.length; i++) {
    const fields = splitRow(lines[i]);
    let label = 'Sample_' + (i - startRow + 1); let dataFields: string[];
    if (hasRowLabels && fields.length > 0) { label = fields[0]; dataFields = fields.slice(1); }
    else dataFields = fields;
    const numericRow: number[] = [];
    for (const f of dataFields) {
      const trimmed = f.trim();
      if (naValues.includes(trimmed)) numericRow.push(NaN);
      else { const val = parseFloat(trimmed); numericRow.push(isNaN(val) ? NaN : val); }
    }
    rowLabels.push(label); dataRows.push(numericRow);
  }
  const maxCols = Math.max(...dataRows.map(r => r.length));
  for (const row of dataRows) while (row.length < maxCols) row.push(NaN);
  const nRows = dataRows.length;
  const d = new Float64Array(nRows * maxCols);
  for (let i = 0; i < nRows; i++) for (let j = 0; j < maxCols; j++) d[i * maxCols + j] = dataRows[i][j];
  return new DataMatrix(new Matrix(d, nRows, maxCols), rowLabels, colLabels);
}

export function toCSV(dm: DataMatrix, delimiter = ','): string {
  const lines: string[] = [];
  lines.push(['', ...dm.colLabels].join(delimiter));
  for (let i = 0; i < dm.nSamples; i++) {
    const vals = dm.data.row(i).map(v => isNaN(v) ? 'NA' : v.toString());
    lines.push([dm.rowLabels[i], ...vals].join(delimiter));
  }
  return lines.join('
');
}
