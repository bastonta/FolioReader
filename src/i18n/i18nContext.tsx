import React, { createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { Language, ResolvedLanguage, TranslationParams, I18nContextValue, TranslationKey } from './types';
import { en } from './translations/en';
import { ru } from './translations/ru';

export function detectSystemLanguage(): ResolvedLanguage {
  if (typeof navigator !== 'undefined') {
    const list = navigator.languages || [navigator.language];
    for (const l of list) {
      if (l) {
        const lower = l.toLowerCase();
        if (lower.startsWith('ru') || lower.startsWith('be') || lower.startsWith('uk') || lower.startsWith('kk')) {
          return 'ru';
        }
        if (lower.startsWith('en')) {
          return 'en';
        }
      }
    }
  }
  return 'en';
}

export function resolveLanguage(setting: Language = 'system'): ResolvedLanguage {
  if (setting === 'ru') return 'ru';
  if (setting === 'en') return 'en';
  return detectSystemLanguage();
}

export function formatPluralRussian(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

export function translate(
  key: TranslationKey,
  params?: TranslationParams,
  lang: ResolvedLanguage = 'en'
): string {
  const dict = lang === 'ru' ? ru : en;
  let text = (dict as any)[key] || (en as any)[key] || key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
}

const I18nContext = createContext<I18nContextValue>({
  language: 'system',
  resolvedLanguage: 'en',
  setLanguage: () => {},
  t: (key: TranslationKey, params?: TranslationParams) => translate(key, params, 'en'),
});

interface I18nProviderProps {
  children: React.ReactNode;
  language?: Language;
  onLanguageChange?: (lang: Language) => void;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({
  children,
  language = 'system',
  onLanguageChange,
}) => {
  const [currentLang, setCurrentLang] = useState<Language>(language);
  const [systemLang, setSystemLang] = useState<ResolvedLanguage>(() => detectSystemLanguage());

  // Listen to external language prop changes
  useEffect(() => {
    setCurrentLang(language);
  }, [language]);

  // Listen to OS/browser language change events
  useEffect(() => {
    const handleLanguageChange = () => {
      setSystemLang(detectSystemLanguage());
    };
    window.addEventListener('languagechange', handleLanguageChange);
    return () => window.removeEventListener('languagechange', handleLanguageChange);
  }, []);

  const resolvedLanguage: ResolvedLanguage = useMemo(() => {
    if (currentLang === 'system') return systemLang;
    return currentLang;
  }, [currentLang, systemLang]);

  const setLanguage = useCallback(
    (newLang: Language) => {
      setCurrentLang(newLang);
      onLanguageChange?.(newLang);
    },
    [onLanguageChange]
  );

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => {
      return translate(key, params, resolvedLanguage);
    },
    [resolvedLanguage]
  );

  const value = useMemo<I18nContextValue>(() => ({
    language: currentLang,
    resolvedLanguage,
    setLanguage,
    t,
  }), [currentLang, resolvedLanguage, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useTranslation = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context;
};
