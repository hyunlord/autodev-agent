'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import ko from './messages/ko.json';
import en from './messages/en.json';

const MESSAGES: Record<string, Record<string, unknown>> = { ko, en };
const STORAGE_KEY = 'autodev-locale';
const DEFAULT_LOCALE = 'ko';

type Locale = 'ko' | 'en';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  messages: Record<string, unknown>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const stored = localStorage.getItem(STORAGE_KEY);
  return (stored === 'ko' || stored === 'en') ? stored : DEFAULT_LOCALE;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // hydration-safe: read localStorage only after mount
  useEffect(() => {
    setLocaleState(getStoredLocale());
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const messages = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];

  return (
    <LocaleContext.Provider value={{ locale, setLocale, messages }}>
      {children}
    </LocaleContext.Provider>
  );
}

/** Resolve a dot-separated key from a nested object. Returns undefined if not found. */
function resolve(obj: unknown, key: string): string | undefined {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * Returns a `t(key)` function scoped to the given namespace.
 *
 * Usage:
 * ```ts
 * const t = useTranslations('header');
 * t('newTask')        // => "+ 새 작업"
 * t('active', { count: 3 }) // => "3개 활성"
 * ```
 *
 * Interpolation: `{varName}` in the message string is replaced with the
 * corresponding value from the `params` object.
 */
export function useTranslations(namespace?: string) {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useTranslations must be used within <LocaleProvider>');

  const root = namespace ? resolve(ctx.messages, namespace) : ctx.messages;
  // If namespace resolved to a subtree (object), use it; otherwise fall back to full messages
  const scope: unknown = (root != null && typeof root === 'object') ? root
    : (typeof root === 'string') ? ctx.messages
    : ctx.messages;

  return useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      // Try scoped lookup first
      let val = resolve(scope, key);
      // Fallback: try full path (namespace.key) from root messages
      if (val === undefined && namespace) {
        val = resolve(ctx.messages, `${namespace}.${key}`);
      }
      if (val === undefined) return key;
      if (!params) return val;
      // Interpolate {varName} placeholders
      return val.replace(/\{(\w+)\}/g, (_, k) =>
        params[k] !== undefined ? String(params[k]) : `{${k}}`
      );
    },
    [scope, namespace, ctx.messages],
  );
}

/** Access the raw locale context (locale value + setter). */
export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within <LocaleProvider>');
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}
