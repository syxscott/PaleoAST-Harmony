/**
 * Regression tests for the view-model layer extracted from pages/Index.ets
 * (2026-10-20).
 *
 * Why this layer exists
 * ---------------------
 * The page was one 1400-line file: the dispatch switches, the dialog wiring,
 * the plot selection AND the small rules that decide what an analysis is
 * actually run on. Six of those rules were pure -- no ArkUI, no component
 * state, same input, same output -- but they sat in private methods of a
 * `@Component struct`, and the ArkUI layer cannot execute under the Node
 * harness. So they had no unit test at all: the unit suite covers `core/**`
 * and the pure `.ts` modules under `ets/`, and a private method of a struct is
 * in neither.
 *
 * The reference projects this follows (harmony-bird's
 * `viewmodels/GameViewModel.ets`, stock-tracker's `viewmodel/ListViewModel.ets`
 * + `model/ChartModels.ets`) split the page into `pages/ + components/ +
 * viewmodels/ + model/`. The five modules under `entry/src/main/ets/viewmodels/`
 * are that layer here: plain `.ts`, no ArkUI import, unit testable.
 *
 * What the tests pin
 * ------------------
 * The rules are pinned by their OLD behaviour, not by a new intent. The move
 * had to be behaviour-preserving down to the last character, so a test that
 * only asserted "the function returns something" would have been worthless.
 * Every rule below has at least one assertion that a changed rule breaks --
 * see the change record for the mutations that were run against these tests to
 * prove they bite.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';
import { buildStratSections } from '../entry/src/main/ets/viewmodels/stratSections.ts';
import { phyloGroupMap, usableGroupCodes } from '../entry/src/main/ets/viewmodels/specimenGroups.ts';
import { clampSampleIndex } from '../entry/src/main/ets/viewmodels/dialogParams.ts';
import { analysisScriptHeader, analysisStepJson } from '../entry/src/main/ets/viewmodels/analysisScript.ts';
import { Matrix } from '../entry/src/main/core/math/Matrix.ts';

const INDEX = 'entry/src/main/ets/pages/Index.ets';
const readIndex = () => readFileSync(INDEX, 'utf-8');

/** Slice a method body out of an .ets source by its signature line. */
function method(src: string, signature: string, nextSignature: string): string {
  const a = src.indexOf(signature);
  if (a < 0) throw new Error('method not found: ' + signature);
  const b = src.indexOf(nextSignature, a);
  if (b < 0) throw new Error('next method not found: ' + nextSignature);
  return src.slice(a, b);
}

/** A matrix of the given shape, filled from a flat list of values. */
function matrix(rows: number, cols: number, values: number[]): Matrix {
  return new Matrix(Float64Array.from(values), rows, cols);
}

// ─── 1. The stratigraphic correlation sections ─────────────────────────────

describe('view model: the stratigraphic correlation still measures S1 and S2', () => {
  it('the two sections are named S1 and S2', () => {
    const s = buildStratSections(matrix(3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(s.length).toBe(2);
    expect(s[0].name).toBe('S1');
    expect(s[1].name).toBe('S2');
  });

  it('both sections take their heights from the first column', () => {
    const s = buildStratSections(matrix(3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(s[0].heights).toEqual([1, 4, 7]);
    expect(s[1].heights).toEqual([1, 4, 7]);
  });

  it('S1 measures the second column and S2 the third', () => {
    const s = buildStratSections(matrix(3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(s[0].values).toEqual([2, 5, 8]);
    expect(s[1].values).toEqual([3, 6, 9]);
  });

  it('a table with two columns measures the second column twice', () => {
    // The old rule: S2 reads column min(2, cols - 1), so with two columns it
    // reads column 1 again -- the two sections are then the same measurement.
    const s = buildStratSections(matrix(3, 2, [1, 2, 3, 4, 5, 6]));
    expect(s[0].values).toEqual([2, 4, 6]);
    expect(s[1].values).toEqual([2, 4, 6]);
  });

  it('a table with no rows turns an empty column into [0]', () => {
    // [0] and not an empty series: the correlation needs something to work
    // with, and a zero-length series is not it.
    const s = buildStratSections(matrix(0, 3, []));
    expect(s[0].values).toEqual([0]);
    expect(s[1].values).toEqual([0]);
  });

  it('a one-column table makes the first section read past the end of the row', () => {
    // The old behaviour, kept: `col(1)` on a one-column matrix walks into the
    // next row -- the first value is the SECOND row's value -- and the last
    // row reads past the end of the buffer. So the values are NOT [0]: the
    // series is out of range, not empty.
    const s = buildStratSections(matrix(2, 1, [1, 2]));
    expect(s[0].values.length).toBe(2);
    expect(s[0].values[0]).toBe(2);
    expect(s[0].values[1]).toBeUndefined();
  });

  it('no data means no sections at all', () => {
    expect(buildStratSections(null).length).toBe(0);
  });
});

// ─── 2. The groups of the phylogenetic analyses ────────────────────────────

describe('view model: the phylogenetic grouping leaves the ungrouped tips out', () => {
  it('a tip whose group is "Ungrouped" is not a group', () => {
    const groups = phyloGroupMap(['A', 'B'], (i) => (i === 0 ? 'Group_A' : 'Ungrouped'));
    expect(Object.keys(groups)).toEqual(['A']);
    expect(groups['A']).toBe('Group_A');
    expect(groups['B']).toBeUndefined();
  });

  it('a group name is trimmed before it is used', () => {
    const groups = phyloGroupMap(['A'], () => '  Group_A  ');
    expect(groups['A']).toBe('Group_A');
  });

  it('a tip with no group at all is left out', () => {
    const groups = phyloGroupMap(['A', 'B'], (i) => (i === 0 ? 'Group_A' : undefined));
    expect(Object.keys(groups)).toEqual(['A']);
  });

  it('an empty group name is left out', () => {
    const groups = phyloGroupMap(['A'], () => '   ');
    expect(Object.keys(groups).length).toBe(0);
  });

  it('two tips in the same group get the same label', () => {
    const groups = phyloGroupMap(['A', 'B'], () => 'Group_A');
    expect(groups['A']).toBe('Group_A');
    expect(groups['B']).toBe('Group_A');
  });
});

// ─── 3. The refusal of an unusable grouping ────────────────────────────────

describe('view model: a missing grouping refuses instead of analysing nothing', () => {
  it('a null grouping refuses with a message that says what to do', () => {
    let message = '';
    try {
      usableGroupCodes(null);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('No usable groups');
    expect(message).toContain('at least two different groups');
  });

  it('the refusal is an error, not an empty vector', () => {
    // The old behaviour: the null became [], and ANOSIM / PERMANOVA / SIMPER
    // / LDA analysed the empty vector and reported "no significant
    // difference" -- p = 1 for an analysis that had never been run.
    expect(() => usableGroupCodes(null)).toThrow();
    expect(() => usableGroupCodes(undefined)).toThrow();
  });

  it('a usable grouping is passed through unchanged', () => {
    expect(usableGroupCodes([0, 1, 0, 1])).toEqual([0, 1, 0, 1]);
  });
});

// ─── 4. The sample row a dialog index refers to ────────────────────────────

describe('view model: the sample row index is clamped to the loaded matrix', () => {
  it('an index past the last row becomes the last row', () => {
    expect(clampSampleIndex(99, 5)).toBe(4);
  });

  it('a negative index becomes the first row', () => {
    expect(clampSampleIndex(-3, 5)).toBe(0);
  });

  it('a fractional index is floored, not rounded', () => {
    expect(clampSampleIndex(2.9, 5)).toBe(2);
  });

  it('a value that is not a number means the first row', () => {
    expect(clampSampleIndex(NaN, 5)).toBe(0);
    expect(clampSampleIndex(undefined as unknown as number, 5)).toBe(0);
  });

  it('a table with one row can only be row 0', () => {
    expect(clampSampleIndex(3, 1)).toBe(0);
  });

  it('a table with no rows can only be row 0', () => {
    expect(clampSampleIndex(3, 0)).toBe(0);
  });
});

// ─── 5. Which workspace tab may be dropped ─────────────────────────────────

describe('view model: the eviction rule stayed in the page on purpose', () => {
  it('the page still decides which tab may be dropped', () => {
    // This rule was a candidate for the move and was NOT moved:
    // `tests/fixEts2026.test.ts` pins it as a source fact about Index.ets
    // (`w !== 'spreadsheet'` has to be between `addWidget` and `exportPlot`),
    // so moving it into a view model would have weakened a regression test
    // this change does not own. The rule is therefore still in the page --
    // and still pinned there.
    const src = readIndex();
    expect(src.includes("w !== 'spreadsheet'")).toBe(true);
    expect(src.includes('this.workspaceWidgets.shift()')).toBe(false);
  });
});

// ─── 6. What the reproducible script says ──────────────────────────────────

describe('view model: the reproducible script says what ran, in session order', () => {
  const data = { nSamples: 5, nVariables: 3, currentFile: '/tmp/x.csv' };

  it('the header names the data, the step count and the generation time', () => {
    const header = analysisScriptHeader(data, 2, '2026-10-20T00:00:00.000Z');
    expect(header[0]).toBe('// PaleoAST-Harmony reproducible analysis script');
    expect(header[1]).toBe('// Generated: 2026-10-20T00:00:00.000Z');
    expect(header[2]).toBe('// Data: 5 x 3 (/tmp/x.csv)');
    expect(header[3]).toBe('// Steps: 2');
    expect(header[4]).toBe('');
  });

  it('a session without data says so', () => {
    const header = analysisScriptHeader(null, 0, '2026-10-20T00:00:00.000Z');
    expect(header[2]).toBe('// Data: not loaded');
    expect(header[3]).toBe('// Steps: 0');
  });

  it('a file name is only mentioned when there is one', () => {
    const header = analysisScriptHeader(
      { nSamples: 2, nVariables: 1, currentFile: '' }, 0, '2026-10-20T00:00:00.000Z');
    expect(header[2]).toBe('// Data: 2 x 1');
  });

  it('the steps are numbered from one and keep the session order', () => {
    const steps = analysisStepJson([
      { analysis: 'PCA', params: { nComponents: 3 }, at: 't1' },
      { analysis: 'NMDS', params: {}, at: 't2' },
    ]);
    expect(steps.length).toBe(2);
    expect(steps[0]).toContain('"step": 1');
    expect(steps[0]).toContain('"analysis": "PCA"');
    expect(steps[1]).toContain('"step": 2');
    expect(steps[1]).toContain('"analysis": "NMDS"');
  });

  it('a step carries the parameters the analysis ran with', () => {
    const steps = analysisStepJson([{ analysis: 'PCA', params: { nComponents: 3 }, at: 't1' }]);
    expect(steps[0]).toContain('"nComponents": 3');
  });

  it('a session that ran nothing has no steps', () => {
    expect(analysisStepJson([]).length).toBe(0);
  });
});

// ─── 7. The page delegates instead of repeating ─────────────────────────────

describe('view model: the page delegates to the view models', () => {
  it('the stratigraphic sections come from the view model', () => {
    const src = readIndex();
    expect(src.includes("import { buildStratSections } from '../viewmodels/stratSections';")).toBe(true);
    expect(src.includes('return buildStratSections(dm ? dm.data : null);')).toBe(true);
    // The inline copy of the rule is gone.
    expect(src.includes('const safe = (colIdx: number): number[] =>')).toBe(false);
  });

  it('the phylogenetic groups come from the view model', () => {
    const src = readIndex();
    expect(src.includes("from '../viewmodels/specimenGroups';")).toBe(true);
    expect(src.includes('phyloGroupMap(labels, (i: number) => dm.rowMeta.getGroup(i))')).toBe(true);
  });

  it('the sample index is clamped by the view model', () => {
    const src = readIndex();
    expect(src.includes('return clampSampleIndex(raw, nRows);')).toBe(true);
  });

  it('the dialog key is still read in the page', () => {
    // The key has to stay in Index.ets: `tests/ets2026.test.ts` (a dialog
    // parameter the page never reads) and `test/device/run.mjs` (the wiring
    // gate) both look for it HERE, not in a view model.
    const src = readIndex();
    expect(src.includes("params['sample_index']")).toBe(true);
  });

  it('the group refusal comes from the view model', () => {
    const src = readIndex();
    expect(src.includes('return usableGroupCodes(this.stateMgr.dataMatrix?.getGroups());')).toBe(true);
  });

  it('the script header and steps come from the view model', () => {
    const src = readIndex();
    expect(src.includes('analysisScriptHeader(info, this.analysisHistory.length')).toBe(true);
    expect(src.includes('analysisStepJson(this.analysisHistory)')).toBe(true);
  });

  it('the joining of the script parts stays in the page', () => {
    // `tests/etsSyntax.test.ts` pins the separator there: a raw newline
    // inside a string literal once made the whole page uncompilable.
    const src = readIndex();
    expect(src.includes("header.join('\\n')")).toBe(true);
    expect(src.includes("steps.join(',\\n')")).toBe(true);
  });

  it('the view models are plain modules without an ArkUI import', () => {
    // Only the import statements are inspected: the doc comments talk about
    // ArkUI on purpose.
    const dir = 'entry/src/main/ets/viewmodels/';
    const offenders: string[] = [];
    for (const f of ['stratSections.ts', 'specimenGroups.ts', 'dialogParams.ts',
      'analysisScript.ts']) {
      for (const line of readFileSync(dir + f, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t.startsWith('import ')) continue;
        if (t.includes('@kit.') || t.includes('@ohos.') || t.includes('ArkUI')) {
          offenders.push(f + ': ' + t);
        }
      }
    }
    expect(offenders.join(' | ')).toBe('');
  });
});

// ─── 8. The theme switch of the floating toolbar ───────────────────────────

describe('fix: the floating toolbar theme switch changed the app but not the platform', () => {
  it('the theme action tells the platform which colour mode to use', () => {
    const body = method(readIndex(), 'private handleAction(', 'private addWidget(');
    // Without this the Canvas and the SVG export change colour (they read the
    // token table directly) while every `$r('app.color.x')` in the page stays
    // light: half the application changed theme and half did not.
    expect(body.includes('applyColorMode(ctx, this.darkMode)')).toBe(true);
    expect(body.includes('getHostContext() as common.UIAbilityContext')).toBe(true);
  });

  it('the theme action uses the shared dark-mode key', () => {
    const body = method(readIndex(), 'private handleAction(', 'private addWidget(');
    expect(body.includes('AppStorage.setOrCreate(DARK_MODE_KEY, this.darkMode)')).toBe(true);
    expect(body.includes("AppStorage.setOrCreate('darkMode'")).toBe(false);
  });

  it('the platform call comes from the shared theme controller', () => {
    const src = readIndex();
    expect(src.includes("import { applyColorMode, DARK_MODE_KEY } from '../theme/ThemeController';")).toBe(true);
  });
});
