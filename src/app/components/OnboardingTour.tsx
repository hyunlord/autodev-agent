'use client';

import { useEffect, useState } from 'react';

export default function OnboardingTour() {
  const [hasSeenTour, setHasSeenTour] = useState(true);

  useEffect(() => {
    const seen = localStorage.getItem('autodev-onboarding-done');
    if (!seen) setHasSeenTour(false);
  }, []);

  useEffect(() => {
    if (hasSeenTour) return;
    // Only run tour on the dashboard (Mission Control)
    if (window.location.pathname !== '/') return;

    const timeout = setTimeout(() => {
      import('driver.js').then(({ driver }) => {
        // @ts-expect-error CSS module has no type declarations
        import('driver.js/dist/driver.css');
        const driverObj = driver({
          showProgress: true,
          animate: true,
          overlayColor: 'rgba(0, 0, 0, 0.7)',
          popoverClass: 'autodev-tour-popover',
          steps: [
            {
              element: '[data-tour="view-tabs"]',
              popover: {
                title: 'Mission Control views',
                description: 'Switch between Kanban, Grid, and Timeline to manage your tasks.',
                side: 'bottom',
              },
            },
            {
              element: '[data-tour="new-task"]',
              popover: {
                title: 'Create a task',
                description: 'Click here to submit a new coding task. AutoDev will plan, code, and verify automatically.',
                side: 'bottom',
              },
            },
            {
              element: '[data-tour="kpi-bar"]',
              popover: {
                title: 'Performance metrics',
                description: 'Track success rate, costs, and verification scores across all tasks.',
                side: 'top',
              },
            },
            {
              element: '[data-tour="active-count"]',
              popover: {
                title: 'Active agents',
                description: 'See how many agents are currently working. AutoDev can run multiple tasks in parallel.',
                side: 'bottom',
              },
            },
          ],
          onDestroyed: () => {
            localStorage.setItem('autodev-onboarding-done', '1');
            setHasSeenTour(true);
          },
        });
        driverObj.drive();
      });
    }, 1500);

    return () => clearTimeout(timeout);
  }, [hasSeenTour]);

  return null;
}
