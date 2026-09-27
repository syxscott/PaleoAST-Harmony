/**
 * Regression tests for the quick-analysis dispatch in Index.ets
 * (2026-09-27, sixth pass).
 *
 * Two defects lived in handleAnalysis() / runQuickAnalysisCore():
 *
 *  1. `requireGroups()` was hoisted to the top of runQuickAnalysisCore(), so it
 *     ran before the switch. Every quick analysis therefore demanded a grouping
 *     factor, including the ~40 that never use one: Summary, Normality,
 *     Spectral, Markov, Wavelet and the rest failed with "No usable groups"
 *     whenever the loaded data happened to be ungrouped. Only LDA, ANOSIM,
 *     PERMANOVA and SIMPER actually consume groups.
 *
 *  2. The eighteen "this analysis needs <input>" cases ended in `break;`, so
 *     control fell through to
 *         this.statusText = name + ' completed';
 *         this.addWidget(name);
 *     which overwrote the explanation with a success message and opened a
 *     workspace tab for a run that never happened (runQuickAnalysisCore has
 *     `default: return null` for all of them).
 *
 * The ArkUI layer cannot execute in the Node harness, so these are static
 * facts about the .ets source, in the same style as ets2026.test.ts.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';

const INDEX = 'entry/src/main/ets/pages/Index.ets';
const read = () => readFileSync(INDEX, 'utf-8');

/** Slice a single method body out of Index.ets by its signature line. */
function method(src: string, signature: string, nextSignature: string): string {
  const a = src.indexOf(signature);
  if (a < 0) throw new Error('method not found: ' + signature);
  const b = src.indexOf(nextSignature, a);
  if (b < 0) throw new Error('next method not found: ' + nextSignature);
  return src.slice(a, b);
}

describe('audit: ungrouped data blocked every quick analysis, not just the group-based ones', () => {
  it('requireGroups is no longer hoisted above the dispatch switch', () => {
    const src = read();
    const body = method(
      src,
      'private runQuickAnalysisCore(name: string): any {',
      'private recordAnalysis(',
    );
    // It used to sit on its own line right after `const data = ...`, ahead of
    // the switch, so it executed for every name.
    expect(body.includes('\n    const groups = this.requireGroups();')).toBe(false);
    // The declaration and the inline per-case calls are the intended shape.
    expect(body.includes('requireGroups')).toBe(true);
  });

  it('exactly the four group-based cases read groups, and they read them inline', () => {
    const src = read();
    const body = method(
      src,
      'private runQuickAnalysisCore(name: string): any {',
      'private recordAnalysis(',
    );
    const users = [...body.matchAll(/case '([^']+)': return this\.statCtrl\.\w+\(this\.requireGroups\(\)\);/g)]
      .map(m => m[1])
      .sort();
    // Before: `runLDA(groups)`, `runANOSIM(groups)`, `runPERMANOVA(groups)`,
    // `runSIMPER(groups)` reading a local that every other case also triggered.
    expect(users.join(',')).toBe('ANOSIM,LDA,PERMANOVA,SIMPER');
  });

  it('the dialog path kept its per-case requireGroups calls', () => {
    // runDialogAnalysisCore already called it inline and was never affected.
    const src = read();
    const body = method(
      src,
      'private runDialogAnalysisCore(name: string, params: Record<string, Object>): any {',
      'private requireGroups(',
    );
    expect((body.match(/this\.requireGroups\(\)/g) || []).length).toBe(4);
  });
});

describe('audit: analyses that cannot run were reported as "completed"', () => {
  it('every "needs <input>" case returns instead of falling through', () => {
    const src = read();
    const body = method(
      src,
      'private async handleAnalysis(name: string): Promise<void> {',
      'private handleAction(',
    );
    const lines = body.split('\n');
    const offenders: string[] = [];
    let seen = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!/case '[^']+':\s*$|case '[^']+':\s*this\.statusText/.test(lines[i])) continue;
      if (!/this\.statusText = '.*(needs|required)/.test(lines[i]) &&
          !(lines[i + 1] || '').includes("needs") &&
          !/required/.test(lines[i + 1] || '')) continue;
      seen++;
      // The next non-empty line must be a return, never a break.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const next = (lines[j] || '').trim();
      if (next === 'break;' || next.startsWith('break;')) offenders.push(lines[i].trim());
    }
    expect(seen).toBe(18);
    expect(offenders.join(' | ')).toBe('');
  });

  it('isLoading is reset in a finally, so an early return cannot strand it', () => {
    // `return` inside `try` skips any statement after the try/catch, and
    // DialogManager.open() cases in the same switch already return.
    const src = read();
    const body = method(
      src,
      'private async handleAnalysis(name: string): Promise<void> {',
      'private handleAction(',
    );
    expect(body.includes('} finally {')).toBe(true);
    const after = body.slice(body.indexOf('} finally {'));
    expect(after.includes('this.isLoading = false;')).toBe(true);
  });

  it('only a run that produced a result is recorded in the reproducible script', () => {
    // recordAnalysis() used to sit above the try, so the eighteen non-runs were
    // written to the persistent history and into the exported script as if they
    // had happened -- the same "this run does not exist" failure the data
    // fingerprint fix addressed from the other direction.
    const src = read();
    const body = method(
      src,
      'private async handleAnalysis(name: string): Promise<void> {',
      'private handleAction(',
    );
    const rec = body.indexOf('this.recordAnalysis(');
    const run = body.indexOf('this.runQuickAnalysisCore(');
    const done = body.indexOf("this.statusText = name + ' completed'");
    expect(rec > 0).toBe(true);
    expect(run > 0).toBe(true);
    // recorded after the computation, and only on the success path
    expect(rec > run).toBe(true);
    expect(rec < done).toBe(true);
  });
});
