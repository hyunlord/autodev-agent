'use client';

import dynamic from 'next/dynamic';
import ThemeInitializer from './ThemeInitializer';

const CommandPalette = dynamic(() => import('./CommandPalette'), { ssr: false });
const OnboardingTour = dynamic(() => import('./OnboardingTour'), { ssr: false });

export default function ClientShell() {
  return (
    <>
      <ThemeInitializer />
      <CommandPalette />
      <OnboardingTour />
    </>
  );
}
