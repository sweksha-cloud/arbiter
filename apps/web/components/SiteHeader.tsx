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
        {/* The app icon, small: the same sandwich as on the home screen. */}
        <img src="/icons/icon-192.png" alt="" width={28} height={28} />
        Arbiter
      </Link>
      {/* Desktop only: the site's sections, so the home page reads as a whole product. */}
      <nav aria-label="Site" className="site-nav">
        <Link href="/#how-it-works">How it works</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/#join-code">Join a session</Link>
      </nav>
      {identity !== undefined && (
        <nav aria-label="Account" className="row nowrap">
          {hasAccount(identity) ? (
            <>
              <Link href="/history" className="header-pill">
                Past sessions
              </Link>
              <Link href="/account" className="header-pill">
                Account
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="header-pill">
                Log in
              </Link>
              <Link href="/signup" className="header-pill strong">
                Sign up
              </Link>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
