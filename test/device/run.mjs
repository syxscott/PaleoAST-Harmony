#!/usr/bin/env node
/**
 * Device E2E driver for PaleoAST-Harmony.
 *
 * Two modes:
 *
 *   node test/device/run.mjs                 # static wiring check (no device)
 *   node test/device/run.mjs --device <udid> # additionally drive a real device
 *
 * The default mode exists because the failure that actually bit us was not a
 * wrong number — it was UI wiring: a dialog dispatching under the wrong name, or
 * collecting a parameter key that the dispatch switch never reads. Neither shows
 * up in the unit tests (they call the controller directly and never touch
 * ets/pages/Index.ets), and both are invisible to a type checker. So the default
 * mode parses the production dispatch switch and verifies, for every declared
 * case, that
 *
 *   1. the analysis name has a `case` in runDialogAnalysisCore();
 *   2. every parameter key in the case is actually READ inside that case block.
 *
 * With --device it additionally verifies that hdc sees the device and that the
 * app can be launched, which is the part that genuinely needs hardware.
 *
 * Usage:
 *   node test/device/run.mjs [--cases <dir>] [--json] [--device <udid>] [--hdc <path>]
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const INDEX_ETS = join(REPO, 'entry/src/main/ets/pages/Index.ets');
const NAV_TREE = join(REPO, 'entry/src/main/ets/components/NavigationTree.ets');

// ─── args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { cases: join(HERE, 'cases'), json: false, device: null, hdc: 'hdc' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cases') out.cases = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--device') out.device = argv[++i];
    else if (a === '--hdc') out.hdc = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    }
  }
  return out;
}

// ─── source parsing ──────────────────────────────────────────────────────────

/**
 * Extract `case '<name>': ...` bodies from runDialogAnalysisCore().
 * Returns a Map<analysisName, bodyText>.
 */
function extractDispatchCases(source) {
  const start = source.indexOf('private runDialogAnalysisCore');
  if (start < 0) {
    throw new Error('runDialogAnalysisCore() not found in Index.ets — has it been renamed?');
  }
  const end = source.indexOf('\n      default:', start);
  const body = source.slice(start, end < 0 ? source.length : end);

  const re = /case '([^']+)':/g;
  const marks = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    marks.push({ name: m[1], at: m.index + m[0].length });
  }
  const map = new Map();
  for (let i = 0; i < marks.length; i++) {
    const to = i + 1 < marks.length ? marks[i + 1].at : body.length;
    // An empty case (fall-through) contributes nothing; keep the first body seen
    // for a name so a duplicate `case` cannot silently shadow the real one.
    const chunk = body.slice(marks[i].at, to);
    if (!map.has(marks[i].name) || chunk.trim().length > map.get(marks[i].name).trim().length) {
      map.set(marks[i].name, chunk);
    }
  }
  return map;
}

/** Analysis names listed in the navigation tree (the user-facing labels). */
function extractNavEntries(source) {
  const names = new Set();
  for (const m of source.matchAll(/'([A-Z][A-Za-z0-9 \-&]*[A-Za-z0-9])'/g)) {
    names.add(m[1]);
  }
  return names;
}

/**
 * Analysis ids that some DialogManager.open() call can reach.
 *
 * The navigation labels are not the analysis ids — `handleAnalysis()` maps
 * 'Null Models' -> 'NullModel' and 'Extinction CI' -> 'Extinction'. So
 * reachability is: listed in the tree (possibly under another label) OR the
 * target of a DialogManager.open() call.
 */
function extractDialogTargets(source) {
  const targets = new Set();
  for (const m of source.matchAll(/DialogManager\.open\('([^']+)'\)/g)) {
    targets.add(m[1]);
  }
  return targets;
}

/**
 * Param keys read by each private helper method.
 *
 * A case block may delegate to a helper — e.g. the sample row is resolved by
 * `this.sampleIndex(params)`, which is where `params['sample_index']` is actually
 * read. Without this the checker reports a false positive.
 */
function extractHelperParamKeys(source) {
  const byHelper = new Map();
  const decl = /^  private (\w+)\([^)]*\)[^{]*\{/gm;
  const marks = [];
  let m;
  while ((m = decl.exec(source)) !== null) {
    marks.push({ name: m[1], bodyStart: m.index + m[0].length });
  }
  for (let i = 0; i < marks.length; i++) {
    // Body runs to the next 2-space `}` (end of method) or the next declaration.
    const from = marks[i].bodyStart;
    const nextDecl = i + 1 < marks.length ? marks[i + 1].bodyStart : source.length;
    const tail = source.slice(from, nextDecl);
    const stop = tail.search(/\n  \}/);
    const body = stop >= 0 ? tail.slice(0, stop) : tail;
    const keys = new Set();
    for (const km of body.matchAll(/params\['([^']+)'\]/g)) {
      keys.add(km[1]);
    }
    if (keys.size > 0) {
      byHelper.set(marks[i].name, keys);
    }
  }
  return byHelper;
}

// ─── checks ──────────────────────────────────────────────────────────────────

function runStaticChecks(casesDir) {
  const indexSrc = readFileSync(INDEX_ETS, 'utf8');
  const dispatch = extractDispatchCases(indexSrc);
  const nav = extractNavEntries(readFileSync(NAV_TREE, 'utf8'));
  const dialogTargets = extractDialogTargets(indexSrc);
  const helperKeys = extractHelperParamKeys(indexSrc);

  // Reverse check: a dialog that opens into nothing is a dead control.
  // Import/Export are UI flows, not analyses, so they never reach the dispatcher.
  const NON_ANALYSIS_DIALOGS = new Set(['Import', 'Export']);
  const orphanDialogs = [...dialogTargets]
    .filter((t) => !dispatch.has(t) && !NON_ANALYSIS_DIALOGS.has(t));

  const files = readdirSync(casesDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(`no case files found in ${casesDir}`);
  }

  const results = [];
  let caseCount = 0;

  for (const file of files) {
    const suite = JSON.parse(readFileSync(join(casesDir, file), 'utf8'));
    if (!Array.isArray(suite.cases)) {
      results.push({ file, case: '-', ok: false, problems: ['suite has no "cases" array'] });
      continue;
    }
    for (const c of suite.cases) {
      caseCount++;
      const problems = [];
      const params = c.params ?? {};

      if (typeof c.analysis !== 'string' || c.analysis.length === 0) {
        problems.push('missing "analysis"');
      }
      if (typeof params !== 'object' || Array.isArray(params)) {
        problems.push('"params" must be an object');
      }

      if (problems.length === 0) {
        const block = dispatch.get(c.analysis);
        if (block === undefined) {
          problems.push(`no \`case '${c.analysis}':\` in runDialogAnalysisCore — the analysis is unreachable from the UI`);
        } else {
          // Keys read directly, plus keys read by any helper the block calls.
          let readable = block;
          for (const hm of block.matchAll(/this\.(\w+)\(/g)) {
            const keys = helperKeys.get(hm[1]);
            if (keys) {
              for (const k of keys) readable += ` params['${k}']`;
            }
          }
          for (const key of Object.keys(params)) {
            if (!readable.includes(`params['${key}']`)) {
              problems.push(`param "${key}" is never read in the '${c.analysis}' case — the dialog value would be silently discarded`);
            }
          }
        }
        if (!nav.has(c.analysis) && !dialogTargets.has(c.analysis)) {
          problems.push(`"${c.analysis}" is neither a NavigationTree entry nor a DialogManager.open() target — no way to reach it`);
        }
      }

      results.push({ file, case: c.analysis, ok: problems.length === 0, problems });
    }
  }

  return { results, caseCount, dispatchCount: dispatch.size, orphanDialogs };
}

// ─── device mode ─────────────────────────────────────────────────────────────

function hdc(args, hdcPath, device) {
  const full = device ? ['-t', device, ...args] : args;
  return execFileSync(hdcPath, full, { encoding: 'utf8', timeout: 30000 });
}

function runDeviceChecks(args) {
  const notes = [];
  try {
    const list = hdc(['list', 'targets'], args.hdc, null);
    const targets = list.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (targets.length === 0) {
      notes.push({ ok: false, text: 'hdc sees no device. Connect a device or start an emulator.' });
      return notes;
    }
    notes.push({ ok: true, text: `hdc targets: ${targets.join(', ')}` });

    const device = args.device ?? targets[0];
    if (args.device && !targets.includes(args.device)) {
      notes.push({ ok: false, text: `requested device "${args.device}" is not among ${targets.join(', ')}` });
      return notes;
    }

    // Confirm the app is installed before trying to launch it.
    const bundle = 'com.paleoast.harmony';
    try {
      const installed = hdc(['shell', 'bm', 'dump', '-a'], args.hdc, device);
      notes.push({
        ok: installed.includes(bundle),
        text: installed.includes(bundle)
          ? `bundle ${bundle} is installed`
          : `bundle ${bundle} not found via \`bm dump -a\` — install the HAP with \`hdc install <path.hap>\``,
      });
    } catch (e) {
      notes.push({ ok: false, text: `bm dump failed: ${e.message}` });
    }

    try {
      hdc(['shell', 'aa', 'start', '-a', 'EntryAbility', '-b', bundle], args.hdc, device);
      notes.push({ ok: true, text: 'aa start EntryAbility issued' });
    } catch (e) {
      notes.push({ ok: false, text: `aa start failed: ${e.message}` });
    }

    notes.push({
      ok: true,
      text: 'Device reachable. Case execution itself needs UI automation (hdc uitest) — ' +
            'wire the per-case assertions against a UI dump before claiming E2E coverage.',
    });
  } catch (e) {
    notes.push({ ok: false, text: `hdc unavailable (${e.message}). Static checks still ran.` });
  }
  return notes;
}

// ─── main ────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  let staticResult;
  try {
    staticResult = runStaticChecks(args.cases);
  } catch (e) {
    console.error(`FAILED to run static checks: ${e.message}`);
    process.exit(1);
  }

  const failures = staticResult.results.filter((r) => !r.ok);
  const deviceNotes = args.device !== null || process.env.PALEOAST_CHECK_DEVICE === '1'
    ? runDeviceChecks(args)
    : [];

  if (args.json) {
    console.log(JSON.stringify({
      mode: 'static',
      cases: staticResult.caseCount,
      dispatchCases: staticResult.dispatchCount,
      failures,
      device: deviceNotes,
    }, null, 2));
    process.exit(failures.length > 0 ? 1 : 0);
  }

  console.log(`Parsed ${staticResult.dispatchCount} dispatch cases from Index.ets`);
  console.log(`Checking ${staticResult.caseCount} declared case(s)...\n`);

  if (staticResult.orphanDialogs.length > 0) {
    console.log('  WARN DialogManager.open() targets with no dispatch case:');
    for (const t of staticResult.orphanDialogs) {
      console.log(`       - '${t}' opens a dialog that runDialogAnalysisCore does not handle`);
    }
    console.log('');
  }

  for (const r of staticResult.results) {
    if (r.ok) {
      console.log(`  PASS ${r.case}`);
    } else {
      console.log(`  FAIL ${r.case}`);
      for (const p of r.problems) {
        console.log(`       - ${p}`);
      }
    }
  }

  if (deviceNotes.length > 0) {
    console.log('\nDevice checks:');
    for (const n of deviceNotes) {
      console.log(`  ${n.ok ? 'OK  ' : 'WARN'} ${n.text}`);
    }
  }

  console.log(
    `\n${staticResult.caseCount - failures.length} passed, ${failures.length} failed, ` +
    `${staticResult.caseCount} total (static wiring)`,
  );
  if (deviceNotes.length === 0) {
    console.log('Run with --device <udid> to also probe real hardware.');
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

main();
