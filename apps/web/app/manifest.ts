import type { MetadataRoute } from 'next';

/**
 * Makes Arbiter installable: "Add to Home Screen" on an iPhone, "Install app"
 * on Android and desktop Chrome. It opens full screen like an app. No offline
 * mode: a live session needs the server anyway.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Arbiter',
    short_name: 'Arbiter',
    description: 'Fair group food decisions, fast.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#211b38',
    theme_color: '#211b38',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
