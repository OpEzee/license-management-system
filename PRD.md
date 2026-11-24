# Product Requirements Document — Opezee License Management System

| Field        | Value                                    |
| ------------ | ---------------------------------------- |
| Product      | Opezee License Management System (LMS)   |
| Owner        | Opezee                                   |
| Status       | v1.0 built; hardening and gap-closing    |
| Last updated | 24 November 2026                         |

---

## 1. Summary

Opezee sells software products (kiosk apps, games, showcase apps) that run on client hardware. The LMS is where Opezee issues, tracks and revokes licenses for those products. It also gives each product a small public API so it can check, on launch and every hour, that its key is still valid on that machine.

It is one deployable service with three parts (see `ARCHITECTURE.md` for how they fit together):

- a React admin dashboard
- a Node.js + Express API
- MongoDB as the database: a local server in development, and a hosted database such as MongoDB Atlas in production

## 2. Problem

Without a central system, licenses live in spreadsheets and emails. Opezee cannot:

- tell which client has which product, or when it expires
- stop one key being installed on several machines
- switch off a product remotely when a client stops paying
- send a client their key in a consistent, branded format

## 3. Goals and non-goals

### Goals

1. An admin can issue a license in under a minute, with the expiry worked out from a preset duration.
2. A product can check its key with one HTTP call and needs no admin credentials.
3. Each license is locked to the first machine that uses it.
4. Deactivating or expiring a license takes effect on the product's next hourly sync.
5. The whole system deploys as one service on one URL.

### Non-goals (v1)

- Payments, invoicing or a client-facing self-service portal.
- Several admin roles or permission levels. There is a single admin role.
- Offline license files or cryptographically signed tokens. Products check online.
- Usage metering or seat counts above one machine per license.

## 4. Users

| User                   | Needs                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| **Admin** (Opezee staff) | Issue, view, edit, deactivate, delete and email licenses; manage products and client accounts; change settings. |
| **Client / POC**       | Receives the license key by email; signs in to the product with a username and password. |
| **Product** (software) | Verifies its key on demand, re-syncs hourly, checks client login, and updates its own contact details. |

## 5. Functional requirements

### 5.1 Authentication (admin)

| ID     | Requirement |
| ------ | ----------- |
| AUTH-1 | Admin signs in with email and password. Fields are validated as the admin types. |
| AUTH-2 | A successful sign-in returns a JWT bearer token. It lasts `TOKEN_EXPIRES_IN`, which defaults to 12h. |
| AUTH-3 | Every dashboard page requires a valid token. An expired token sends the admin to `/login`. |
| AUTH-4 | A wrong email and a wrong password return the same error, so the response does not reveal which accounts exist. |
| AUTH-5 | Login is limited to 10 failed attempts per 15 minutes per IP. |
| AUTH-6 | The admin account is created or reset with `npm run create-admin`. |

### 5.2 Dashboard

| ID     | Requirement |
| ------ | ----------- |
| DASH-1 | Shows summary cards only: total clients, active licenses, expired licenses and total licenses. There is no license table. |
| DASH-2 | The sidebar has Dashboard, Licenses, Products and Clients, with Settings pinned at the bottom. |

### 5.3 Licenses

| ID    | Requirement |
| ----- | ----------- |
| LIC-1 | The table has these columns: license key, client name, user name, product, sold by, start date, expiry date, status and actions. |
| LIC-2 | The actions column has **View** and **Delete** icons only. View opens an editable popup. Delete asks for confirmation first. |
| LIC-3 | The create/edit form has: client user ID, client name, company, product, sold by, start date and duration. |
| LIC-4 | Duration is one of `1_month`, `3_months`, `6_months`, `1_year` or `custom`. For the presets the server calculates the expiry and the field is read-only. For `custom` the admin sets the expiry, which must be after the start date. |
| LIC-5 | The server generates license keys with a CSPRNG in the format `PREFIX-XXXX-XXXX-XXXX`. The alphabet excludes `I L O U 0 1`. Keys are unique and can never be edited. |
| LIC-6 | Status is always derived when read, never trusted from storage. It is one of `pending` (starts in the future), `active`, `expired` or `deactivated` (switched off by the admin, which overrides the dates). |
| LIC-7 | Clicking the status chip deactivates or reactivates a license. The license keeps its dates. |
| LIC-8 | **Share** emails the license to between 1 and 10 recipients over SMTP. If SMTP is not configured, it opens a `mailto:` link instead. |
| LIC-9 | The table supports search and filtering through the toolbar. |

### 5.4 Products

| ID     | Requirement |
| ------ | ----------- |
| PROD-1 | A table lists the products that have been added. |
| PROD-2 | **Add product** takes two fields only: name (required, 120 characters max) and description (optional, 1000 characters max). |
| PROD-3 | Products can be edited and deleted. |

### 5.5 Clients

| ID    | Requirement |
| ----- | ----------- |
| CLI-1 | Client accounts hold a client name, company, username and password (8 characters minimum, stored as a bcrypt hash). |
| CLI-2 | The list shows each client's license count. |
| CLI-3 | When an account is created, any unlinked licenses with the same client name (and company, if one is recorded) are linked to the new username. |

### 5.6 Settings

| ID    | Requirement |
| ----- | ----------- |
| SET-1 | A dark/light mode toggle. The choice is saved per device and applied before first paint. First-time visitors follow their OS setting. |
| SET-2 | Change password, which needs the current password, a new password and a confirmation. |
| SET-3 | Email IDs: add, edit, delete and set a default. The first email added becomes the default. The default cannot be deleted while other emails exist. |
| SET-4 | Console logo upload: PNG, JPEG, WebP or SVG, up to 500 KB. It is stored in the MongoDB `settings` collection, document `branding`. With no logo, the console shows an "OpEzee" wordmark. |

### 5.7 Product-facing API (public, no admin token)

| ID    | Endpoint | Requirement |
| ----- | -------- | ----------- |
| API-1 | `POST /api/licenses/verify` | Checks a key on demand. Input: `licenseKey`, optional `productName`, `machineNumber`. Returns `valid` plus the reason: not found (404), product mismatch (403), machine mismatch (403), deactivated, expired or pending. |
| API-2 | `POST /api/licenses/sync` | Same check, called by the product every hour. A product must lock itself when `valid` is false. |
| API-3 | `POST /api/clients/login` | Checks a client's username and password, optionally for one product. Limited to 30 attempts per 15 minutes per IP. |
| API-4 | `PUT /api/licenses/poc`, `PUT /api/licenses/email` | Let the product update its own POC name or email. The key plus the claimed machine number act as the credential. Only allowed while the license is active. |
| API-5 | — | Verify, sync, poc and email are limited to 20 requests per minute per IP. They allow CORS from any origin. |

### 5.8 One machine per license

| ID     | Requirement |
| ------ | ----------- |
| LOCK-1 | The first successful verify that sends a `machineNumber` claims the license for that machine. |
| LOCK-2 | After that, any request with a different machine number, or none, gets `machine_mismatch`. |
| LOCK-3 | Machine numbers are compared case-insensitively. They may contain `A–Z a–z 0–9 . _ : -` and are at most 128 characters. |

## 6. Non-functional requirements

| Area          | Requirement |
| ------------- | ----------- |
| Security      | Helmet CSP is on. Admin CORS is restricted to `CORS_ORIGIN` plus same-origin. Input is validated and escaped with express-validator. JSON bodies are capped at 100 KB (1 MB for the logo). Responses never include stack traces. The server refuses to start without a `JWT_SECRET` of 16+ characters. |
| Secrets       | `.env` is git-ignored. It holds `MONGODB_URI`, with any database credentials, and `JWT_SECRET`. So is `backups/`, whose database exports contain password hashes. The connection string stays on the server only. |
| Data          | MongoDB (`MONGODB_URI`, `MONGODB_DB`). The server refuses to start if it cannot connect. `npm run backup-db` exports every collection to JSON, and `npm run restore-db` loads a backup back in. The restore is idempotent, upserting by id. |
| Rate limits   | Admin API: 300 requests per 15 minutes. Admin login: 10 per 15 minutes. Client login: 30 per 15 minutes. Verify, sync, poc and email: 20 per minute. All limits are per IP. |
| Performance   | Verify and sync answer in under 500 ms (p95) on the Render free tier once warm. |
| Availability  | `GET /health` is used for Render's health check. |
| Compatibility | Node 18+ (20 recommended). The dashboard supports the current Chrome, Edge, Firefox and Safari. |
| Testing       | `npm test` runs the end-to-end API suite against a throwaway database on a local MongoDB server, and drops that database afterwards. It needs a running MongoDB but no credentials. It must pass before merging. |

## 7. Known gaps / open items

| #  | Item | Notes |
| -- | ---- | ----- |
| G1 | **There is no Clients page in the dashboard.** | The README, sidebar requirement (DASH-2) and hooks expect `client/src/pages/Clients.jsx`, but neither the file nor its `/clients` route in `App.jsx` exists. The backend endpoints are already in place. |
| G2 | `feedback.txt` belongs to the "Light a Lamp" project. | Move it to that repo or delete it. |
| G3 | ~~`.claude/launch.json` points at a `frontend/` folder that does not exist.~~ | Done: it now runs `npm run dev` at the root. |
| G4 | The README's auth section lists only 3 public endpoints. | `/licenses/poc` and `/licenses/email` are public too. |
| G5 | The README mentions an `example-game/` folder that is not in the repo. | Add the folder or remove the reference. |
| G6 | Machine lock reset. | There is no admin action to release a machine claim, for example when a client replaces hardware. |
| G7 | Audit log. | Nothing records who changed or deactivated a license, or when. |
| G8 | Expiry reminders. | The system does not email clients before their license expires. |

## 8. Success metrics

- Every active Opezee installation is covered by a license in the LMS.
- Zero cases of one key running on more than one machine.
- A deactivation takes effect on the product within 1 hour.
- An admin can create and share a license in under 60 seconds.

## 9. Release plan

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 1 | Login, Dashboard, Licenses, Products, Settings, the verify/sync/login API | Done |
| 2 | Email sharing, branding, machine lock, POC self-service, Render deploy | Done |
| 3 | Firestore → MongoDB migration: data layer on the `mongodb` driver, backup and restore scripts | Done |
| 4 | Clients page (G1), repo clean-up (G2, G4, G5), CI with a MongoDB service | Next |
| 5 | Machine-lock reset (G6), audit log (G7), expiry reminders (G8) | Planned |
