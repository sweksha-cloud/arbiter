'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { api } from '../lib/api';
import { hasAccount, loadIdentity, saveIdentity, useIdentity } from '../lib/identity';

/** On every page: log in / sign up, or your account and past sessions. */
export function SiteHeader() {
  const identity = useIdentity();

  // Check the saved sign-in with the server once per page load. A token that
  // was revoked elsewhere (logout, password change or reset) gets a 401, and
  // api.ts then clears it; otherwise refresh the account email, which older
  // saved identities don't have.
  const token = identity?.token;
  useEffect(() => {
    if (!token) return;
    api.me(token).then(
      (me) => {
        const saved = loadIdentity();
        if (saved?.token === token && saved.email !== me.email) saveIdentity({ ...saved, email: me.email });
      },
      () => {}
    );
  }, [token]);

  return (
    <header className="site-header">
      <Link href="/" className="brand">
        Arbiter
      </Link>
      {identity !== undefined && (
        <nav aria-label="Account" className="row nowrap">
          {hasAccount(identity) ? (
            <>
              <Link href="/history">Past sessions</Link>
              <Link href="/account">Account</Link>
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Sign up</Link>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
