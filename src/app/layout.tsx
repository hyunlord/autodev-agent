import type { Metadata } from 'next';
import ClientShell from './components/ClientShell';
import { LocaleProvider } from '@/i18n/context';
import './globals.css';

export const metadata: Metadata = {
  title: 'AutoDev Agent',
  description: 'Universal AI Development Agent Orchestrator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark" suppressHydrationWarning>
      <body className="bg-[var(--bg-primary)] text-[var(--text-primary)] antialiased">
        <LocaleProvider>
          {children}
        </LocaleProvider>
        <ClientShell />
      </body>
    </html>
  );
}
