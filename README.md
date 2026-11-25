# Opezee License Management System

## Project Overview

Opezee License Management System is a central platform to create, issue and control software licenses for Opezee products. Admins use a web dashboard to manage products, clients and licenses, and each Opezee product connects to the system to check whether its license is valid before it can be used.

## Use Cases

### Actors

| Actor | Role |
| --- | --- |
| **Admin** | Manages products, clients and licenses from the dashboard |
| **Client** | Receives the license and uses the Opezee product |
| **Product** | Opezee software that checks its license with the system |

### Admin

| Use Case | Description |
| --- | --- |
| Login | Sign in to the admin dashboard |
| Manage products | Add, edit or delete products |
| Manage clients | Add, edit or delete clients |
| Issue license | Create a license for a client and product with an expiry date |
| Send license | Email the license key to the client |
| Manage licenses | Edit, change status of, or delete licenses |
| View dashboard | Shows summary cards, status and product breakdowns, machine-slot usage, expiring-soon and recently-issued lists |

### Client

| Use Case | Description |
| --- | --- |
| Receive license | Get the license key by email |
| Activate product | Enter the license key in the product |

### Product

| Use Case | Description |
| --- | --- |
| Verify license | Check the license key is valid before use, sending its machine number so it counts against the license's max screens |
| Re-check license | Re-validate the license periodically |

## Project Flow

```mermaid
flowchart TD
    A[Admin logs in] --> B[Add product]
    B --> C[Add client]
    C --> D[Issue license]
    D --> E[License emailed to client]
    E --> F[Client enters key in product]
    F --> G{Product verifies license}
    G -- Valid --> H[Product unlocked]
    G -- Invalid / Expired --> I[Access blocked]
    H --> J[Periodic re-check]
    J --> G
```

1. Admin logs in to the dashboard.
2. Admin adds the product and the client.
3. Admin issues a license for the client and product.
4. The license key is emailed to the client.
5. Client enters the key in the product.
6. Product verifies the license — valid keys unlock the product, invalid or expired keys are blocked.
7. Product re-checks the license periodically while in use.

## Max screens per license

Each license has **max screens**: how many machines can use the key, from 1 to 100, set by the admin (1 by default).

- Products send `machineNumber` with `POST /api/licenses/verify` and `POST /api/licenses/sync`. A product that shows the hosted `/client` pages passes it in their URL as `&machine=`. The first *max screens* distinct machines claim a slot, and a machine that holds a slot is always accepted.
- When every slot is taken, a new machine gets `403` with `valid: false` and `code: "SCREEN_LIMIT_REACHED"`.
- Once any slot is claimed, a request with no machine number gets `403` with `code: "MACHINE_NUMBER_REQUIRED"`.
- Machine numbers are compared trimmed and case-insensitively. They may contain letters, digits and `. _ : -`, up to 128 characters.
- In the dashboard, the license popup lists the machines in use. **Release** frees one, for example when hardware is replaced. The same action is available as `DELETE /api/licenses/:id/machines/:machineNumber` (admin token). Max screens cannot be lowered below the machines in use.
- Digital Diya keys are not limited this way: Digital Diya reports its own screens, shown in the Screens column.

## Database

Data is stored in **MongoDB** (it previously lived in Firebase Firestore). By default the
server connects to a local MongoDB at `mongodb://127.0.0.1:27017`, database
`opezee_licenses`. Override with `MONGODB_URI` and `MONGODB_DB` in `.env`.

| Command | What it does |
| --- | --- |
| `npm run backup-db` | Exports every collection to `backups/mongodb-<timestamp>/` as JSON |
| `npm run restore-db` | Loads the newest backup folder into MongoDB (upserts by id, safe to re-run) |
| `npm run restore-db -- <folder>` | Loads a specific backup folder |
| `npm run set-max-screens -- --min <n>` | One-off migration before deploying max screens. Gives every license without a limit `max(n, machines it already has)`. Add `--dry-run` to preview. Safe to re-run |
| `npm run strip-client-passwords` | One-off migration: removes the readable client passwords older records still carry, so only the bcrypt hash is left. Add `-- --dry-run` to preview. Safe to re-run, and worth re-running after restoring an old backup |
| `npm run create-admin` | Creates or resets the dashboard admin login |
| `npm test` | Runs the API tests against a throwaway database on the local MongoDB |

The `backups/` folder is git-ignored because it contains password hashes. Backups taken before `strip-client-passwords` ran also contain readable client passwords: delete them, or keep them somewhere locked down.
