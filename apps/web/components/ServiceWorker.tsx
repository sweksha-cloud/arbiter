'use client';

import { useEffect } from 'react';

/** Registers the offline-page service worker (public/sw.js), in production builds only. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // No offline page then; everything else works the same.
    });
  }, []);
  return null;
}
