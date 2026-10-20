/**
 * Regression test: a relative import one directory too shallow made
 * Splash.ets point at a directory that does not exist.
 *
 * `entry/src/main/ets/pages/Splash.ets` imported the startup loader with
 *
 *     import { createPaleoastStartupLoader } from '../core/app_infrastructure/StartupLoader';
 *
 * The loader lives in `entry/src/main/core/app_infrastructure/`, and the
 * importer sits two directories below `entry/src/main/` (main/ets/pages/), so
 * the path has to climb two levels: '../../core/...'. With one level the
 * import pointed at `entry/src/main/ets/core/app_infrastructure/`, which is
 * not a directory in this project -- ArkTS would refuse to compile the file
 * and the app would have no splash screen at all.
 *
 * Why no gate saw it: the unit tests import `core/**` only, the device
 * wiring check greps for identifier names, and structure_check.py counts
 * brackets. A relative path that points at nothing is invisible to all three,
 * and the .ets layer is not part of the Node import smoke test because it
 * uses the ArkUI DSL. This file closes that hole: every relative import
 * under `entry/src/main` -- the .ets layer included -- is resolved against
 * the file system.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSources as collectSourcesShared, stripComments } from './sourceScan.ts';

/**
 * The repository root, derived from this file's own location -- never the
 * absolute path of the machine the test was written on, which is what made
 * the suite unrunnable on the CI runner.
 */
const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\\/g, '/');
const MAIN = ROOT + 'entry/src/main';

/** The module suffixes ArkTS/TypeScript resolution may land on. */
const MODULE_EXTS = ['.ts', '.tsx', '.ets', '.d.ts', '.js'];

/**
 * The relative module specifiers of one source file. Package imports
 * ('@kit.ArkUI', '@ohos.router', ...) are not relative and are not our
 * business here.
 */
export function relativeSpecifiers(src: string): string[] {
  const code = stripComments(src);
  const specs: string[] = [];
  const re = /(?:^|[\s;{}()])import\s+(?:type\s+)?(?:[^'"();]*?\s+from\s+)?['"](\.[^'"]*)['"]/g;
  const reExport = /(?:^|[\s;{}()])export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"](\.[^'"]*)['"]/g;
  const reDynamic = /\bimport\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g;
  for (const r of [re, reExport, reDynamic]) {
    r.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.exec(code)) !== null) specs.push(m[1]);
  }
  return specs;
}

/**
 * Resolve one relative specifier the way the ArkTS compiler would: the
 * literal path, the literal path plus a module suffix, or a directory
 * barrel. Returns the resolved file, or null when nothing is there.
 */
export function resolveRelativeImport(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of MODULE_EXTS) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of MODULE_EXTS) {
    const idx = join(base, 'index' + ext);
    if (existsSync(idx)) return idx;
  }
  return null;
}

function collectSources(dir: string, out: string[] = []): string[] {
  // .ets and .ts: the layer under entry/src/main is ArkTS plus the shared
  // TypeScript it imports.
  return collectSourcesShared(dir, out, ['.ets', '.ts']);
}

describe('audit: a relative import one level too shallow made Splash.ets uncompilable', () => {
  it('the resolver tells a broken relative import from the legal shapes', () => {
    // A gate that cannot tell a real defect from a legal import is worse
    // than no gate, so the shapes it has to survive are pinned first: a
    // barrel directory, a plain file, and the shallow path that used to
    // break the build.
    const splash = MAIN + '/ets/pages/Splash.ets';

    expect(resolveRelativeImport(splash, '../../core/app_infrastructure/StartupLoader') === null).toBe(false);
    expect(resolveRelativeImport(splash, '../core/app_infrastructure/StartupLoader') === null).toBe(true);

    // A barrel: '../../core/models/index' -> core/models/index.ts
    expect(resolveRelativeImport(splash, '../../core/models/index') === null).toBe(false);
    // A plain module: '../../core/parsers/CSVParser' -> core/parsers/CSVParser.ts
    expect(resolveRelativeImport(splash, '../../core/parsers/CSVParser') === null).toBe(false);
    // A sibling in the same directory: './rowGroups' -> components/rowGroups.ts
    expect(resolveRelativeImport(MAIN + '/ets/components/Spreadsheet.ets', './rowGroups') === null).toBe(false);
    // A sub-directory of the same directory: './plot/boxGeometry'
    expect(resolveRelativeImport(MAIN + '/ets/components/PlotCanvas.ets', './plot/boxGeometry') === null).toBe(false);
    // And the sibling of a sibling, one level up and back down:
    // '../components/plot/plotSeries' from pages/Index.ets
    expect(resolveRelativeImport(splash, '../components/plot/plotSeries') === null).toBe(false);
  });

  it('the scanner ignores imports inside comments and strings', () => {
    const src = [
      "import { A } from './a';",
      "// import { B } from './missing-in-a-comment';",
      "/* import { C } from './missing-in-a-block-comment'; */",
      "const s = \"import { D } from './missing-in-a-string'\";",
    ].join('\n');
    const specs = relativeSpecifiers(src);
    expect(specs.length).toBe(1);
    expect(specs[0]).toBe('./a');
  });

  it('Splash.ets no longer imports the startup loader from a directory that does not exist', () => {
    const splash = MAIN + '/ets/pages/Splash.ets';
    const src = readFileSync(splash, 'utf-8');
    const specs = relativeSpecifiers(src);
    expect(specs.indexOf('../core/app_infrastructure/StartupLoader') >= 0).toBe(false);
    expect(specs.indexOf('../../core/app_infrastructure/StartupLoader') >= 0).toBe(true);
    // And the path it now uses really does land on the loader.
    expect(resolveRelativeImport(splash, '../../core/app_infrastructure/StartupLoader') === null).toBe(false);
  });

  it('no relative import under entry/src/main points at a file that does not exist', () => {
    const files = collectSources(MAIN);
    files.sort();
    const broken: string[] = [];
    let checked = 0;
    for (const f of files) {
      for (const spec of relativeSpecifiers(readFileSync(f, 'utf-8'))) {
        checked++;
        if (resolveRelativeImport(f, spec) === null) {
          broken.push(f.slice(ROOT.length) + ' -> ' + spec);
        }
      }
    }
    // The scan must actually be looking at something, or it proves nothing.
    expect(checked > 200).toBe(true);
    expect(broken.join(' | ')).toBe('');
  });
});
