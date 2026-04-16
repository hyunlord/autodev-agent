'use client';

import { useEffect } from 'react';

/**
 * Reads the stored theme from localStorage and applies it to <html>.
 * Mounted in ClientShell so it runs on ALL pages, not just the homepage.
 * ThemeToggle handles the interactive toggle; this just initializes on mount.
 */
export default function ThemeInitializer() {
  useEffect(() => {
    const stored = localStorage.getItem('autodev-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored ? stored === 'dark' : prefersDark;

    const html = document.documentElement;
    if (isDark) {
      html.classList.add('dark');
      html.classList.remove('light');
    } else {
      html.classList.remove('dark');
      html.classList.add('light');
    }
  }, []);

  return null;
}
