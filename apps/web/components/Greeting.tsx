'use client';

import { useState } from 'react';

import { forgetActiveSession } from '../lib/active-session';
import { api } from '../lib/api';
import { clearIdentity, saveIdentity, type Identity } from '../lib/identity';
import { useSubmit } from '../lib/use-submit';

/**
 * "Hi Angel." with two ways out: Change name (same person, new name; answers
 * and sessions kept) and Not you? (this device forgets them and asks for a
 * name again, e.g. on a shared phone).
 */
export function Greeting({ identity }: { identity: Identity }) {
  const [editing, setEditing] = useState(false);
  const rename = useSubmit();
  const [leaving, setLeaving] = useState(false);

  // Signs this device out (a guest's sign-in too), so the next person starts fresh.
  async function notYou() {
    setLeaving(true);
    await api.logout(identity.token).catch(() => {});
    forgetActiveSession();
    clearIdentity();
  }

  if (editing) {
    return (
      <form
        className="stack tight"
        onSubmit={rename.handle(async (value) => {
          const { guest } = await api.changeName(identity.token, value('name'));
          saveIdentity({ ...identity, guest });
          setEditing(false);
        })}
      >
        <label className="field">
          <span>What should your friends call you?</span>
          <input
            name="name"
            defaultValue={identity.guest.displayName}
            maxLength={30}
            autoComplete="nickname"
            pattern=".*\S.*"
            title="Enter a name"
            required
            autoFocus
          />
        </label>
        <div className="row nowrap">
          <button className="button primary grow" disabled={rename.busy}>
            {rename.busy ? 'Saving…' : 'Save name'}
          </button>
          <button type="button" className="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
        {rename.error && <p className="error">{rename.error}</p>}
      </form>
    );
  }

  return (
    <div className="greeting">
      <p className="greeting-name">
        Hi <strong>{identity.guest.displayName}</strong>.
      </p>
      <div className="greeting-actions">
        <button type="button" className="pill-button" onClick={() => setEditing(true)}>
          Change name
        </button>
        <button type="button" className="pill-button" onClick={notYou} disabled={leaving}>
          Not you?
        </button>
      </div>
    </div>
  );
}
