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
import { splitCSVLine, splitCSVRecords } from './CSVParser';

export interface ExcelData {
  sheets: SheetData[];
  nSheets: number;
  /**
   * Set when the file could NOT be read as a workbook and the delimited-text
   * reader was used instead. The result is still a table, but it was not read
   * as an xlsx — a silent fallback would hand the user numbers with no
   * indication that the workbook was never actually parsed.
   */
  fallbackReason?: string;
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

/** Excel parse failure with an explanation of what went wrong. */
export class ExcelParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExcelParseError';
  }
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
    const reason = e instanceof Error ? e.message : String(e);

    // A ZIP archive is never delimited text. The old code sniffed the raw
    // bytes for commas and tabs; a real xlsx is full of them, so EVERY
    // workbook that failed to decode came back as a "table" whose labels were
    // binary garbage and whose cells were all null -- with no error at all.
    // That is the worst possible outcome for a result that ends up in a
    // paper, so a ZIP now fails loudly instead.
    if (isZipArchive(bytes)) {
      throw new ExcelParseError(
        `Failed to parse Excel workbook: ${reason}. The file is a ZIP archive (xlsx) ` +
        'but its contents could not be decoded; it was NOT parsed as delimited text ' +
        'because that would silently produce a table of wrong numbers.'
      );
    }

    // Not a ZIP: it may be delimited text after all (e.g. a CSV handed in as
    // bytes). Fall back, but say so in the result.
    const text = decodeUtf8(bytes);
    if (looksLikeDelimited(text)) {
      const result = parseDelimited(text, opts);
      result.fallbackReason =
        `Not a readable xlsx workbook (${reason}); parsed as delimited text instead.`;
      return result;
    }
    throw new ExcelParseError(`Failed to parse Excel file: ${reason}`);
  }
}

/** ZIP local-file-header / empty-archive signature. */
function isZipArchive(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B;
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
      entries[entry.name] = decodeUtf8(data);
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

  const name = decodeUtf8(bytes.slice(offset + 30, offset + 30 + nameLen));

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

  const name = decodeUtf8(bytes.slice(offset + 46, offset + 46 + nameLen));

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
  //
  // RFC 1951 §3.1.1: "Data elements are packed into bytes in order of
  // increasing bit number within the byte, i.e. starting with the
  // LEAST-SIGNIFICANT bit of the byte." The old reader took the MOST
  // significant bit first, so every block header, every Huffman code and every
  // extra bit was read upside down and no real workbook could be decoded.
  const readBit = (): number => {
    if (bitCount === 0) {
      if (pos >= compressed.length) throw new Error('DEFLATE: unexpected end of input');
      bitBuffer = compressed[pos++];
      bitCount = 8;
    }
    const bit = bitBuffer & 1;
    bitBuffer >>>= 1;
    bitCount--;
    return bit;
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
  // Distance table — RFC 1951 §3.2.5 (30 codes).
  //
  // The old table had 32 entries with the bases 1..10, 12, 14, 16, 20, ...:
  // that is NOT the RFC table, so every back-reference was copied from the
  // wrong distance and the decompressed bytes were garbage.
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
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

/**
 * Decode bytes as UTF-8.
 *
 * Everything inside an xlsx is UTF-8 XML. The old decoder built the string
 * with `String.fromCharCode` per byte, i.e. Latin-1, so a label such as
 * "三叶虫" came out as nine mojibake characters instead of three. The same
 * helper is used for the ZIP entry names, which are ASCII in practice.
 */
const utf8Decoder = new TextDecoder('utf-8');

function decodeUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

/** One `<sheet>` entry of the workbook: its display name and its r:id. */
interface WorkbookSheet {
  name: string;
  /** Relationship id (`r:id`) pointing at the worksheet part, if present. */
  rid: string | null;
}

function parseWorkbookXml(entries: Record<string, string>): { sheets: WorkbookSheet[] } | null {
  const xml = entries['xl/workbook.xml'] || entries['xl\\workbook.xml'];
  if (!xml) return null;

  const sheets: WorkbookSheet[] = [];
  const sheetMatches = xml.match(/<sheet\b[^>]*>/g) || [];

  for (const match of sheetMatches) {
    const nameMatch = match.match(/\bname="([^"]*)"/);
    if (!nameMatch) continue;
    // The relationship id is `r:id`. `sheetId` must NOT match here — it is a
    // different attribute and would point the lookup at the wrong part.
    const ridMatch = match.match(/(?:^|\s)(?:r:)?id="([^"]*)"/);
    sheets.push({ name: nameMatch[1], rid: ridMatch ? ridMatch[1] : null });
  }

  return sheets.length > 0 ? { sheets } : null;
}

/**
 * Resolve a relationship target to a path inside the archive.
 * `worksheets/sheet2.xml` is relative to `xl/`; `/xl/worksheets/sheet2.xml` is
 * absolute.
 */
function normaliseSheetPath(target: string): string {
  let path = target.replace(/\\/g, '/');
  if (path.startsWith('/')) path = path.slice(1);
  if (!path.startsWith('xl/')) path = 'xl/' + path;
  return path;
}

/**
 * Map sheet names to their worksheet parts.
 *
 * The mapping follows the workbook's `r:id` into the relationship file. The
 * old code paired the Nth `<sheet>` with the Nth worksheet relationship, which
 * returns ANOTHER SHEET's data whenever the two orders differ (a deleted
 * sheet, or a file rewritten by a tool that renumbered the relationships).
 */
function resolveSheetMapping(entries: Record<string, string>, workbook: { sheets: WorkbookSheet[] }): Record<string, string> {
  const mapping: Record<string, string> = {};

  // Try xl/workbook.xml.rels first
  const relsXml = entries['xl/_rels/workbook.xml.rels'] || entries['xl\\workbook.xml.rels'];

  const byId = new Map<string, string>();
  const worksheetTargets: string[] = [];

  if (relsXml) {
    const relMatches = relsXml.match(/<Relationship\b[^>]*>/g) || [];
    for (const rel of relMatches) {
      const idMatch = rel.match(/\bId="([^"]*)"/);
      const targetMatch = rel.match(/\bTarget="([^"]*)"/);
      if (!targetMatch) continue;
      const path = normaliseSheetPath(targetMatch[1]);
      if (idMatch) byId.set(idMatch[1], path);
      const typeMatch = rel.match(/\bType="([^"]*)"/);
      if (typeMatch && /worksheet/i.test(typeMatch[1])) worksheetTargets.push(path);
    }
  }

  workbook.sheets.forEach((sheet, index) => {
    // Primary: the relationship the workbook itself names.
    let path = sheet.rid ? byId.get(sheet.rid) : undefined;
    // Fallback: position among the worksheet relationships.
    if (!path) path = worksheetTargets[index];
    // Last resort: the conventional file name.
    if (!path) path = `xl/worksheets/sheet${index + 1}.xml`;
    mapping[sheet.name] = path;
  });

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
  for (const cell of extractCells(xml)) {
    const col = colLetterToIndex(cell.colRef);
    maxCol = Math.max(maxCol, col);

    if (!rows.has(cell.rowNum)) {
      rows.set(cell.rowNum, new Map());
    }

    const value = parseCellValue(cell.content, sharedStrings, cell.typeAttr);
    rows.get(cell.rowNum)!.set(col, value);
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
        rowLabels.push(cellToLabel(rowData?.get(j)) || `Row_${i + 1}`);
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
    // Column 0 is the ROW-LABEL column when hasRowLabels is set, so it must not
    // occupy a column-label slot. Pushing an '' placeholder for it made
    // colLabels one element longer than the data, and DataMatrix's constructor
    // replaces the whole array with Var_1..Var_N whenever the lengths disagree
    // -- so importing any xlsx with row labels silently discarded every real
    // column name. The no-header branch below already started at column 1.
    for (let j = opts.hasRowLabels ? 1 : 0; j <= maxCol; j++) {
      const cell = headerRow.get(j);
      colLabels.push(cellToLabel(cell) || `Col_${j + 1}`);
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

/** One `<c>` element of a worksheet. */
interface RawCell {
  colRef: string;
  rowNum: number;
  typeAttr: string;
  content: string;
}

/**
 * Extract every `<c>` cell of a worksheet.
 *
 * A cell is either self-closing (`<c r="A1" s="1"/>` — styled but empty, the
 * usual way Excel writes an empty cell) or paired (`<c r="A1"><v>1</v></c>`).
 * A single regex cannot tell the two apart: the lazy `[\s\S]*?` of the paired
 * form runs past the `/>` of a self-closing cell and swallows the NEXT cell's
 * content, which is then filed under the empty cell's reference — so the value
 * of B1 ended up in A1.
 *
 * This scanner reads the opening tag first, so a self-closing cell never
 * captures any content, and the content of a paired cell never runs past the
 * start of the next cell.
 */
function extractCells(xml: string): RawCell[] {
  const cells: RawCell[] = [];
  let i = 0;

  while (i < xml.length) {
    const start = xml.indexOf('<c', i);
    if (start < 0) break;
    const marker = xml[start + 2];
    // `<c `, `<c>` and `<c/>` open a cell; `<col ...>` / `<cols>` do not.
    if (marker !== ' ' && marker !== '\t' && marker !== '\n' && marker !== '>' && marker !== '/') {
      i = start + 2;
      continue;
    }

    const tagEnd = xml.indexOf('>', start);
    if (tagEnd < 0) break;
    const tag = xml.slice(start, tagEnd + 1);
    const selfClosing = tag.endsWith('/>');
    const attrs = tag.slice(2, tag.length - 1).replace(/\/\s*$/, '').trim();

    let content = '';
    let next = tagEnd + 1;
    if (!selfClosing) {
      const closeIdx = xml.indexOf('</c>', tagEnd + 1);
      const nextCellIdx = xml.indexOf('<c', tagEnd + 1);
      if (closeIdx < 0) {
        // Unterminated cell: keep only what precedes the next cell.
        content = nextCellIdx >= 0 ? xml.slice(tagEnd + 1, nextCellIdx) : xml.slice(tagEnd + 1);
        next = nextCellIdx >= 0 ? nextCellIdx : xml.length;
      } else if (nextCellIdx >= 0 && nextCellIdx < closeIdx) {
        // Truncated cell: the next cell starts before this one is closed, so
        // the content must stop there instead of running into the next cell.
        content = xml.slice(tagEnd + 1, nextCellIdx);
        next = nextCellIdx;
      } else {
        content = xml.slice(tagEnd + 1, closeIdx);
        next = closeIdx + 4;
      }
    }

    const refMatch = attrs.match(/\br="([A-Z]+)(\d+)"/);
    if (refMatch) {
      const typeMatch = attrs.match(/\bt="([^"]*)"/);
      cells.push({
        colRef: refMatch[1],
        rowNum: parseInt(refMatch[2], 10) - 1,
        typeAttr: typeMatch ? typeMatch[1] : 'n',
        content
      });
    }
    i = next;
  }

  return cells;
}

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
  if (!vMatch) {
    // An empty cell carries no <v>. The old code returned 0 here, which
    // FABRICATED a measurement: a blank cell became a real zero, every mean
    // was dragged towards 0 and a missing specimen looked like a measured
    // one. Missing data has to stay missing (NaN) — the CSV path already did.
    if (type === 's' || type === 'str') return '';
    return NaN;
  }

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
      // A cell whose value is not a number is missing data, not a zero.
      const n = parseFloat(raw);
      return isNaN(n) ? NaN : n;
    }
  }
}

/**
 * Text of a cell for use as a row/column label.
 * A missing value (NaN) has no text — it must not become the label "NaN".
 */
function cellToLabel(cell: CellValue | undefined): string {
  if (cell === undefined || cell === null) return '';
  if (typeof cell === 'number') return isNaN(cell) ? '' : String(cell);
  return String(cell);
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
  // Binary payloads (a failed workbook, an image, a DOCX) contain NUL and
  // other control bytes. Sniffing those as CSV produced a table of garbage
  // labels, so a file that is not text at all is never treated as text.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return false;
  const firstLine = text.split(/\r?\n/)[0];
  const delimiters = [',', '\t', ';', '|'];
  return delimiters.some(d => {
    const count = (firstLine.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length;
    return count >= 2;
  });
}

/** Delimiter with the most occurrences in the first record. */
function sniffDelimiter(firstLine: string): string {
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const count = (firstLine.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function parseDelimited(text: string, opts: Required<ParseExcelOptions>, forcedDelimiter?: string): ExcelData {
  // Records, not lines: a quoted field may contain a line break (RFC 4180).
  const records = splitCSVRecords(text).filter(r => r.trim());
  if (records.length === 0) {
    return { sheets: [{ name: 'Sheet1', data: [], rowLabels: [], colLabels: [] }], nSheets: 1 };
  }

  // Use the delimiter the caller asked for; otherwise detect it.
  const delimiter = forcedDelimiter ?? sniffDelimiter(records[0]);

  // Parse rows
  const rows: string[][] = [];
  for (const record of records) {
    const fields = parseCSVLine(record, delimiter);
    rows.push(fields);
  }

  // Extract column labels
  const colLabels: string[] = [];
  if (opts.hasHeader && rows.length > 0) {
    const header = rows[0];
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
  // The delimiter used to be dropped on the floor: `parseExcelText(text, ';')`
  // and `parseExcelText(text, ',')` produced the same table.
  return parseDelimited(
    text,
    { sheetIndex: 0, hasHeader: true, hasRowLabels: true, naValues: ['NA', 'NaN', '-', '', 'nan', 'null'] },
    delimiter
  );
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
