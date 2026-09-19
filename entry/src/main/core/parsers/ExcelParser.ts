/**
 * Professional Excel (.xlsx/.xls) parser for HarmonyOS.
 * Replaces pandas.read_excel functionality.
 *
 * XLSX (Office Open XML) is a ZIP archive containing:
 * - [Content_Types].xml - Lists all parts
 * - xl/workbook.xml - Workbook structure and sheet names
 * - xl/worksheets/sheet{N}.xml - Cell data
 * - xl/sharedStrings.xml - Shared string table
 * - xl/styles.xml - Formatting styles
 *
 * This implementation provides production-grade parsing with:
 * - Complete DEFLATE decompression (RFC 1951)
 * - LZ77 back-references
 * - Dynamic Huffman decoding
 * - Proper error handling and recovery
 */
import { DataMatrix } from '../models/DataMatrix';
import { Matrix } from '../math/Matrix';
import { splitCSVLine } from './CSVParser';

export interface ExcelData {
  sheets: SheetData[];
  nSheets: number;
}

export interface SheetData {
  name: string;
  data: number[][];
  rowLabels: string[];
  colLabels: string[];
}

export interface ParseExcelOptions {
  sheetIndex?: number;
  hasHeader?: boolean;
  hasRowLabels?: boolean;
  naValues?: string[];
}

/**
 * Parse Excel file content (XLSX or legacy XLS).
 */
export function parseExcel(content: ArrayBuffer | Uint8Array | string, options: ParseExcelOptions = {}): ExcelData {
  const opts: Required<ParseExcelOptions> = {
    sheetIndex: 0,
    hasHeader: true,
    hasRowLabels: true,
    naValues: ['NA', 'NaN', '-', '', 'nan', 'null', 'N/A']
  };
  Object.assign(opts, options);

  // String input: treat as CSV/TSV
  if (typeof content === 'string') {
    return parseDelimited(content, opts);
  }

  // ArrayBuffer/Uint8Array: try XLSX first
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  try {
    return parseXLSX(bytes, opts);
  } catch (e) {
    // Fallback: try as CSV-like format
    const text = uint8ToString(bytes);
    if (looksLikeDelimited(text)) {
      return parseDelimited(text, opts);
    }
    throw new Error(`Failed to parse Excel file: ${e}`);
  }
}

/**
 * Parse XLSX (Office Open XML) format.
 */
function parseXLSX(buffer: ArrayBuffer | Uint8Array, opts: Required<ParseExcelOptions>): ExcelData {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;

  // Step 1: Parse ZIP structure
  const zipEntries = parseZipArchive(bytes);

  // Step 2: Find workbook to get sheet names
  const workbook = parseWorkbookXml(zipEntries);
  if (!workbook) {
    throw new Error('Invalid XLSX: workbook.xml not found');
  }

  // Step 3: Find sheet relationships to map names to files
  const sheetMap = resolveSheetMapping(zipEntries, workbook);

  // Step 4: Get target sheet
  const sheetNames = Object.keys(sheetMap);
  const targetIndex = Math.min(opts.sheetIndex, sheetNames.length - 1);
  const targetName = sheetNames[targetIndex];
  const sheetPath = sheetMap[targetName];

  // Step 5: Parse shared strings (for text cells)
  const sharedStrings = parseSharedStrings(zipEntries);

  // Step 6: Parse styles (for future use)
  const styles = parseStyles(zipEntries);

  // Step 7: Parse sheet XML
  const sheetXml = zipEntries[sheetPath];
  if (!sheetXml) {
    throw new Error(`Sheet file not found: ${sheetPath}`);
  }

  const sheetData = parseSheetXml(sheetXml, sharedStrings, opts);

  return {
    sheets: [{
      name: targetName,
      data: sheetData.data,
      rowLabels: sheetData.rowLabels,
      colLabels: sheetData.colLabels
    }],
    nSheets: sheetNames.length
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ZIP Archive Parsing
// ══════════════════════════════════════════════════════════════════════════════

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  dataOffset: number;
  localHeaderOffset: number;
  nameLen: number;
  extraLen: number;
  commentLen: number;
}

function parseZipArchive(bytes: Uint8Array): Record<string, string> {
  const entries: Record<string, string> = {};
  const centralDirectory: ZipEntry[] = [];

  let offset = 0;

  // Find and parse all local file headers
  while (offset < bytes.length - 4) {
    if (bytes[offset] !== 0x50 || bytes[offset + 1] !== 0x4B ||
        bytes[offset + 2] !== 0x03 || bytes[offset + 3] !== 0x04) {
      offset++;
      continue;
    }

    const entry = parseLocalFileHeader(bytes, offset);
    if (entry) {
      centralDirectory.push(entry);
      offset = entry.localHeaderOffset + 30 + entry.nameLen + entry.extraLen;
    } else {
      break;
    }
  }

  // Find and parse central directory (at end of ZIP)
  const cdOffset = findCentralDirectoryOffset(bytes);
  if (cdOffset >= 0) {
    let cdPos = cdOffset;
    while (cdPos < bytes.length - 4) {
      if (bytes[cdPos] !== 0x50 || bytes[cdPos + 1] !== 0x4B ||
          bytes[cdPos + 2] !== 0x01 || bytes[cdPos + 3] !== 0x02) {
        break;
      }

      const entry = parseCentralDirectoryEntry(bytes, cdPos);
      if (entry) {
        // Update with actual data from central directory
        const existing = centralDirectory.find(e => e.name === entry.name);
        if (existing) {
          existing.compressedSize = entry.compressedSize;
          existing.uncompressedSize = entry.uncompressedSize;
          existing.dataOffset = entry.dataOffset;
        }
        cdPos += 46 + entry.nameLen + entry.extraLen + entry.commentLen;
      } else {
        break;
      }
    }
  }

  // Extract and decompress all entries
  for (const entry of centralDirectory) {
    if (entry.name.endsWith('/')) continue; // Skip directories

    const data = extractEntryData(bytes, entry);
    if (data) {
      entries[entry.name] = uint8ToString(data);
    }
  }

  return entries;
}

function parseLocalFileHeader(bytes: Uint8Array, offset: number): ZipEntry | null {
  // Signature already verified at offset
  const versionNeeded = bytes[offset + 4] | (bytes[offset + 5] << 8);
  const flags = bytes[offset + 6] | (bytes[offset + 7] << 8);
  const compression = bytes[offset + 8] | (bytes[offset + 9] << 8);
  const compressedSize = bytes[offset + 18] | (bytes[offset + 19] << 8) |
                       (bytes[offset + 20] << 16) | (bytes[offset + 21] << 24);
  const uncompressedSize = bytes[offset + 22] | (bytes[offset + 23] << 8) |
                         (bytes[offset + 24] << 16) | (bytes[offset + 25] << 24);
  const nameLen = bytes[offset + 26] | (bytes[offset + 27] << 8);
  const extraLen = bytes[offset + 28] | (bytes[offset + 29] << 8);

  const name = Array.from(bytes.slice(offset + 30, offset + 30 + nameLen))
    .map(b => String.fromCharCode(b)).join('');

  const dataOffset = offset + 30 + nameLen + extraLen;

  return {
    name,
    compressedSize,
    uncompressedSize,
    compressionMethod: compression,
    dataOffset,
    localHeaderOffset: offset,
    nameLen,
    extraLen,
    commentLen: 0
  };
}

function parseCentralDirectoryEntry(bytes: Uint8Array, offset: number): ZipEntry | null {
  // Signature already verified
  const versionMade = bytes[offset + 4] | (bytes[offset + 5] << 8);
  const versionNeeded = bytes[offset + 6] | (bytes[offset + 7] << 8);
  const flags = bytes[offset + 8] | (bytes[offset + 9] << 8);
  const compression = bytes[offset + 10] | (bytes[offset + 11] << 8);
  const compressedSize = bytes[offset + 20] | (bytes[offset + 21] << 8) |
                       (bytes[offset + 22] << 16) | (bytes[offset + 23] << 24);
  const uncompressedSize = bytes[offset + 24] | (bytes[offset + 25] << 8) |
                         (bytes[offset + 26] << 16) | (bytes[offset + 27] << 24);
  const nameLen = bytes[offset + 28] | (bytes[offset + 29] << 8);
  const extraLen = bytes[offset + 30] | (bytes[offset + 31] << 8);
  const commentLen = bytes[offset + 32] | (bytes[offset + 33] << 8);
  const localHeaderOffset = bytes[offset + 42] | (bytes[offset + 43] << 8) |
                           (bytes[offset + 44] << 16) | (bytes[offset + 45] << 24);

  const name = Array.from(bytes.slice(offset + 46, offset + 46 + nameLen))
    .map(b => String.fromCharCode(b)).join('');

  return {
    name,
    compressedSize,
    uncompressedSize,
    compressionMethod: compression,
    dataOffset: localHeaderOffset + 30 + nameLen + extraLen,
    localHeaderOffset,
    nameLen,
    extraLen,
    commentLen
  };
}

function findCentralDirectoryOffset(bytes: Uint8Array): number {
  // End of central directory signature: EOCD
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B &&
        bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      return bytes[i + 16] | (bytes[i + 17] << 8) |
             (bytes[i + 18] << 16) | (bytes[i + 19] << 24);
    }
  }
  return -1;
}

function extractEntryData(bytes: Uint8Array, entry: ZipEntry): Uint8Array | null {
  const compressedData = bytes.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    // Stored - no compression
    return compressedData;
  } else if (entry.compressionMethod === 8) {
    // DEFLATE
    return inflateDeflate(compressedData);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// DEFLATE Decompression (RFC 1951)
// ══════════════════════════════════════════════════════════════════════════════

function inflateDeflate(compressed: Uint8Array): Uint8Array {
  const output: number[] = [];
  let pos = 0;
  let bitBuffer = 0;
  let bitCount = 0;

  // Shared LSB-first bit reader (RFC 1951 §3.1.1) — one stream position for
  // the whole inflate, shared by headers, Huffman decoding and extra bits.
  const readBit = (): number => {
    if (bitCount === 0) {
      if (pos >= compressed.length) throw new Error('DEFLATE: unexpected end of input');
      bitBuffer = compressed[pos++];
      bitCount = 8;
    }
    bitCount--;
    return (bitBuffer >> bitCount) & 1;
  };
  const readBits = (n: number): number => {
    let val = 0;
    for (let i = 0; i < n; i++) val |= readBit() << i;
    return val;
  };

  // Canonical Huffman decoding (zlib "puff" style): counts per code length +
  // symbols ordered by (length, symbol value).
  interface HuffTable { counts: number[]; symbols: number[] }
  const buildTable = (lengths: number[]): HuffTable => {
    const counts = new Array(16).fill(0);
    for (const len of lengths) if (len > 0) counts[len]++;
    const offsets = new Array(16).fill(0);
    let total = 0;
    for (let len = 1; len < 16; len++) { offsets[len] = total; total += counts[len]; }
    const symbols = new Array(total).fill(0);
    for (let sym = 0; sym < lengths.length; sym++) {
      if (lengths[sym] > 0) symbols[offsets[lengths[sym]]++] = sym;
    }
    return { counts, symbols };
  };
  const decodeSymbol = (table: HuffTable): number => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= readBit();
      const count = table.counts[len];
      if (code - first < count) return table.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('DEFLATE: invalid Huffman code');
  };

  // Fixed Huffman tables (RFC 1951 §3.2.6)
  const fixedLitLengths: number[] = [];
  for (let i = 0; i < 144; i++) fixedLitLengths.push(8);
  for (let i = 144; i < 256; i++) fixedLitLengths.push(9);
  for (let i = 256; i < 280; i++) fixedLitLengths.push(7);
  for (let i = 280; i < 288; i++) fixedLitLengths.push(8);
  const fixedLit = buildTable(fixedLitLengths);
  const fixedDist = buildTable(new Array(32).fill(5));

  const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448];
  const DIST_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11];
  // HCLEN order of the code-length alphabet (RFC 1951 §3.2.7)
  const HCLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  while (true) {
    const isFinal = readBit();
    const blockType = readBits(2);

    if (blockType === 0) {
      // Stored block: discard remaining bits, then LEN + NLEN are byte-aligned
      bitCount = 0;
      if (pos + 4 > compressed.length) throw new Error('DEFLATE: truncated stored block');
      const len = compressed[pos] | (compressed[pos + 1] << 8);
      pos += 4; // LEN + NLEN (NLEN is a complement check; skipped)
      for (let i = 0; i < len; i++) {
        if (pos >= compressed.length) throw new Error('DEFLATE: truncated stored data');
        output.push(compressed[pos++]);
      }
    } else if (blockType === 1 || blockType === 2) {
      let litTable: HuffTable, distTable: HuffTable;
      if (blockType === 1) {
        litTable = fixedLit;
        distTable = fixedDist;
      } else {
        // Dynamic Huffman: HLIT/HDIST/HCLEN headers, code-length alphabet in
        // HCLEN order, then run-length-coded literal/distance code lengths
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const clLengths = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) clLengths[HCLEN_ORDER[i]] = readBits(3);
        const clTable = buildTable(clLengths);

        const allLengths: number[] = [];
        while (allLengths.length < hlit + hdist) {
          const sym = decodeSymbol(clTable);
          if (sym < 16) {
            allLengths.push(sym);
          } else if (sym === 16) {
            const rep = 3 + readBits(2);
            const last = allLengths.length > 0 ? allLengths[allLengths.length - 1] : 0;
            for (let r = 0; r < rep; r++) allLengths.push(last);
          } else if (sym === 17) {
            const rep = 3 + readBits(3);
            for (let r = 0; r < rep; r++) allLengths.push(0);
          } else {
            const rep = 11 + readBits(7);
            for (let r = 0; r < rep; r++) allLengths.push(0);
          }
        }
        litTable = buildTable(allLengths.slice(0, hlit));
        distTable = buildTable(allLengths.slice(hlit, hlit + hdist));
      }

      // Decode the compressed data of this block
      while (true) {
        const lit = decodeSymbol(litTable);
        if (lit < 256) {
          output.push(lit);
        } else if (lit === 256) {
          break; // end of block
        } else {
          const li = lit - 257;
          if (li >= LENGTH_BASE.length) throw new Error('DEFLATE: invalid length symbol');
          const length = LENGTH_BASE[li] + readBits(LENGTH_EXTRA[li]);
          const distSym = decodeSymbol(distTable);
          if (distSym >= DIST_BASE.length) throw new Error('DEFLATE: invalid distance symbol');
          const distance = DIST_BASE[distSym] + readBits(DIST_EXTRA[distSym]);
          let start = output.length - distance;
          if (start < 0) throw new Error('DEFLATE: distance too far back');
          for (let i = 0; i < length; i++) {
            output.push(output[start]);
            start++;
          }
        }
        if (output.length > 50_000_000) throw new Error('DEFLATE: output exceeds safety limit');
      }
    } else {
      throw new Error('DEFLATE: reserved block type 3');
    }

    if (isFinal) break;
  }

  return new Uint8Array(output);
}

// ══════════════════════════════════════════════════════════════════════════════
// XML Parsing Helpers
// ══════════════════════════════════════════════════════════════════════════════

function uint8ToString(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
}

function parseWorkbookXml(entries: Record<string, string>): { sheets: string[] } | null {
  const xml = entries['xl/workbook.xml'] || entries['xl\\workbook.xml'];
  if (!xml) return null;

  const sheets: string[] = [];
  const sheetMatches = xml.match(/<sheet[^>]*name="([^"]*)"[^>]*>/g) || [];

  for (const match of sheetMatches) {
    const nameMatch = match.match(/name="([^"]*)"/);
    if (nameMatch) {
      sheets.push(nameMatch[1]);
    }
  }

  return sheets.length > 0 ? { sheets } : null;
}

function resolveSheetMapping(entries: Record<string, string>, workbook: { sheets: string[] }): Record<string, string> {
  const mapping: Record<string, string> = {};

  // Try xl/workbook.xml.rels first
  const relsXml = entries['xl/_rels/workbook.xml.rels'] || entries['xl\\workbook.xml.rels'];

  if (relsXml) {
    // Parse relationships
    const targetMatches = relsXml.match(/Type="[^"]*worksheet[^"]*"[^>]*Target="([^"]*)"/g) || [];
    for (let i = 0; i < targetMatches.length && i < workbook.sheets.length; i++) {
      const targetMatch = targetMatches[i].match(/Target="([^"]*)"/);
      if (targetMatch) {
        let path = targetMatch[1];
        // Normalize path separators
        path = path.replace(/\\/g, '/');
        if (!path.startsWith('xl/')) {
          path = 'xl/' + path;
        }
        mapping[workbook.sheets[i]] = path;
      }
    }
  }

  // Fallback: use standard naming
  if (Object.keys(mapping).length === 0) {
    for (let i = 0; i < workbook.sheets.length; i++) {
      mapping[workbook.sheets[i]] = `xl/worksheets/sheet${i + 1}.xml`;
    }
  }

  return mapping;
}

function parseSharedStrings(entries: Record<string, string>): string[] {
  const xml = entries['xl/sharedStrings.xml'] || entries['xl\\sharedStrings.xml'];
  if (!xml) return [];

  const strings: string[] = [];
  const siMatches = xml.match(/<si>([\s\S]*?)<\/si>/g) || [];

  for (const si of siMatches) {
    // Extract all text content, handling <t> and <r><t> elements
    let text = '';
    const tMatches = si.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
    for (const t of tMatches) {
      const content = t.match(/<t[^>]*>([^<]*)<\/t>/)?.[1] || '';
      text += unescapeXml(content);
    }
    strings.push(text);
  }

  return strings;
}

function parseStyles(entries: Record<string, string>): Record<string, unknown> {
  // Styles parsing for future use (number formatting, cell styles)
  const xml = entries['xl/styles.xml'] || entries['xl\\styles.xml'];
  if (!xml) return {};
  // Basic structure detection - return empty for now, can be extended
  return { hasStyles: true };
}

function parseSheetXml(xml: string, sharedStrings: string[], opts: Required<ParseExcelOptions>): SheetData {
  const rows: Map<number, Map<number, CellValue>> = new Map();
  let maxCol = 0;

  // Parse cells
  const cellRegex = /<c\s[^>]*r="([A-Z]+)(\d+)"[^>]*>([\s\S]*?)<\/c>/g;
  let cellMatch;

  while ((cellMatch = cellRegex.exec(xml)) !== null) {
    const colRef = cellMatch[1];
    const rowNum = parseInt(cellMatch[2], 10) - 1;
    const cellContent = cellMatch[3];

    const col = colLetterToIndex(colRef);
    maxCol = Math.max(maxCol, col);

    if (!rows.has(rowNum)) {
      rows.set(rowNum, new Map());
    }

    // The cell type lives on the <c> element itself, so read it from the full
    // match and hand it to the decoder (see parseCellValue).
    const typeAttr = (cellMatch[0].match(/<c\s[^>]*?\bt="([^"]*)"/) || [])[1] ?? 'n';
    const value = parseCellValue(cellContent, sharedStrings, typeAttr);
    rows.get(rowNum)!.set(col, value);
  }

  // Convert to array format
  const rowNumbers = Array.from(rows.keys()).sort((a, b) => a - b);
  const data: number[][] = [];
  const rowLabels: string[] = [];

  const dataStartRow = opts.hasHeader ? 1 : 0;

  for (let i = dataStartRow; i <= (rowNumbers.length > 0 ? rowNumbers[rowNumbers.length - 1] : 0); i++) {
    const rowData = rows.get(i);
    const row: number[] = [];

    for (let j = 0; j <= maxCol; j++) {
      if (opts.hasRowLabels && j === 0) {
        rowLabels.push(rowData?.get(j)?.toString() || `Row_${i + 1}`);
      } else {
        const cell = rowData?.get(j);
        if (cell === undefined) {
          row.push(NaN);
        } else if (typeof cell === 'number') {
          row.push(cell);
        } else if (typeof cell === 'boolean') {
          // Boolean cells (t="b") are produced by parseCellValue; without this
          // branch they fell through to NaN and the value was lost.
          row.push(cell ? 1 : 0);
        } else if (typeof cell === 'string') {
          if (opts.naValues.includes(cell)) {
            row.push(NaN);
          } else {
            const n = parseFloat(cell);
            row.push(isNaN(n) ? NaN : n);
          }
        } else {
          row.push(NaN);
        }
      }
    }
    data.push(row);
  }

  // Extract column labels from first row
  const colLabels: string[] = [];
  if (opts.hasHeader && rows.has(0)) {
    const headerRow = rows.get(0)!;
    for (let j = 0; j <= maxCol; j++) {
      if (opts.hasRowLabels && j === 0) {
        colLabels.push('');
      } else {
        const cell = headerRow.get(j);
        colLabels.push(cell?.toString() || `Col_${j + 1}`);
      }
    }
  } else {
    for (let j = opts.hasRowLabels ? 1 : 0; j <= maxCol; j++) {
      colLabels.push(`Col_${j + 1}`);
    }
  }

  // NOTE: the header row needs no removal here. The loop above already starts
  // at `dataStartRow` (= 1 when hasHeader), so row 0 never entered `data`.
  // A trailing `data.shift()` used to be here and silently dropped the FIRST
  // DATA ROW of every header-bearing workbook.

  // Pad rows to same length
  if (data.length > 0) {
    const maxCols = Math.max(...data.map(r => r.length));
    for (const row of data) {
      while (row.length < maxCols) row.push(NaN);
    }
  }

  return { name: '', data, rowLabels, colLabels };
}

type CellValue = number | string | boolean | null;

/**
 * Decode one `<c>` cell.
 *
 * @param cellContent  inner XML of the `<c>` element
 * @param sharedStrings shared string table
 * @param typeAttr     the `t` attribute of the ENCLOSING `<c>` tag. It has to be
 *   passed in: the attribute lives on the element, not in its inner content.
 *   Looking it up inside `cellContent` (the previous behaviour) never matched
 *   anything, so `type` was always 'n' and every branch below was dead code —
 *   shared strings were silently replaced by their table INDEX and text cells
 *   by 0.
 */
function parseCellValue(cellContent: string, sharedStrings: string[], typeAttr: string = 'n'): CellValue {
  const type = typeAttr || 'n';

  // inlineStr keeps its text in <is><t>…</t></is> rather than <v>.
  if (type === 'inlineStr') {
    const isMatch = cellContent.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    return isMatch ? unescapeXml(isMatch[1]) : '';
  }

  const vMatch = cellContent.match(/<v>([\s\S]*?)<\/v>/);
  if (!vMatch) return (type === 's' || type === 'str') ? '' : 0;

  const raw = vMatch[1];

  switch (type) {
    case 's': { // Shared string: raw is an index into the shared table
      const idx = parseInt(raw, 10);
      return sharedStrings[idx] ?? '';
    }

    case 'str': // Formula string result
    case 'e':   // Error literal
      return unescapeXml(raw);

    case 'b': // Boolean
      return raw.trim() === '1' || raw.trim().toLowerCase() === 'true';

    case 'n': // Number
    default: {
      const n = parseFloat(raw);
      return isNaN(n) ? 0 : n;
    }
  }
}

function colLetterToIndex(letters: string): number {
  let result = 0;
  for (const char of letters) {
    result = result * 26 + (char.charCodeAt(0) - 'A'.charCodeAt(0) + 1);
  }
  return result - 1;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

// ══════════════════════════════════════════════════════════════════════════════
// CSV/TSV Fallback
// ══════════════════════════════════════════════════════════════════════════════

function looksLikeDelimited(text: string): boolean {
  const firstLine = text.split(/\r?\n/)[0];
  const delimiters = [',', '\t', ';', '|'];
  return delimiters.some(d => {
    const count = (firstLine.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length;
    return count >= 2;
  });
}

function parseDelimited(text: string, opts: Required<ParseExcelOptions>): ExcelData {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) {
    return { sheets: [{ name: 'Sheet1', data: [], rowLabels: [], colLabels: [] }], nSheets: 1 };
  }

  // Detect delimiter
  const firstLine = lines[0];
  let delimiter = ',';
  const delimiterCounts = [
    { d: ',', c: (firstLine.match(/,/g) || []).length },
    { d: '\t', c: (firstLine.match(/\t/g) || []).length },
    { d: ';', c: (firstLine.match(/;/g) || []).length },
    { d: '|', c: (firstLine.match(/\|/g) || []).length }
  ];
  delimiterCounts.sort((a, b) => b.c - a.c);
  if (delimiterCounts[0].c > 0) delimiter = delimiterCounts[0].d;

  // Parse rows
  const rows: string[][] = [];
  for (const line of lines) {
    const fields = parseCSVLine(line, delimiter);
    rows.push(fields);
  }

  // Extract column labels
  const colLabels: string[] = [];
  if (opts.hasHeader && rows.length > 0) {
    const header = rows[0];
    if (opts.hasRowLabels && header.length > 0) {
      colLabels.push('');
    }
    for (let j = opts.hasRowLabels ? 1 : 0; j < header.length; j++) {
      colLabels.push(header[j] || `Col_${j + 1}`);
    }
  }

  // Extract data rows
  const data: number[][] = [];
  const rowLabels: string[] = [];
  const dataStartRow = opts.hasHeader ? 1 : 0;

  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (opts.hasRowLabels && row.length > 0) {
      rowLabels.push(row[0] || `Row_${i + 1}`);
    }
    const dataFields = opts.hasRowLabels ? row.slice(1) : row;
    const numericRow: number[] = [];

    for (const field of dataFields) {
      const trimmed = field.trim();
      if (opts.naValues.includes(trimmed)) {
        numericRow.push(NaN);
      } else {
        const n = parseFloat(trimmed);
        numericRow.push(isNaN(n) ? NaN : n);
      }
    }
    data.push(numericRow);
  }

  // Pad rows
  if (data.length > 0) {
    const maxCols = Math.max(...data.map(r => r.length));
    for (const row of data) {
      while (row.length < maxCols) row.push(NaN);
    }
  }

  return {
    sheets: [{ name: 'Sheet1', data, rowLabels, colLabels }],
    nSheets: 1
  };
}

function parseCSVLine(line: string, delimiter: string): string[] {
  // Single shared RFC 4180 implementation (see CSVParser.splitCSVLine) so the
  // CSV and XLSX text paths cannot drift apart again.
  return splitCSVLine(line, delimiter);
}

// ══════════════════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════════════════

export function parseExcelText(text: string, delimiter = '\t'): ExcelData {
  return parseDelimited(text, { sheetIndex: 0, hasHeader: true, hasRowLabels: true, naValues: ['NA', 'NaN', '-', '', 'nan', 'null'] });
}

export function excelToDataMatrix(excel: ExcelData, sheetIndex = 0): DataMatrix {
  const sheet = excel.sheets[sheetIndex];
  if (!sheet) throw new Error(`Sheet ${sheetIndex} not found`);

  const nRows = sheet.data.length;
  const nCols = nRows > 0 ? Math.max(...sheet.data.map(r => r.length)) : 0;

  const d = new Float64Array(nRows * nCols);
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      d[i * nCols + j] = sheet.data[i]?.[j] ?? NaN;
    }
  }
  const grid: number[][] = [];
  for (let i = 0; i < nRows; i++) {
    grid.push(Array.from(d.subarray(i * nCols, (i + 1) * nCols)));
  }

  return new DataMatrix(Matrix.from2D(grid), sheet.rowLabels, sheet.colLabels);
}
