# End-to-end tests

Tests the **production build** the way it runs on the server: the backend
(`node backend/dist/index.js`, `NODE_ENV=production`) serves `frontend/dist`,
the database is installed with `scripts/migrate-db.sh` (like `deploy.sh`), and
the media library contains real files generated with ffmpeg (films, a series in
a folder named `… S02E12-22 FINAL`, seasons folders, an anime, image and PDF
manga chapters). TMDB / AniList / MangaDex are replaced by `mock-metadata.mjs`,
so no Internet access or API key is needed.

```bash
npx playwright install chromium   # once
npm run e2e                       # build + environment + tests
npm run e2e:stop                  # stop and clean up
```

Requirements: Node 20+, ffmpeg, python3 with Pillow, PostgreSQL server
binaries (`initdb`, `pg_ctl`). Environment files live in `/tmp/nexus-e2e`
(`E2E_DIR`), screenshots in `/tmp/nexus-e2e/shots`.

`node e2e/run.mjs <filter>` runs only the tests whose name contains `<filter>`;
`bash e2e/setup.sh restart-backend` rebuilds and restarts only the backend.

What is covered: build info & API 404s, login, stream tokens and access rules,
scanning (metadata, cleaned show names, seasons/episodes, TMDB episode titles,
manga image/PDF chapters), rescans never wiping metadata when the metadata API
is down, HTTP range streaming, progress saving & resume, every page of the UI
(catalogue, title pages, real video playback, series, manga reader, files with
upload, services, scripts, network, settings, terminal), regular-user
restrictions, outdated-backend diagnostics, access-token refresh, live stats,
"Ma liste", search & genres, password change, theme and phone layouts.
