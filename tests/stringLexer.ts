/**
 * Standalone string-literal lexer used by etsSyntax.test.ts.
 *
 * Deliberately has no dependency on the TypeScript parser: the repo's test
 * harness runs on plain node with type stripping, and the check has to work on
 * `.ets` files that the TypeScript parser rejects for unrelated reasons
 * (ArkUI's `@Component struct X { build() {} }` is not TypeScript grammar).
 *
 * The one subtlety is deciding whether a `/` opens a regex literal or is a
 * division operator. It uses the standard heuristic. The heuristic is
 * validated two ways in the test: against fixtures covering the ambiguous
 * cases, and against the fact that this lexer and the TypeScript parser
 * independently agree that the whole repository is clean.
 */

/** Tokens after which a `/` is division, not the start of a regex. */
const VALUE_END_PUNCT: Set<string> = new Set([')', ']', '}']);

/** Keywords after which a `/` does open a regex (`return /re/`, `typeof /re/`). */
const REGEX_OK_WORDS: Set<string> = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

export interface UnterminatedHit {
  /** Byte offset of the opening quote. */
  offset: number;
  /** 1-based line of the opening quote. */
  line: number;
  quote: string;
}

/**
 * Report every `'`/`"` literal that hits a line terminator before its closing
 * quote. A quoted string may not span a line break in TypeScript or ArkTS, so
 * any hit is a hard compile error (TS1002).
 */
export function findUnterminatedStringLiterals(src: string): UnterminatedHit[] {
  const hits: UnterminatedHit[] = [];
  const n = src.length;
  let i = 0;
  let lastKind: string = null;  // 'word' | 'value' | 'punct'
  let lastText: string = '';

  const at = (k: number): string => (i + k < n ? src[i + k] : '');

  while (i < n) {
    const c = src[i];

    if (/\s/.test(c)) { i++; continue; }

    if (c === '/' && at(1) === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && at(1) === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && at(1) === '/')) i++;
      i += 2;
      continue;
    }

    if (c === '/') {
      const prevIsValue =
        (lastKind === 'value') ||
        (lastKind === 'word' && !REGEX_OK_WORDS.has(lastText)) ||
        (lastKind === 'punct' && VALUE_END_PUNCT.has(lastText));
      if (!prevIsValue) {
        i++;
        let inClass = false;
        while (i < n) {
          const d = src[i];
          if (d === '\\') { i += 2; continue; }
          if (d === '[') { inClass = true; }
          else if (d === ']') { inClass = false; }
          else if (d === '/' && !inClass) { i++; break; }
          else if (d === '\n') { break; } // malformed regex, resync
          i++;
        }
        while (i < n && /[a-z]/.test(src[i])) i++;
        lastKind = 'value';
        lastText = '/re/';
        continue;
      }
    }

    if (c === "'" || c === '"') {
      const quote = c;
      const start = i;
      i++;
      let terminated = false;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === quote) { i++; terminated = true; break; }
        if (d === '\n' || d === '\r') { break; }  // the defect
        i++;
      }
      if (!terminated) {
        hits.push({ offset: start, line: src.slice(0, start).split('\n').length, quote });
      }
      lastKind = 'value';
      lastText = 'str';
      continue;
    }

    if (c === '`') {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        i++;
      }
      lastKind = 'value';
      lastText = 'tpl';
      continue;
    }

    if (/[0-9]/.test(c)) {
      while (i < n && /[0-9a-zA-Z._]/.test(src[i])) i++;
      lastKind = 'value';
      lastText = 'num';
      continue;
    }

    if (/[A-Za-z_$]/.test(c)) {
      const s = i;
      while (i < n && /[\w$]/.test(src[i])) i++;
      lastKind = 'word';
      lastText = src.slice(s, i);
      continue;
    }

    lastKind = 'punct';
    lastText = c;
    i++;
  }
  return hits;
}
