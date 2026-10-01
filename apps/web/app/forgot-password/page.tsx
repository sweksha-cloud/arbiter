'use client';

import Link from 'next/link';
import { useState } from 'react';

import { api } from '../../lib/api';
import { EMAIL_ENABLED } from '../../lib/config';
import { useSubmit } from '../../lib/use-submit';

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string>();
  const { handle, busy, error } = useSubmit();

  if (!EMAIL_ENABLED) {
    return (
      <main className="page stack">
        <h1>Reset your password</h1>
        <p>Password reset by email isn&apos;t available yet. If you&apos;re locked out, make a new account for now.</p>
        <p className="small">
          <Link href="/login">Back to log in</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="page stack">
      <h1>Reset your password</h1>
      {sentTo ? (
        <section className="card stack" role="status">
          <p>
            If there&apos;s an account for <strong>{sentTo}</strong>, we&apos;ve emailed it a link to choose a new
            password. The link works once, for an hour.
          </p>
          <p className="muted small">Nothing arrived? Check your spam folder, or try again in a few minutes.</p>
        </section>
      ) : (
        <form
          className="card stack"
          onSubmit={handle(async (value) => {
            await api.forgotPassword(value('email'));
            setSentTo(value('email'));
          })}
        >
          <p className="muted">Enter your account&apos;s email and we&apos;ll send you a link.</p>
          <label className="field">
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send me a link'}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      <p className="small">
        <Link href="/login">Back to log in</Link>
      </p>
    </main>
  );
}
