/**
 * Regression test for the compile-breaking string literal in Index.ets
 * (2026-09-27, sixth pass).
 *
 * `buildAnalysisScript()` was written with RAW newlines inside single-quoted
 * string literals:
 *
 *     return header.join('
 * ') + '
 * ' + (steps.length > 0 ? steps.join(',
 * ') : '[]');
 *
 * A quoted string may not span a line terminator in TypeScript or ArkTS, so the
 * diagnostic is TS1002 "Unterminated string literal" and the entire main page
 * failed to compile. Nothing in the existing gates could see it: the unit tests
 * only import `core/**`, the wiring check greps for identifier names, and
 * structure_check.py counts brackets -- and a stray quote keeps brackets
 * balanced.
 *
 * The lexer behind this test is checked against fixtures first, because a guard
 * that cannot tell a real defect from a regex literal is worse than no guard.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findUnterminatedStringLiterals } from './stringLexer.ts';

const ROOT = 'D:/GIthub/PaleoAST-Harmony/';
const SCAN_DIRS = ['entry/src/main', 'tests', 'test', 'tools'];

function collectSources(dir: string, out: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (['node_modules', 'oh_modules', 'build', '.hvigor'].indexOf(name) >= 0) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) collectSources(p, out);
    else if (/\.(ets|ts|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

describe('audit: a string literal spanning a line break made Index.ets uncompilable', () => {
  it('the lexer recognises an unterminated literal and ignores legal ones', () => {
    // The guard is only worth having if it can tell the two apart, so the
    // ambiguous shapes are pinned first: regex literals full of quote
    // characters, apostrophes in comments, and multi-line template literals.
    const bad = [
      ["const a = 'x\n", 1, 'newline then end of file'],
      // One malformed literal cascades: the lexer re-enters string state at the
      // next quote. The TypeScript parser likewise emitted TS1002 twice here.
      ["const a = 'x\ny';\n", 2, 'newline mid-literal'],
      ['const a = "x\n', 1, 'double quotes'],
    ];
    for (const [src, want, why] of bad) {
      expect(findUnterminatedStringLiterals(src).length + ' <- ' + why)
        .toBe(want + ' <- ' + why);
    }

    const good = [
      ["const a = 'ok';", 'normal string'],
      ["const a = 'it\\'s'; // don't\n", 'escaped quote, apostrophe in a line comment'],
      ['// don\'t panic\n', 'apostrophe in a line comment'],
      ["/* it's fine */\n", 'apostrophe in a block comment'],
      ['const a = `line1\nline2`;', 'multi-line template literal is legal'],
      ['t.replace(/[\'"]:\\/g, \'x\');', 'regex literal containing both quote characters'],
      ['const a = b / c / d;', 'division, not a regex'],
      ['if (x) { }\nconst a = /re/.test(s);', 'regex after a block'],
      ['const a = 4 / 2;', 'numeric division'],
      ['const a = 1 / 2 / 3;', 'repeated division'],
    ];
    for (const [src, why] of good) {
      expect(findUnterminatedStringLiterals(src).length + ' <- ' + why).toBe('0 <- ' + why);
    }
  });

  it('no source file in the repository contains an unterminated string literal', () => {
    // Cross-checked against the TypeScript parser (ts 5.7, createSourceFile
    // with parseDiagnostics, filtered to TS1002/TS1160/TS1380/TS1381): both
    // independently report zero across all 194 files. The parser cannot be used
    // in the harness itself because it rejects ArkUI's `@Component struct`
    // syntax, which is why the lexer exists.
    const files: string[] = [];
    for (const d of SCAN_DIRS) collectSources(ROOT + d, files);
    files.sort();

    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf-8');
      for (const h of findUnterminatedStringLiterals(src)) {
        offenders.push(
          f.slice(ROOT.length) + ':' + h.line + ' unterminated ' + h.quote +
          ' :: ' + JSON.stringify(src.slice(h.offset, h.offset + 60))
        );
      }
    }
    expect(offenders.join(' | ')).toBe('');
  });

  it('buildAnalysisScript joins its parts with escaped newlines', () => {
    const index = readFileSync(ROOT + 'entry/src/main/ets/pages/Index.ets', 'utf-8');
    // Before: `header.join('` + raw LF + `')`. Now the separator is a
    // two-character escape, which is what a reader of the source expects.
    expect(index.includes("header.join('\\n')")).toBe(true);
    expect(index.includes("steps.join(',\\n')")).toBe(true);
  });

  it('the two branches of the step join produce the same document shape', () => {
    // The empty branch emitted "[]" while the non-empty branch emitted the
    // *body* of an array with no delimiters, so a session that had run nothing
    // and a session that had run one thing produced structurally different
    // documents. Each step comes from JSON.stringify(..., null, 2), i.e. the
    // output was always meant to be an array.
    const index = readFileSync(ROOT + 'entry/src/main/ets/pages/Index.ets', 'utf-8');
    expect(index.includes("'[' + steps.join(',\\n') + ']' : '[]'")).toBe(true);
  });
});
