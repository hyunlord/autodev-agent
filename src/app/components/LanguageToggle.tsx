'use client';

import { useLocale } from '@/i18n/context';

const LANGUAGES = [
  { code: 'ko' as const, label: '한국어', flag: '\u{1F1F0}\u{1F1F7}' },
  { code: 'en' as const, label: 'English', flag: '\u{1F1FA}\u{1F1F8}' },
];

export default function LanguageToggle() {
  const { locale, setLocale } = useLocale();

  const current = LANGUAGES.find(l => l.code === locale) ?? LANGUAGES[0];
  const next = LANGUAGES.find(l => l.code !== locale) ?? LANGUAGES[1];

  return (
    <button
      onClick={() => setLocale(next.code)}
      className="text-xs px-2 py-1 rounded-md transition-colors hover:bg-gray-800"
      style={{ color: 'var(--text-secondary)' }}
      title={`Switch to ${next.label}`}
    >
      {current.flag} {current.code.toUpperCase()}
    </button>
  );
}
