import { Matrix } from '../math/Matrix';
import { DataMatrix } from '../models/index';

/**
 * Split one CSV record into fields (RFC 4180).
 *
 * A doubled quote inside a quoted field is a literal quote — `"He said ""hi"""`
 * is one field reading `He said "hi"`. Treating every `"` as a plain toggle
 * (the previous behaviour) swallowed one quote per escape and could shift the
 * remaining fields out of alignment. `ExcelParser` already parsed this
 * correctly, so both now share this single implementation.
 */
export function splitCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function parseCSV(text: string, delimiter = ',', hasHeader = true, hasRowLabels = true, naValues: string[] = ['NA','NaN','-','','nan','null']): DataMatrix {
  // Fixed: use proper regex /\r?\n/ to match optional CR + LF
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) throw new Error('Empty CSV');
  const splitRow = (line: string): string[] => splitCSVLine(line, delimiter);
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

/**
 * Quote a field when it would otherwise break the record — i.e. when it
 * contains the delimiter, a quote, or a line break (RFC 4180 §2.6/2.7).
 * Without this, a row label such as `Site A, north` silently split into two
 * fields on the next import.
 */
function quoteField(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || /[\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function toCSV(dm: DataMatrix, delimiter = ','): string {
  const lines: string[] = [];
  lines.push(['', ...dm.colLabels].map(v => quoteField(v, delimiter)).join(delimiter));
  for (let i = 0; i < dm.nSamples; i++) {
    const vals = dm.data.row(i).map(v => isNaN(v) ? 'NA' : v.toString());
    lines.push([dm.rowLabels[i], ...vals].map(v => quoteField(v, delimiter)).join(delimiter));
  }
  return lines.join('\n');
}
