'use client';

import type { MeetingMode, NamedLocation, SessionView } from '@arbiter/shared';
import { useState } from 'react';

import { LocationPicker } from './LocationPicker';

const MODES: { mode: MeetingMode; label: string; detail: string }[] = [
  { mode: 'area', label: 'We already know the area', detail: 'You set it. Nobody else is asked for a location.' },
  {
    mode: 'between',
    label: 'Find a spot between us',
    detail: "Everyone shares where they're coming from, and Arbiter searches in the middle."
  }
];

export interface MeetingActions {
  setMode: (mode: MeetingMode) => Promise<void>;
  setArea: (area: NamedLocation) => Promise<void>;
  setOrigin: (origin: NamedLocation | null) => Promise<void>;
}

/**
 * Where the group is meeting, in the lobby. The host picks how (TRADEOFFS.md
 * 1b): a known area, or between everyone's starting points. Starting points
 * are private: others only see how many people shared one.
 */
export function MeetingCard({
  view,
  myId,
  token,
  actions
}: {
  view: SessionView;
  myId: string;
  token: string;
  actions: MeetingActions;
}) {
  const { meeting } = view;
  const isHost = view.hostId === myId;
  const hostName = view.members.find((m) => m.id === view.hostId)?.displayName ?? 'The host';
  const [error, setError] = useState<string>();

  async function chooseMode(mode: MeetingMode) {
    setError(undefined);
    try {
      await actions.setMode(mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  }

  return (
    <section className="card stack" aria-labelledby="meeting-heading">
      <h2 id="meeting-heading">Where to meet</h2>

      {isHost ? (
        <fieldset className="field">
          <legend className="small muted">
            {meeting.mode ? 'You can switch until results are shown.' : 'Choose how to pick the area.'}
          </legend>
          <div className="segmented">
            {MODES.map(({ mode, label }) => (
              <button key={mode} type="button" aria-pressed={meeting.mode === mode} onClick={() => chooseMode(mode)}>
                {label}
              </button>
            ))}
          </div>
          {meeting.mode && <p className="small muted">{MODES.find((m) => m.mode === meeting.mode)?.detail}</p>}
        </fieldset>
      ) : (
        meeting.mode === null && <p className="muted">Waiting for {hostName} to choose where to meet.</p>
      )}
      {error && <p className="error">{error}</p>}

      {meeting.mode === 'area' &&
        (isHost ? (
          <LocationPicker token={token} label="Search near" value={meeting.area} onChoose={actions.setArea} />
        ) : meeting.area ? (
          <p>
            Meeting near <strong>{meeting.area.label ?? `${hostName}'s current location`}</strong>
          </p>
        ) : (
          <p className="muted">Waiting for {hostName} to set the area.</p>
        ))}

      {meeting.mode === 'between' && (
        <>
          <p>
            <strong>Meeting spot: between everyone</strong>{' '}
            <span className="muted small">
              ({meeting.sharedIds.length} of {view.members.length} shared)
            </span>
          </p>
          <LocationPicker
            token={token}
            label="Where are you coming from?"
            value={meeting.myOrigin}
            onChoose={actions.setOrigin}
            onClear={() => actions.setOrigin(null)}
          />
          <p className="small muted">Only used to find a fair place to meet. Nobody else sees it.</p>
          {meeting.tooFarApart && (
            <p className="warning small" role="alert">
              You&apos;re too far apart to meet in the middle: someone would come more than 30 miles.
              {isHost ? ' Choose "We already know the area" instead.' : ` ${hostName} can set an area instead.`}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** "Searched near San Francisco, CA, USA", shown above the results. */
export function searchedNearText(view: SessionView): string {
  const { meeting } = view;
  const hostName = view.members.find((m) => m.id === view.hostId)?.displayName ?? 'the host';
  if (meeting.searchedNear) return `Searched near ${meeting.searchedNear}`;
  if (meeting.mode === 'between') return 'Searched around the middle of the group';
  return `Searched near ${hostName}'s location`;
}
