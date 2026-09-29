import type { ReactNode } from 'react';

export const metadata = {
  title: 'Arbiter',
  description: 'Fair group food decisions, fast.'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
