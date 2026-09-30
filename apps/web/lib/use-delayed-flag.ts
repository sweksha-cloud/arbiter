'use client';

import { useEffect, useState } from 'react';

/** True only once `value` has stayed true for `ms`. Hides blips like a quick page reload. */
export function useDelayedFlag(value: boolean, ms: number): boolean {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!value) {
      setDelayed(false);
      return;
    }
    const timer = setTimeout(() => setDelayed(true), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return value && delayed;
}
