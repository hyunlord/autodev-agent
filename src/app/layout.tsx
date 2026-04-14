import type { Metadata } from 'next';
import ClientShell from './components/ClientShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'AutoDev Agent',
  description: 'Universal AI Development Agent Orchestrator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="bg-[var(--bg-primary)] text-[var(--text-primary)] antialiased">
        {children}
        <ClientShell />
      </body>
    </html>
  );
}
