# Project status and roadmap — Opezee License Management System

Checked against the repo on **24 November 2026**, on branch `production` at `f9fd18f`. Every row below links to evidence in the code, git or `npm` output.

## 1. Summary

- **Feature-complete for v1.** Licenses, products, settings, max screens, Digital Diya, the product API, the Help page and the dashboard are all built. `npm test` passes: 292 server and 40 client tests.
- **Not deployable yet.** Products must start sending `machineNumber`, the production database needs the `set-max-screens` migration, and 7 commits are still only local.
- **Biggest open risk.** Client passwords are stored and returned in readable form. A hash-only + show-once plan is written and waiting for a go-ahead.

## 2. Feature list

| Feature | Status | Notes |
| --- | --- | --- |
| Admin login, change password | Done | `adminRoutes.js:22` `/login`, `:59` `/change-password`; `Settings.jsx:690` |
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
| render.yaml | Partly done | `MONGODB_URI` is `sync: false` (`render.yaml:28`), so it must be set to a hosted URI in the Render dashboard |
| CLAUDE.md, PRD.md, ARCHITECTURE.md | Done, some stale lines | `CLAUDE.md:93` and PRD gaps G2, G4 and G5 refer to things already fixed. PRD CLI-1 says passwords are "stored as a bcrypt hash", but the code also stores a readable copy |

## 3. Pending

| # | Item | Priority | Evidence | Next step |
| --- | --- | --- | --- | --- |
| 1 | Plaintext `password` on clients | **High** | Written at `clientService.js:121`, `:168`. Returned at `:41` (via `:132`, `:136`, `:281`). Shown at `LicenseFormModal.jsx:46`, `:173–174`, `:445` (`type="text"`) | Implement the hash-only + show-once plan, then run the strip script |
| 2 | Readable passwords in `backups/` | Medium | No `backups/` folder on disk (0 files). The pre-migration Firestore export isn't in the repo, so I couldn't check it | Find and delete or lock away any old exports, wherever they are kept |
| 3 | Deploy prerequisites | **High** | Hosted pages take `&machine=` (`productLink.js:61`). Product builds sending `machineNumber` can't be checked from this repo. No sign the migration has run | Ship product updates, then `backup-db` → `set-max-screens -- --min 5` on production |
| 4 | Local commits not on GitHub | **High** | 7 commits (`4f9ee2d` … `f9fd18f`); `production` is ahead of `origin` by 7 | Push, and open a PR to `main` (`main` is at `921ebdc`) |
| 5 | Hosted MongoDB on Render | **High** | `render.yaml:28` has `sync: false` and a comment saying to use Atlas. The actual value is in the Render dashboard and can't be checked from here | Set an Atlas `MONGODB_URI` and allow Render's IPs |
| 6 | CI workflow | Medium | No `.github/workflows/` folder. `npm test` needs a running MongoDB | Add `ci.yml` with a `mongo` service container, running `npm test` and `npm run build` |
| 7 | Clients page | Medium | `client/src/pages/Clients.jsx` missing (PRD G1). The `/api/clients` CRUD exists | Build the page after #1, so it never handles readable passwords |
| 8 | README: setup, env table, API reference | Medium | README sections stop at Overview, Use Cases, Flow, Max screens and Database. There's no setup, environment table or API reference | Write all three. `CLAUDE.md` says the README holds them |
| 9 | Dead code and stray files | Low | `feedback.txt` and `correction.txt` are gone. Still left: unused `daysUntil` (`format.js:41`) and `durationLabel` (`:60`), unused `licenseService.listClients` (`licenseService.js:613`), 8 commented-out JSX blocks (e.g. `Settings.jsx:225, 424, 671`), stale `.dockerignore:13–14` | Remove them in one tidy-up commit, and update `CLAUDE.md:93` and PRD G2, G4 and G5 |
| 10 | npm audit / esbuild / bundle | Medium | 4 high, 0 critical: `vite` (direct), `body-parser`, `follow-redirects`, `source-map-js`, all fixable. `esbuild@0.21.5` postinstall not approved. JS bundle 669 kB (174 kB gzip), over Vite's 500 kB warning | `npm audit fix`, re-test, approve or deny esbuild's install script, code-split |
| 11 | `.env` variants on disk | Done | Only `.env` and `.env.example` remain. `.env copy` is gone. `.gitignore` ignores `.env*` except the example (`f6b2b4e`) | Revoke the Firebase key that was in `.env copy` |

## 4. Improvements

| Area | Issue | Where | Effort | Priority |
| --- | --- | --- | --- | --- |
| Security | Admin JWT kept in `localStorage`, so it can be read by any injected script | `client/src/services/api.js:7, 15` | L | Medium |
| Security | Sign-in is limited per IP only (10 per 15 min). There is no per-account lockout | `server/middleware/rateLimiter.js:27–34` | S | Medium |
| Security | Changing the password doesn't invalidate existing 12 h tokens | `adminService.js:56` (`expiresIn`), `:128` `changePassword` | M | Medium |
| Security | No audit log of who changed or deactivated a license (PRD G7) | No such collection or code in `server/` | M | Medium |
| Security | The example staff PIN `1968` could be copied into production unchanged | `.env.example:15` | S | Medium |
| Features | No expiry reminders (PRD G8) | Nothing in `server/` or `client/src` | M | Medium |
| Features | No one-click renew. Help tells admins to edit the dates by hand | `Help.jsx:432` | S | Low |
| Features | No CSV export of licenses | Nothing in `client/src` | S | Low |
| Features | Search and status filter only. No sorting, date filter or paging, and the list loads every license | `useLicenses.js` `filterLicenses`; `licenseService.js:225` | M | Low |
| Operations | `/health` doesn't check MongoDB, so Render reports healthy while the database is down | `server.js:173–175` | S | **High** |
| Operations | Backups are manual only | `package.json` `backup-db` | M | Medium |
| Operations | Errors only go to the console. No log service or alerts | `errorHandler.js:24` | M | Medium |
| Performance | Every `/verify` and `/sync` reads the whole `clients` collection | `licenseService.js:43` `clientDirectory()`, called at `:464` | M | Medium |
| Performance | Stats and the Dashboard load every license to count them | `licenseService.js:591`; `Dashboard.jsx:247` | M | Low |
| Performance | One 669 kB JS chunk, with no route-level code splitting | `App.jsx` (no `lazy`); build output | S | Low |
| Testing | No CI, so tests only run on a developer's machine | No `.github/workflows/` | M | **High** |
| Testing | No browser or end-to-end tests. UI and dark mode have never been checked in a real browser | No Playwright or Cypress config | L | Medium |
| Testing | Client unit tests cover only the dashboard helpers | `client/tests/` has 1 file | M | Low |
| Code quality | Large files that are hard to review | `api.test.js` 1200 lines, `Settings.jsx` 704, `licenseService.js` 677, `LicenseFormModal.jsx` 578, `licenseController.js` 513 | M | Low |
| Code quality | `toIso()` copied into 5 services | `server/services/{admin,branding,client,license,product}Service.js` | S | Low |
| Code quality | Verify, sync and Digital Diya responses each build their messages separately | `licenseController.js:274` `VALIDATE_MESSAGES` vs `:414` `messages` | S | Low |

## 5. Recommended order

1. **Hash-only client passwords:** the approach is chosen and the plan is written; it needs a go-ahead on its two open questions. Then run `strip-client-passwords` (Pending #1).
2. **Revoke the old Firebase service-account key** in the Google Cloud console (Pending #11).
3. **Fix the 4 high npm advisories** with `npm audit fix`, then run `npm test` and the build again (Pending #10).
4. **Make `/health` ping MongoDB**, so Render and Docker notice a lost database (Improvements: Operations).
5. **Ship product builds that send `machineNumber`**, and pass `&machine=` to the hosted pages (Pending #3).
6. **Production data:** run `backup-db`, then `set-max-screens -- --min 5`, then `strip-client-passwords` (Pending #3).
7. **Render and GitHub:** set an Atlas `MONGODB_URI`, push the 7 commits, and open a PR to `main` (Pending #4, #5).
8. **CI:** add `ci.yml` with a `mongo` service container, running `npm test` and `npm run build` (Pending #6).
9. **Clients page:** build `Clients.jsx`, its route and its sidebar entry (Pending #7).
10. **Expiry reminders and a renew action** (PRD G8 and the Help workaround).
