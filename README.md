# PvME preset storage

`presets/` is the source of truth for saved preset JSON. This repository turns each JSON file (except `preset-index.json`) into crawler-readable static embed pages and WebP previews; the editor application remains a separate repository.

## Local development

Run `npm install`, then `npm run dev`. It selects and renders ten random presets rather than the full corpus, then opens a dashboard at `http://localhost:3001/`. The dashboard links to each source JSON, both WebPs, and an `OG inspect` page that disables the human redirect only in local development so metadata can be examined. Editing one of those ten JSON files regenerates only its previews. The layout-less URL is a real landscape (`7x4`) HTML page, so Discord can read its OpenGraph metadata.

`EMBED_SITE_URL` defaults to `http://localhost:3001/`; `EDITOR_SITE_URL` defaults to `http://localhost:5173/`. The former creates image, canonical, and OpenGraph URLs. The latter is only the human redirect target (`#/ID?layout=…`). Override either as needed. Use `npm run generate` or `npm run generate:force` for one-off runs.

## Publication and cache

The Pages workflow runs on relevant pushes to `main`, plus a daily reconciliation and manual force option. It generates an artefact, never commits WebPs to `main`, serializes deployments, and enforces a size budget. It fingerprints original JSON plus renderer assets, uses SHA-256 content-addressed WebPs, repairs missing cache files, removes deleted pages/unreferenced images, and keeps last-known-good previews when rendering a changed preset fails. Failed presets retry on the next run.

Run `npm test` for generator behavior tests. Old `https://presets.pvme.io?id=<id>` links cannot produce per-preset OpenGraph metadata on GitHub Pages: query-based compatibility needs a separate HTTP-level redirect/proxy during infrastructure migration.
