# Deploying the atlas

## The public demonstration build (synthetic data)

Live at https://lbcn-stanford.github.io/brain-atlas/. The public repository
`LBCN-Stanford/brain-atlas` holds the atlas's source on `main` (exported from this repository by
`scripts/export_public_source.py`) and the built site on `gh-pages`, which Pages serves. A push to
its `main` rebuilds and redeploys the site (its `pages` workflow).

- **From CI:** push a tag `atlas-vX.Y.Z` (or run the `deploy-demo` workflow by hand). It builds,
  refuses a non-synthetic release, runs the browser check and deploys. It needs the repository
  secret `DEMO_DEPLOY_TOKEN` (fine-grained, Contents: write on `LBCN-Stanford/brain-atlas` only).
- **From a lab machine:** `app/scripts/deploy_demo.sh` (dry run) then `--push`. It builds a fresh
  worktree of HEAD, so local controlled data and uncommitted edits cannot reach the bundle.

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
6. **No analytics or cookies.** The About page says the site collects nothing; keep it true.

Build:

```bash
SITE_BASE=/ SITE_URL=https://<host>/ SITE_INDEX=yes npm run build
```

Stanford hosting has its own approvals (the domain, a Stanford-affiliated site owner, accessibility
and security standards). What they are and who decides is written up in
`../../deliverables/2026-10-16-v2-change-list-part2.md` (section I) in the stream folder, outside
this repository.

## The controlled build

`VITE_DATA_DIR=data-real npm run build:controlled` shows real reports. It is controlled data under
IRB protocol 11354: never deploy it to a public host. A real-data deployment needs a written
release from the PI, IRB confirmation, and either formally de-identified text or a
login-protected, Stanford-managed host.
