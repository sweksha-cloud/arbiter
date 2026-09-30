import { NextResponse, type NextRequest } from 'next/server';

import { SERVER_URL } from './lib/config';
import { contentSecurityPolicy, SECURITY_HEADERS } from './lib/security-headers';

/**
 * Adds a fresh nonce and the Content Security Policy to every page request.
 * Next.js reads the nonce from the request's CSP header and puts it on its own
 * scripts, so only those run (lib/security-headers.ts).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy({ nonce, serverUrl: SERVER_URL, dev: process.env.NODE_ENV === 'development' });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not static files, and not link prefetches.
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' }
      ]
    }
  ]
};
