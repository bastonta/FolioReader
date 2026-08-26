import { en } from './translations/en';

export type TranslationKey = keyof typeof en;
export type Language = 'system' | 'en' | 'ru';
export type ResolvedLanguage = 'en' | 'ru';

export type TranslationParams = Record<string, string | number>;

export interface I18nContextValue {
  language: Language;
  resolvedLanguage: ResolvedLanguage;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

