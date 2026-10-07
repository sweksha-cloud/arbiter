import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Link from 'next/link';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { SaveProgress } from '../components/SaveProgress';
import { ServiceWorker } from '../components/ServiceWorker';
import { SiteHeader } from '../components/SiteHeader';
import './globals.css';

// One typeface everywhere (TRADEOFFS.md 23), self-hosted by Next: no request to Google from browsers.
const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

const description = 'Where should we eat? Everyone sets their must-haves privately, then you swipe together until you match.';

export const metadata: Metadata = {
  // Link previews need absolute URLs for the preview image (opengraph-image.tsx).
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arbiter-topaz.vercel.app'),
  title: 'Arbiter',
  description,
  openGraph: { title: 'Arbiter: where should we eat?', description, siteName: 'Arbiter', type: 'website' },
  twitter: { card: 'summary_large_image', title: 'Arbiter: where should we eat?', description },
  // Added to an iPhone's home screen, it opens full screen under this name.
  appleWebApp: { capable: true, title: 'Arbiter', statusBarStyle: 'default' }
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
    <html lang="en" className={sans.variable}>
      <body>
        <SiteHeader />
        <SaveProgress />
        <ServiceWorker />
        {children}
        <footer className="site-footer muted small">
          Chain nutrition information{' '}
          <a href="https://platform.fatsecret.com" target="_blank" rel="noreferrer">
            Powered by fatsecret Platform API
          </a>
          . Nothing here is nutrition or medical advice.
          <br />
          <Link href="/terms">Terms of Use</Link> · <Link href="/privacy">Privacy Policy</Link> ·{' '}
          <a href="https://github.com/sweksha-cloud/arbiter" target="_blank" rel="noreferrer">
            Code on GitHub
          </a>
        </footer>
      </body>
    </html>
  );
}
