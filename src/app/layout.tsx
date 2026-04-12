import type { Metadata } from 'next';
import ClientShell from './components/ClientShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'AutoDev Agent',
  description: 'Universal AI Development Agent Orchestrator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 antialiased">
        {children}
        <ClientShell />
      </body>
    </html>
  );
}
