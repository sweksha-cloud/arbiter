'use client';

import Link from 'next/link';
import { useState } from 'react';

import { NameForm } from '../../components/NameForm';
import { PreferencesForm } from '../../components/PreferencesForm';
import { useIdentity } from '../../lib/identity';
import { usePreferences } from '../../lib/use-preferences';

export default function PreferencesPage() {
  const identity = useIdentity();
  const { preferences, setPreferences, error } = usePreferences(identity?.token);
  const [saved, setSaved] = useState(false);

  return (
    <main className="page stack">
      <p>
        <Link href="/">← Home</Link>
      </p>
      <h1>Your preferences</h1>

      {identity === null && <NameForm />}
      {error && <p className="error">{error}</p>}
      {identity && preferences !== undefined && (
        <PreferencesForm
          // Remount with fresh state when the loaded preferences change.
          key={identity.token}
          token={identity.token}
          initial={preferences}
          submitLabel="Save"
          onSaved={(p) => {
            setPreferences(p);
            setSaved(true);
          }}
        />
      )}
      {saved && <p className="success">Saved. They&apos;ll apply to every session you join.</p>}
    </main>
  );
}
