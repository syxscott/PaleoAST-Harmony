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
  /**
   * Non-fatal inconsistencies found while reading (a taxon without a matrix
   * row, a matrix row without a taxon, a declared NCHAR that disagrees with
   * the data). A parse problem must never look like "the file simply had
   * fewer rows".
   */
  warnings?: string[];
}

/**
 * Split one matrix line into its taxon name and its sequence.
 * The name may be quoted (`'Homo sapiens' ACGT`).
 */
function splitMatrixLine(line: string): { name: string; seq: string } {
  let i = 0;
  let name = '';
  const first = line[0];
  if (first === "'" || first === '"') {
    i = 1;
    while (i < line.length && line[i] !== first) { name += line[i]; i++; }
    if (i < line.length) i++; // closing quote
    name = name.trim();
  } else {
    while (i < line.length && !/\s/.test(line[i])) { name += line[i]; i++; }
  }
  const rest = line.slice(i).trim().replace(/\s+/g, '');
  return { name, seq: rest.replace(/;+$/, '') };
}

export function parseNexus(text: string): NexusData {
  const lines = text.split(/\r?\n/);
  /** Taxon names in TAXLABELS order. */
  const declaredTaxa: string[] = [];
  /** Matrix rows in file order; an interleaved matrix repeats a taxon. */
  const matrixRows: { name: string; seq: string }[] = [];
  let dataType = 'standard';
  let missingChar = '?';
  let gapChar = '-';
  let declaredNChar = 0;
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
    if (lower === 'end;' || lower === 'end') { inBlock = ''; inMatrix = false; continue; }

    if (inBlock === 'taxa' || inBlock === 'taxa_block') {
      if (lower.startsWith('taxlabels')) {
        const rest = t.substring(9).replace(';', '').trim();
        // De-duplicate: a repeated label would make the taxon list longer than
        // the matrix rows and shift every downstream leaf/label mapping.
        for (const n of rest.split(/\s+/)) if (n && !declaredTaxa.includes(n)) declaredTaxa.push(n);
      }
    }

    if (inBlock === 'characters' || inBlock === 'data') {
      if (lower.startsWith('dimensions')) {
        const m = lower.match(/nchar\s*=\s*(\d+)/);
        if (m) declaredNChar = parseInt(m[1], 10);
      }
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
        if (parts.length === 1) {
          // A line with a single token continues the previous taxon: an
          // interleaved or line-wrapped matrix. The old parser dropped such a
          // line, so half of every long sequence disappeared without a word.
          const previous = matrixRows[matrixRows.length - 1];
          if (previous) previous.seq += parts[0];
        } else {
          matrixRows.push(splitMatrixLine(t));
        }
      }
    }
  }

  // Matrix rows keyed by name. An interleaved matrix contributes several rows
  // for the same taxon; they are concatenated in file order.
  const byName = new Map<string, string>();
  for (const row of matrixRows) {
    byName.set(row.name, (byName.get(row.name) ?? '') + row.seq);
  }

  const warnings: string[] = [];

  // The taxon list: TAXLABELS order first, then any matrix row the label
  // list does not mention (so its data is not thrown away).
  const taxa: string[] = [...declaredTaxa];
  for (const name of byName.keys()) {
    if (!taxa.includes(name)) {
      taxa.push(name);
      warnings.push(`Matrix row "${name}" has no TAXLABELS entry; it was appended to the taxon list.`);
    }
  }
  for (const name of declaredTaxa) {
    if (!byName.has(name)) {
      warnings.push(`Taxon "${name}" has no matrix row; its characters are missing (NaN).`);
    }
  }
  if (declaredTaxa.length > 0 && byName.size !== declaredTaxa.length) {
    warnings.push(`Taxa list has ${declaredTaxa.length} entries but the matrix has ${byName.size} rows.`);
  }

  // Character states per taxon, ALIGNED BY NAME. The old parser appended the
  // taxa list and the matrix rows independently, so a filtered file (matrix
  // order != TAXLABELS order) put the sequence of one taxon under the name of
  // another one.
  let maxLen = 0;
  for (const seq of byName.values()) maxLen = Math.max(maxLen, seq.length);
  const nChar = Math.max(declaredNChar, maxLen);
  if (declaredNChar > 0 && maxLen !== declaredNChar) {
    warnings.push(`Declared NCHAR ${declaredNChar} does not match the matrix (${maxLen} characters).`);
  }

  const characters: number[][] = taxa.map(name => {
    const seq = byName.get(name);
    const row: number[] = [];
    for (let i = 0; i < nChar; i++) {
      const ch = seq === undefined ? undefined : seq[i];
      if (ch === undefined) {
        // No row for this taxon, or a row shorter than the matrix.
        row.push(NaN);
      } else if (ch === missingChar || ch === gapChar || ch === '?' || ch === '-') {
        row.push(0);
      } else {
        const v = parseInt(ch, 36);
        row.push(isNaN(v) ? 0 : v);
      }
    }
    return row;
  });

  return {
    taxa,
    characters,
    nTax: taxa.length,
    nChar,
    dataType,
    missingChar,
    gapChar,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}
