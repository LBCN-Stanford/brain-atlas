# Deploying the atlas

## The public demonstration build (synthetic data)

Live at https://lbcn-stanford.github.io/brain-atlas/. A push to `main` runs the `pages` workflow
(`.github/workflows/pages.yml`): it refuses a non-synthetic release, builds, runs the browser
check, and publishes `app/dist` to the `gh-pages` branch, which GitHub Pages serves.

## Any other host (for example a Stanford address)

The build is static files. A host needs:

1. **HTTPS only.**
2. **Every unknown path served the atlas.** Either rewrite `/*` to `/index.html`, or serve
   `404.html` for missing paths (it redirects to the root and keeps the query and hash). Build with
   `SITE_BASE` set to the path the site lives under.
3. **Caching:** `assets/*` is content-hashed, so `Cache-Control: public, max-age=31536000,
   immutable`. `index.html`, `404.html`: `no-cache`. `atlas/brain/*` and `data/*`: a day.
4. **Compression:** gzip or brotli for `.html`, `.js`, `.css`, `.json`. Binary brain files have
   gzip copies (`*.gz`) that the page inflates itself; a host may serve them with or without
   `Content-Encoding: gzip`, the page handles both.
5. **Headers (recommended):** `Content-Security-Policy: default-src 'self'; script-src 'self'
   'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'`
   (the inline script is the schema.org metadata), `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: strict-origin-when-cross-origin`.
6. **No analytics or cookies.** The About page says the page sets no cookies and runs no analytics; keep it true.

Build:

```bash
SITE_BASE=/ SITE_URL=https://<host>/ SITE_INDEX=yes npm run build
```

Stanford hosting has its own approvals (the domain, a Stanford-affiliated site owner, accessibility
and security standards). The lab handles them with Stanford.

## The controlled build

`VITE_DATA_DIR=data-real npm run build:controlled` shows real reports. It is controlled data under
IRB protocol 11354: never deploy it to a public host. A real-data deployment needs a written
release from the PI, IRB confirmation, and either formally de-identified text or a
login-protected, Stanford-managed host.
