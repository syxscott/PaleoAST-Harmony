/**
 * Parser regression tests — 2026-10-19 review round.
 *
 * Every test name states the OLD behaviour, so a future change that brings
 * the defect back fails here instead of silently corrupting a result that
 * ends up in a paper.
 *
 * The xlsx fixtures are built with node:zlib (`deflateRawSync`) so the tests
 * exercise the DEFLATE path of the archive reader. The hand-made STORED
 * archives of the older suites never touched it, which is why every real
 * workbook failed to parse.
 */
import { describe, it, expect } from './runner.ts';
import { deflateRawSync } from 'node:zlib';

import { parseExcel, parseExcelText } from '../entry/src/main/core/parsers/ExcelParser.ts';
import { parseCSV, splitCSVRecords } from '../entry/src/main/core/parsers/CSVParser.ts';
import { parseTPS } from '../entry/src/main/core/parsers/TPSParser.ts';
import { parseNexus } from '../entry/src/main/core/parsers/NexusParser.ts';
import { parseNewick } from '../entry/src/main/core/parsers/NewickParser.ts';
import { TreeComparator } from '../entry/src/main/core/parsers/TreeComparator.ts';
import { parseDAT } from '../entry/src/main/core/parsers/DATParser.ts';
import {
  serializeMatrix, deserializeMatrix, loadMatrix, crc32, CorruptedCacheError
} from '../entry/src/main/core/parsers/BinaryCache.ts';
import { NEXUSWriter } from '../entry/src/main/core/parsers/NexusWriter.ts';

// ─── xlsx fixtures ───────────────────────────────────────────────────────────

const ZIP_MAGIC = 0x04034b50;
const CD_MAGIC = 0x02014b50;
const EOCD_MAGIC = 0x06054b50;

/**
 * Build a ZIP archive. `deflate: true` stores the entries with a real
 * DEFLATE stream (method 8), which is what Excel, LibreOffice and openpyxl
 * produce.
 */
function buildZip(entries: [string, string][], deflate = true): ArrayBuffer {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, text] of entries) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = deflate ? 8 : 0;
    const crc = crc32(raw);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, ZIP_MAGIC, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, CD_MAGIC, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(10, method, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const p of central) cdSize += p.length;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, EOCD_MAGIC, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);

  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  let total = 0;
  for (const p of all) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out.buffer;
}

function workbookXml(sheets: [string, string][]): string {
  const body = sheets.map(([name, rid]) => `<sheet name="${name}" sheetId="1" r:id="${rid}"/>`).join('');
  return `<?xml version="1.0"?><workbook><sheets>${body}</sheets></workbook>`;
}

function relsXml(rels: [string, string][]): string {
  const body = rels.map(([id, target]) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/>`
  ).join('');
  return `<?xml version="1.0"?><Relationships>${body}</Relationships>`;
}

function sheetXml(rows: string): string {
  return `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;
}

// ─── xlsx ────────────────────────────────────────────────────────────────────

describe('fix 2026-10: the xlsx reader', () => {
  it('a real DEFLATE-compressed workbook is parsed instead of falling back to a table of garbage', () => {
    // OLD: every real xlsx (Excel, LibreOffice, openpyxl) uses DEFLATE. The
    // inflate implementation read the bits MSB-first and used a distance
    // table that is not the one of RFC 1951, so the decode threw, the parser
    // fell back to "this looks like delimited text", and the result was a
    // sheet of nulls with binary garbage as labels — no error at all.
    let rows = '';
    for (let i = 1; i <= 60; i++) {
      rows += `<row r="${i}"><c r="A${i}"><v>${i}</v></c><c r="B${i}"><v>${i * 2}</v></c></row>`;
    }
    const zip = buildZip([
      ['xl/workbook.xml', workbookXml([['S1', 'rId1']])],
      ['xl/_rels/workbook.xml.rels', relsXml([['rId1', 'worksheets/sheet1.xml']])],
      ['xl/worksheets/sheet1.xml', sheetXml(rows)],
    ]);

    const r = parseExcel(zip, { hasHeader: false, hasRowLabels: false });
    const s = r.sheets[0];
    expect(s.name).toBe('S1');                 // was the fallback default "Sheet1"
    expect(s.data.length).toBe(60);
    expect(s.data[0][0]).toBe(1);
    expect(s.data[0][1]).toBe(2);
    expect(s.data[59][0]).toBe(60);
    expect(s.data[59][1]).toBe(120);
    expect(r.fallbackReason).toBeUndefined();   // it really was read as a workbook
  });

  it('a workbook that cannot be decoded raises an error instead of being sniffed as delimited text', () => {
    // OLD: a corrupt workbook was re-read as CSV and handed back as a table.
    // The table was silently wrong, which is worse than a failure.
    const broken = buildZip([
      ['xl/workbook.xml', workbookXml([['S1', 'rId1']])],
      ['xl/_rels/workbook.xml.rels', relsXml([['rId1', 'worksheets/sheet1.xml']])],
      ['xl/worksheets/sheet1.xml', sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>')],
    ]);
    // Overwrite the compressed payload of the first entry with bytes that are
    // not a DEFLATE stream at all (0xFF = a reserved block type).
    const bytes = new Uint8Array(broken);
    const view = new DataView(bytes.buffer);
    const compressedSize = view.getUint32(18, true);
    const nameLen = new TextEncoder().encode('xl/workbook.xml').length;
    const dataOffset = 30 + nameLen;
    for (let i = 0; i < compressedSize; i++) bytes[dataOffset + i] = 0xFF;

    let error: unknown = null;
    try {
      parseExcel(bytes.slice().buffer, { hasHeader: false, hasRowLabels: false });
    } catch (e) { error = e; }
    expect(error !== null).toBe(true);
    expect(String((error as Error).message).includes('ZIP')).toBe(true);
  });

  it('a self-closing empty cell no longer steals the value of the next cell', () => {
    // OLD: `<c r="A1" s="1"/>` was read as an open tag, so the lazy match
    // swallowed B1's content and A1 got the value 5. A styled but empty cell
    // is the normal way Excel writes an empty cell.
    const rows = '<row r="1"><c r="A1" s="1"/><c r="B1"><v>5</v></c></row>'
      + '<row r="2"><c r="A2"><v>7</v></c><c r="B2"><v>9</v></c></row>';
    const zip = buildZip([
      ['xl/workbook.xml', workbookXml([['S1', 'rId1']])],
      ['xl/_rels/workbook.xml.rels', relsXml([['rId1', 'worksheets/sheet1.xml']])],
      ['xl/worksheets/sheet1.xml', sheetXml(rows)],
    ]);

    const s = parseExcel(zip, { hasHeader: false, hasRowLabels: false }).sheets[0];
    expect(Number.isNaN(s.data[0][0])).toBe(true);   // A1 is empty
    expect(s.data[0][1]).toBe(5);                   // B1 keeps its own value
    expect(s.data[1][0]).toBe(7);
    expect(s.data[1][1]).toBe(9);
  });

  it('sheets are located through the workbook r:id instead of by position', () => {
    // OLD: the Nth <sheet> was paired with the Nth worksheet relationship.
    // When the two orders differ (a deleted sheet, a rewritten file) the
    // parser returned ANOTHER sheet's data under the requested name.
    const rows1 = '<row r="1"><c r="A1"><v>1</v></c></row>';
    const rows2 = '<row r="1"><c r="A1"><v>999</v></c></row>';
    const zip = buildZip([
      ['xl/workbook.xml', workbookXml([['S1', 'rId2']])],
      ['xl/_rels/workbook.xml.rels', relsXml([
        ['rId1', 'worksheets/sheet1.xml'],
        ['rId2', 'worksheets/sheet2.xml'],
      ])],
      ['xl/worksheets/sheet1.xml', sheetXml(rows1)],
      ['xl/worksheets/sheet2.xml', sheetXml(rows2)],
    ]);

    const s = parseExcel(zip, { hasHeader: false, hasRowLabels: false }).sheets[0];
    expect(s.name).toBe('S1');
    expect(s.data[0][0]).toBe(999);   // was 1 (the first sheet's value)
  });

  it('xlsx labels are decoded as UTF-8 and an empty cell is NaN instead of a fabricated 0', () => {
    // OLD: the bytes were decoded as Latin-1, so "三叶虫" became nine
    // mojibake characters, and a cell without a value became 0 — a real
    // measurement that dragged every statistic towards zero.
    const shared = '<?xml version="1.0"?><sst>'
      + '<si><t>标本</t></si><si><t>数量</t></si>'
      + '<si><t>三叶虫</t></si><si><t>菊石</t></si></sst>';
    const rows = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="3"></c><c r="C2"><v>5</v></c></row>'
      + '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>xyz</v></c></row>';
    const zip = buildZip([
      ['xl/workbook.xml', workbookXml([['S1', 'rId1']])],
      ['xl/_rels/workbook.xml.rels', relsXml([['rId1', 'worksheets/sheet1.xml']])],
      ['xl/worksheets/sheet1.xml', sheetXml(rows)],
      ['xl/sharedStrings.xml', shared],
    ]);

    const s = parseExcel(zip, { hasHeader: true, hasRowLabels: true }).sheets[0];
    expect(s.rowLabels[0]).toBe('三叶虫');
    expect(s.rowLabels[1]).toBe('菊石');
    expect(s.colLabels[0]).toBe('数量');
    expect(Number.isNaN(s.data[0][0])).toBe(true);   // empty cell, was 0
    expect(s.data[0][1]).toBe(5);
    expect(Number.isNaN(s.data[1][0])).toBe(true);   // <v>xyz</v>, was 0
  });

  it('parseExcelText uses the delimiter it was given', () => {
    // OLD: the delimiter argument was dropped on the floor, so ';' and ','
    // produced the same table.
    const semi = parseExcelText('id;v1;v2\nr1;1;2\n', ';');
    expect(semi.sheets[0].colLabels).toEqual(['v1', 'v2']);
    expect(semi.sheets[0].data[0][0]).toBe(1);

    const comma = parseExcelText('id;v1;v2\nr1;1;2\n', ',');
    expect(comma.sheets[0].colLabels).toEqual([]);
    expect(comma.sheets[0].data[0].length).toBe(0);
  });
});

// ─── delimited text ──────────────────────────────────────────────────────────

describe('fix 2026-10: delimited text', () => {
  it('a quoted line break does not split one record into two rows', () => {
    // OLD: the text was split on newlines first, so a quoted field holding a
    // line break became two rows, the second one half a record, and every
    // column after it was shifted.
    const dm = parseCSV('id,note\nr1,"line1\nline2"\nr2,plain\n', ',', true, true);
    expect(dm.nSamples).toBe(2);
    expect(dm.rowLabels[0]).toBe('r1');
    expect(dm.rowLabels[1]).toBe('r2');

    const records = splitCSVRecords('id,note\nr1,"line1\nline2"\nr2,plain\n');
    expect(records.length).toBe(3);   // header + 2 records
    expect(records[1]).toBe('r1,"line1\nline2"');
  });

  it('the workbook text path does not split a record on a quoted line break either', () => {
    const r = parseExcelText('id;note\nr1;"line1\nline2"\nr2;plain\n', ';');
    expect(r.sheets[0].data.length).toBe(2);
    expect(r.sheets[0].rowLabels[0]).toBe('r1');
    expect(r.sheets[0].rowLabels[1]).toBe('r2');
  });
});

// ─── TPS ─────────────────────────────────────────────────────────────────────

describe('fix 2026-10: the TPS reader', () => {
  it('a record keeps the ID that stands in front of its LM block', () => {
    // OLD: the LM= line flushed (and dropped) the record that had an ID but
    // no landmarks yet, so every specimen inherited the name of the NEXT one
    // and the first ID was lost. The whole column was shifted by one row.
    const r = parseTPS('ID= sp1\nLM= 2\n0 0\n1 1\nID= sp2\nLM= 2\n2 2\n3 3\n');
    expect(r.length).toBe(2);
    expect(r[0].id).toBe('sp1');
    expect(r[0].landmarks).toEqual([[0, 0], [1, 1]]);
    expect(r[1].id).toBe('sp2');
    expect(r[1].landmarks).toEqual([[2, 2], [3, 3]]);
  });

  it('a record still takes the ID that follows its LM block', () => {
    // The other spelling of the same format must keep working.
    const r = parseTPS('LM= 2\n0 0\n1 1\nID= 1\n');
    expect(r.length).toBe(1);
    expect(r[0].id).toBe('1');
    expect(r[0].landmarks).toEqual([[0, 0], [1, 1]]);
  });

  it('one file-level LM header with one ID per specimen yields one record per specimen', () => {
    // OLD: the landmark count was reset at every record boundary, so the
    // coordinates of every specimen but the first were ignored. The bundled
    // 30-specimen example produced ONE record with the last specimen's name.
    const r = parseTPS('LM=2\nID= sp1\n0 0\n1 1\nID= sp2\n2 2\n3 3\n');
    expect(r.length).toBe(2);
    expect(r[0].id).toBe('sp1');
    expect(r[0].landmarks).toEqual([[0, 0], [1, 1]]);
    expect(r[1].id).toBe('sp2');
    expect(r[1].landmarks).toEqual([[2, 2], [3, 3]]);
  });
});

// ─── NEXUS ───────────────────────────────────────────────────────────────────

describe('fix 2026-10: the NEXUS reader', () => {
  it('matrix rows are matched to the taxa by name, not by position', () => {
    // OLD: the taxa list and the matrix rows were appended independently, so
    // a filtered file (matrix order != TAXLABELS order) put the sequence of
    // one taxon under the name of another one.
    const text = [
      '#NEXUS',
      'BEGIN TAXA;',
      '  TAXLABELS Alpha Beta Gamma;',
      'END;',
      'BEGIN CHARACTERS;',
      '  DIMENSIONS NCHAR=2;',
      '  FORMAT DATATYPE=STANDARD;',
      '  MATRIX',
      '  Beta  11',
      '  Gamma 12',
      '  Alpha 13',
      '  ;',
      'END;',
    ].join('\n');

    const r = parseNexus(text);
    expect(r.taxa).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(r.nChar).toBe(2);
    expect(r.characters[0]).toEqual([1, 3]);   // Alpha
    expect(r.characters[1]).toEqual([1, 1]);   // Beta
    expect(r.characters[2]).toEqual([1, 2]);   // Gamma
  });

  it('a taxon without a matrix row is reported and filled with NaN', () => {
    // OLD: the taxon list was longer than the matrix, and the missing row
    // simply was not there — a silent "the file had fewer rows".
    const text = [
      'BEGIN TAXA;',
      '  TAXLABELS Alpha Beta Gamma;',
      'END;',
      'BEGIN CHARACTERS;',
      '  MATRIX',
      '  Alpha 11',
      '  Beta 12',
      '  ;',
      'END;',
    ].join('\n');

    const r = parseNexus(text);
    expect(r.taxa).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(r.characters.length).toBe(3);
    expect(Number.isNaN(r.characters[2][0])).toBe(true);
    expect(Number.isNaN(r.characters[2][1])).toBe(true);
    expect((r.warnings ?? []).length).toBeGreaterThan(0);
  });

  it('a matrix row continued on the next line is not dropped', () => {
    // OLD: a line with a single token was discarded, so half of every long
    // sequence disappeared without a word.
    const text = [
      'BEGIN CHARACTERS;',
      '  MATRIX',
      '  Alpha AC',
      '  GT',
      '  ;',
      'END;',
    ].join('\n');

    const r = parseNexus(text);
    expect(r.nChar).toBe(4);
    expect(r.taxa).toEqual(['Alpha']);
    expect(r.characters[0].length).toBe(4);
  });
});

// ─── trees ───────────────────────────────────────────────────────────────────

describe('fix 2026-10: the tree tools', () => {
  it('weightedRF is not 0 when only a terminal branch length differs', () => {
    // OLD: the leaf level returned before the split was recorded, so a
    // terminal branch never entered the map and two trees that differ only
    // in a terminal branch scored 0 — "identical".
    const a = parseNewick('((A:1,B:1):1,(C:1,D:1):1);');
    const b = parseNewick('((A:1,B:1):1,(C:2,D:1):1);');
    expect(TreeComparator.weightedRF(a, b)).toBeWithin(0.5, 1e-12);
    expect(TreeComparator.weightedRF(a, a)).toBeWithin(0, 1e-12);
  });

  it('normalisedRF stays inside [0, 1] for two rooted trees', () => {
    // OLD: the denominator used the UNROOTED number of splits (2(n-3)), so
    // ((A,B),(C,D)) against ((A,C),(B,D)) scored 2.0 on a scale documented
    // as [0, 1]. A rooted binary tree has n-2 internal clades.
    const a = parseNewick('((A,B),(C,D));');
    const b = parseNewick('((A,C),(B,D));');
    expect(TreeComparator.normalisedRF(a, b)).toBeWithin(1, 1e-12);
    expect(TreeComparator.normalisedRF(a, b)).toBeLessThanOrEqual(1);
    expect(TreeComparator.normalisedRF(a, a)).toBeWithin(0, 1e-12);
  });

  it('a Newick support value is not swallowed by the label', () => {
    // OLD: the text after ")" was only read as a support value when the WHOLE
    // text was a number, so "(A,B)0.9Homo" became the name "0.9Homo" and the
    // support value was lost.
    const t = parseNewick('(A,B)0.9Homo;');
    expect(t.support).toBeWithin(0.9, 1e-12);
    expect(t.name).toBe('Homo');

    const plain = parseNewick('(A,B)0.75;');
    expect(plain.support).toBeWithin(0.75, 1e-12);
    expect(plain.name).toBe('');
  });

  it('an unbalanced Newick string raises an error instead of losing a name', () => {
    // OLD: "(A,B" was accepted as a tree and "A,B" silently dropped the B.
    let missing: unknown = null;
    try { parseNewick('(A,B'); } catch (e) { missing = e; }
    expect(missing !== null).toBe(true);

    let extra: unknown = null;
    try { parseNewick('A,B'); } catch (e) { extra = e; }
    expect(extra !== null).toBe(true);
  });
});

// ─── .dat ────────────────────────────────────────────────────────────────────

describe('fix 2026-10: the .dat reader', () => {
  it('a tab-separated .dat is no longer parsed into an empty matrix', () => {
    // OLD: the delimiter was never sniffed, so a tab-separated file was split
    // on commas and every row had a single field.
    const d = parseDAT('Taxon\tlength\twidth\nsp1\t1.2\t3.4\nsp2\t5.6\t7.8\n');
    expect(d.nRows).toBe(2);
    expect(d.nCols).toBe(2);
    expect(d.colLabels).toEqual(['length', 'width']);
    expect(d.data[0][0]).toBeWithin(1.2, 1e-9);
    expect(d.data[1][1]).toBeWithin(7.8, 1e-9);
  });

  it('a headerless .dat keeps its first row as data', () => {
    // OLD: hasHeader defaulted to true, so the first row of a file without a
    // header was eaten silently.
    const d = parseDAT('sp1\t1.2\t3.4\nsp2\t5.6\t7.8\n');
    expect(d.nRows).toBe(2);
    expect(d.data[0][0]).toBeWithin(1.2, 1e-9);
    expect(d.rowLabels[0]).toBe('sp1');
  });
});

// ─── binary cache ────────────────────────────────────────────────────────────

describe('fix 2026-10: the binary cache', () => {
  it('a payload that is not a whole number of doubles raises a CorruptedCacheError', () => {
    // OLD: `new Float64Array(buffer, 64)` threw a bare RangeError, which
    // says nothing about the file that caused it.
    const buffer = new ArrayBuffer(64 + 7);
    const view = new DataView(buffer);
    view.setUint32(0, 0x50414C45);      // big-endian, as serializeMatrix writes it
    view.setUint32(4, 2);
    view.setBigUint64(8, BigInt(7));
    view.setUint32(24, 0);              // CRC 0 = not checked

    let error: unknown = null;
    try { deserializeMatrix(buffer); } catch (e) { error = e; }
    expect(error instanceof CorruptedCacheError).toBe(true);
  });

  it('loadMatrix rejects a header whose shape does not match the payload', () => {
    // OLD: a header claiming 3x3 over four doubles was accepted and every
    // consumer then read past the end of the data.
    const payload = new Float64Array([1, 2, 3, 4]);
    const buffer = serializeMatrix(payload, { nRows: 3, nCols: 3 });
    const view = new DataView(buffer);
    view.setUint32(24, 0);   // CRC 0 = not checked, so the shape check is what fires

    let error: unknown = null;
    try { loadMatrix(buffer); } catch (e) { error = e; }
    expect(error instanceof CorruptedCacheError).toBe(true);

    const good = serializeMatrix(payload, { nRows: 2, nCols: 2 });
    expect(loadMatrix(good).data.length).toBe(4);
  });
});

// ─── NEXUS writer ────────────────────────────────────────────────────────────

describe('fix 2026-10: the NEXUS writer', () => {
  it('the document has no END without a matching BEGIN', () => {
    // OLD: an extra "END;" closed nothing; strict readers rejected the file.
    const w = new NEXUSWriter({ matrix: { A: 'AAAA', B: 'CCCC' } });
    w.addTree('t1', '(A,B);');
    const text = w.write();
    const begins = (text.match(/BEGIN/g) || []).length;
    const ends = (text.match(/END;/g) || []).length;
    expect(begins).toBe(3);
    expect(ends).toBe(begins);
  });

  it('a name containing "/", "=" or "*" is quoted', () => {
    // OLD: those characters were not reserved, so the name was written bare
    // and the file could no longer be read back.
    const w = new NEXUSWriter({ matrix: { 'sp=1': 'AAAA', 'a/b': 'CCCC', 'c*d': 'GGGG' } });
    const text = w.write();
    expect(text.includes("'sp=1'")).toBe(true);
    expect(text.includes("'a/b'")).toBe(true);
    expect(text.includes("'c*d'")).toBe(true);
  });
});
