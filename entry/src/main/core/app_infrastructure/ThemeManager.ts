/**
 * Theme manager �� replaces app_infrastructure/theme/manager.py
 * Manages dark/light theme switching and propagation.
 */

import { LIGHT_THEME, DARK_THEME } from '../config/DesignSystem';
// ThemePalette is a pure type alias. Importing it as a VALUE binding makes the
// module graph fail to instantiate outside the hvigor/TS pipeline
// ("does not provide an export named 'ThemePalette'").
import type { ThemePalette } from '../config/DesignSystem';

export class ThemeManager {
  private static _instance: ThemeManager | null = null;
  private _dark: boolean = false;
  private _listeners: ((theme: ThemePalette) => void)[] = [];

  static getInstance(): ThemeManager {
    if (!ThemeManager._instance) ThemeManager._instance = new ThemeManager();
    return ThemeManager._instance;
  }

  get isDark(): boolean { return this._dark; }
  get theme(): ThemePalette { return this._dark ? DARK_THEME : LIGHT_THEME; }

  toggle(): void { this._dark = !this._dark; this._notify(); }
  setDark(dark: boolean): void { this._dark = dark; this._notify(); }
  onChange(listener: (theme: ThemePalette) => void): void { this._listeners.push(listener); }
  private _notify(): void { for (const l of this._listeners) l(this.theme); }
}
