/**
 * Where to go after logging in or signing up: the `?next=` page if it's one
 * of ours, else home. Only same-site paths, so a link can't send someone off
 * to another website after they log in.
 */
export function nextPath(search: string = window.location.search): string {
  const next = new URLSearchParams(search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

/** A login or signup link that comes back to `path` afterwards. */
export const withNext = (href: '/login' | '/signup', path: string) => (path === '/' ? href : `${href}?next=${encodeURIComponent(path)}`);
