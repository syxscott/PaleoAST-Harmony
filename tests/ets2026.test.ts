/**
 * Regression tests for the defects found while reviewing the ArkUI layer
 * (2026-09-27, fifth pass).
 *
 * The ArkUI files cannot be executed in the Node harness, so these cover the
 * core-side contract the UI depends on, plus the static facts about the .ets
 * wiring that are checkable by inspection.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { toCSV, parseCSV } from '../entry/src/main/core/parsers/CSVParser.ts';
import { DataController } from '../entry/src/main/core/controllers/DataController.ts';
import { DataMatrix, StateManager } from '../entry/src/main/core/models/index.ts';

const ETS = 'entry/src/main/ets/';
const read = (p: string) => readFileSync(ETS + p, 'utf-8');

const DM = new DataMatrix(
  Matrix.from2D([[1, 2, 3], [4, 5, 6]]),
  ['Site A, north', 'SiteB'],
  ['Len', "Wid'th", 'Mass'],
);

describe('audit: the export dialog\'s "Include labels" checkbox did nothing', () => {
  it('toCSV omits the header row and the label column when asked', () => {
    // ExportDialog published includeLabels; Index.ets never read it and toCSV
    // had no such parameter, so unticking the box changed nothing about the
    // file on disk.
    expect(toCSV(DM).split('\n').length).toBe(3);          // header + 2 rows
    expect(toCSV(DM, ',', false).split('\n').length).toBe(2); // 2 rows only
    expect(toCSV(DM, ',', false).startsWith('1,2,3')).toBe(true);
  });

  it('the default is byte-identical to the old behaviour', () => {
    // The label column is empty on the header row; `Wid'th` contains an
    // apostrophe but no delimiter / quote / newline, so RFC 4180 §2.6 does not
    // call for quoting it, while `Site A, north` (contains the delimiter) is
    // quoted. Unchanged from before the includeLabels parameter existed.
    expect(toCSV(DM)).toBe(",Len,Wid'th,Mass\n\"Site A, north\",1,2,3\nSiteB,4,5,6");
  });

  it('a label-free export re-imports with hasHeader=false, hasRowLabels=false', () => {
    const back = parseCSV(toCSV(DM, ',', false), ',', false, false);
    expect(back.nSamples).toBe(2);
    expect(back.nVariables).toBe(3);
    expect(back.data.get(0, 0)).toBe(1);
    expect(back.data.get(1, 2)).toBe(6);
  });

  it('a labelled export re-imports with its labels intact', () => {
    const back = parseCSV(toCSV(DM), ',', true, true);
    expect(back.rowLabels).toEqual(['Site A, north', 'SiteB']);
    expect(back.colLabels).toEqual(['Len', "Wid'th", 'Mass']);
  });

  it('DataController.exportCSV forwards the flag', () => {
    const dc = new DataController();
    StateManager.getInstance().setData(DM);
    expect(dc.exportCSV().split('\n').length).toBe(3);
    expect(dc.exportCSV(',', false).split('\n').length).toBe(2);
  });
});

describe('audit: the UI presented identity maps as real analyses', () => {
  const index = read('pages/Index.ets');

  it('"TPS Grid" no longer feeds the loaded matrix in as both source and target', () => {
    // A thin-plate spline with source == target is the identity map: all
    // non-affine weights are zero, the bending energy is exactly 0, and the
    // "deformation grid" is a picture of the input table. It now refuses.
    expect(index.includes('runTPSAnalyze(\n          this.stateMgr.dataMatrix.data.to2D(), this.stateMgr.dataMatrix.data.to2D()\n        )')).toBe(false);
    expect(index.includes('runTPSAnalyze(data.to2D(), data.to2D())')).toBe(false);
    expect(index.includes('TPS Grid needs a source and a target configuration')).toBe(true);
  });

  it('"CCA" no longer passes one table as both species and environment', () => {
    // A self-constrained ordination says nothing about ecology and was
    // presented under the name CCA.
    expect(index.includes('runCCA(data, data)')).toBe(false);
    expect(index.includes('CCA needs a species table and a separate environment table')).toBe(true);
  });

  it('the group-based analyses read groups through requireGroups()', () => {
    // getGroups() can return null; `?? []` used to turn that into an empty
    // group vector that each test then answered "no significant difference" on.
    expect(index.includes("getGroups() ?? []")).toBe(false);
    expect(index.includes("groups ?? []")).toBe(false);
    expect(index.includes('private requireGroups(): number[]')).toBe(true);
  });

  it('the spreadsheet group changes actually reach the DataMatrix', () => {
    // Spreadsheet keeps group names in its own @State and only publishes them
    // through onGroupChanged, whose default is a no-op. WorkspaceView rendered
    // it with no callbacks at all, so a user's grouping never reached a model.
    const wv = read('components/WorkspaceView.ets');
    expect(wv.includes('onGroupChanged')).toBe(true);
    expect(wv.includes('setGroups')).toBe(true);
  });
});

describe('audit: the collected-then-dropped parameter family', () => {
  it('no dialog publishes a parameter that Index.ets never reads', () => {
    // Checked mechanically over all 35 dialogs: the published key set minus the
    // keys Index.ets actually consumes is empty. This is the guard against the
    // family reappearing (wavelet scales, nullModel nWorkers, EFA n_points and
    // runBrokenStick's row were all instances).
    const dir = ETS + 'components/dialogs/';
    const published = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ets')) continue;
      const t = readFileSync(dir + f, 'utf-8');
      for (const m of t.matchAll(/onConfirm\(\s*\{(.*?)\}\s*\)/gs)) {
        for (const k of m[1].matchAll(/['"]?([A-Za-z_$][\w$]*)['"]?\s*:/g)) published.add(k[1]);
      }
    }
    const read_ = read('pages/Index.ets');
    const consumed = new Set<string>();
    for (const m of read_.matchAll(/params\['([^']+)'\]/g)) consumed.add(m[1]);
    // `onConfirm` is the callback's own declaration, not a params key.
    published.delete('onConfirm');
    const orphans = [...published].filter(k => !consumed.has(k)).sort();
    expect(orphans.join(',')).toBe('');
  });
});
