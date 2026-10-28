import type { ReactNode } from 'react';
import { HarborNav } from '@/components/shell';
import { currentSession } from '@/lib/api/client';
import './globals.css';

export const metadata = { title: 'Tidewatch' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  return (
    <html lang="en">
      <body className="bg-surface font-sans text-fg">
        <HarborNav session={session} />
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}
