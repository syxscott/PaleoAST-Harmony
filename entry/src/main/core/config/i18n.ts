/**
 * PaleoAST Internationalization Module — ArkTS port of config/i18n/
 *
 * Provides Chinese/English language switching for the application.
 *
 * Usage:
 *   import { t, setLanguage, getLanguage, getTranslator } from '../config/i18n';
 *
 *   // Simple translation
 *   const label = t('dialog.pca.title');
 *
 *   // With format arguments  ({0}, {1}, ... placeholders)
 *   t('status.loaded_rows', rows)
 *
 *   // Language switching
 *   setLanguage('zh');
 */

import { TRANSLATIONS_EN } from './i18n/translations_en';
import { TRANSLATIONS_ZH } from './i18n/translations_zh';

export type Language = 'en' | 'zh';

type LanguageChangeListener = (lang: Language) => void;

/** Format '{0}', '{1}', ... placeholders the same way Python's str.format does. */
function formatMessage(template: string, args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const i = parseInt(index, 10);
    return i >= 0 && i < args.length ? String(args[i]) : match;
  });
}

/** Base translator without UI-framework dependency. */
export class TranslatorBase {
  protected _translations: Map<Language, Record<string, string>> = new Map();
  protected _currentLang: Language = 'en';

  constructor() {
    this._translations.set('en', TRANSLATIONS_EN);
    this._translations.set('zh', TRANSLATIONS_ZH);
  }

  /** Translate a key; falls back to English then to the key itself. */
  translate(key: string): string {
    const dict = this._translations.get(this._currentLang);
    if (dict && dict[key] !== undefined) return dict[key];
    const en = this._translations.get('en');
    if (en && en[key] !== undefined) return en[key];
    return key;
  }

  /** Alias of translate() for Qt-style call sites. */
  tr(key: string): string {
    return this.translate(key);
  }

  setLanguage(lang: Language): void {
    if (this._translations.has(lang) || lang === 'en' || lang === 'zh') {
      this._currentLang = lang;
    }
  }

  getLanguage(): Language {
    return this._currentLang;
  }

  availableLanguages(): Language[] {
    return ['en', 'zh'];
  }

  /** Merge additional keys at runtime (used by plugins). */
  addTranslations(lang: Language, translations: Record<string, string>): void {
    const existing = this._translations.get(lang);
    this._translations.set(lang, { ...(existing ?? {}), ...translations });
  }
}

/** Application translator with language-change notification. */
export class Translator extends TranslatorBase {
  private _listeners: LanguageChangeListener[] = [];

  setLanguage(lang: Language): void {
    if (lang === this._currentLang) return;
    super.setLanguage(lang);
    for (const cb of this._listeners) cb(lang);
  }

  addLanguageChangeListener(cb: LanguageChangeListener): void {
    this._listeners.push(cb);
  }

  removeLanguageChangeListener(cb: LanguageChangeListener): void {
    const i = this._listeners.indexOf(cb);
    if (i >= 0) this._listeners.splice(i, 1);
  }
}

let _translator: Translator | null = null;

/** Global translator singleton (mirrors Python get_translator()). */
export function getTranslator(): Translator {
  if (!_translator) _translator = new Translator();
  return _translator;
}

/** Translate with optional positional format arguments. */
export function t(key: string, ...args: (string | number)[]): string {
  const raw = getTranslator().translate(key);
  return args.length > 0 ? formatMessage(raw, args) : raw;
}

export function setLanguage(lang: Language): void {
  getTranslator().setLanguage(lang);
}

export function getLanguage(): Language {
  return getTranslator().getLanguage();
}

export function tr(key: string): string {
  return getTranslator().translate(key);
}
