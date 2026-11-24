# Project status and roadmap — Opezee License Management System

Checked against the repo on **24 November 2026**, on branch `production` at `f9fd18f`. Updated the same day after the security and clean-up batch (`3edc099` … the "remove dead code" commit). Every row below links to evidence in the code, git or `npm` output.

## 1. Summary

- **Feature-complete for v1.** Licenses, products, settings, max screens, Digital Diya, the product API, the Help page and the dashboard are all built. `npm test` passes: 320 server and 40 client tests. CI runs them on GitHub.
- **Not deployable yet.** Products must start sending `machineNumber`, the production database needs the `set-max-screens` migration, Render needs `MONGODB_URI` and `CLIENT_PIN`, and 15 commits are still only local.
- **Biggest open risk.** Client passwords are stored and returned in readable form. A hash-only + show-once plan is written and waiting for a go-ahead. The npm highs, the health check, session revocation, the default PIN and the verify reads are fixed.

## 2. Feature list

| Feature | Status | Notes |
| --- | --- | --- |
| Admin login, change password | Done | `adminRoutes.js:22` `/login`, `:59` `/change-password`; `Settings.jsx:690`. A password change or `create-admin` reset signs out older sessions (`1e66843`) |
| Dashboard insights | Done | `f9fd18f`; `Dashboard.jsx`; helpers tested in `client/tests/dashboardStats.test.mjs` |
| License create / edit / deactivate / delete / email | Done | `licenseRoutes.js:207, 231, 267, 297, 280`. Email needs SMTP; without it, the API returns 503 |
| Duration presets | Done | `licenseDates.js:11–18`: 1, 3 and 6 months, 1 year, custom |
| Max screens + machine release | Done (code) | `78d5547`; `licenseRoutes.js:250`. Not live until the deploy prerequisites in Pending #3 are met |
| Digital Diya screens + endpoints | Done | `licenseRoutes.js:118` validate, `:148` sync; Screens column in `LicenseTable.jsx` |
| Products | Done | `productRoutes.js:33–42`: full create, read, update and delete |
| Settings (theme, logo, email IDs) | Done | `Settings.jsx:3` theme switch, `:684` Branding, `:697` Email Configuration |
| Help page | Done | `App.jsx:42` route, sidebar entry; `250352c` |
| Product API | Done | 8 entries in `PUBLIC_PATHS` (`server.js`): verify, sync, details, Digital Diya ×2, poc, email, clients/login. `/client` pages at `App.jsx:25–31`. The staff PIN uses `/licenses/details` |
| MongoDB backup + restore | Done | `npm run backup-db` / `restore-db` (`package.json`). Manual only (see Improvements) |
| `set-max-screens` migration | Partly done | The script and tests exist (`server/scripts/setMaxScreens.js`). Nothing in the repo shows it has been run on production |
| Dockerfile | Done | Multi-stage. The build doesn't run tests, because they need a live MongoDB |
| render.yaml | Partly done | `MONGODB_URI` and `CLIENT_PIN` are `sync: false`, so both must be set in the Render dashboard: a hosted URI, and a unique PIN |
| CLAUDE.md, PRD.md, ARCHITECTURE.md | Done | The stale lines (`CLAUDE.md:93`, PRD G2, G4 and G5) are fixed. One mismatch remains: PRD CLI-1 says passwords are "stored as a bcrypt hash", but the code also stores a readable copy (Pending #1) |

## 3. Pending

| # | Item | Priority | Evidence | Next step |
| --- | --- | --- | --- | --- |
| 1 | Plaintext `password` on clients | **High** | Written at `clientService.js:121`, `:168`. Returned at `:41` (via `:132`, `:136`, `:281`). Shown at `LicenseFormModal.jsx:46`, `:173–174`, `:445` (`type="text"`) | Implement the hash-only + show-once plan, then run the strip script |
| 2 | Readable passwords in `backups/` | Medium | No `backups/` folder on disk (0 files). The pre-migration Firestore export isn't in the repo, so I couldn't check it | Find and delete or lock away any old exports, wherever they are kept |
| 3 | Deploy prerequisites | **High** | Hosted pages take `&machine=` (`productLink.js:61`). Product builds sending `machineNumber` can't be checked from this repo. No sign the migration has run | Ship product updates, then `backup-db` → `set-max-screens -- --min 5` on production |
| 4 | Local commits not on GitHub | **High** | 15 commits (`4f9ee2d` … the "remove dead code" commit); `production` is ahead of `origin` by 15 | Push, which also starts the first CI run, and open a PR to `main` (`main` is at `921ebdc`) |
| 5 | Hosted MongoDB and staff PIN on Render | **High** | `render.yaml` has `MONGODB_URI` and `CLIENT_PIN` as `sync: false`. The actual values are in the Render dashboard and can't be checked from here | Set an Atlas `MONGODB_URI` (and allow Render's IPs) and a unique `CLIENT_PIN` |
| 6 | CI workflow | Done | `.github/workflows/ci.yml`: a `mongo:7` service, then `npm ci` → `npm test` → `npm run build` → `npm audit --omit=dev --audit-level=high`, on `main` and `production`. Steps checked locally; the workflow hasn't run on GitHub yet | Push, and watch the first run |
| 7 | Clients page | Medium | `client/src/pages/Clients.jsx` missing (PRD G1). The `/api/clients` CRUD exists | Build the page after #1, so it never handles readable passwords |
| 8 | README: setup, env table, API reference | Medium | README sections stop at Overview, Use Cases, Flow, Max screens and Database. There's no setup, environment table or API reference | Write all three. `CLAUDE.md` says the README holds them |
| 9 | Dead code and stray files | Done | Removed: `daysUntil` and `durationLabel` (`format.js`), the unused `licenseService.listClients`, the 8 commented-out JSX blocks, and the `copyDetails`, `buildMessage` and Settings `useAuth` code they left unused. `CLAUDE.md:93` and PRD G2, G4 and G5 updated | Only `.dockerignore:13–14` remain: they ignore two files that no longer exist, which is harmless |
| 10 | npm audit / esbuild / bundle | Low | High advisories fixed (`3edc099`): `vite` 6.4.6, `body-parser` 1.20.9, `follow-redirects` 1.16.3, `source-map-js` 1.2.4. `npm audit --omit=dev`: 0 high, 0 critical, 5 moderate (`react-router` needs v7, a major; `nodemailer`, `qs`, `postcss-selector-parser` are in range). `esbuild@0.25.12` postinstall still not approved. Bundle 670 kB (175 kB gzip) | `react-router` v7 later. Approve or deny esbuild's install script. Code-split |
| 11 | `.env` variants and the old Firebase key | Done | Only `.env` and `.env.example` remain, `.gitignore` ignores `.env*` except the example (`f6b2b4e`), and the Firebase service-account key that was in `.env copy` has been revoked | None |

## 4. Improvements

| Area | Issue | Where | Effort | Priority |
| --- | --- | --- | --- | --- |
| Security | Admin JWT kept in `localStorage`, so it can be read by any injected script | `client/src/services/api.js:7, 15` | L | Medium |
| Security | Sign-in is limited per IP only (10 per 15 min). There is no per-account lockout | `server/middleware/rateLimiter.js:27–34` | S | Medium |
| Security | ~~Changing the password doesn't invalidate existing 12 h tokens~~ Done: `tokenVersion` in the JWT, checked by `requireAdmin` | `1e66843` | M | Done |
| Security | No audit log of who changed or deactivated a license (PRD G7) | No such collection or code in `server/` | M | Medium |
| Security | ~~The example staff PIN `1968` could be copied into production unchanged~~ Done: `.env.example` ships it empty, and in production a missing PIN or `1968` gives 503 plus a start-up warning | `ecebfb2`; `server/utils/staffPin.js` | S | Done |
| Features | No expiry reminders (PRD G8) | Nothing in `server/` or `client/src` | M | Medium |
| Features | No one-click renew. Help tells admins to edit the dates by hand | `Help.jsx:432` | S | Low |
| Features | No CSV export of licenses | Nothing in `client/src` | S | Low |
| Features | Search and status filter only. No sorting, date filter or paging, and the list loads every license | `useLicenses.js` `filterLicenses`; `licenseService.js:225` | M | Low |
| Operations | ~~`/health` doesn't check MongoDB~~ Done: it pings with a 2 s timeout and answers 503 when the database is down | `74f732b` | S | Done |
| Operations | Backups are manual only | `package.json` `backup-db` | M | Medium |
| Operations | Errors only go to the console. No log service or alerts | `errorHandler.js:24` | M | Medium |
| Performance | ~~Every `/verify` and `/sync` reads the whole `clients` collection~~ Done: single-license reads look up only the linked account through the `username` index (the profiler test shows 1 document examined, of 32) | `21d6c35` | M | Done |
| Performance | Stats and the Dashboard load every license to count them | `licenseService.js:591`; `Dashboard.jsx:247` | M | Low |
| Performance | One 669 kB JS chunk, with no route-level code splitting | `App.jsx` (no `lazy`); build output | S | Low |
| Testing | ~~No CI, so tests only run on a developer's machine~~ Done | `.github/workflows/ci.yml` | M | Done |
| Testing | No browser or end-to-end tests. UI and dark mode have never been checked in a real browser | No Playwright or Cypress config | L | Medium |
| Testing | Client unit tests cover only the dashboard helpers | `client/tests/` has 1 file | M | Low |
| Code quality | Large files that are hard to review | `api.test.js` 1200 lines, `Settings.jsx` 704, `licenseService.js` 677, `LicenseFormModal.jsx` 578, `licenseController.js` 513 | M | Low |
| Code quality | `toIso()` copied into 5 services | `server/services/{admin,branding,client,license,product}Service.js` | S | Low |
| Code quality | Verify, sync and Digital Diya responses each build their messages separately | `licenseController.js:274` `VALIDATE_MESSAGES` vs `:414` `messages` | S | Low |

## 5. Recommended order

1. **Hash-only client passwords:** the approach is chosen and the plan is written; it needs a go-ahead on its two open questions. Then run `strip-client-passwords` (Pending #1).
2. ~~**Revoke the old Firebase service-account key**~~ Done (Pending #11).
3. ~~**Fix the 4 high npm advisories**~~ Done in `3edc099` (Pending #10).
4. ~~**Make `/health` ping MongoDB**~~ Done in `74f732b` (Improvements: Operations).
5. **Ship product builds that send `machineNumber`**, and pass `&machine=` to the hosted pages (Pending #3).
6. **Production data:** run `backup-db`, then `set-max-screens -- --min 5`, then `strip-client-passwords` (Pending #3).
7. **Render and GitHub:** set an Atlas `MONGODB_URI` and a unique `CLIENT_PIN`, push the 15 commits, and open a PR to `main` (Pending #4, #5).
8. ~~**CI:** add `ci.yml` with a `mongo` service container~~ Done: test, build and audit on every push and PR to `main` and `production` (Pending #6).
9. **Clients page:** build `Clients.jsx`, its route and its sidebar entry (Pending #7).
10. **Expiry reminders and a renew action** (PRD G8 and the Help workaround).
