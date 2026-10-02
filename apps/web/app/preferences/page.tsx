'use client';

import Link from 'next/link';
import { useState } from 'react';

import { NameForm } from '../../components/NameForm';
import { PreferencesForm } from '../../components/PreferencesForm';
import { SaveProgress } from '../../components/SaveProgress';
import { api } from '../../lib/api';
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
          initial={preferences}
          submitLabel="Save"
          onSubmit={async (p) => {
            await api.savePreferences(identity.token, p);
            setPreferences(p);
            setSaved(true);
          }}
        />
      )}
      {saved && <p className="success">Saved. They&apos;ll be filled in for you in your next session.</p>}
      {saved && <SaveProgress />}
    </main>
  );
}
