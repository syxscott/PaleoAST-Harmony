/**
 * Shared helpers for the tests that look at the source of the repository.
 *
 * Both the import-resolution gate and the colour-token gate read the .ets
 * files as text, and both have to be able to tell a real statement from one
 * that only appears in a comment: a commented-out import is not an import,
 * and `$r('app.color.x')` written in a doc comment is not a resource
 * reference.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read a source file for inspection, with the line endings normalised.
 *
 * The repository mixes CRLF and LF, and which one a file has on disk
 * depends on how it was checked out (core.autocrlf, .gitattributes) rather
 * than on its content. That matters for any check that splits the source
 * into lines and matches a regular expression against a line: in
 * JavaScript, `.` does not match `\r` either — it is a line terminator — so
 * a pattern like `(.+)$` matches nothing at all on a CRLF file, and a
 * source check that passes on a Linux checkout can fail on a Windows one.
 *
 * Normalising here keeps those checks about the source and not about the
 * checkout.
 *
 * @param path the file to read
 * @returns the source with CRLF turned into LF
 */
export function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Remove the comments from a source file, keeping the string and template
 * literals intact.
 *
 * A naive stripper that cuts at the first `//` would also cut a URL inside
 * a string, and the rest of the line — which may hold the very statement the
 * gate is looking for — would disappear with it. So the scan is a small
 * state machine.
 *
 * @param src the source text
 * @returns the source without its comments
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Every source file of a directory tree, skipping the build directories.
 *
 * @param dir the directory to walk
 * @param out the accumulator
 * @param ext the file extensions to keep, e.g. ['.ets'] or ['.ets', '.ts']
 * @returns the file paths
 */
export function collectSources(dir: string, out: string[] = [], ext: string | string[] = '.ets'): string[] {
  const exts: string[] = Array.isArray(ext) ? ext : [ext];
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
    if (st.isDirectory()) collectSources(p, out, exts);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}
