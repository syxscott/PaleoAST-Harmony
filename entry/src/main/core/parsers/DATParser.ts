/**
 * DAT file parser ¡ª replaces parsers/dat_parser.py
 * Handles various delimiters and formats.
 */

export interface DATData {
  data: number[][];
  rowLabels: string[];
  colLabels: string[];
  nRows: number;
  nCols: number;
}

export function parseDAT(text: string, delimiter = ',', hasHeader = true, hasRowLabels = true): DATData {
  const lines = text.trim().split(/?
/).filter(l => l.trim());
  if (lines.length === 0) return { data: [], rowLabels: [], colLabels: [], nRows: 0, nCols: 0 };

  let startRow = 0;
  let colLabels: string[] = [];

  if (hasHeader) {
    const headerFields = lines[0].split(delimiter).map(s => s.trim());
    colLabels = hasRowLabels ? headerFields.slice(1) : headerFields;
    startRow = 1;
  }

  const rowLabels: string[] = [];
  const data: number[][] = [];

  for (let i = startRow; i < lines.length; i++) {
    const fields = lines[i].split(delimiter).map(s => s.trim());
    if (hasRowLabels) {
      rowLabels.push(fields[0]);
      const row = fields.slice(1).map(f => {
        if (['NA', 'NaN', '-', '', 'nan', 'null'].includes(f)) return NaN;
        const v = parseFloat(f);
        return isNaN(v) ? NaN : v;
      });
      data.push(row);
    } else {
      rowLabels.push('Sample_' + (i - startRow + 1));
      const row = fields.map(f => {
        if (['NA', 'NaN', '-', '', 'nan', 'null'].includes(f)) return NaN;
        const v = parseFloat(f);
        return isNaN(v) ? NaN : v;
      });
      data.push(row);
    }
  }

  const nCols = Math.max(...data.map(r => r.length));
  for (const row of data) while (row.length < nCols) row.push(NaN);
  if (!hasHeader) colLabels = Array.from({ length: nCols }, (_, i) => 'Var_' + (i + 1));

  return { data, rowLabels, colLabels, nRows: data.length, nCols };
}
