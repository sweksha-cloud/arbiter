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
  const forget = useSubmit();

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
    <div className="stack tight">
      <p>
        Hi <strong>{identity.guest.displayName}</strong>.
      </p>
      <form
        className="row nowrap small"
        onSubmit={forget.handle(async () => {
          // Signs this device out (a guest's sign-in too), so the next person starts fresh.
          await api.logout(identity.token).catch(() => {});
          forgetActiveSession();
          clearIdentity();
        })}
      >
        <button type="button" className="button link small" onClick={() => setEditing(true)}>
          Change name
        </button>
        <span className="muted" aria-hidden="true">
          ·
        </span>
        <button className="button link small" disabled={forget.busy}>
          Not you?
        </button>
      </form>
      {forget.error && <p className="error">{forget.error}</p>}
    </div>
  );
}
