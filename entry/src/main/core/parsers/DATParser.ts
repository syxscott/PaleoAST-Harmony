/**
 * DAT file parser — replaces parsers/dat_parser.py
 * Handles various delimiters and formats.
 */

export interface DATData {
  data: number[][];
  rowLabels: string[];
  colLabels: string[];
  nRows: number;
  nCols: number;
}

/** A field that is a plain number (so a row of them cannot be a header). */
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Delimiter with the most occurrences in the first line. */
function sniffDatDelimiter(line: string): string {
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const count = (line.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Does the first line look like DATA rather than a header?
 * True when every non-empty data field is a number.
 */
function firstRowIsData(line: string, delimiter: string, hasRowLabels: boolean): boolean {
  const fields = line.split(delimiter).map(s => s.trim());
  const data = hasRowLabels ? fields.slice(1) : fields;
  const values = data.filter(f => f !== '');
  if (values.length === 0) return false;
  return values.every(f => NUMBER_PATTERN.test(f));
}

/**
 * Parse a .dat file.
 *
 * `delimiter` is sniffed when it is not given — a tab-separated .dat used to
 * be split on commas and produced a single column per row, i.e. an empty
 * matrix. `hasHeader` is decided from the first row when it is not given: if
 * that row is all numbers it is DATA, and the old default (true) silently ate
 * the first row of a headerless file.
 */
export function parseDAT(text: string, delimiter?: string, hasHeader?: boolean, hasRowLabels = true): DATData {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { data: [], rowLabels: [], colLabels: [], nRows: 0, nCols: 0 };

  const delim = delimiter ?? sniffDatDelimiter(lines[0]);
  const useHeader = hasHeader ?? !firstRowIsData(lines[0], delim, hasRowLabels);

  let startRow = 0;
  let colLabels: string[] = [];

  if (useHeader) {
    const headerFields = lines[0].split(delim).map(s => s.trim());
    colLabels = hasRowLabels ? headerFields.slice(1) : headerFields;
    startRow = 1;
  }

  const rowLabels: string[] = [];
  const data: number[][] = [];

  for (let i = startRow; i < lines.length; i++) {
    const fields = lines[i].split(delim).map(s => s.trim());
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
  if (!useHeader) colLabels = Array.from({ length: nCols }, (_, i) => 'Var_' + (i + 1));

  return { data, rowLabels, colLabels, nRows: data.length, nCols };
}

/** DAT parse failure with context (dat_parser.py DATParseError). */
export class DATParseError extends Error {
  constructor(message: string, public line: number = 0) {
    super(line > 0 ? `${message} (line ${line})` : message);
    this.name = 'DATParseError';
  }
}

/** File-level convenience (dat_parser.py parse_dat_file): real fs read. */
export async function parseDatFile(path: string): Promise<{ data: number[][]; rowLabels: string[]; colLabels: string[] }> {
  const { FileManager } = await import('../io/FileManager');
  const text = await FileManager.readText(path);
  return parseDAT(text);
}
