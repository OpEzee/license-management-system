'use strict';

/*
 * Gives every existing license a maxScreens limit, so the machine limit can
 * be switched on without cutting off a working installation.
 *
 *   npm run set-max-screens -- --dry-run          # show what would change
 *   npm run set-max-screens -- --min 5            # floor of 5 for existing licenses
 *   npm run set-max-screens                       # floor of 1
 *
 * For each license that has no maxScreens yet:
 *   - the single machineNumber left by the old one-machine lock (if any) is
 *     carried into claimedMachines, so that machine keeps its slot
 *   - maxScreens = max(--min, machines already claimed)
 *
 * Between the old lock's removal and this limit, keys ran on any number of
 * machines and nothing recorded which, so the claimed count alone can undercount
 * an installation. --min is the safety margin for that; lower it per license
 * in the console once the real machines have checked in.
 *
 * Safe to re-run: a license that already has maxScreens is never touched.
 * Back up first: npm run backup-db
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { initDb, getDb, closeDb, settings } = require('../config/db');
const {
  normalizeMachine,
  DEFAULT_MAX_SCREENS,
  MAX_SCREENS_LIMIT,
} = require('../services/licenseService');

function parseArgs(argv) {
  const options = { min: DEFAULT_MAX_SCREENS, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--min' || arg.startsWith('--min=')) {
      const raw = arg.includes('=') ? arg.split('=')[1] : argv[(i += 1)];
      const min = Number(raw);
      if (!Number.isInteger(min) || min < 1 || min > MAX_SCREENS_LIMIT) {
        throw new Error(`--min must be a whole number from 1 to ${MAX_SCREENS_LIMIT}`);
      }
      options.min = min;
    } else {
      throw new Error(`Unknown option "${arg}". Use --min <n> and/or --dry-run.`);
    }
  }
  return options;
}

/** The machines a license already holds: any claimedMachines, plus the legacy single one. */
function machinesOf(doc) {
  const machines = [];
  const seen = new Set();
  const add = (entry) => {
    const machineNumber = normalizeMachine(entry.machineNumber);
    if (!machineNumber || seen.has(machineNumber)) return;
    seen.add(machineNumber);
    machines.push({
      machineNumber,
      // When the old lock claimed it was never recorded; unknown beats invented.
      firstSeenAt: entry.firstSeenAt || null,
      lastSeenAt: entry.lastSeenAt || null,
    });
  };
  (doc.claimedMachines || []).forEach(add);
  if (doc.machineNumber) add({ machineNumber: doc.machineNumber });
  return machines;
}

/**
 * The migration itself, separate from the CLI so the tests can run it against
 * their own database. Returns the summary it would print.
 */
async function migrate(db, { min = DEFAULT_MAX_SCREENS, dryRun = false } = {}) {
  const licenses = db.collection('licenses');
  const total = await licenses.countDocuments();
  const pending = await licenses.find({ maxScreens: { $exists: false } }).toArray();

  const rows = [];
  for (const doc of pending) {
    const claimedMachines = machinesOf(doc);
    const maxScreens = Math.min(MAX_SCREENS_LIMIT, Math.max(min, claimedMachines.length));
    rows.push({
      licenseKey: doc.licenseKey,
      productName: doc.productName,
      claimed: claimedMachines.length,
      legacy: Boolean(doc.machineNumber),
      maxScreens,
    });

    if (dryRun) continue;
    // Re-checking maxScreens in the filter keeps a concurrent run, or an admin
    // setting the limit meanwhile, from being overwritten.
    await licenses.updateOne(
      { _id: doc._id, maxScreens: { $exists: false } },
      {
        $set: { maxScreens, claimedMachines, updatedAt: new Date() },
        ...(doc.machineNumber !== undefined ? { $unset: { machineNumber: '' } } : {}),
      }
    );
  }

  return {
    total,
    updated: rows.length,
    alreadySet: total - rows.length,
    legacyMachinesCarried: rows.filter((r) => r.legacy).length,
    rows,
    min,
    dryRun,
  };
}

function printSummary(summary) {
  const { rows } = summary;
  console.log(summary.dryRun ? '\nDry run: nothing was written.\n' : '');
  if (rows.length) {
    console.log('  License key            Product                    Claimed  Max screens');
    rows.forEach((r) => {
      console.log(
        `  ${String(r.licenseKey).padEnd(22)} ${String(r.productName || '').slice(0, 26).padEnd(26)} ${String(r.claimed).padStart(7)}  ${String(r.maxScreens).padStart(11)}${r.legacy ? '  (legacy machine kept)' : ''}`
      );
    });
    console.log('');
  }
  console.log(`  Licenses in the database:     ${summary.total}`);
  console.log(`  ${summary.dryRun ? 'Would be given' : 'Given'} maxScreens:       ${summary.updated} (floor ${summary.min})`);
  console.log(`  Already had maxScreens:       ${summary.alreadySet}`);
  console.log(`  Legacy machine numbers kept:  ${summary.legacyMachinesCarried}`);
  console.log('');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initDb();
  console.log(`\nSetting maxScreens in ${settings().dbName}${options.dryRun ? ' (dry run)' : ''}`);
  printSummary(await migrate(getDb(), options));
  await closeDb();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('\nMigration failed:', err.message, '\n');
    await closeDb().catch(() => {});
    process.exit(1);
  });
}

module.exports = { migrate, parseArgs };
