/**
 * The Content Security Policy: only this app's own scripts (carrying this
 * request's nonce) may run, and the page may only talk to itself and the
 * Arbiter server. Sign-in tokens live in localStorage, so stopping injected
 * scripts is what keeps them safe (SECURITY.md).
 */
export function contentSecurityPolicy({ nonce, serverUrl, dev }: { nonce: string; serverUrl: string; dev: boolean }) {
  const server = new URL(serverUrl);
  // Socket.IO upgrades to a WebSocket on the same host.
  const socketOrigin = `${server.protocol === 'https:' ? 'wss:' : 'ws:'}//${server.host}`;
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets scripts Next.js loads (which carry the nonce) load their own chunks.
    // Development needs eval for React's debugging tools; production never does.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Inline style attributes (like the progress bar's width) need this; styles can't run code.
    "style-src 'self' 'unsafe-inline'",
    // Inline SVG data: URLs are allowed for small graphics. Place photos load
    // from the API server, which sends the browser on to Google's image host.
    `img-src 'self' data: ${server.origin} https://*.googleusercontent.com`,
    "font-src 'self'",
    // The offline-page service worker (public/sw.js), from this site only.
    "worker-src 'self'",
    `connect-src 'self' ${server.origin} ${socketOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only once the API is on HTTPS: over plain HTTP (local dev, phones on the LAN) it would break every call.
    ...(server.protocol === 'https:' ? ['upgrade-insecure-requests'] : [])
  ].join('; ');
}

/** Headers every page gets alongside the CSP. */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  // Never send full page URLs (which can hold session codes) to other sites.
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Location is used to pick the meeting spot; nothing else is needed.
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=()'
};
