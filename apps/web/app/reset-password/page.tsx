'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { saveIdentity } from '../../lib/identity';
import { useLinkToken } from '../../lib/use-link-token';
import { useSubmit } from '../../lib/use-submit';

export default function ResetPasswordPage() {
  const token = useLinkToken();
  const router = useRouter();
  const { handle, busy, error } = useSubmit();

  if (token === undefined) return null;
  if (!token) {
    return (
      <main className="page stack">
        <h1>This link isn&apos;t complete</h1>
        <p>
          Open the link from your email again, or <Link href="/forgot-password">ask for a new one</Link>.
        </p>
      </main>
    );
  }

  return (
    <main className="page stack">
      <h1>Choose a new password</h1>
      <form
        className="card stack"
        onSubmit={handle(async (value) => {
          saveIdentity(await api.resetPassword(token, value('password')));
          // Drop the used token from the address bar and history.
          window.history.replaceState(null, '', '/reset-password');
          router.push('/');
        })}
      >
        <label className="field">
          <span>New password</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
          <span className="muted small">At least 8 characters. This signs you out on your other devices.</span>
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save and log in'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error} <Link href="/forgot-password">Ask for a new link</Link>
          </p>
        )}
      </form>
    </main>
  );
}
