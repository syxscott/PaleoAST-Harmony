/**
 * The colour tokens of the application — the single source of truth.
 *
 * Before this file the .ets layer carried 442 hard-coded hex literals across
 * 57 files, and the dark theme was applied by 72 hand-written
 * `darkMode ? '#a' : '#b'` ternaries. Two consequences:
 *
 *   1. a colour was spelled out again for every use, so "the secondary text
 *      colour" was #7F8C8D in one file and #95A5A6 in the next;
 *   2. nothing switched with the system theme, because ArkUI's resource
 *      mechanism (`$r('app.color.x')` + `resources/dark/`) was never wired
 *      up — `color.json` existed, but no .ets file referenced a single
 *      resource.
 *
 * The arrangement now:
 *
 *   - THIS FILE holds every colour, once, with its light and its dark value.
 *   - `tools/gen_theme_resources.mjs` generates
 *     `resources/base/element/color.json` and `resources/dark/element/color.json`
 *     from it, so the ArkUI resource files cannot drift from the table below.
 *   - UI attributes use `$r('app.color.<token>')`. ArkUI resolves those against
 *     `base/` or `dark/` depending on the colour mode, and `ThemeController`
 *     keeps the colour mode in step with the in-app switch.
 *   - Canvas and the SVG exporter need a *string*, not a Resource, so they call
 *     `token(name, dark)` instead. Both read the same table, so the figure on
 *     screen and the figure in the exported report cannot disagree.
 *
 * This module is plain TypeScript on purpose: it holds no ArkUI import, so
 * the unit test suite can check it directly (tests/theme2026.test.ts).
 */

/** A colour that has a different value in the light and the dark theme. */
export interface ThemeColor {
  /** The value used while the light theme is active. */
  light: string;
  /** The value used while the dark theme is active. */
  dark: string;
}

/**
 * Every colour of the application.
 *
 * Names are role-based, not appearance-based: `text_secondary` says what the
 * colour is FOR, so a file that wants "the quiet label" asks for it by name
 * and does not have to know whether that is #7F8C8D or #AAAAAA today.
 *
 * The values are the ones the application already used, so the light theme
 * renders exactly as it did before the tokens were introduced.
 */
export const TOKENS: Record<string, ThemeColor> = {
  // ─── Surfaces ────────────────────────────────────────────────────────
  /**
   * The background of the launch window. `module.json5` refers to it as
   * "$color:start_window_background", so the name is fixed by the manifest
   * and cannot be renamed to something more consistent.
   */
  'start_window_background': { light: '#FFFFFF', dark: '#1A1A2E' },
  /** The window background and the main page surface. */
  'bg_primary': { light: '#FFFFFF', dark: '#1A1A2E' },
  /** The background of a section that sits on the main surface. */
  'bg_secondary': { light: '#F8F9FA', dark: '#16213E' },
  /** A raised surface: cards, pop-ups, the table header. */
  'bg_elevated': { light: '#FAFBFC', dark: '#0F3460' },
  /** A quiet tinted surface: inactive rows, the empty state. */
  'bg_tint': { light: '#EBF5FB', dark: '#2A2A4A' },
  /** The row or cell that is currently selected. */
  'bg_selected': { light: '#FDF2E9', dark: '#2A2A4A' },
  /** A muted neutral surface, used for inactive headers. */
  'bg_muted': { light: '#95A5A6', dark: '#333333' },
  /** A notice strip that has to be readable but must not shout. */
  'bg_notice': { light: '#FFFFCC', dark: '#3A3320' },
  /** The surface of the element that is being edited right now. */
  'bg_active': { light: '#FFFFFF', dark: '#2A2A4A' },
  /** The header strip of the data table. */
  'bg_header': { light: '#E4E7EB', dark: '#0F3460' },

  // ─── Text ─────────────────────────────────────────────────────────────
  /** The colour of running text. */
  'text_primary': { light: '#2C3E50', dark: '#CCCCCC' },
  /** The colour of a label that supports the main text. */
  'text_secondary': { light: '#7F8C8D', dark: '#AAAAAA' },
  /** The colour of a hint, a placeholder, a disabled item. */
  'text_muted': { light: '#95A5A6', dark: '#888888' },
  /** Text that sits ON the accent colour — never a themed surface. */
  'text_on_accent': { light: '#FFFFFF', dark: '#FFFFFF' },
  /**
   * A control that cannot be used: the greyed-out undo arrow, the version
   * line in the corner. It was the same grey in both themes before, and it
   * stays the same — a disabled control has to look disabled in either.
   */
  'text_disabled': { light: '#BDC3C7', dark: '#BDC3C7' },
  /** The tick labels along an axis. */
  'text_axis': { light: '#95A5A6', dark: '#AAAAAA' },
  /** The axis line itself. */
  'axis_line': { light: '#7F8C8D', dark: '#CCCCCC' },
  /** The strongest text on the current surface: the title of a figure. */
  'text_strong': { light: '#2C3E50', dark: '#FFFFFF' },

  // ─── Accent ───────────────────────────────────────────────────────────
  /** The accent colour: the primary button, the active tab, the series 1. */
  'primary': { light: '#3498DB', dark: '#3498DB' },
  /** The pressed state of the accent colour. */
  'primary_pressed': { light: '#2980B9', dark: '#2980B9' },

  // ─── Borders ──────────────────────────────────────────────────────────
  /** The hairline between rows, cards and sections. */
  'border_light': { light: '#E4E7EB', dark: '#333333' },

  // ─── Status ───────────────────────────────────────────────────────────
  /** Something failed. */
  'danger': { light: '#E74C3C', dark: '#E74C3C' },
  /** Something needs attention. */
  'warning': { light: '#F39C12', dark: '#F39C12' },
  /** Something succeeded. */
  'success': { light: '#27AE60', dark: '#27AE60' },

  // ─── Data series ─────────────────────────────────────────────────────
  // The palette a plot cycles through. The order is the order the series
  // are handed out in, so it is part of the contract, not a detail.
  'series_1': { light: '#3498DB', dark: '#3498DB' },
  'series_2': { light: '#E74C3C', dark: '#E74C3C' },
  'series_3': { light: '#27AE60', dark: '#27AE60' },
  'series_4': { light: '#F39C12', dark: '#F39C12' },
  'series_5': { light: '#9B59B6', dark: '#9B59B6' },
  'series_6': { light: '#1ABC9C', dark: '#1ABC9C' },
};

/**
 * Colours that carry an alpha channel.
 *
 * ArkUI reads a *resource* colour as #AARRGGBB but a *string* colour as
 * #RRGGBBAA, so an eight-digit value must never become a resource: the two
 * notations would stand for different colours and the tint would turn into a
 * solid block. These stay strings, and `tools/gen_theme_resources.mjs` keeps
 * them out of color.json on purpose.
 */
export const ALPHA_TOKENS: Record<string, ThemeColor> = {
  /** The drop shadow of a raised card. */
  'shadow_soft': { light: '#00000010', dark: '#00000010' },
  /** The drop shadow of a floating toolbar. */
  'shadow_strong': { light: '#00000020', dark: '#00000020' },
  /** The faint stripe of every second row of the data table. */
  'row_stripe': { light: '#F8F9FA08', dark: '#16213E08' },
  /** The cell the user has clicked. */
  'cell_selected': { light: '#3498DB40', dark: '#3498DB40' },
};

/**
 * The order in which the data-series colours are handed out. The order is
 * part of the contract: series 1 of one analysis has to be the same colour
 * as series 1 of the next one.
 */
export const SERIES_TOKEN_ORDER: string[] = [
  'series_1', 'series_2', 'series_3', 'series_4', 'series_5', 'series_6',
];

/**
 * The colour of the n-th data series, 0-based.
 *
 * @param index the series number
 * @returns the colour of that series
 */
export function seriesColor(index: number): string {
  const name: string = SERIES_TOKEN_ORDER[
    ((index % SERIES_TOKEN_ORDER.length) + SERIES_TOKEN_ORDER.length) % SERIES_TOKEN_ORDER.length
  ];
  return TOKENS[name].light;
}

/**
 * The whole series palette, in order.
 *
 * @returns the six series colours
 */
export function seriesPalette(): string[] {
  return SERIES_TOKEN_ORDER.map((name: string) => TOKENS[name].light);
}

/**
 * The value of one token for one theme.
 *
 * @param name the token name, e.g. 'text_secondary'
 * @param dark true for the dark theme, false for the light one
 * @returns the hex colour, e.g. '#7F8C8D'
 * @throws when the token does not exist — a typo must not silently render
 *         as "no colour at all"
 */
export function token(name: string, dark: boolean): string {
  const entry: ThemeColor | undefined = TOKENS[name] ?? ALPHA_TOKENS[name];
  if (entry === undefined) {
    throw new Error(`Unknown colour token: ${name}`);
  }
  return dark ? entry.dark : entry.light;
}

/**
 * The light and the dark value of one token, for the cases where both are
 * needed at once (a gradient, a legend that shows the two themes).
 *
 * @param name the token name
 * @returns the two values, light first
 */
export function tokenPair(name: string): [string, string] {
  const entry: ThemeColor | undefined = TOKENS[name] ?? ALPHA_TOKENS[name];
  if (entry === undefined) {
    throw new Error(`Unknown colour token: ${name}`);
  }
  return [entry.light, entry.dark];
}

/**
 * Every token name, sorted. The generator writes one resource file per
 * theme out of this, and the unit test compares the two lists.
 *
 * @returns the token names
 */
export function tokenNames(): string[] {
  return Object.keys(TOKENS).sort();
}

/**
 * The names of the tokens that carry an alpha channel. They are string-only
 * and never become a resource.
 *
 * @returns the alpha token names
 */
export function alphaTokenNames(): string[] {
  return Object.keys(ALPHA_TOKENS).sort();
}
