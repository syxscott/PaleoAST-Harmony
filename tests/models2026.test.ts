/**
 * Regression tests for the specimen-group pipeline found while reviewing
 * core/models + the UI wiring (2026-09-27, third pass).
 *
 * This was the most damaging defect of the whole audit: the user could group
 * specimens in the spreadsheet, run PERMANOVA / ANOSIM / SIMPER / LDA, and get
 * "no significant difference (p = 1)" for data the groups separated completely.
 * Per AGENTS.md every test name STATES THE OLD BEHAVIOUR.
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { DataMatrix } from '../entry/src/main/core/models/DataMatrix.ts';
import { StateManager } from '../entry/src/main/core/models/StateManager.ts';
import {
  permanova, anosim, simper, lda, computeDistanceMatrix,
} from '../entry/src/main/core/analysis/statistics/index.ts';

/** Two clades separated by an order of magnitude in every variable. */
const CLADE_ROWS = [
  [1, 10, 5], [2, 20, 6], [1.5, 15, 5.5],
  [9, 90, 1], [8, 80, 1.2], [9.5, 95, 0.8],
];
const LABELS = ['s1', 's2', 's3', 's4', 's5', 's6'];
const COLS = ['a', 'b', 'c'];

function matrixWithGroups(groups: string[]): DataMatrix {
  const dm = new DataMatrix(Matrix.from2D(CLADE_ROWS), LABELS, COLS);
  dm.setGroups(groups);
  return dm;
}

describe('audit: getGroups() collapsed every named group into 0', () => {
  it('two named clades become two distinct codes', () => {
    // `getGroups()` ran `parseInt(name) || 0` on the group NAME. For
    // "Amniote" / "Reptile" that is NaN and therefore 0, so the vector was
    // [0,0,0,0,0,0] -- a single group.
    const dm = matrixWithGroups(['Amniote', 'Amniote', 'Amniote', 'Reptile', 'Reptile', 'Reptile']);
    expect(dm.getGroups()).toEqual([0, 0, 0, 1, 1, 1]);
    expect(dm.getGroupNames()).toEqual(['Amniote', 'Reptile']);
  });

  it('a grouping that was silently flattened produced F = 0.000000', () => {
    const X = Matrix.from2D(CLADE_ROWS);
    const D = computeDistanceMatrix(X, 'euclidean');
    const correct = [0, 0, 0, 1, 1, 1];
    // F is undefined for one group; the old code fed that fiction to the test
    // and it answered "no significant difference" for maximally separated data.
    expect(permanova(D, correct, 99, 42).fStatistic).toBeCloseTo(193.6545, 3);
    // With only one group the test must now refuse rather than answer.
    let msg = '';
    try { permanova(D, [0, 0, 0, 0, 0, 0], 99, 42); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('at least 2 distinct groups');
  });

  it('partly assigned or single-group datasets report no groups at all', () => {
    // "Ungrouped" is the spreadsheet's default for every fresh row, so a
    // dataset nobody touched must not look like one big group.
    expect(matrixWithGroups(['Ungrouped', 'Ungrouped', 'Ungrouped', 'Ungrouped', 'Ungrouped', 'Ungrouped']).getGroups()).toBeNull();
    expect(matrixWithGroups([]).getGroups()).toBeNull();
    // one real group plus leftovers is still not usable
    expect(matrixWithGroups(['A', 'A', 'A', 'Ungrouped', 'Ungrouped', 'Ungrouped']).getGroups()).toBeNull();
    // names differing only by case / spacing are still names
    expect(matrixWithGroups(['a', 'a', 'A', 'A', 'A', 'A']).getGroups()).toEqual([0, 0, 1, 1, 1, 1]);
  });

  it('the codes survive the round trip through the analysis', () => {
    const dm = matrixWithGroups(['Amniote', 'Amniote', 'Amniote', 'Reptile', 'Reptile', 'Reptile']);
    const D = computeDistanceMatrix(dm.data, 'euclidean');
    const g = dm.getGroups()!;
    expect(permanova(D, g, 99, 42).fStatistic).toBeCloseTo(193.6545, 3);
    expect(anosim(D, g, 99, 42).statistic).toBeCloseTo(1, 12);
    expect(simper(dm.data, g).groupPairResults.length).toBe(1);
    expect(simper(dm.data, g).overallDissimilarity).toBeCloseTo(0.7102, 4);
  });
});

describe('audit: the between-group tests answered on an empty group vector', () => {
  const X = Matrix.from2D(CLADE_ROWS);
  const D = computeDistanceMatrix(X, 'euclidean');

  it('simper no longer returns an empty result with dissimilarity 0', () => {
    // It used to return { overallDissimilarity: 0, contributions: [],
    // groupPairResults: [] } for zero groups -- indistinguishable from "these
    // groups are identical" in a results table.
    let msg = '';
    try { simper(X, []); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('simper: no groups supplied');
  });

  it('permanova no longer reports F = 0, p = 1 and a negative df', () => {
    // dfBetween was -1 and pValue exactly 1 -- a well-formed "no significant
    // difference" row for an analysis that had never been given groups.
    let msg = '';
    try { permanova(D, []); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('permanova: no groups supplied');
  });

  it('anosim no longer reports a negative R and p = 1', () => {
    let msg = '';
    try { anosim(D, []); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('anosim: no groups supplied');
  });

  it('lda no longer dies later with "eigh:A[0] is not finite: NaN"', () => {
    // The opaque failure came from deep inside the eigensolver, long after the
    // real cause (there were no groups at all).
    let msg = '';
    try { lda(X, []); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('lda: no groups supplied');
  });

  it('a group vector of the wrong length is rejected too', () => {
    let msg = '';
    try { permanova(D, [0, 0, 1], 99, 42); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('3 group labels for 6 specimens');
  });
});

describe('audit: transpose() destroyed metadata and invented groups', () => {
  it('a specimen keeps its group, colour, weight and excluded flag', () => {
    // The old code REPLACED any column metadata with a fabricated
    // {name, type:'numeric'} stub, so everything a specimen was annotated with
    // was gone; and it copied each old column's NAME into the new row's GROUP
    // slot, so every row ended up "in group Var_3".
    const dm = new DataMatrix(Matrix.from2D([[1, 10, 100], [2, 20, 200], [3, 30, 300]]),
      ['SpecA', 'SpecB', 'SpecC'], ['Length', 'Width', 'Stage']);
    dm.rowMeta.set(0, { group: 'Amniote', color: '#ff0000', weight: 2.5 });
    dm.rowMeta.exclude(2);

    const t = dm.transpose();
    const c0 = t.colMeta.get(0)!;
    expect(c0.name).toBe('SpecA');
    expect(c0.group).toBe('Amniote');
    expect(c0.color).toBe('#ff0000');
    expect(c0.weight).toBe(2.5);
    expect(t.colMeta.get(2)!.excluded).toBe(true);
    // and no row was given a fabricated group
    expect(t.rowMeta.getGroup(0)).toBeUndefined();
    expect(t.rowMeta.getGroup(1)).toBeUndefined();
    expect(t.rowMeta.getGroup(2)).toBeUndefined();
  });

  it('a former variable keeps its data type on the new row', () => {
    const dm = new DataMatrix(Matrix.from2D([[1, 10, 100], [2, 20, 200], [3, 30, 300]]),
      ['SpecA', 'SpecB', 'SpecC'], ['Length', 'Width', 'Stage']);
    dm.colMeta.set(1, { name: 'Width', type: 'ordinal' });
    dm.colMeta.set(2, { name: 'Stage', type: 'categorical' });
    const t = dm.transpose();
    expect(t.rowMeta.get(1)!.type).toBe('ordinal');
    expect(t.rowMeta.get(2)!.type).toBe('categorical');
  });

  it('the labels still swap and the data still transposes', () => {
    const dm = new DataMatrix(Matrix.from2D([[1, 10, 100], [2, 20, 200], [3, 30, 300]]),
      ['SpecA', 'SpecB', 'SpecC'], ['Length', 'Width', 'Stage']);
    const t = dm.transpose();
    expect(t.nSamples).toBe(3);
    expect(t.nVariables).toBe(3);
    expect(t.rowLabels).toEqual(['Length', 'Width', 'Stage']);
    expect(t.colLabels).toEqual(['SpecA', 'SpecB', 'SpecC']);
    expect(t.data.get(0, 0)).toBe(1);
    expect(t.data.get(0, 1)).toBe(2);
    // t[i][j] === data[j][i]: t row 1 is the old column 1, [10, 20, 30]
    expect(t.data.get(1, 2)).toBe(30);
    expect(t.data.get(2, 1)).toBe(200);
  });
});

describe('audit: replacing the dataset left stale undo history behind', () => {
  it('setData clears every stack, and so does clearData', () => {
    const sm = new StateManager();
    const mk = () => new DataMatrix(Matrix.from2D([[1, 2], [3, 4]]), ['r0', 'r1'], ['c0', 'c1']);
    const first = mk();
    sm.setData(first);
    sm.pushUndo(0, 0, 1, 99);
    sm.pushCommandSnapshot();
    sm.cacheResult('k', { v: 1 });
    expect(sm.canUndo()).toBe(true);
    expect(sm.canUndoCommand).toBe(true);

    // A cell delta carries (row, col, oldVal) against the PREVIOUS matrix, so
    // replaying it into a new dataset writes the old specimen's value in.
    const second = new DataMatrix(Matrix.from2D([[7, 8], [9, 10]]), ['r0', 'r1'], ['c0', 'c1']);
    sm.setData(second);
    expect(sm.canUndo()).toBe(false);
    expect(sm.canUndoCommand).toBe(false);
    expect(sm.getCachedResult('k')).toBeNull();
    expect(sm.undo()).toBe(false);
    expect(sm.dataMatrix!.data.get(0, 0)).toBe(7);
  });
});
