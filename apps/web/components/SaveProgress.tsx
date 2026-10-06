'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { hasAccount, useIdentity } from '../lib/identity';
import { withNext } from '../lib/next-path';

// Closing the banner lasts until the browser tab closes; the next visit shows it again.
const CLOSED_KEY = 'arbiter.saveBannerClosed';

/**
 * A slim banner under the top bar on every page, for guests: log in or sign
 * up to keep their preferences and sessions (logging in brings this device's
 * progress along, TRADEOFFS.md 4h). Both come back to this page.
 */
export function SaveProgress() {
  const identity = useIdentity();
  const path = usePathname();
  const [closed, setClosed] = useState(true);

  useEffect(() => {
    try {
      setClosed(sessionStorage.getItem(CLOSED_KEY) === '1');
    } catch {
      setClosed(false);
    }
  }, []);

  // Not on the home page, where Start is the one main action (TRADEOFFS.md 23d); the header has Log in / Sign up.
  if (!identity || hasAccount(identity) || closed || path === '/' || path === '/login' || path === '/signup') return null;

  function close() {
    setClosed(true);
    try {
      sessionStorage.setItem(CLOSED_KEY, '1');
    } catch {
      // Storage blocked: it just comes back on the next page.
    }
  }

  return (
    <aside className="save-banner" aria-label="Save your progress">
      <p className="small">
        💾 <Link href={withNext('/login', path)}>Log in</Link> or <Link href={withNext('/signup', path)}>Sign up</Link> to save
        your progress.
      </p>
      <button className="button icon" onClick={close} aria-label="Close">
        ✕
      </button>
    </aside>
  );
}
