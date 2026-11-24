# Architecture — Opezee License Management System

This document explains how the system is built. For what it must do, see `PRD.md`. For setup and the API reference, see `README.md`.

## 1. System overview

```
                 ┌──────────────────────────────────────────────┐
                 │        One Node process (npm start)          │
 Admin browser ──┤  Express                                     │
  (dashboard)    │   ├── /            → dist/ (built React SPA) │
                 │   ├── /health      → health check            │──► Firebase Firestore
 Opezee product ─┤   └── /api/*       → routes → services       │    (firebase-admin SDK)
 (kiosk / game)  │                                              │
                 └──────────────────────────────────────────────┘
```

- **One repository, one `package.json`, one `.env`.** The client and the server share a dependency tree.
- **Same origin in every environment.** In production, Express serves `dist/`. In development, Vite (:5173) proxies `/api` to Express (:5000). The dashboard always calls a relative `/api`.
- **Firestore is reached only from the server**, through the Admin SDK, so the Firestore security rules stay fully locked. Neither browsers nor products ever see Firebase credentials.

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
│   ├── config/firebase.js    Admin SDK init from env
│   ├── routes/               Validation chains + route wiring
│   ├── controllers/          HTTP shaping only
│   ├── services/             Firestore access + business rules
│   ├── middleware/           auth, validate, rateLimiter, errorHandler
│   ├── utils/                generateLicenseKey, licenseDates
│   ├── scripts/              createAdmin, checkMail
│   └── tests/api.test.js     End-to-end tests on an in-memory Firestore fake
├── scripts/dev.js            Runs nodemon + vite together
├── vite.config.mjs           root=client, out=dist, /api proxy, PostCSS inline
├── Dockerfile                Production container image
├── render.yaml               Render blueprint (one web service)
└── .github/workflows/ci.yml  Test + build + audit
```

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
      → controller → service → Firestore
  → notFound / errorHandler (JSON, no stack traces)
```

**What each layer does**

| Layer | Owns | Must not |
| ----- | ---- | -------- |
| Route | Paths, validators, sanitisers, limiters | Contain logic |
| Controller | Mapping service results to status code and JSON | Touch Firestore |
| Service | Firestore reads and writes, business rules, `ApiError` | Know about `req` / `res` |
| Util | Pure functions: key generation, date maths | Do I/O |

## 4. Authentication and access

| Caller | Credential | Endpoints |
| ------ | ---------- | --------- |
| Admin | JWT bearer token (HS256, `JWT_SECRET`), from `POST /api/admin/login` | Everything except the public set |
| Product | License key, plus the claimed `machineNumber` | `/licenses/verify`, `/licenses/sync`, `/licenses/poc`, `/licenses/email` |
| Client user | Username and password (bcrypt), checked for the product | `/clients/login` |
| Anyone | None | `/admin/branding` (GET), `/health` |

- The public set is listed in `PUBLIC_PATHS` in `server/server.js`. These paths skip the admin CORS check and the admin rate limiter.
- In the dashboard, the token is kept in `localStorage` (`lm.token`). An axios interceptor attaches it to requests, and on a 401 it sends the user to `/login`.

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

The stored `status` field is only there for convenience when browsing Firestore. The API always recalculates it with `computeStatus()`.

### Period

The service takes `startDate` and `duration` and passes them to `resolveLicensePeriod()`, which returns the expiry. Presets: `1_month`, `3_months`, `6_months`, `1_year`. A `custom` duration takes an explicit expiry, which must come after the start date.

### Key

Keys look like `PREFIX-XXXX-XXXX-XXXX`. They are generated with a CSPRNG and rejection sampling, using an alphabet that drops `I L O U 0 1`. Each new key is checked for uniqueness before it is saved, and keys are never edited.

### Verify / sync flow

```
normalize key → lookup by licenseKey
  ├─ none                       → 404 not_found
  ├─ productName given & differs → 403 product_mismatch
  ├─ status deactivated/expired/pending → 200 valid:false + reason
  ├─ machine claimed & (missing or different) → 403 machine_mismatch
  ├─ unclaimed & machineNumber given → claim it (write)
  └─ 200 valid:true
```

The product calls `verify` on launch and `sync` every hour. If either returns `valid: false`, the product must lock.

### Client linking

A license's `clientUserId` links it to a `clients` document by username. Anything typed on the license itself takes priority. The account only fills fields that were left blank. When a license has no link and its client name matches exactly one account, it is linked automatically. Creating a new account adopts any unlinked licenses with a matching name and company.

## 6. Data model (Firestore)

| Collection | Document fields | Notes |
| ---------- | --------------- | ----- |
| `licenses` | licenseKey, clientName, companyName, clientUserId, productName, soldBy, duration, startDate, expiryDate, machineNumber, deactivated, status, createdAt, updatedAt | Legacy docs may hold `clientEmail` in place of `clientUserId`, or no `startDate` (in which case `createdAt` is used) |
| `products` | name, description, createdAt, updatedAt | |
| `clients` | clientName, companyName, username, passwordHash, createdAt, updatedAt | |
| `admins` | email, name, passwordHash | |
| `emailConfigs` | email, label, isDefault | At most one has `isDefault: true` |
| `settings` | `branding` doc: logo (data URL), fileName | |

All list queries order by `createdAt`, which only needs Firestore's automatic single-field indexes.

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
| Render | `render.yaml`: `npm ci && npm run build`, then `npm start`, with `/health` as the health check |
| Docker | `Dockerfile`: a multi-stage Node 20 Alpine build. Pass env vars at runtime and expose port 5000 |
| LAN | `npm run build && npm start`. The server listens on `0.0.0.0` and prints its LAN URLs |

## 10. Testing

`server/tests/api.test.js` loads the real app and replaces `config/firebase.js` with an in-memory fake. That fake supports `collection`, `doc`, `where('==')`, `orderBy`, `limit`, `add`, `set`, `update` and `delete`. The tests need no network access and no secrets. CI runs them on Node 18, 20 and 22, then runs `vite build` and `npm audit`.

## 11. Extension points

| To add… | Touch |
| ------- | ----- |
| An admin endpoint | `routes/*`, then `controllers/*`, then `services/*`, plus tests |
| A public endpoint | The same, plus `PUBLIC_PATHS` in `server.js` and a limiter in `rateLimiter.js` |
| A dashboard page | `pages/`, a route in `App.jsx`, the sidebar entry in `AdminLayout.jsx`, and an API module in `api.js` |
| An env variable | `.env.example`, the README env table, and `render.yaml` if production needs it |
