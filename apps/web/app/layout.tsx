import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { SiteHeader } from '../components/SiteHeader';
import './globals.css';

export const metadata: Metadata = {
  title: 'Arbiter',
  description: 'Fair group food decisions, fast.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fce4d8' },
    { media: '(prefers-color-scheme: dark)', color: '#211b38' }
  ]
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Render per request, so each page gets its own CSP nonce (proxy.ts).
  await connection();
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
