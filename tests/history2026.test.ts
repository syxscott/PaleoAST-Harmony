/**
 * Regression tests for the data-fingerprint used by the analysis history
 * (2026-09-27, sixth pass).
 *
 * The history suppresses a repeat run when the stored `params` string matches
 * the newest record of the same analysis. `params` used to hold only the DIALOG
 * settings, so loading a different dataset and re-running the same analysis was
 * suppressed as a double-tap and the run disappeared from the persistent
 * history -- and therefore from the exported reproducible script.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';
import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { DataMatrix } from '../entry/src/main/core/models/index.ts';
import { dataFingerprint, DATA_HASH_KEY } from '../entry/src/main/ets/utils/dataFingerprint.ts';

const mk = (rows: number[][], rl: string[], cl: string[]) =>
  new DataMatrix(Matrix.from2D(rows), rl, cl);

const A = mk([[1, 2], [3, 4]], ['r1', 'r2'], ['c1', 'c2']);
const A2 = mk([[1, 2], [3, 4]], ['r1', 'r2'], ['c1', 'c2']);
const big1 = mk(
  Array.from({ length: 48 }, (_, i) => Array.from({ length: 12 }, (_, j) => i + j)),
  Array.from({ length: 48 }, (_, i) => 's' + i),
  Array.from({ length: 12 }, (_, j) => 'v' + j),
);
const big2 = mk(
  Array.from({ length: 48 }, (_, i) => Array.from({ length: 12 }, (_, j) => i + j + (i === 47 ? 0.5 : 0))),
  Array.from({ length: 48 }, (_, i) => 's' + i),
  Array.from({ length: 12 }, (_, j) => 'v' + j),
);

describe('audit: the history de-duplication could not tell two datasets apart', () => {
  it('the same data always fingerprints the same', () => {
    expect(dataFingerprint(A)).toBe(dataFingerprint(A2));
    expect(dataFingerprint(big1)).toBe(dataFingerprint(
      mk(
        Array.from({ length: 48 }, (_, i) => Array.from({ length: 12 }, (_, j) => i + j)),
        Array.from({ length: 48 }, (_, i) => 's' + i),
        Array.from({ length: 12 }, (_, j) => 'v' + j),
      ),
    ));
  });

  it('a FRACTIONAL change in one cell changes the fingerprint', () => {
    // The first version fed each value through `v & 0xff`; bitwise operators
    // coerce to Int32 and truncate the fraction, so 4 and 4.5 hashed
    // identically -- which is most of a morphometrics or measurement table.
    expect(dataFingerprint(mk([[1, 2], [3, 4.5]], ['r1', 'r2'], ['c1', 'c2'])) === dataFingerprint(A)).toBe(false);
    expect(dataFingerprint(mk([[1, 2.0000000001], [3, 4]], ['r1', 'r2'], ['c1', 'c2'])) === dataFingerprint(A)).toBe(false);
  });

  it('two same-shape datasets that data_shape cannot tell apart differ', () => {
    // Both report dataShape = "48x12", so the de-dup key had to come from the
    // content, not the shape.
    expect(big1.nSamples).toBe(48);
    expect(big1.nVariables).toBe(12);
    expect(big2.nSamples).toBe(48);
    expect(big2.nVariables).toBe(12);
    expect(dataFingerprint(big1) === dataFingerprint(big2)).toBe(false);
  });

  it('a label change changes the fingerprint, a NaN is stable', () => {
    expect(dataFingerprint(mk([[1, 2], [3, 4]], ['r1', 'CHANGED'], ['c1', 'c2'])) === dataFingerprint(A)).toBe(false);
    expect(dataFingerprint(mk([[1, 2], [3, 4]], ['r1', 'r2'], ['c1', 'renamed'])) === dataFingerprint(A)).toBe(false);
    const nan1 = mk([[NaN, 2], [3, 4]], ['r1', 'r2'], ['c1', 'c2']);
    const nan2 = mk([[NaN, 2], [3, 4]], ['r1', 'r2'], ['c1', 'c2']);
    expect(dataFingerprint(nan1)).toBe(dataFingerprint(nan2));
    expect(dataFingerprint(nan1) === dataFingerprint(A)).toBe(false);
  });

  it('no dataset hashes to the "none" sentinel, and null does', () => {
    expect(dataFingerprint(null)).toBe('none');
    expect(dataFingerprint(undefined)).toBe('none');
    expect(dataFingerprint(A) === 'none').toBe(false);
    expect(dataFingerprint(big1) === 'none').toBe(false);
  });
});

describe('audit: the fingerprint reaches the de-dup key and stays out of the script', () => {
  const index = readFileSync('entry/src/main/ets/pages/Index.ets', 'utf-8');

  it('persistAnalysis stamps it into the STORED params', () => {
    expect(index.includes('[DATA_HASH_KEY]: fp')).toBe(true);
    expect(index.includes('JSON.stringify(storedParams)')).toBe(true);
    expect(index.includes('JSON.stringify(params ?? {})')).toBe(false);
  });

  it('the in-memory history the script is built from keeps the untouched params', () => {
    // recordAnalysis pushes the caller's params object; only persistAnalysis's
    // copy of them is stamped, so buildAnalysisScript can never emit the key.
    const m = index.match(/private recordAnalysis\(name: string, params: Record<string, Object>\): void \{[\s\S]*?\n  \}/);
    expect(m !== null).toBe(true);
    expect(m![0]).toContain('this.analysisHistory.push(step)');
    expect(m![0]).toContain('params,');
    expect(m![0].includes('DATA_HASH_KEY')).toBe(false);
  });

  it('restoreHistory strips it again, and old records without it still parse', () => {
    expect(index.includes('delete params[DATA_HASH_KEY]')).toBe(true);
    // The parse is still guarded, so a record written before the key existed
    // (or with a corrupt blob) degrades to {} rather than throwing.
    expect(index.includes('params = JSON.parse(r.params) as Record<string, Object>;')).toBe(true);
  });

  it('the reserved key name is exported, so the two ends cannot drift', () => {
    expect(DATA_HASH_KEY).toBe('_dataHash');
  });
});
