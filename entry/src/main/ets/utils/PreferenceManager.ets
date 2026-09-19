/**
 * Preferences-backed settings store.
 *
 * Wraps `@kit.ArkData` preferences so the UI only ever calls
 * `PreferenceManager.set(...)` / `get(...)` and never touches the underlying
 * handle. Two details that matter:
 *
 *   - the handle is cached in a static field, so `getPreferencesSync` runs once
 *     at startup instead of on every read;
 *   - `set()` flushes immediately, so a value survives an abrupt kill without
 *     an explicit save action.
 *
 * `loadAllToAppStorage()` is the bridge to reactive UI: it pushes every
 * persisted key (with its declared default) into AppStorage once, after which
 * components read through `@StorageLink`. Nothing else may write these keys
 * directly, otherwise disk and memory diverge.
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import Logger from './Logger';
import { AppSettings } from './AppSettings';

export class PreferenceManager {
  private static handle: preferences.Preferences | null = null;

  /** Call once from EntryAbility.onCreate (or onWindowStageCreate). */
  public static init(context: common.UIAbilityContext): void {
    if (PreferenceManager.handle) {
      return;
    }
    try {
      PreferenceManager.handle = preferences.getPreferencesSync(context, { name: AppSettings.STORE_NAME });
      Logger.info('[PreferenceManager] initialised');
    } catch (err) {
      const e = err as Error;
      Logger.error('[PreferenceManager] init failed: ' + e.message);
    }
  }

  /** Persist a value and flush it to disk. No-op (with a log) before init. */
  public static set(key: string, value: preferences.ValueType): void {
    if (!PreferenceManager.handle) {
      Logger.error('[PreferenceManager] set(' + key + ') ignored: not initialised');
      return;
    }
    try {
      PreferenceManager.handle.putSync(key, value);
      PreferenceManager.handle.flush();
    } catch (err) {
      const e = err as Error;
      Logger.error('[PreferenceManager] set(' + key + ') failed: ' + e.message);
    }
  }

  /** Read a value, falling back to `fallback` when unavailable. */
  public static get(key: string, fallback: preferences.ValueType): preferences.ValueType {
    if (!PreferenceManager.handle) {
      return fallback;
    }
    try {
      return PreferenceManager.handle.getSync(key, fallback);
    } catch (err) {
      const e = err as Error;
      Logger.error('[PreferenceManager] get(' + key + ') failed: ' + e.message);
      return fallback;
    }
  }

  /**
   * Publish every stored setting to AppStorage so `@StorageLink` consumers react.
   * Runs once at startup; defaults come from AppSettings.
   */
  public static loadAllToAppStorage(): void {
    if (!PreferenceManager.handle) {
      Logger.error('[PreferenceManager] cannot publish to AppStorage: not initialised');
      return;
    }
    AppStorage.setOrCreate(
      AppSettings.KEY_DARK_MODE,
      PreferenceManager.get(AppSettings.KEY_DARK_MODE, AppSettings.DEFAULT_DARK_MODE));
    AppStorage.setOrCreate(
      AppSettings.KEY_DECIMAL_PRECISION,
      PreferenceManager.get(AppSettings.KEY_DECIMAL_PRECISION, AppSettings.DEFAULT_DECIMAL_PRECISION));
    AppStorage.setOrCreate(
      AppSettings.KEY_ALPHA,
      PreferenceManager.get(AppSettings.KEY_ALPHA, AppSettings.DEFAULT_ALPHA));
    AppStorage.setOrCreate(
      AppSettings.KEY_RNG_SEED,
      PreferenceManager.get(AppSettings.KEY_RNG_SEED, AppSettings.DEFAULT_RNG_SEED));
    AppStorage.setOrCreate(
      AppSettings.KEY_LAST_ANALYSIS,
      PreferenceManager.get(AppSettings.KEY_LAST_ANALYSIS, AppSettings.DEFAULT_LAST_ANALYSIS));
    AppStorage.setOrCreate(
      AppSettings.KEY_EXPORT_FORMAT,
      PreferenceManager.get(AppSettings.KEY_EXPORT_FORMAT, AppSettings.DEFAULT_EXPORT_FORMAT));
    AppStorage.setOrCreate(
      AppSettings.KEY_HISTORY_ENABLED,
      PreferenceManager.get(AppSettings.KEY_HISTORY_ENABLED, AppSettings.DEFAULT_HISTORY_ENABLED));
    Logger.info('[PreferenceManager] settings published to AppStorage');
  }

  /** Read a setting straight from AppStorage (after loadAllToAppStorage). */
  public static fromAppStorage<T>(key: string, fallback: T): T {
    return AppStorage.get<T>(key) ?? fallback;
  }
}
