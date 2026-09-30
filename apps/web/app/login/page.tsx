'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { api } from '../../lib/api';
import { hasAccount, saveIdentity, useIdentity } from '../../lib/identity';
import { useSubmit } from '../../lib/use-submit';

export default function LoginPage() {
  const identity = useIdentity();
  const router = useRouter();
  const { handle, busy, error } = useSubmit();

  if (hasAccount(identity)) {
    return (
      <main className="page stack">
        <h1>You&apos;re logged in</h1>
        <p>
          As <strong>{identity.email}</strong>. <Link href="/account">Go to your account</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="page stack">
      <h1>Log in</h1>
      <form
        className="card stack"
        onSubmit={handle(async (value) => {
          saveIdentity(await api.login(identity?.token, { email: value('email'), password: value('password') }));
          router.push('/');
        })}
      >
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="auth-links small">
          <Link href="/forgot-password">Forgot your password?</Link>
          <Link href="/signup">Make an account</Link>
        </div>
      </form>
      {identity && (
        <p className="muted small">
          Logging in switches this device to your account. Preferences you set as a guest here stay with the guest.
        </p>
      )}
    </main>
  );
}
