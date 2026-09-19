/**
 * Code audit — TS adaptation of app_infrastructure/audit/ (ast_auditor.py +
 * directory_fixer.py). The Python tools walk Python ASTs; this port applies
 * the same audit *categories* to TypeScript sources with line-based scanning:
 *   - brace/paren balance violations
 *   - stray console.log statements
 *   - TODO/FIXME markers
 *   - duplicate export names within a file
 */

export interface AuditIssue {
  file: string;
  line: number;
  severity: 'error' | 'warning' | 'info';
  category: 'balance' | 'console' | 'todo' | 'duplicate-export';
  message: string;
}

export interface AuditReport {
  filesScanned: number;
  issues: AuditIssue[];
  errorCount: number;
  warningCount: number;
}

/**
 * Strip string literals, template literals, COMMENTS and REGEX literals so
 * bracket counting sees only code.
 *
 * Regex literals matter: `/[{(]/` inside a character class would otherwise
 * unbalance the counter and report a phantom error. The previous version
 * ignored them, which made this auditor flag ~20 perfectly valid files
 * (every `replace(/[\r\n]/g, ...)` in the parsers, for example) — a false
 * positive rate that made the whole audit report useless.
 */
function stripLiterals(source: string): string {
  let out = '';
  let i = 0;
  let prevSignificant = ''; // last non-space code char; a '/' in expression position starts a regex
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        if (source[i] === '\n') out += '\n';
        i++;
      }
      i++;
      out += ' ';
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      out += ' ';
      continue;
    }
    if (ch === '/' && '=(,:[!&|?{;'.includes(prevSignificant)) {
      // Regex literal: skip to the unescaped closing '/' outside a character class.
      i++;
      let inClass = false;
      while (i < source.length) {
        const c = source[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { i++; break; }
        else if (c === '\n') break;
        i++;
      }
      while (i < source.length && /[a-z]/.test(source[i])) i++; // flags
      out += ' ';
      continue;
    }
    out += ch;
    if (!/\s/.test(ch)) prevSignificant = ch;
    i++;
  }
  return out;
}

/** Audit one TS/ETS source file. */
export function auditSource(file: string, source: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const lines = source.split('\n');

  // 1. bracket balance (per file, code-only)
  const code = stripLiterals(source);
  const pairs: Record<string, string> = { '}': '{', ')': '(', ']': '[' };
  const stack: { ch: string; line: number }[] = [];
  let line = 1;
  for (const ch of code) {
    if (ch === '\n') { line++; continue; }
    if (ch === '{' || ch === '(' || ch === '[') stack.push({ ch, line });
    else if (ch in pairs) {
      const top = stack.pop();
      if (!top || top.ch !== pairs[ch]) {
        issues.push({
          file, line, severity: 'error', category: 'balance',
          message: `Unbalanced '${ch}'`,
        });
      }
    }
  }
  for (const leftover of stack) {
    issues.push({
      file, line: leftover.line, severity: 'error', category: 'balance',
      message: `Unclosed '${leftover.ch}'`,
    });
  }

  // 2. console.log / TODO markers (line scan on the raw source)
  for (let i = 0; i < lines.length; i++) {
    if (/console\.log\(/.test(lines[i])) {
      issues.push({
        file, line: i + 1, severity: 'info', category: 'console',
        message: 'console.log statement',
      });
    }
    const todo = lines[i].match(/(TODO|FIXME)[:\s]/);
    if (todo) {
      issues.push({
        file, line: i + 1, severity: 'warning', category: 'todo',
        message: `${todo[1]} marker`,
      });
    }
  }

  // 3. duplicate export names
  const exportCounts = new Map<string, number>();
  for (const m of source.matchAll(/export\s+(?:function|class|const|let|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    exportCounts.set(m[1], (exportCounts.get(m[1]) ?? 0) + 1);
  }
  for (const [name, count] of exportCounts) {
    if (count > 1) {
      issues.push({
        file, line: 0, severity: 'error', category: 'duplicate-export',
        message: `Export '${name}' declared ${count} times`,
      });
    }
  }

  return issues;
}

/**
 * Audit a set of files (ast_auditor.audit_paleoast equivalent). Pure function:
 * pass a file-path → source map; no filesystem access so it runs on device,
 * in tests, and in CLI tooling alike.
 */
export function auditPaleoast(files: Record<string, string>): AuditReport {
  const issues: AuditIssue[] = [];
  let filesScanned = 0;
  for (const [file, source] of Object.entries(files)) {
    filesScanned++;
    issues.push(...auditSource(file, source));
  }
  return {
    filesScanned,
    issues,
    errorCount: issues.filter(i => i.severity === 'error').length,
    warningCount: issues.filter(i => i.severity === 'warning').length,
  };
}
