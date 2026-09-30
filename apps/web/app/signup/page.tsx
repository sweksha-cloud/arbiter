'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { api } from '../../lib/api';
import { hasAccount, saveIdentity, useIdentity } from '../../lib/identity';
import { useSubmit } from '../../lib/use-submit';

export default function SignupPage() {
  const identity = useIdentity();
  const router = useRouter();
  const { handle, busy, error } = useSubmit();

  if (hasAccount(identity)) {
    return (
      <main className="page stack">
        <h1>You already have an account</h1>
        <p>
          You&apos;re logged in as <strong>{identity.email}</strong>. <Link href="/account">Go to your account</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="page stack">
      <h1>Make an account</h1>
      <p className="muted">
        Save your preferences and see your past sessions on any device.
        {identity && ' Everything you did as a guest on this device comes with you.'}
      </p>
      <form
        className="card stack"
        onSubmit={handle(async (value) => {
          saveIdentity(
            await api.signup(identity?.token, {
              displayName: identity ? undefined : value('displayName'),
              email: value('email'),
              password: value('password')
            })
          );
          router.push('/');
        })}
      >
        {identity ? (
          <p>
            Signing up as <strong>{identity.guest.displayName}</strong>
          </p>
        ) : (
          <label className="field">
            <span>What should your friends call you?</span>
            <input name="displayName" maxLength={30} autoComplete="nickname" required />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            aria-describedby="password-hint"
            required
          />
          <span id="password-hint" className="muted small">
            At least 8 characters. A few words together is easy to remember and hard to guess.
          </span>
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? 'Creating your account…' : 'Make my account'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="small">
          Already have one? <Link href="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}
