# Architecture — Opezee License Management System

This document explains how the system is built. For what it must do, see `PRD.md`. For setup and the API reference, see `README.md`.

## 1. System overview

```
                 ┌──────────────────────────────────────────────┐
                 │        One Node process (npm start)          │
 Admin browser ──┤  Express                                     │
  (dashboard)    │   ├── /            → dist/ (built React SPA) │
                 │   ├── /health      → health check            │──► MongoDB
 Opezee product ─┤   └── /api/*       → routes → services       │    (mongodb driver)
 (kiosk / game)  │                                              │
                 └──────────────────────────────────────────────┘
```

- **One repository, one `package.json`, one `.env`.** The client and the server share a dependency tree.
- **Same origin in every environment.** In production, Express serves `dist/`. In development, Vite (:5173) proxies `/api` to Express (:5000). The dashboard always calls a relative `/api`.
- **MongoDB is reached only from the server**, through the official `mongodb` driver and `server/config/db.js`. Neither browsers nor products ever see the connection string or its credentials. Only the services touch the database.
- **The server will not start without the database.** `initDb()` connects, pings and creates the indexes before `app.listen()`. If any of those fails, the process exits.

## 2. Repository layout

```
licence-management-system/
├── client/                   React 18 + Vite 5 + Tailwind 3 dashboard
│   └── src/
│       ├── pages/            Login, Dashboard, Licenses, Products, Settings
│       ├── layouts/          AdminLayout — sidebar + responsive shell
│       ├── components/       Shared UI (Modal, ConfirmDialog, Toast, LicenseTable…)
│       ├── context/          AuthContext, ThemeContext, BrandingContext
│       ├── hooks/            useLicenses.js → useLicenses / useProducts / useClients
│       └── services/         api.js (axios modules), format.js (dates, durations)
├── server/                   Express 4 API (CommonJS)
│   ├── server.js             App setup, security, CORS split, static SPA, startup
│   ├── config/db.js          MongoClient, collection(), newId(), indexes
│   ├── routes/               Validation chains + route wiring
│   ├── controllers/          HTTP shaping only
│   ├── services/             MongoDB access + business rules
│   ├── middleware/           auth, validate, rateLimiter, errorHandler
│   ├── utils/                generateLicenseKey, licenseDates
│   ├── scripts/              createAdmin, checkMail, backupDb, restoreBackup, setMaxScreens
│   └── tests/api.test.js     End-to-end tests on a throwaway MongoDB database
├── scripts/dev.js            Runs nodemon + vite together
├── vite.config.mjs           root=client, out=dist, /api proxy, PostCSS inline
├── Dockerfile                Production container image
├── render.yaml               Render blueprint (one web service)
└── .github/workflows/ci.yml  CI: mongo:7 service, then test, build, audit
```

`backups/` (written by `npm run backup-db`) is git-ignored and Docker-ignored, because it holds password hashes.

## 3. Request lifecycle (server)

```
request
  → helmet (CSP)
  → JSON body parser (100 KB; 1 MB only for /api/admin/branding)
  → morgan logging
  → CORS: public paths → origin *; everything else → allow-list + same-origin
  → adminLimiter (non-public paths)
  → router
      → route-level limiter (verify / login / client login)
      → express-validator chain → validate.js (400 with errors[])
      → requireAdmin (admin routes only — declared after the public routes)
      → controller → service → MongoDB
  → notFound / errorHandler (JSON, no stack traces)
```

**What each layer does**

| Layer | Owns | Must not |
| ----- | ---- | -------- |
| Route | Paths, validators, sanitisers, limiters | Contain logic |
| Controller | Mapping service results to status code and JSON | Touch the database |
| Service | MongoDB reads and writes (via `collection()`), business rules, `ApiError` | Know about `req` / `res` |
| Util | Pure functions: key generation, date maths | Do I/O |

## 4. Authentication and access

| Caller | Credential | Endpoints |
| ------ | ---------- | --------- |
| Admin | JWT bearer token (HS256, `JWT_SECRET`), from `POST /api/admin/login` | Everything except the public set |
| Product | License key. On `/verify` and `/sync`, also the `machineNumber` it runs on, which counts against the license's max screens | `/licenses/verify`, `/licenses/sync`, `/licenses/poc`, `/licenses/email` |
| Client user | Username and password (bcrypt), checked for the product | `/clients/login` |
| Anyone | None | `/admin/branding` (GET), `/health` |

- The public set is listed in `PUBLIC_PATHS` in `server/server.js`. These paths skip the admin CORS check and the admin rate limiter.
- In the dashboard, the token is kept in `localStorage` (`lm.token`). An axios interceptor attaches it to requests, and on a 401 it sends the user to `/login`.
- **Session revocation:** each admin document has a `tokenVersion`, and each JWT carries it as `ver`. A missing value counts as 0 on either side. `requireAdmin` checks the signature, then looks the admin up and rejects a mismatched version with the same `401 INVALID_TOKEN` as an expired token. Change-password and a `create-admin` reset increment `tokenVersion`. Change-password returns a fresh token, which `authApi.changePassword` stores.

## 5. License domain model

### Status (derived on every read)

```
deactivated?  ── yes ──► deactivated
     │ no
expiry ≤ now? ── yes ──► expired
     │ no
start > now?  ── yes ──► pending
     │ no
     ▼
   active
```

The stored `status` field is only there for convenience when browsing the database. The API always recalculates it with `computeStatus()`.

### Period

The service takes `startDate` and `duration` and passes them to `resolveLicensePeriod()`, which returns the expiry. Presets: `1_month`, `3_months`, `6_months`, `1_year`. A `custom` duration takes an explicit expiry, which must come after the start date.

### Key

Keys look like `PREFIX-XXXX-XXXX-XXXX`. They are generated with a CSPRNG and rejection sampling, using an alphabet that drops `I L O U 0 1`. Each new key is checked for uniqueness before it is saved, and keys are never edited.

### Verify / sync flow

```
normalize key → lookup by licenseKey
  ├─ none                       → 404 not_found
  ├─ productName given & differs → 403 product_mismatch
  ├─ status deactivated/expired/pending → 200 valid:false + reason   (no slot used)
  └─ admitMachine(machineNumber)       — /verify and /sync only
       ├─ no machineNumber
       │    ├─ slots already claimed   → 403 MACHINE_NUMBER_REQUIRED
       │    └─ none claimed            → 200 valid:true (claims nothing)
       ├─ already holds a slot         → update lastSeenAt → 200 valid:true
       ├─ free slot (atomic push)      → claim it          → 200 valid:true
       └─ every slot taken             → 403 SCREEN_LIMIT_REACHED, valid:false
```

The product calls `verify` on launch and `sync` every hour. If either returns `valid: false`, the product must lock.

### Max screens (machine slots)

A license admits at most `maxScreens` machines (1–100, default 1). Claimed machines are stored on the license as `claimedMachines: [{ machineNumber, firstSeenAt, lastSeenAt }]`, with `machineNumber` trimmed and lowercased.

- **No read-then-write.** A claim is one `findOneAndUpdate` whose filter carries both `claimedMachines.machineNumber: { $ne: m }` and `$expr: size(claimedMachines) < maxScreens`, with a `$push` as the update. Machines checking in at the same moment cannot exceed the limit, and one machine racing itself cannot take two slots. If the push fails, `admitMachine` looks once more for the machine's own slot (it may have claimed it a moment earlier) before calling the license full.
- **Lowering the limit** puts the same size check (`size ≤ new maxScreens`) into the update's filter. When the check fails, the update returns `409 MACHINES_IN_USE` ("Release machines first"). The controller runs that check before it also saves the POC account, so a refused edit changes nothing.
- **Release:** `DELETE /api/licenses/:id/machines/:machineNumber` (admin) `$pull`s the entry. It returns `404 MACHINE_NOT_FOUND` if the license has no such machine.
- **Not to be confused with `screens`.** That field holds what Digital Diya's own server reports through `/digital-diya/sync`. Digital Diya sends no machine numbers, so its endpoints, the PIN details, `/poc` and `/email` never check or claim slots. The dashboard hides Max screens and the Machines column for Digital Diya licenses.
- **Migration:** `npm run set-max-screens -- [--min <n>] [--dry-run]` gives every license without a limit `max(n, machines claimed)`. It carries the old lock's single `machineNumber` field into `claimedMachines`. It is safe to re-run.

### Client linking

A license's `clientUserId` links it to a `clients` document by username. Anything typed on the license itself takes priority. The account only fills fields that were left blank. When a license has no link and its client name matches exactly one account, it is linked automatically. Creating a new account adopts any unlinked licenses with a matching name and company.

## 6. Data model (MongoDB)

Database `MONGODB_DB` (default `opezee_licenses`). Every document's `_id` is a hex **string** from `newId()`, not an `ObjectId`: records carried over from Firestore kept their original ids, so links that contain them still work. Dates are stored as BSON dates.

| Collection | Document fields | Indexes | Notes |
| ---------- | --------------- | ------- | ----- |
| `licenses` | licenseKey, clientName, companyName, clientUserId, productName, soldBy, duration, startDate, expiryDate, deactivated, status, maxScreens, claimedMachines `[{ machineNumber, firstSeenAt, lastSeenAt }]`, screens `{ used, limit, plan, updatedAt }`, createdAt, updatedAt | `licenseKey` (unique), `clientUserId`, `productName`, `createdAt` desc | Legacy docs may hold `clientEmail` in place of `clientUserId`, or no `startDate` (in which case `createdAt` is used). A missing `maxScreens` counts as 1. Until `set-max-screens` runs, old docs may still hold the single `machineNumber` left by the one-machine lock. `screens` exists only on Digital Diya licenses that have synced |
| `products` | name, description, createdAt, updatedAt | `createdAt` desc | Name uniqueness is checked case-insensitively in code |
| `clients` | clientName, companyName, username, passwordHash, password, createdAt, updatedAt | `username` | `password` is a readable copy that the admin views see. `passwordHash` (bcrypt) is what login checks |
| `admins` | email, name, passwordHash, createdAt, updatedAt | `email` (unique) | |
| `emailConfigs` | email, label, isDefault, createdAt | `email` | Any number may be default. The last default cannot be deleted while other addresses remain |
| `settings` | `_id: 'branding'`: logo (data URL), mimeType, fileName, updatedAt | | Upserted on first logo upload |

`ensureIndexes()` in `server/config/db.js` creates the indexes on every start-up. That's safe because creating an existing index does nothing.

### Backup and restore

- `npm run backup-db` exports every collection to `backups/mongodb-<timestamp>/<collection>.json`, plus a `_manifest.json`. Dates are written as `{ "$date": "<ISO>" }`.
- `npm run restore-db [-- <folder>]` loads the newest backup folder, or the one named. It does this with `replaceOne` upserts keyed on `_id`, so re-running it duplicates nothing, and documents missing from the backup are left alone. It also reads the one-off Firestore export taken before the migration.

## 7. Client (dashboard) architecture

- **Routing:** `App.jsx` handles routing. `/login` is public. Every other page is wrapped in `ProtectedRoute` and then `AdminLayout`.
- **State:** there is no global store. Contexts hold the session, theme and branding. Data hooks fetch on mount and expose `reload({ silent })`.
- **API access:** only through the modules in `services/api.js` (`authApi`, `licenseApi`, `productApi`, `clientApi`, `brandingApi`, `emailApi`).
- **Theme:** Tailwind's `darkMode: 'class'`. An inline script in `index.html` sets the class before first paint so the page never flashes the wrong theme.
- **Date previews:** forms preview expiry dates using `format.js`. The server stays authoritative.

## 8. Email

`mailService.js` uses Nodemailer over SMTP, configured from `SMTP_*` variables. Without SMTP configured, the share endpoint returns `503 MAIL_NOT_CONFIGURED`, and the UI falls back to a `mailto:` link. Emails contain an HTML table and a plain-text version. Every interpolated value is HTML-escaped, and a request can have at most 10 recipients.

## 9. Deployment

| Target | How |
| ------ | --- |
| Render | `render.yaml`: `npm ci && npm run build`, then `npm start`, with `/health` as the health check. Render has no MongoDB, so `MONGODB_URI` must point to a hosted database such as MongoDB Atlas |
| Docker | `Dockerfile`: a multi-stage Node 20 Alpine build. Pass env vars at runtime and expose port 5000. Inside the container, `127.0.0.1` is the container itself, so use `host.docker.internal` or a hosted URI. The build stage does not run the tests, because they need a live MongoDB |
| LAN | `npm run build && npm start`, with MongoDB running on the same machine or `MONGODB_URI` pointing at it. The server listens on `0.0.0.0` and prints its LAN URLs |

In every target, the server exits at start-up if it cannot reach MongoDB. Once running, `GET /health` pings MongoDB through `pingDb()` (`config/db.js`), with a 2-second timeout. It answers `200 … db: "up"` or `503 … db: "down"`, so Render and the Docker `HEALTHCHECK` mark the service unhealthy when the database is lost. The reason is logged and never sent in the response.

## 10. Testing

`server/tests/api.test.js` loads the real app, with its real routes, validators, services and `config/db.js`, and runs it against a real MongoDB. It sets `MONGODB_DB` to a throwaway `opezee_licenses_test_<pid>_<time>` database and drops that database when the run ends. Nothing is faked, so a MongoDB server must be reachable: the local default, or `MONGODB_URI`. If it isn't, the suite exits straight away. The tests need no secrets, and SMTP is forced off so no real email is sent.

`client/tests/dashboardStats.test.mjs` unit-tests the Dashboard's pure helpers. It loads them through Vite's SSR loader, because the client is ESM that plain Node cannot load. `npm test` runs the server suite and then `npm run test:client`.

### CI

`.github/workflows/ci.yml` runs on every push and pull request to `main` and `production`:

| | |
| --- | --- |
| Database | A `mongo:7` service container on port 27017, health-checked with `mongosh` before the steps start. `MONGODB_URI=mongodb://localhost:27017`. The run sets its own `MONGODB_DB`, as a fallback only, because the server suite always creates and drops its own throwaway database |
| Env | Dummy values only (`JWT_SECRET`; `SMTP_*` blank). No repository secrets are used |
| Steps | Node 20 (from `.nvmrc`, with the npm cache) → `npm ci` → `npm test` → `npm run build` → `npm audit --omit=dev --audit-level=high` |
| Limits | 15-minute timeout. A newer push to the same branch or PR cancels the older run. The token is read-only |

The audit step fails the run on any new high or critical advisory in production dependencies. Moderate ones are reported but don't fail it.

## 11. Extension points

| To add… | Touch |
| ------- | ----- |
| An admin endpoint | `routes/*`, then `controllers/*`, then `services/*`, plus tests |
| A public endpoint | The same, plus `PUBLIC_PATHS` in `server.js` and a limiter in `rateLimiter.js` |
| A dashboard page | `pages/`, a route in `App.jsx`, the sidebar entry in `AdminLayout.jsx`, and an API module in `api.js` |
| An env variable | `.env.example`, the README env table, and `render.yaml` if production needs it |
