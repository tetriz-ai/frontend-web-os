// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/shared/nav';
import { RegisterServiceWorker } from './register-sw';
import './globals.css';

const APP_NAME = "Tip Splitter";

// The security baseline (fwos check web/security, D-7, D-24). A static export can't set headers, so
// the policy ships as a meta tag; frame-ancestors can't be set from a meta tag, so the host sets it.
// 'unsafe-inline' is needed by Next's runtime; in development Next also needs 'unsafe-eval' and ws:
// for fast refresh.
const dev = process.env.NODE_ENV !== 'production';
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${dev ? ' ws:' : ''}`,
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export const metadata: Metadata = { title: APP_NAME };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
      </head>
      <body className="min-h-screen bg-surface font-sans text-body text-fg antialiased">
        <a
          href="#main"
          className="sr-only rounded-md border border-border bg-surface-elevated text-label text-fg focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="border-b border-border-faint bg-surface-elevated">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <span className="text-heading text-fg">{APP_NAME}</span>
            <Nav />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-5xl px-4 py-8">
          {children}
        </main>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
