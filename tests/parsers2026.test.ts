/**
 * Parser regression tests.
 *
 * Found by a line-by-line review of core/parsers: two silent data-loss paths in
 * the spreadsheet and TPS readers.
 */
import { describe, it, expect } from './runner.ts';
import { parseTPS } from '../entry/src/main/core/parsers/TPSParser.ts';
import { splitCSVLine, parseCSV } from '../entry/src/main/core/parsers/CSVParser.ts';
import { serializeMatrix, deserializeMatrix } from '../entry/src/main/core/parsers/BinaryCache.ts';

describe('audit: parsers lost data silently', () => {
  it('a 3-D TPS landmark block keeps its z coordinate', () => {
    // `LM3=` is the TPS keyword for 3-D landmarks, but the parser treated it
    // exactly like `LM=` and pushed only [x, y]. Every 3-D morphometric
    // configuration was therefore silently reduced to 2-D and the analysis ran
    // on half the data while looking entirely normal.
    const r = parseTPS('LM3=2\n0 0 0\n1 1 1\nID=1\n');
    expect(r.length).toBe(1);
    expect(r[0].landmarks).toEqual([[0, 0, 0], [1, 1, 1]]);
  });

  it('a 2-D TPS landmark block is still parsed as two components', () => {
    const r = parseTPS('LM=2\n0 0\n1 1\nID=1\n');
    expect(r[0].landmarks).toEqual([[0, 0], [1, 1]]);
  });

  it('the 2-D/3-D flag resets between records in one file', () => {
    const r = parseTPS('LM=2\n0 0\n1 1\nID=1\nLM3=2\n5 5 5\n6 6 6\nID=2\n');
    expect(r.length).toBe(2);
    expect(r[0].landmarks).toEqual([[0, 0], [1, 1]]);
    expect(r[1].landmarks).toEqual([[5, 5, 5], [6, 6, 6]]);
  });

  it('a ragged CSV neither truncates a long row nor fabricates zeros', () => {
    const r = parseCSV('a,b\n1,2,3\n4,5\n', ',', true, false);
    expect(r.data.cols).toBe(3);
    expect(r.data.get(0, 2)).toBe(3);
    expect(Number.isNaN(r.data.get(1, 2))).toBe(true);
  });

  it('a non-numeric cell becomes NaN rather than a fabricated 0', () => {
    const r = parseCSV('a,b\n1,abc\n', ',', true, false);
    expect(Number.isNaN(r.data.get(0, 1))).toBe(true);
  });

  it('a missing-value token becomes NaN', () => {
    const r = parseCSV('a,b\n1,NA\n', ',', true, false);
    expect(Number.isNaN(r.data.get(0, 1))).toBe(true);
  });

  it('splitCSVLine keeps a quoted comma out of the split and unescapes doubled quotes', () => {
    // Pinned because the delimiter is a required argument: called with one
    // argument it silently stops splitting.
    expect(splitCSVLine('"x,1","he said ""hi"""', ',')).toEqual(['x,1', 'he said "hi"']);
  });

  it('the binary cache round-trips and rejects a corrupted payload', () => {
    const data = new Float64Array([1, 2, 3, 4]);
    const buf = serializeMatrix(data);
    const back = deserializeMatrix(buf);
    expect(back.length).toBe(4);
    expect(back[0]).toBe(1);
    expect(back[3]).toBe(4);

    const bytes = new Uint8Array(buf);
    bytes[bytes.length - 1] ^= 0xFF;
    expect(() => deserializeMatrix(bytes.slice().buffer)).toThrow();

    const badMagic = new Uint8Array(buf);
    badMagic[0] ^= 0xFF;
    expect(() => deserializeMatrix(badMagic.slice().buffer)).toThrow();
  });
});
