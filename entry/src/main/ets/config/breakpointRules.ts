/**
 * The breakpoint rules — plain TypeScript, so the unit suite can check them.
 *
 * The rules themselves follow the HarmonyOS official vp breakpoints:
 *
 *   sm: [0, 600)     tri-fold collapsed, phone portrait
 *   md: [600, 840)   phone landscape, small free window
 *   lg: [840, 1440)  tri-fold half and fully unfolded, tablet portrait
 *   xl: [1440, +inf) tablet landscape, 2-in-1
 *
 * Two things live here that used to be scattered around the UI:
 *
 *   - `computeBreakpoint`, the width -> bucket mapping;
 *   - `breakpointValue`, which answers "the value for the current
 *     breakpoint" and falls back sensibly when a breakpoint has no value of
 *     its own. Before this, the five places that depend on the breakpoint
 *     each spelled out their own condition:
 *
 *         .sideBarWidth(this.breakPoint === 'lg' || this.breakPoint === 'xl' ? 280 : 240)
 *
 *     which is the same decision five times over, in five slightly
 *     different shapes, and none of it could be tested.
 *
 * The transport (AppStorage) and the reactive state stay in Breakpoint.ets;
 * only the decisions live here, where they can be checked.
 */

/** The four viewport buckets the application lays out for. */
export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl';

/** The buckets, from the narrowest to the widest. */
export const BREAKPOINT_ORDER: Breakpoint[] = ['sm', 'md', 'lg', 'xl'];

/** The upper bound (vp, exclusive) of each bucket. */
export const BREAKPOINT_MAX_WIDTH_VP: Record<Breakpoint, number> = {
  'sm': 600,
  'md': 840,
  'lg': 1440,
  'xl': Number.POSITIVE_INFINITY,
};

/**
 * Map a viewport width (vp) to its bucket.
 *
 * @param widthVp the width in virtual pixels
 * @returns the bucket the width falls into
 */
export function computeBreakpoint(widthVp: number): Breakpoint {
  if (widthVp < BREAKPOINT_MAX_WIDTH_VP['sm']) return 'sm';
  if (widthVp < BREAKPOINT_MAX_WIDTH_VP['md']) return 'md';
  if (widthVp < BREAKPOINT_MAX_WIDTH_VP['lg']) return 'lg';
  return 'xl';
}

/**
 * The value of a breakpoint-dependent setting, one entry per bucket.
 *
 * A bucket may be left out: the lookup then falls back to the nearest
 * bucket that has a value.
 */
export interface BreakpointValueOptions<T> {
  /** The value while the viewport is narrower than 600vp. */
  sm?: T;
  /** The value between 600 and 840vp. */
  md?: T;
  /** The value between 840 and 1440vp. */
  lg?: T;
  /** The value from 1440vp upwards. */
  xl?: T;
}

/**
 * The value for the current breakpoint, with a fallback cascade.
 *
 * The order of the cascade is: the current bucket first, then the narrower
 * ones, then the wider ones, and finally the caller's default. The narrow
 * side comes first because a setting that was designed for a small screen
 * is the safer choice when the layout is in between.
 *
 * A `current` that is not one of the four buckets means the width was never
 * computed; the default is returned then, and an error is thrown if there
 * is none.
 *
 * @param current the bucket the application is in
 * @param options the value per bucket
 * @param defaultValue the value to use when no bucket has one
 * @returns the value for the current bucket
 * @throws when neither a bucket nor the default has a value — that is a
 *         programming error, not a runtime condition
 */
export function breakpointValue<T>(
  current: Breakpoint,
  options: BreakpointValueOptions<T>,
  defaultValue?: T
): T {
  const order: Breakpoint[] = BREAKPOINT_ORDER;
  const index: number = order.indexOf(current);

  // A bucket that is not one of the four means the width was never
  // computed. The caller's default is the only sensible answer, and it is
  // the value the conditionals this replaced used to produce.
  if (index < 0) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error('breakpointValue: unknown breakpoint: ' + current);
  }

  // The bucket itself.
  {
    const own: T | undefined = options[order[index]];
    if (own !== undefined) return own;
  }

  // The narrower buckets, nearest first.
  for (let i = index - 1; i >= 0; i--) {
    const value: T | undefined = options[order[i]];
    if (value !== undefined) return value;
  }

  // The wider buckets, nearest first.
  for (let i = index + 1; i < order.length; i++) {
    const value: T | undefined = options[order[i]];
    if (value !== undefined) return value;
  }

  // The caller's default.
  if (defaultValue !== undefined) return defaultValue;

  // Any value at all, narrowest first.
  for (const bucket of order) {
    const value: T | undefined = options[bucket];
    if (value !== undefined) return value;
  }

  throw new Error('breakpointValue: neither a breakpoint nor a default has a value');
}
