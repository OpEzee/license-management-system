# CLAUDE.md — Opezee License Management System

Claude Code reads this file at the start of every session in this repo. It holds the working rules. The other docs cover:

- `PRD.md`: what to build
- `ARCHITECTURE.md`: how the system fits together
- `README.md`: setup and the API reference

## Project in one line

This is the admin dashboard (React 18 + Vite + Tailwind) and license API (Express 4 + MongoDB) that Opezee uses to issue licenses for its products. Products call public endpoints to verify a license and re-sync it every hour. Each license runs on at most its `maxScreens` machines (1–100, default 1).

## Environment

- The developer works on Windows at `C:\projects\licence-management-system`, editing in VS Code. Give shell commands that work in PowerShell, and use `npm` scripts in preference to bash-only commands.
- Use Node 20, as pinned in `.nvmrc`. The project supports Node 18 and later.
- There is one `.env` at the root. Never print it, commit it or edit its secrets.
- The database is MongoDB. `npm run dev`, `npm start` and `npm test` all need a running MongoDB server: by default `mongodb://127.0.0.1:27017`, database `opezee_licenses`. Override them with `MONGODB_URI` and `MONGODB_DB`. The server exits at start-up if it cannot connect.

## Commands

| Task | Command |
| ---- | ------- |
| Install | `npm install` |
| Run the dev server (API + dashboard) | `npm run dev`, then open http://localhost:5173 |
| Run the API only | `npm run dev:api` |
| Run the dashboard only | `npm run dev:web` |
| Run the tests | `npm test` |
| Build for production | `npm run build`, then `npm start` (port 5000) |
| Create or reset the admin | `npm run create-admin` |
| Check SMTP | `npm run check-mail [address]` |
| Back up the database | `npm run backup-db` (writes `backups/mongodb-<timestamp>/`, git-ignored) |
| Restore the newest backup | `npm run restore-db` |
| Restore a specific backup | `npm run restore-db -- <folder>` |
| Give existing licenses a max-screens limit | `npm run set-max-screens -- --min <n>` (add `--dry-run` to preview). Run it once before deploying max screens. |
| Run in Docker | `docker build -t opezee-lms .` then `docker run --env-file .env -p 5000:5000 opezee-lms`. `MONGODB_URI` must reach MongoDB from inside the container: use `host.docker.internal`, not `127.0.0.1`. |

**Definition of done:** `npm test` passes, `npm run build` succeeds, and `README.md` / `PRD.md` are updated if behaviour or scope changed.

## Code style

- **Server:** CommonJS with `'use strict';`. Use semicolons and single quotes.
- **Client:** ESM, `.jsx` function components and hooks. Omit semicolons and use single quotes.
- Comments explain *why*, not *what*. Follow the existing comment tone.
- Do not add TypeScript, new frameworks or state libraries, or a second `package.json` unless asked.

## Rules for server changes

1. Respect the layers. Routes hold validation, controllers shape HTTP responses, and services own MongoDB access and the business rules. Services reach the database only through `collection()` from `server/config/db.js`. Never touch the database from a controller or a route.
   - Document `_id`s are hex strings from `newId()`, not `ObjectId`s, because records carried over from Firestore kept their ids. Query by `{ _id: String(id) }`.
   - A new field the services look up on every request gets an index in `ensureIndexes()`.
2. Validate every input with express-validator. Text inputs get `.trim().escape()` and a max length. Optional form fields use `.optional({ values: 'falsy' })`.
3. For expected errors, throw `new ApiError(status, message, CODE)`. Responses look like `{ success, message, code, errors? }`, and never include a stack trace.
4. Public routes go **above** `router.use(requireAdmin)`. They must also be added to `PUBLIC_PATHS` in `server/server.js`, and each one needs a rate limiter.
5. Never weaken these:
   - status is always derived with `computeStatus()`
   - the server calculates expiry dates
   - license keys come only from `generateLicenseKey.js` and cannot be edited
   - max screens per license: on `/verify` and `/sync`, a new machine beyond `maxScreens` gets `403 SCREEN_LIMIT_REACHED`, and once any slot is claimed, a missing machine number gets `403 MACHINE_NUMBER_REQUIRED`. Slots are claimed only through `admitMachine()`, as one atomic `findOneAndUpdate` with the size check in its filter, never as a read followed by a write. Don't confuse this with `screens`, which Digital Diya reports itself.
   - wrong-email and wrong-password logins return the same error
6. Keep the legacy-field fallbacks in `toPublicLicense()` (`clientEmail` and `createdAt`).

## Rules for client changes

1. Call the API only through the modules in `client/src/services/api.js`. Never call `axios` from a component.
2. Reuse the existing components before creating new ones: `Modal`, `ConfirmDialog`, `Toast`, `TableToolbar`, `StatusBadge`, `StatCard`, `IconButton`, `DatePicker` and `States`.
3. Use only Tailwind classes, and every screen must work in both light and dark mode.
4. To add a page: add the file to `pages/`, add a route inside `ProtectedRoute` → `AdminLayout` in `App.jsx`, and add a sidebar entry in `AdminLayout.jsx`.

## Tests

- All tests live in `server/tests/api.test.js`. They run against a throwaway database (`opezee_licenses_test_<pid>_<time>`) on the local MongoDB server and drop it at the end. There is no fake, so MongoDB must be running. Set `MONGODB_URI` if it is not on the default port.
- Every new or changed endpoint needs tests for:
  - success
  - validation (400)
  - no token (401)
  - each error code

## Git

- Branch from `main`. Use Conventional Commit prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Keep each pull request to one concern. Each description covers what changed, why, and how it was tested.

## How to work with me

- Before a change that touches more than about three files, give a short plan and wait for a go-ahead.
- When the PRD and the code disagree, point it out and ask which one is right. Don't silently pick one.
- Prefer small diffs. Do not reformat files you are not otherwise changing.

## Current priorities

1. Build the Clients page (`client/src/pages/Clients.jsx`, its route and sidebar entry). The backend `/api/clients` CRUD already exists.
2. README: add the setup steps, the environment variable table and an API reference listing every endpoint, public and admin. `feedback.txt` is already gone, and the old auth section with its incomplete endpoint list was removed.
