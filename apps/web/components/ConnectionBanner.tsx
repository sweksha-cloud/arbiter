'use client';

import { useEffect, useState } from 'react';

import { useDelayedFlag } from '../lib/use-delayed-flag';

/**
 * A banner while the live connection is down, and a brief "Back online" once
 * it returns. Waits a moment before showing so a quick blip doesn't flash it.
 */
export function ConnectionBanner({ connected }: { connected: boolean }) {
  // The browser knows about lost wifi immediately; the socket can take a while to notice.
  const [browserOffline, setBrowserOffline] = useState(false);
  useEffect(() => {
    const update = () => setBrowserOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const down = useDelayedFlag(!connected || browserOffline, 1500);
  const [backOnline, setBackOnline] = useState(false);
  const [wasDown, setWasDown] = useState(false);

  // Remember that the banner was shown, so returning can say "Back online".
  if (down && !wasDown) setWasDown(true);
  if (!down && wasDown) {
    setWasDown(false);
    setBackOnline(true);
  }
  useEffect(() => {
    if (!backOnline) return;
    const timer = setTimeout(() => setBackOnline(false), 2500);
    return () => clearTimeout(timer);
  }, [backOnline]);

  if (down) {
    return (
      <div className="connection-banner down" role="status">
        {browserOffline ? 'You’re offline. Reconnecting when your connection is back…' : 'Lost connection to Arbiter. Reconnecting…'}
      </div>
    );
  }
  if (backOnline) {
    return (
      <div className="connection-banner up" role="status">
        Back online
      </div>
    );
  }
  return null;
}
