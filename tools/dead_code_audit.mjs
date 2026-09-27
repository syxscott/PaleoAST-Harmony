#!/usr/bin/env node
// Dead-export audit, transparent through barrel files.
//
//   node tools/dead_code_audit.mjs [--list]
//
// "Defined, covered by tests, and all gates green" does not mean reachable. A
// declared export is dead when no production file *uses* it. The subtlety this
// script exists for: a re-export in an index.ts is not a use. `reporting/index.ts`
// re-exports TableGenerator / FigureHandler / MatrixConverter and Index.ets
// imports the barrel, so a naive "does any other file mention the name" check
// calls all three referenced. In fact exportReport() deliberately avoids
// TableGenerator -- it emits a whole table environment, which nests badly
// inside addTable's fragment -- and never mentions the other two, so they are
// reachable only from tests.
//
// This reports candidates, not verdicts. Before deleting anything, confirm the
// symbol is not reached dynamically (router tables, plugin registries, string
// keys) -- this script cannot see those.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = ['entry/src/main', 'tests', 'test', 'tools'];

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name).replace(/\\/g, '/');
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ets|ts|mjs|js)$/.test(name)) out.push(p);
  }
}

const files = [];
for (const d of SRC) walk(ROOT + d, files);
files.sort();

const rel = (f) => f.slice(ROOT.length);
const isTest = (f) => /(^|\/)(tests?|ohosTest|tools)\//.test(f);
// Reached by the router (main_pages.json), the ability, or by being written
// into an ArkUI build() tree rather than by name.
const isEntry = (f) =>
  /entry\/src\/main\/ets\/entryability\//.test(f) ||
  /entry\/src\/main\/ets\/pages\//.test(f) ||
  /entry\/src\/main\/ets\/components\//.test(f);

const DECL = /export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g;

const decls = [];
for (const f of files) {
  const t = readFileSync(f, 'utf-8');
  for (const m of t.matchAll(DECL)) decls.push({ name: m[2], file: f, kind: m[1] });
  for (const m of t.matchAll(/export\s+default\s+(?:class|function|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g)) {
    decls.push({ name: m[1], file: f, kind: 'default-class' });
  }
}

// Identifier occurrences per file, with re-export lists blanked out.
const uses = new Map();
for (const f of files) {
  const t = readFileSync(f, 'utf-8').replace(/export\s*\{[\s\S]*?\}/g, (m) => ' '.repeat(m.length));
  uses.set(f, new Set([...t.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0])));
}

const dead = [];
const testOnly = [];
for (const d of decls) {
  if (isEntry(d.file)) continue;
  let prod = 0, tst = 0;
  for (const [f, set] of uses) {
    if (f === d.file || !set.has(d.name)) continue;
    if (isTest(f)) tst++; else prod++;
  }
  if (prod === 0) (tst > 0 ? testOnly : dead).push({ ...d, tests: tst });
}

const byFile = (list) => {
  const m = new Map();
  for (const d of list) {
    if (!m.has(d.file)) m.set(d.file, []);
    m.get(d.file).push(d.name);
  }
  return [...m].sort();
};

const show = (title, list) => {
  console.log(`\n=== ${title}: ${list.length} ===`);
  for (const [f, names] of byFile(list)) {
    console.log(`  ${rel(f).padEnd(58)} ${String(names.length).padStart(3)} symbol(s)`);
    if (process.argv.includes('--list')) for (const n of names) console.log(`        ${n}`);
  }
};

console.log(`scanned ${files.length} files, ${decls.length} value exports declared`);
show('never used in production (a barrel re-export does not count)', dead);
show('used only by tests', testOnly);
console.log('\nCandidates only. Confirm nothing reaches them dynamically (router');
console.log('tables, plugin registries, string keys) before deleting.');
