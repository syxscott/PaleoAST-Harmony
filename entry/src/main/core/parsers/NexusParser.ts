/**
 * Nexus file parser — replaces parsers/nexus_lexer.py
 * Handles BEGIN TAXA, BEGIN CHARACTERS, BEGIN DATA blocks.
 */

/**
 * Nexus tokeniser — low-level access for advanced callers.
 * Mirrors parsers/nexus_lexer.py::NexusLexer / NexusTokenType.
 */
export enum NexusTokenType {
  BEGIN = 'BEGIN', END = 'END', BLOCK = 'BLOCK',
  TAXA = 'TAXA', CHARACTERS = 'CHARACTERS', DATA = 'DATA',
  DIMENSIONS = 'DIMENSIONS', NTAX = 'NTAX', NCHAR = 'NCHAR',
  FORMAT = 'FORMAT', DATATYPE = 'DATATYPE', MISSING = 'MISSING',
  GAP = 'GAP', MATRIX = 'MATRIX',
  SEMICOLON = ';', EQUALS = '=', COMMA = ',',
  NUMBER = 'NUMBER', STRING = 'STRING', COMMENT = 'COMMENT',
  EOF = 'EOF', UNKNOWN = 'UNKNOWN'
}

export interface NexusToken {
  type: NexusTokenType;
  value: string;
  line: number;
  column: number;
}

export function tokenizeNexus(text: string): NexusToken[] {
  const out: NexusToken[] = [];
  let pos = 0, line = 1, col = 1;
  const push = (type: NexusTokenType, value: string) =>
    out.push({ type, value, line, column: col });
  while (pos < text.length) {
    const ch = text[pos];
    if (/\s/.test(ch)) { if (ch === '\n') { line++; col = 1; } else col++; pos++; continue; }
    if (ch === '[') {
      const start = pos; pos++;
      while (pos < text.length && text[pos] !== ']') pos++;
      // Fix: throw error for unclosed comment
      if (pos >= text.length) throw new Error('Unclosed comment block starting at position ' + start);
      pos++; // skip ]
      push(NexusTokenType.COMMENT, text.slice(start, pos));
      col++; continue;
    }
    if (ch === ';') { push(NexusTokenType.SEMICOLON, ';'); pos++; col++; continue; }
    if (ch === '=') { push(NexusTokenType.EQUALS, '='); pos++; col++; continue; }
    if (ch === ',') { push(NexusTokenType.COMMA, ','); pos++; col++; continue; }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(text[pos + 1] ?? ''))) {
      const start = pos;
      while (pos < text.length && /[0-9.\-eE+]/.test(text[pos])) pos++;
      push(NexusTokenType.NUMBER, text.slice(start, pos));
      col += pos - start; continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch; pos++;
      const start = pos;
      while (pos < text.length && text[pos] !== quote) pos++;
      // Fix: throw error for unclosed string
      if (pos >= text.length) throw new Error('Unclosed string literal starting at position ' + (start - 1));
      const value = text.slice(start, pos);
      pos++; // skip closing quote
      push(NexusTokenType.STRING, value);
      col += pos - start + 2; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = pos;
      while (pos < text.length && /[A-Za-z0-9_]/.test(text[pos])) pos++;
      const value = text.slice(start, pos);
      const upper = value.toUpperCase();
      const reserved: Record<string, NexusTokenType> = {
        BEGIN: NexusTokenType.BEGIN, END: NexusTokenType.END,
        TAXA: NexusTokenType.TAXA, CHARACTERS: NexusTokenType.CHARACTERS,
        DATA: NexusTokenType.DATA, BLOCK: NexusTokenType.BLOCK,
        DIMENSIONS: NexusTokenType.DIMENSIONS, NTAX: NexusTokenType.NTAX,
        NCHAR: NexusTokenType.NCHAR, FORMAT: NexusTokenType.FORMAT,
        DATATYPE: NexusTokenType.DATATYPE, MISSING: NexusTokenType.MISSING,
        GAP: NexusTokenType.GAP, MATRIX: NexusTokenType.MATRIX
      };
      push(reserved[upper] ?? NexusTokenType.STRING, value);
      col += pos - start; continue;
    }
    push(NexusTokenType.UNKNOWN, ch); pos++; col++;
  }
  push(NexusTokenType.EOF, '');
  return out;
}

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
  // Fixed: proper regex for line splitting
  const lines = text.split(/\r?\n/);
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
        // Fixed: removed duplicate condition
        if (lower.includes('datatype=dna')) dataType = 'dna';
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
