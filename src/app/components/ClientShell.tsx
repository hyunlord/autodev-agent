'use client';

import dynamic from 'next/dynamic';

const CommandPalette = dynamic(() => import('./CommandPalette'), { ssr: false });
const OnboardingTour = dynamic(() => import('./OnboardingTour'), { ssr: false });

export default function ClientShell() {
  return (
    <>
      <CommandPalette />
      <OnboardingTour />
    </>
  );
}
