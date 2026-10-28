import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/shared/data/query-provider';
import { Nav } from '@/shared/nav/nav';
import { currentAccess, testAccess } from '@/shared/session/session';
import './globals.css';

const APP_NAME = "Reading list";

export const metadata: Metadata = { title: APP_NAME };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const access = await currentAccess();
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface font-sans text-body text-fg antialiased">
        {/* For fwos's IA harness: the role and flags this page was rendered for, only while FWOS_TEST_ACCESS=1. */}
        {testAccess() ? <meta name="fwos-access" content={JSON.stringify(access)} /> : null}
        <a
          href="#main"
          className="sr-only rounded-md bg-surface-elevated px-3 py-2 text-label text-fg focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <header className="border-b border-border-faint bg-surface-elevated">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <span className="text-heading text-fg">{APP_NAME}</span>
            <Nav access={access} />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-5xl px-4 py-8">
          <QueryProvider>{children}</QueryProvider>
        </main>
      </body>
    </html>
  );
}
