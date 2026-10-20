/**
 * Generate the ArkUI colour resources from the token table.
 *
 * The table lives in entry/src/main/ets/theme/tokens.ts — plain TypeScript,
 * unit-tested, and the only place a colour is written down. This script
 * turns it into the two files ArkUI actually reads:
 *
 *   entry/src/main/resources/base/element/color.json   the light theme
 *   entry/src/main/resources/dark/element/color.json    the dark theme
 *
 * ArkUI resolves `$r('app.color.x')` against base/ or dark/ depending on the
 * colour mode, so the second file is what makes the application follow the
 * system theme (and the in-app switch, via ThemeController).
 *
 * Usage:
 *   node --experimental-transform-types tools/gen_theme_resources.mjs
 *   node --experimental-transform-types tools/gen_theme_resources.mjs --check
 *
 * --check writes nothing and exits non-zero when a resource file is out of
 * date. The CI runs it, so the two can never drift from the table.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKENS } from '../entry/src/main/ets/theme/tokens.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\\/g, '/');
const RESOURCES = join(ROOT, 'entry/src/main/resources');

const BASE_FILE = join(RESOURCES, 'base/element/color.json');
const DARK_FILE = join(RESOURCES, 'dark/element/color.json');

/**
 * The ArkUI resource file for one theme.
 *
 * @param {'light'|'dark'} theme which theme to render
 * @returns {string} the file content, in the layout the project already used
 */
export function renderColorJson(theme) {
  const names = Object.keys(TOKENS).sort();
  const lines = names.map((name) => `    { "name": "${name}", "value": "${TOKENS[name][theme]}" }`);
  return '{\n  "color": [\n' + lines.join(',\n') + '\n  ]\n}\n';
}

const targets = [
  { file: BASE_FILE, theme: 'light' },
  { file: DARK_FILE, theme: 'dark' },
];

const check = process.argv.includes('--check');
let drifted = 0;

for (const target of targets) {
  const wanted = renderColorJson(target.theme);
  if (check) {
    const current = existsSync(target.file) ? readFileSync(target.file, 'utf8') : '';
    if (current !== wanted) {
      drifted++;
      console.error(`OUT OF DATE: ${target.file.replace(/\\/g, '/')}`);
      console.error('  run: node --experimental-transform-types tools/gen_theme_resources.mjs');
    }
  } else {
    mkdirSync(dirname(target.file), { recursive: true });
    writeFileSync(target.file, wanted, 'utf8');
    console.log(`wrote ${target.file.replace(/\\/g, '/')} (${Object.keys(TOKENS).length} colours)`);
  }
}

if (check) {
  if (drifted) {
    console.error(`${drifted} resource file(s) out of date.`);
    process.exit(1);
  }
  console.log(`colour resources are in sync with tokens.ts (${Object.keys(TOKENS).length} colours x 2 themes)`);
}
