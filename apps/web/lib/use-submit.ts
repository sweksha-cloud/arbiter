'use client';

import { useState, type FormEvent } from 'react';

/**
 * Busy and error state for a form whose submit calls the server. Hands the
 * action the form's values, read from the page at submit time: fields are
 * left to the browser (not React state), so anything typed before the page
 * finished loading is kept (BUG-013).
 */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function handle(action: (values: (name: string) => string) => Promise<void>) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      setBusy(true);
      setError(undefined);
      try {
        await action((name) => String(data.get(name) ?? ''));
        form.reset();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      } finally {
        setBusy(false);
      }
    };
  }

  return { handle, busy, error };
}
