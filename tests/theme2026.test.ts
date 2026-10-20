/**
 * Regression test: the colours of the .ets layer were 442 hard-coded hex
 * literals, and the dark theme was applied by 72 hand-written
 * `darkMode ? '#a' : '#b'` ternaries.
 *
 * The defect was not visible anywhere:
 *
 *   - `resources/base/element/color.json` existed with eight colours and NOT
 *     ONE .ets file referenced a resource (`$r('app.color.x')` was used zero
 *     times), so ArkUI's dark-mode mechanism was never in play;
 *   - `resources/dark/` did not exist at all;
 *   - the application had a dark-mode switch of its own, but never called
 *     `setColorMode`, so the platform's colour mode and the application's
 *     variable were two unrelated things.
 *
 * The arrangement now:
 *
 *   - `ets/theme/tokens.ts` holds every colour, once, with its light and its
 *     dark value. It is plain TypeScript, so this suite can check it.
 *   - `tools/gen_theme_resources.mjs` writes the two resource files out of
 *     that table; the CI runs it with --check, so they cannot drift.
 *   - UI attributes use `$r('app.color.x')`; the Canvas and the SVG export
 *     use `token('x', dark)`, because they need a string.
 *
 * The tests below pin all of that, and the last one is the gate that keeps
 * the 442 literals from coming back.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSources, stripComments } from './sourceScan.ts';
import {
  TOKENS, ALPHA_TOKENS, token, tokenPair, tokenNames, alphaTokenNames,
  seriesPalette, seriesColor,
} from '../entry/src/main/ets/theme/tokens.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\\/g, '/');
const ETS = join(ROOT, 'entry/src/main/ets');

/**
 * The source of a file without its comments. A colour written in a doc
 * comment is not a colour the application uses, and a resource reference in
 * a comment is not a reference.
 *
 * @param file the file to read
 * @returns the source without comments
 */
function code(file: string): string {
  return stripComments(readFileSync(file, 'utf8'));
}

const HEX6 = /^#[0-9A-Fa-f]{6}$/;
const HEX8 = /^#[0-9A-Fa-f]{8}$/;

describe('fix: 442 hard-coded colours and 72 hand-written dark-mode ternaries', () => {
  it('the token table holds a valid colour for every token, in both themes', () => {
    const names = tokenNames();
    expect(names.length > 20).toBe(true);
    for (const name of names) {
      const entry = TOKENS[name];
      expect(HEX6.test(entry.light) + ' ' + name).toBe(true + ' ' + name);
      expect(HEX6.test(entry.dark) + ' ' + name).toBe(true + ' ' + name);
    }
    // The tokens with an alpha channel are string-only, and they are the
    // reason a resource cannot carry them.
    for (const name of alphaTokenNames()) {
      const entry = ALPHA_TOKENS[name];
      expect(HEX8.test(entry.light) + ' ' + name).toBe(true + ' ' + name);
      expect(HEX8.test(entry.dark) + ' ' + name).toBe(true + ' ' + name);
    }
  });

  it('the light theme still renders the colours it rendered before', () => {
    // The migration must not change a single light colour: the values below
    // are the literals that were in the source before the tokens existed.
    const before: [string, string][] = [
      ['primary', '#3498DB'],
      ['text_primary', '#2C3E50'],
      ['text_secondary', '#7F8C8D'],
      ['text_muted', '#95A5A6'],
      ['bg_primary', '#FFFFFF'],
      ['bg_secondary', '#F8F9FA'],
      ['bg_elevated', '#FAFBFC'],
      ['bg_tint', '#EBF5FB'],
      ['border_light', '#E4E7EB'],
      ['danger', '#E74C3C'],
      ['warning', '#F39C12'],
      ['success', '#27AE60'],
      ['series_5', '#9B59B6'],
      ['series_6', '#1ABC9C'],
    ];
    for (const [name, expected] of before) {
      expect(token(name, false) + ' ' + name).toBe(expected + ' ' + name);
    }
  });

  it('an unknown token is an error, not a colour of its own', () => {
    // A typo must not silently render as "no colour at all".
    let threw = false;
    try {
      token('no_such_token', false);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('the series palette hands out the same colours in the same order', () => {
    const palette = seriesPalette();
    expect(palette.length).toBe(6);
    expect(palette[0]).toBe('#3498DB');
    expect(palette[1]).toBe('#E74C3C');
    expect(seriesColor(0)).toBe(palette[0]);
    // The index wraps instead of running off the end.
    expect(seriesColor(6)).toBe(palette[0]);
    expect(seriesColor(-1)).toBe(palette[5]);
  });

  it('the two theme values of a token are the ones the source used', () => {
    const pair = tokenPair('text_primary');
    expect(pair[0]).toBe('#2C3E50');
    expect(pair[1]).toBe('#CCCCCC');
  });

  it('the colour resources are in sync with the token table', () => {
    // The generator writes the two files; this is what the CI's --check
    // does. A token added to the table and not generated would be caught
    // here and there.
    const base = readFileSync(ROOT + 'entry/src/main/resources/base/element/color.json', 'utf8');
    const dark = readFileSync(ROOT + 'entry/src/main/resources/dark/element/color.json', 'utf8');
    const readAll = (text: string): Map<string, string> => {
      const map = new Map<string, string>();
      const re = /\{ "name": "([^"]+)", "value": "([^"]+)" \}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) map.set(m[1], m[2]);
      return map;
    };
    const baseMap = readAll(base);
    const darkMap = readAll(dark);

    // Every resource-colour token is in both files, with the right value.
    for (const name of tokenNames()) {
      expect((baseMap.get(name) ?? 'missing') + ' ' + name).toBe(TOKENS[name].light + ' ' + name);
      expect((darkMap.get(name) ?? 'missing') + ' ' + name).toBe(TOKENS[name].dark + ' ' + name);
    }
    // And nothing else is in them.
    expect(baseMap.size).toBe(tokenNames().length);
    expect(darkMap.size).toBe(tokenNames().length);
    // The token with an alpha channel is deliberately NOT a resource: a
    // resource colour is read as #AARRGGBB, a string colour as #RRGGBBAA.
    for (const name of alphaTokenNames()) {
      expect(baseMap.has(name)).toBe(false);
      expect(darkMap.has(name)).toBe(false);
    }
    // The manifest refers to this one by name, so it has to exist.
    expect(baseMap.has('start_window_background')).toBe(true);
  });

  it('no .ets file contains a raw hex colour any more', () => {
    // The gate that keeps the 442 literals from coming back. The token
    // table itself is the one place a hex value is written down.
    const files = collectSources(ETS);
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.slice(ROOT.length);
      if (rel.endsWith('theme/tokens.ts')) continue;
      const matches = code(f).match(/#[0-9A-Fa-f]{3,8}\b/g);
      if (matches) {
        for (const m of matches) offenders.push(rel + ' ' + m);
      }
    }
    expect(offenders.join(' | ')).toBe('');
  });

  it('every colour resource the .ets layer refers to exists', () => {
    // A typo in a resource name is a runtime failure, not a compile error.
    const base = readFileSync(ROOT + 'entry/src/main/resources/base/element/color.json', 'utf8');
    const known = new Set<string>();
    const re = /\{ "name": "([^"]+)", "value": "([^"]+)" \}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(base)) !== null) known.add(m[1]);

    const used = new Set<string>();
    for (const f of collectSources(ETS)) {
      const text = code(f);
      const r = /\$r\('app\.color\.([a-z_0-9]+)'\)/g;
      let hit: RegExpExecArray | null;
      while ((hit = r.exec(text)) !== null) used.add(hit[1]);
    }
    expect(used.size > 10).toBe(true);
    const missing = [...used].filter((n) => !known.has(n));
    expect(missing.join(' | ')).toBe('');
  });

  it('every token the .ets layer refers to exists in the table', () => {
    const known = new Set<string>(tokenNames());
    for (const n of alphaTokenNames()) known.add(n);
    const used = new Set<string>();
    for (const f of collectSources(ETS)) {
      const text = code(f);
      const r = /token\('([a-z_0-9]+)'/g;
      let hit: RegExpExecArray | null;
      while ((hit = r.exec(text)) !== null) used.add(hit[1]);
    }
    expect(used.size > 5).toBe(true);
    const missing = [...used].filter((n) => !known.has(n));
    expect(missing.join(' | ')).toBe('');
  });

  it('the switch and the platform colour mode are put in step', () => {
    // The switch alone does not switch the resources: the platform has to
    // be told. Both places that matter are checked here.
    const ability = readFileSync(ROOT + 'entry/src/main/ets/entryability/EntryAbility.ets', 'utf8');
    expect(ability.includes('applyColorMode(this.context')).toBe(true);
    const ribbon = readFileSync(ROOT + 'entry/src/main/ets/components/RibbonBar.ets', 'utf8');
    expect(ribbon.includes('applyColorMode(ctx, isOn)')).toBe(true);
  });
});
