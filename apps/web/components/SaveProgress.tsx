'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { hasAccount, useIdentity } from '../lib/identity';
import { withNext } from '../lib/next-path';

/** For guests: sign up or log in to keep their preferences and sessions. Both come back to this page. */
export function SaveProgress() {
  const identity = useIdentity();
  const path = usePathname();
  if (!identity || hasAccount(identity)) return null;

  return (
    <aside className="card save-progress" aria-label="Save your progress">
      <p className="small">
        <strong>Save your progress.</strong> <Link href={withNext('/signup', path)}>Sign up</Link> to keep your preferences and past
        sessions on any device, or <Link href={withNext('/login', path)}>log in</Link>.
      </p>
    </aside>
  );
}
