/**
 * Regression test: the five places that depend on the viewport each spelled
 * out their own condition.
 *
 *     .sideBarWidth(this.breakPoint === 'lg' || this.breakPoint === 'xl' ? 280 : 240)
 *     .minContentWidth(this.breakPoint === 'sm' ? 0 : 480)
 *     .showSideBar(this.breakPoint === 'sm' ? this.sidebarOpen : true)
 *     isSmallScreen: this.breakPoint === 'sm'
 *
 * The same decision, four times over, in four slightly different shapes,
 * and none of it could be tested: the rules lived in the page component,
 * and the page component cannot be imported into the Node test suite.
 *
 * The rules now live in entry/src/main/ets/config/breakpointRules.ts, which
 * is plain TypeScript, and the page asks for a value per breakpoint with a
 * fallback cascade.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from './sourceScan.ts';
import {
  BREAKPOINT_ORDER, BREAKPOINT_MAX_WIDTH_VP,
  computeBreakpoint, breakpointValue,
} from '../entry/src/main/ets/config/breakpointRules.ts';
import type { Breakpoint } from '../entry/src/main/ets/config/breakpointRules.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\\/g, '/');

describe('fix: the viewport-dependent values were four conditions of their own', () => {
  it('the buckets are the official HarmonyOS vp breakpoints', () => {
    expect(BREAKPOINT_ORDER.join(',')).toBe('sm,md,lg,xl');
    expect(BREAKPOINT_MAX_WIDTH_VP['sm']).toBe(600);
    expect(BREAKPOINT_MAX_WIDTH_VP['md']).toBe(840);
    expect(BREAKPOINT_MAX_WIDTH_VP['lg']).toBe(1440);
  });

  it('a width maps to the bucket it belongs to', () => {
    expect(computeBreakpoint(0)).toBe('sm');
    expect(computeBreakpoint(599)).toBe('sm');
    expect(computeBreakpoint(600)).toBe('md');
    expect(computeBreakpoint(839)).toBe('md');
    expect(computeBreakpoint(840)).toBe('lg');
    expect(computeBreakpoint(1439)).toBe('lg');
    expect(computeBreakpoint(1440)).toBe('xl');
    expect(computeBreakpoint(4000)).toBe('xl');
  });

  it('the bucket a width maps to is the one the old conditions used', () => {
    // The old code: sm for the narrowest, lg or xl for the wide one, and
    // everything else in between. The table has to agree with it.
    const oldIsSmall = (bp: string): boolean => bp === 'sm';
    const oldSideBarWidth = (bp: string): number => (bp === 'lg' || bp === 'xl') ? 280 : 240;
    const oldMinContentWidth = (bp: string): number => bp === 'sm' ? 0 : 480;
    for (const bp of BREAKPOINT_ORDER) {
      expect(breakpointValue(bp, { sm: true, md: false, lg: false, xl: false }, false))
        .toBe(oldIsSmall(bp));
      expect(breakpointValue(bp, { sm: 240, md: 240, lg: 280, xl: 280 }, 240))
        .toBe(oldSideBarWidth(bp));
      expect(breakpointValue(bp, { sm: 0, md: 480, lg: 480, xl: 480 }, 480))
        .toBe(oldMinContentWidth(bp));
    }
  });

  it('a missing bucket falls back to the nearest one that has a value', () => {
    // The narrow side comes first: a setting designed for a small screen is
    // the safer choice in between.
    expect(breakpointValue('lg', { sm: 10 })).toBe(10);
    expect(breakpointValue('sm', { xl: 99 })).toBe(99);
    expect(breakpointValue('md', { sm: 1, lg: 2 })).toBe(1);
    expect(breakpointValue('sm', { md: 1, lg: 2 })).toBe(1);
  });

  it('the bucket itself wins over the fallbacks', () => {
    expect(breakpointValue('md', { sm: 1, md: 2, lg: 3, xl: 4 })).toBe(2);
    expect(breakpointValue('xl', { sm: 1, md: 2, lg: 3, xl: 4 })).toBe(4);
  });

  it('the default is used when no bucket has a value', () => {
    expect(breakpointValue('md', {}, 'fallback')).toBe('fallback');
    expect(breakpointValue('md', { sm: 1 }, 'fallback')).toBe(1);
  });

  it('an unknown bucket means the width was never computed', () => {
    // The old conditions treated an unknown breakpoint as "not sm, not
    // lg/xl", and the default keeps that behaviour.
    expect(breakpointValue('nope' as Breakpoint, { sm: true, md: false }, false)).toBe(false);
    let threw = false;
    try {
      breakpointValue('nope' as Breakpoint, { sm: true }, undefined as unknown as string);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('a table with no value at all is a programming error', () => {
    let threw = false;
    try {
      breakpointValue('md', {});
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('the page asks for the values instead of testing the breakpoint', () => {
    // The point of the refactor: the page no longer spells out a condition
    // of its own. The comments are stripped first — the note that explains
    // the refactor quotes the old condition, and a comment is not code.
    const index = stripComments(
      readFileSync(ROOT + 'entry/src/main/ets/pages/Index.ets', 'utf-8')
    );
    expect(index.includes("this.breakPoint === 'sm'")).toBe(false);
    expect(index.includes("this.breakPoint === 'lg'")).toBe(false);
    expect(index.includes('breakpointValue(this.breakPoint as Breakpoint')).toBe(true);
    expect(index.includes('private isSmallScreen(): boolean')).toBe(true);
    expect(index.includes('private sideBarWidth(): number')).toBe(true);
    expect(index.includes('private minContentWidth(): number')).toBe(true);
    expect(index.includes('private showSideBar(): boolean')).toBe(true);
  });

  it('the transport still publishes the width the way it always did', () => {
    // The rules moved; the AppStorage keys did not. EntryAbility and the
    // page read these, and a key that changed name would be a silent
    // failure: the layout would simply never react to a fold.
    const bp = readFileSync(ROOT + 'entry/src/main/ets/config/Breakpoint.ets', 'utf-8');
    expect(bp.includes("KEY_BREAKPOINT = 'breakpoint'")).toBe(true);
    expect(bp.includes("KEY_WINDOW_WIDTH_VP = 'windowWidthVp'")).toBe(true);
    expect(bp.includes("KEY_WINDOW_WIDTH_PX = 'windowWidthPx'")).toBe(true);
    // And the rules it uses are the ones that were tested above.
    expect(bp.includes('computeBreakpoint(widthPx / d)')).toBe(true);
  });
});
