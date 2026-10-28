import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/chrome';
import './globals.css';

export const metadata = { title: 'Tidewatch: berths without phone calls' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-surface font-sans text-fg">
        <SiteHeader />
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}
