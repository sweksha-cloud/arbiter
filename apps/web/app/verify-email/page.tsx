'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '../../lib/api';
import { useLinkToken } from '../../lib/use-link-token';

export default function VerifyEmailPage() {
  const token = useLinkToken();
  const [result, setResult] = useState<'verified' | string>();

  useEffect(() => {
    if (!token) return;
    api.verifyEmail(token).then(
      () => {
        setResult('verified');
        window.history.replaceState(null, '', '/verify-email');
      },
      (e: unknown) => setResult(e instanceof Error ? e.message : 'Something went wrong')
    );
  }, [token]);

  if (token === undefined) return null;
  return (
    <main className="page stack">
      <h1>Confirm your email</h1>
      {!token ? (
        <p>This link isn&apos;t complete. Open the link from your email again.</p>
      ) : result === undefined ? (
        <p className="muted">Checking your link…</p>
      ) : result === 'verified' ? (
        <p className="success" role="status">
          Thanks, your email is confirmed. <Link href="/">Back to Arbiter</Link>
        </p>
      ) : (
        <p className="error">
          {result} <Link href="/account">Go to your account</Link>
        </p>
      )}
    </main>
  );
}
