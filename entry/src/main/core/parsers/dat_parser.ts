export interface DATData {
  labels: string[];
  values: number[][];
  nRows: number;
  nCols: number;
}
export function parseDAT(text: string, delimiter: string = ','): DATData {
  const lines = text.trim().split(/?
/).filter(l => l.trim());
  if (lines.length === 0) return { labels: [], values: [], nRows: 0, nCols: 0 };
  const labels: string[] = [];
  const values: number[][] = [];
  for (const line of lines) {
    const parts = line.split(delimiter).map(s => s.trim());
    const numParts = parts.filter(p => !isNaN(Number(p)));
    if (numParts.length > 0) {
      labels.push(parts[0]);
      values.push(numParts.map(Number));
    }
  }
  return { labels, values, nRows: values.length, nCols: values[0]?.length ?? 0 };
}
