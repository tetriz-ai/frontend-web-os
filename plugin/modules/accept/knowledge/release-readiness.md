# Release readiness

fwos never deploys, signs, notarizes or submits. It prepares the commands and a checklist per
channel; credentials are typed by the user into their own tools, never into chat.

## Web

- [ ] `next build` passes and the e2e suite ran against the production artifact with its actual
      serve command (TC-default-prod): `next start` for a Next.js server, or a static file server
      serving `out/` for `output: 'export'`; not `next dev`
- [ ] Environment variables documented in `.env.example`; real values set in the host, not the repo
- [ ] The effective Content-Security-Policy allows only what the app needs (add analytics or API
      origins explicitly): response headers from `next.config.ts` or proxy/middleware for a server,
      or a CSP meta tag or host-applied `public/_headers` for a static export. Confirm the chosen
      host actually sends any configured headers; a static export does not run Next.js headers().
- [ ] App identity (C18): name, favicon, social image filled (no placeholder)
- [ ] Privacy: what's collected and where it goes matches spec section 6; consent first if there are
      EU users and any analytics
- [ ] Hosting picked; deploy command written down for the user (for example their host's CLI)

## Electron and Mac

Signing, notarization, App Store privacy answers and the entitlement list are added with those
platforms. Until then, the spec records them as planned, and the acceptance report lists them as
not built in this release.
