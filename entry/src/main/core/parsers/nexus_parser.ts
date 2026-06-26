export interface NexusData {
  taxa: string[];
  characters: number[][];
  dataType: string;
  nTax: number;
  nChar: number;
}
export function parseNexus(text: string): NexusData {
  const taxa: string[] = [];
  const lines = text.split(/?
/);
  let inMatrix = false;
  const charRows: string[][] = [];
  for (const line of lines) {
    const t = line.trim().toLowerCase();
    if (t === 'matrix') { inMatrix = true; continue; }
    if (t === 'end;') { inMatrix = false; continue; }
    if (inMatrix && t) {
      const parts = t.split(/\s+/);
      if (parts.length >= 2) { taxa.push(parts[0]); charRows.push(parts.slice(1).join('').split('')); }
    }
  }
  const nChar = charRows[0]?.length ?? 0;
  const characters = charRows.map(row => row.map(ch => { const v = parseInt(ch); return isNaN(v) ? 0 : v; }));
  return { taxa, characters, dataType: 'standard', nTax: taxa.length, nChar };
}
