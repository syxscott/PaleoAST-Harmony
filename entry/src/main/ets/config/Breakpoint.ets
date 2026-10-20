/**
 * The breakpoint state of the running application.
 *
 * The rules — which bucket a width falls into, and how a breakpoint-dependent
 * value is looked up — live in `breakpointRules.ts`, which is plain
 * TypeScript and is unit-tested there. This file is only the transport: it
 * puts the current width into AppStorage, where the UI reads it.
 *
 * ## Why the transport is still AppStorage and not AppStorageV2
 *
 * The state management V2 (`@ObservedV2` / `@Trace` / `@Local`) is the
 * current API, and the reference implementation this was modelled on uses
 * it. It cannot be adopted for one corner of this application, though:
 *
 *   - the V2 decorators only work in a `@ComponentV2` component, and the
 *     page that reads the breakpoint (`pages/Index.ets`) is a V1
 *     `@Component`;
 *   - a V1 component cannot hold a V2 observed object in a `@State` — the
 *     reference is observed, not what is inside it, so a change to the
 *     breakpoint would not repaint the layout;
 *   - converting a page to `@ComponentV2` means converting its children
 *     too, because the two versions do not pass parameters to each other.
 *     That is every one of the 57 .ets files, not one corner of the
 *     application.
 *
 * So the whole-tree migration to `@ComponentV2` is a project of its own,
 * and it needs a device to verify. Until then this file keeps the transport
 * that works, and the decisions it carries are the part that could be
 * tested and is.
 */
import {
  Breakpoint, BREAKPOINT_ORDER, BREAKPOINT_MAX_WIDTH_VP,
  computeBreakpoint, breakpointValue, BreakpointValueOptions,
} from './breakpointRules';

export { Breakpoint, BREAKPOINT_ORDER, BREAKPOINT_MAX_WIDTH_VP, computeBreakpoint, breakpointValue };
export type { BreakpointValueOptions };

export class Breakpoints {
  static readonly SM_MAX = BREAKPOINT_MAX_WIDTH_VP['sm'];
  static readonly MD_MAX = BREAKPOINT_MAX_WIDTH_VP['md'];
  static readonly LG_MAX = BREAKPOINT_MAX_WIDTH_VP['lg'];

  /** Map a viewport width (vp) to the breakpoint bucket. */
  static compute(widthVp: number): Breakpoint {
    return computeBreakpoint(widthVp);
  }

  /** AppStorage keys written by EntryAbility. */
  static readonly KEY_BREAKPOINT = 'breakpoint';
  static readonly KEY_WINDOW_WIDTH_VP = 'windowWidthVp';
  static readonly KEY_WINDOW_WIDTH_PX = 'windowWidthPx';

  /** Push a new window width into AppStorage (EntryAbility side). */
  static updateWindowWidth(widthPx: number, density: number): void {
    const d = density > 0 ? density : 1;
    AppStorage.setOrCreate(Breakpoints.KEY_WINDOW_WIDTH_PX, widthPx);
    AppStorage.setOrCreate(Breakpoints.KEY_WINDOW_WIDTH_VP, widthPx / d);
    AppStorage.setOrCreate(Breakpoints.KEY_BREAKPOINT, computeBreakpoint(widthPx / d) as string);
  }
}
