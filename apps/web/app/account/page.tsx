'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from '../../lib/api';
import { EMAIL_ENABLED } from '../../lib/config';
import { clearIdentity, hasAccount, useIdentity } from '../../lib/identity';
import { useSubmit } from '../../lib/use-submit';

export default function AccountPage() {
  const identity = useIdentity();
  const router = useRouter();
  const [changed, setChanged] = useState(false);
  const change = useSubmit();
  const logout = useSubmit();
  const resend = useSubmit();
  const [verified, setVerified] = useState<boolean>();
  const [resent, setResent] = useState(false);
  const token = identity?.token;

  useEffect(() => {
    if (!token) return;
    api.me(token).then(
      (me) => setVerified(me.emailVerified),
      () => {}
    );
  }, [token]);

  if (identity === undefined) return null;
  if (!hasAccount(identity)) {
    return (
      <main className="page stack">
        <h1>Your account</h1>
        <p>
          You&apos;re using Arbiter as a guest. <Link href="/signup">Make an account</Link> to keep your preferences
          and past sessions, or <Link href="/login">log in</Link>.
        </p>
      </main>
    );
  }

  return (
    <main className="page stack">
      <h1>Your account</h1>
      <section className="card stack">
        <p>
          <strong>{identity.guest.displayName}</strong>
          <br />
          <span className="muted">{identity.email}</span>
        </p>
        <div className="row">
          <Link href="/history">Past sessions</Link>
          <Link href="/preferences">Your preferences</Link>
        </div>
      </section>

      {EMAIL_ENABLED && verified === false && (
        <form
          className="notice stack tight"
          onSubmit={resend.handle(async () => {
            await api.resendVerification(identity.token);
            setResent(true);
          })}
        >
          <p>
            <strong>Confirm your email.</strong> We sent a link to {identity.email} when you signed up.
          </p>
          {resent ? (
            <p className="small" role="status">
              Sent. The new link works for 24 hours.
            </p>
          ) : (
            <button className="button link" disabled={resend.busy}>
              Send the link again
            </button>
          )}
          {resend.error && <p className="error">{resend.error}</p>}
        </form>
      )}

      <form
        className="card stack"
        onSubmit={change.handle(async (value) => {
          await api.changePassword(identity.token, value('currentPassword'), value('newPassword'));
          setChanged(true);
        })}
      >
        <h2>Change your password</h2>
        <label className="field">
          <span>Current password</span>
          <input name="currentPassword" type="password" autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>New password</span>
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
          <span className="muted small">At least 8 characters. Your other devices will be signed out.</span>
        </label>
        <button className="button primary" disabled={change.busy}>
          {change.busy ? 'Saving…' : 'Change password'}
        </button>
        {change.error && (
          <p className="error" role="alert">
            {change.error}
          </p>
        )}
        {changed && (
          <p className="success" role="status">
            Password changed. Your other devices have been signed out.
          </p>
        )}
      </form>

      <form
        onSubmit={logout.handle(async () => {
          await api.logout(identity.token).catch(() => {});
          clearIdentity();
          router.push('/');
        })}
      >
        <button className="button" disabled={logout.busy}>
          Log out
        </button>
      </form>
    </main>
  );
}
