/**
 * Application settings — key names and defaults in one place.
 *
 * Every persisted key is declared here so that `PreferenceManager` and the UI
 * cannot drift apart on spelling, and so `loadAllToAppStorage()` has a single
 * source of truth for defaults.
 */
export class AppSettings {
  /** Preferences store file name. */
  static readonly STORE_NAME: string = 'paleoast_settings';

  // ─── Appearance ────────────────────────────────────────────────────
  static readonly KEY_DARK_MODE: string = 'darkMode';
  static readonly DEFAULT_DARK_MODE: boolean = false;

  // ─── Numerics ──────────────────────────────────────────────────────
  /** Decimal places used when formatting statistical output. */
  static readonly KEY_DECIMAL_PRECISION: string = 'decimalPrecision';
  static readonly DEFAULT_DECIMAL_PRECISION: number = 4;

  /** Significance level used by the tests (alpha). */
  static readonly KEY_ALPHA: string = 'alpha';
  static readonly DEFAULT_ALPHA: number = 0.05;

  /** Default PRNG seed for reproducible simulations. */
  static readonly KEY_RNG_SEED: string = 'rngSeed';
  static readonly DEFAULT_RNG_SEED: number = 42;

  // ─── Workflow ──────────────────────────────────────────────────────
  /** Remember the last analysis the user ran, so it can be re-offered. */
  static readonly KEY_LAST_ANALYSIS: string = 'lastAnalysis';
  static readonly DEFAULT_LAST_ANALYSIS: string = '';

  /** Default format offered by the export dialog. */
  static readonly KEY_EXPORT_FORMAT: string = 'exportFormat';
  static readonly DEFAULT_EXPORT_FORMAT: string = 'CSV';

  /** Whether analyses are appended to the persistent history. */
  static readonly KEY_HISTORY_ENABLED: string = 'historyEnabled';
  static readonly DEFAULT_HISTORY_ENABLED: boolean = true;
}
