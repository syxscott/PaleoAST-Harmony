/**
 * Convert Python translation dictionaries to TypeScript Record files.
 * Usage: node tools/convert_i18n.js
 */
const fs = require('fs');
const path = require('path');

const PY_DIR = 'D:/GIthub/PaleoAST/config/i18n';
const OUT_DIR = 'D:/GIthub/PaleoAST-Harmony/entry/src/main/core/config/i18n';

function parsePyDict(src) {
  // Extract the TRANSLATIONS = { ... } literal and evaluate it as JS
  const start = src.indexOf('TRANSLATIONS');
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  let end = braceStart;
  let inStr = false;
  let strCh = '';
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === strCh) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const literal = src.slice(braceStart, end + 1)
    // triple-quoted values
    .replace(/"""([\s\S]*?)"""/g, (m, s) => JSON.stringify(s.trim()))
    // strip Python comments outside strings
    .replace(/(^|[^\\])#.*$/gm, '$1')
    // trailing commas are legal in JS
    ;
  // eslint-disable-next-line no-eval
  const obj = (0, eval)('(' + literal + ')');
  return obj;
}

function toTsFile(dict, langLabel) {
  const entries = Object.entries(dict).map(([k, v]) => {
    const key = JSON.stringify(k);
    const val = JSON.stringify(String(v).replace(/\r\n/g, '\n'));
    return `  ${key}: ${val},`;
  });
  return `/**
 * ${langLabel} translations — auto-converted from config/i18n/translations_*.py
 * (keys are the English source strings, matching the Python convention).
 */
export const TRANSLATIONS_${langLabel === 'English' ? 'EN' : 'ZH'}: Record<string, string> = {
${entries.join('\n')}
};
`;
}

for (const [file, label] of [['translations_en.py', 'English'], ['translations_zh.py', 'Chinese']]) {
  const src = fs.readFileSync(path.join(PY_DIR, file), 'utf8');
  const dict = parsePyDict(src);
  const out = toTsFile(dict, label);
  const outFile = path.join(OUT_DIR, label === 'English' ? 'translations_en.ts' : 'translations_zh.ts');
  fs.writeFileSync(outFile, out);
  console.log(`${file}: ${Object.keys(dict).length} keys -> ${outFile}`);
}
console.log('done');
