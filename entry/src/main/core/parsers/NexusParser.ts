/**
 * Nexus file parser ¡ª replaces parsers/nexus_lexer.py
 * Handles BEGIN TAXA, BEGIN CHARACTERS, BEGIN DATA blocks.
 */

export interface NexusData {
  taxa: string[];
  characters: number[][];
  nTax: number;
  nChar: number;
  dataType: string;
  missingChar: string;
  gapChar: string;
}

export function parseNexus(text: string): NexusData {
  const lines = text.split(/?
/);
  const taxa: string[] = [];
  const charRows: string[][] = [];
  let dataType = 'standard';
  let missingChar = '?';
  let gapChar = '-';
  let inMatrix = false;
  let inBlock = '';

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const lower = t.toLowerCase();

    if (lower.startsWith('begin ')) {
      inBlock = t.substring(6).trim().toLowerCase().replace(';', '');
      inMatrix = false;
      continue;
    }
    if (lower === 'end;') { inBlock = ''; inMatrix = false; continue; }

    if (inBlock === 'taxa' || inBlock === 'taxa_block') {
      if (lower.startsWith('dimensions') && lower.includes('ntax=')) {
        const m = lower.match(/ntax=(\d+)/);
        if (m) { /* nTax parsed */ }
      }
      if (lower.startsWith('taxlabels')) {
        const rest = t.substring(9).replace(';', '').trim();
        const names = rest.split(/\s+/);
        for (const n of names) if (n) taxa.push(n);
      }
    }

    if (inBlock === 'characters' || inBlock === 'data') {
      if (lower.startsWith('format')) {
        if (lower.includes('datatype=dna') || lower.includes('datatype=dna')) dataType = 'dna';
        else if (lower.includes('datatype=protein')) dataType = 'protein';
        else if (lower.includes('datatype=standard')) dataType = 'standard';
        const mm = lower.match(/missing=(.)/); if (mm) missingChar = mm[1];
        const gg = lower.match(/gap=(.)/); if (gg) gapChar = gg[1];
      }
      if (lower === 'matrix') { inMatrix = true; continue; }
      if (inMatrix && t !== ';' && !lower.startsWith('end')) {
        const parts = t.split(/\s+/);
        if (parts.length >= 2) {
          const name = parts[0];
          const seq = parts.slice(1).join('').split('');
          if (!taxa.includes(name)) taxa.push(name);
          charRows.push(seq);
        }
      }
    }
  }

  const nChar = charRows[0]?.length ?? 0;
  const characters = charRows.map(row => row.map(ch => {
    if (ch === missingChar || ch === gapChar || ch === '?' || ch === '-') return 0;
    const v = parseInt(ch, 36);
    return isNaN(v) ? 0 : v;
  }));

  return { taxa, characters, nTax: taxa.length, nChar, dataType, missingChar, gapChar };
}
