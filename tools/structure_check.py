#!/usr/bin/env python3
"""Structural sanity check for TS/ArkTS sources: bracket balance + basic lint.

Skips string/char/template literals and comments. Regex literals are detected
heuristically (a '/' in expression position starts a regex) so character
classes like [\\r\\n] do not unbalance the counter.
"""
import os
import re
import sys

ROOT = 'entry/src/main'
EXTS = ('.ts', '.ets')

OPEN = '{([' 
CLOSE = '})]'
MATCH = {'}': '{', ')': '(', ']': '['}


def strip_noise(src):
    """Return src with literals/comments blanked, plus a line map."""
    out = []
    i, n = 0, len(src)
    prev_significant = ''          # last non-space code char, to spot regex position
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                i += 1
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            i += 2
            while i < n and not (src[i] == '*' and i + 1 < n and src[i + 1] == '/'):
                if src[i] == '\n':
                    out.append('\n')
                i += 1
            i += 2
            continue
        if c in '"\'':
            quote = c
            i += 1
            while i < n and src[i] != quote:
                if src[i] == '\\':
                    i += 1
                if src[i] == '\n':
                    out.append('\n')
                i += 1
            i += 1
            continue
        if c == '`':
            i += 1
            depth = 1
            while i < n and depth:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == '`':
                    depth -= 1
                elif src[i] == '\n':
                    out.append('\n')
                i += 1
            continue
        if c == '/' and prev_significant in '=(,:[!&|?{;' + '':
            # regex literal in expression position
            i += 1
            in_class = False
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == '[':
                    in_class = True
                elif src[i] == ']':
                    in_class = False
                elif src[i] == '/' and not in_class:
                    i += 1
                    break
                elif src[i] == '\n':
                    break
                i += 1
            while i < n and src[i].isalpha():
                i += 1
            continue
        out.append(c)
        if not c.isspace():
            prev_significant = c
        i += 1
    return ''.join(out)


def check(path):
    src = open(path, encoding='utf-8', errors='ignore').read()
    code = strip_noise(src)
    stack = []
    line = 1
    problems = []
    for ch in code:
        if ch == '\n':
            line += 1
            continue
        if ch in OPEN:
            stack.append((ch, line))
        elif ch in CLOSE:
            if not stack or stack[-1][0] != MATCH[ch]:
                problems.append(f'line {line}: unexpected {ch!r}')
            else:
                stack.pop()
    for ch, ln in stack:
        problems.append(f'line {ln}: unclosed {ch!r}')
    # duplicate exports in one file
    names = re.findall(r'export\s+(?:function|class|const|let|interface|enum)\s+([A-Za-z_$][\w$]*)', src)
    dupes = {nm for nm in names if names.count(nm) > 1}
    for nm in sorted(dupes):
        problems.append(f'duplicate export: {nm}')
    problems.extend(check_redeclare(code, src))
    problems.extend(check_static_in_struct(src))
    return problems


DECL_RE = re.compile(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)')


def check_redeclare(code, src):
    """Flag a const/let/var declared twice in the same brace scope.

    Added after a sed-based edit produced two `const gap` in one block — a
    compile error that bracket counting cannot see. Scope tracking is
    approximate (arrow functions and blocks share a depth) but false positives
    are easy to eyeball, whereas the error itself is easy to miss.
    """
    problems = []
    scopes = [{}]
    paren = 0
    line = 1
    i = 0
    n = len(code)
    # Last significant character/word. Whitespace does NOT update it, so a
    # keyword is still recognisable after a newline+indent.
    prev = ''
    while i < n:
        ch = code[i]
        if ch == '\n':
            line += 1
            i += 1
            continue
        if ch.isspace():
            i += 1
            continue
        if ch == '(':
            # A `for (let i ...)` header declares in the loop's own scope, which
            # ends at ')'. Pushing a scope here keeps two consecutive loops from
            # being reported as a redeclaration of `i`.
            paren += 1
            scopes.append({})
            prev = '('
            i += 1
            continue
        if ch == ')':
            if paren > 0:
                paren -= 1
                if len(scopes) > 1:
                    scopes.pop()
            prev = ')'
            i += 1
            continue
        if ch == '{':
            scopes.append({})
            prev = '{'
            i += 1
            continue
        if ch == '}':
            if len(scopes) > 1:
                scopes.pop()
            prev = '}'
            i += 1
            continue
        if ch == ';':
            prev = ';'
            i += 1
            continue
        if ch.isalpha() or ch in '_$':
            j = i
            while j < n and (code[j].isalnum() or code[j] in '_$'):
                j += 1
            word = code[i:j]
            if word in ('const', 'let', 'var'):
                m = DECL_RE.match(code, i)
                if m:
                    name = m.group(1)
                    cur = scopes[-1]
                    if name in cur:
                        problems.append(
                            f'line {line}: duplicate declaration of {name!r} '
                            f'(also declared at line {cur[name]})')
                    else:
                        cur[name] = line
                    i = m.end()
                    prev = 'x'
                    continue
            prev = word
            i = j
            continue
        prev = ch
        i += 1
    return problems


def check_static_in_struct(src):
    """ArkTS `struct` declarations do not support `static` members.

    The repo's other `static readonly` usages are plain classes; a `static`
    inside an @Component struct fails to compile and — like the duplicate
    declaration above — is invisible to unit tests.
    """
    problems = []
    for m in re.finditer(r'@Component\s*\n\s*export\s+struct\s+(\w+)\s*\{', src):
        name = m.group(1)
        start = m.end()
        depth = 1
        i = start
        line = src.count('\n', 0, start) + 1
        while i < len(src) and depth > 0:
            ch = src[i]
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
            elif ch == '\n':
                line += 1
            elif ch == '/' and src[i:i + 2] == '//':
                i = src.find('\n', i)
                if i < 0:
                    break
            i += 1
        body = src[start:i]
        for sm in re.finditer(r'^\s*static\s+(\w+)', body, re.M):
            problems.append(
                f'line {line}: `static {sm.group(1)}` inside struct {name} — '
                f'move it to module scope or to a plain class')
    return problems


def main():
    targets = sys.argv[1:]
    if not targets:
        targets = []
        for dirpath, dirnames, filenames in os.walk(ROOT):
            for f in filenames:
                if f.endswith(EXTS):
                    targets.append(os.path.join(dirpath, f))
    bad = 0
    for t in sorted(targets):
        if not os.path.exists(t):
            print(f'MISSING {t}')
            bad += 1
            continue
        probs = check(t)
        if probs:
            bad += 1
            print(f'--- {t}')
            for p in probs:
                print(f'    {p}')
    print(f'== checked {len(targets)} files, {bad} with problems ==')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
