/**
 * Breakpoint system for foldable / tri-fold / tablet / 2-in-1 screens.
 *
 * Follows the HarmonyOS official vp breakpoints:
 *   sm: [0, 600)     — tri-fold collapsed state / phone portrait
 *   md: [600, 840)   — phone landscape / small free window
 *   lg: [840, 1440)  — tri-fold half & fully unfolded / tablet portrait
 *   xl: [1440, +∞)   — tablet landscape / 2-in-1
 *
 * The current breakpoint lives in AppStorage under 'breakpoint' and is
 * maintained by EntryAbility's windowSizeChange listener, so folding /
 * unfolding re-evaluates layout with component-level granularity while
 * keeping every component instance mounted (no tree rebuild → smooth
 * fold transitions).
 */
export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl';

export class Breakpoints {
  static readonly SM_MAX = 600;
  static readonly MD_MAX = 840;
  static readonly LG_MAX = 1440;

  /** Map a viewport width (vp) to the breakpoint bucket. */
  static compute(widthVp: number): Breakpoint {
    if (widthVp < Breakpoints.SM_MAX) return 'sm';
    if (widthVp < Breakpoints.MD_MAX) return 'md';
    if (widthVp < Breakpoints.LG_MAX) return 'lg';
    return 'xl';
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
    AppStorage.setOrCreate(Breakpoints.KEY_BREAKPOINT, Breakpoints.compute(widthPx / d) as string);
  }
}
