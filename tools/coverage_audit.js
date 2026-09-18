/**
 * Coverage audit: extract every public Python function/class from the PaleoAST
 * computational modules and check whether the Harmony port contains an
 * equivalent (snake_case or camelCase, case-insensitive search).
 */
const fs = require('fs');
const path = require('path');

const PY_ROOT = 'D:/GIthub/PaleoAST';
const HM_ROOT = 'D:/GIthub/PaleoAST-Harmony/entry/src/main';

// computational modules to audit (UI views handled separately)
const MODULES = [
  'statistics', 'ecology', 'macroevolution', 'morphometrics', 'morpho3d',
  'phylogenetics', 'stratigraphy', '_core', 'parsers', 'models', 'controllers',
  'config', 'utils', 'hpc', 'state_machine', 'app_infrastructure',
  'reporting', 'plugins', 'data',
];

// collect Harmony source into one big string for fast searching
function collectSources(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__' || entry.name === 'node_modules') continue;
      collectSources(full, acc);
    } else if (/\.(ts|ets)$/.test(entry.name)) {
      acc.push(fs.readFileSync(full, 'utf8'));
    }
  }
}
const sources = [];
collectSources(HM_ROOT, sources);
const haystack = sources.join('\n');
const haystackLower = haystack.toLowerCase();

function toCamel(name) {
  return name.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase());
}
function toCamelLower(name) {
  const c = toCamel(name);
  return c.charAt(0).toLowerCase() + c.charAt(1) ? c.charAt(0).toLowerCase() + c.slice(1) : c;
}

function extractPyDefs(moduleDir) {
  const defs = new Map(); // name -> [file, kind]
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '__pycache__') continue;
        walk(full);
      } else if (/\.py$/.test(e.name) && e.name !== '__init__.py') {
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(/^(?:def|class)\s+([A-Za-z_]\w*)/gm)) {
          const name = m[1];
          if (name.startsWith('_')) continue; // private
          if (!defs.has(name)) defs.set(name, path.relative(PY_ROOT, full));
        }
      }
    }
  }
  walk(moduleDir);
  return defs;
}

const missing = [];
const found = [];
let total = 0;
for (const mod of MODULES) {
  const dir = path.join(PY_ROOT, mod);
  if (!fs.existsSync(dir)) { console.log('SKIP (no dir):', mod); continue; }
  const defs = extractPyDefs(dir);
  for (const [name, file] of defs) {
    total++;
    const variants = [name, toCamel(name), toCamelLower(name), name.replace(/_/g, '')];
    const hit = variants.some(v => haystackLower.includes(v.toLowerCase()));
    if (hit) found.push({ mod, name, file });
    else missing.push({ mod, name, file });
  }
}

console.log(`总公开 API: ${total}, 命中: ${found.length}, 未命中: ${missing.length}\n`);
console.log('=== 未命中清单（按模块） ===');
const byMod = {};
for (const m of missing) { (byMod[m.mod] ??= []).push(`${m.name} (${m.file})`); }
for (const [mod, names] of Object.entries(byMod)) {
  console.log(`\n[${mod}] ${names.length} 项`);
  for (const n of names.sort()) console.log('  - ' + n);
}
fs.writeFileSync('tools/coverage_found.json', JSON.stringify(found, null, 1));
fs.writeFileSync('tools/coverage_missing.json', JSON.stringify(missing, null, 1));
