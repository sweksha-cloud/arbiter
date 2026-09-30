'use client';

import { useEffect, useState } from 'react';

/**
 * The `#token=…` from an emailed link, read once when the page opens.
 * `undefined` until read, `null` if there isn't one. Read once (not on every
 * render) because the page removes it from the address bar after use, and
 * re-reading would then report the link as incomplete (BUG-017). Tokens are
 * in the fragment, which browsers never send to servers.
 */
export function useLinkToken(): string | null | undefined {
  const [token, setToken] = useState<string | null>();
  useEffect(() => {
    setToken(new URLSearchParams(window.location.hash.slice(1)).get('token'));
  }, []);
  return token;
}
