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
