'use strict';

/*
 * Removes the readable `password` copies that client (POC) accounts used to
 * carry next to their bcrypt hash. After this, a POC's password exists only
 * as the hash: the login checks it, and nothing can show it again.
 *
 *   npm run strip-client-passwords -- --dry-run   # count what would change
 *   npm run strip-client-passwords                # remove them
 *
 * An account with a readable password but no hash (should not exist, but an
 * old import might have one) is hashed from it first, so its POC can still
 * sign in.
 *
 * Prints counts only, never a password or a username. Safe to re-run, and
 * worth re-running after any restore from a backup taken before this change.
 * Back up first: npm run backup-db — then delete or lock away those backups,
 * which still hold the readable passwords.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const bcrypt = require('bcryptjs');
const { initDb, getDb, closeDb, settings } = require('../config/db');

const BCRYPT_ROUNDS = 12;

function parseArgs(argv) {
  const options = { dryRun: false };
  argv.forEach((arg) => {
    if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown option "${arg}". The only option is --dry-run.`);
  });
  return options;
}

/**
 * The migration itself, separate from the CLI so the tests can run it against
 * their own database. Returns the summary it would print.
 */
async function strip(db, { dryRun = false } = {}) {
  const clients = db.collection('clients');
  const total = await clients.countDocuments();
  const pending = await clients.find({ password: { $exists: true } }).toArray();
  const missingHash = pending.filter((doc) => !doc.passwordHash);

  if (!dryRun) {
    for (const doc of pending) {
      const $set = { updatedAt: new Date() };
      if (!doc.passwordHash && doc.password) {
        $set.passwordHash = await bcrypt.hash(String(doc.password), BCRYPT_ROUNDS);
      }
      // Matching on the field keeps a concurrent run from double-counting.
      await clients.updateOne(
        { _id: doc._id, password: { $exists: true } },
        { $set, $unset: { password: '' } }
      );
    }
  }

  return {
    total,
    stripped: pending.length,
    hashedFirst: missingHash.filter((doc) => doc.password).length,
    alreadyClean: total - pending.length,
    dryRun,
  };
}

function printSummary(summary) {
  console.log(summary.dryRun ? '\nDry run: nothing was written.\n' : '');
  console.log(`  Client accounts in the database:   ${summary.total}`);
  console.log(`  ${summary.dryRun ? 'Would lose' : 'Lost'} their readable password:  ${summary.stripped}`);
  console.log(`  ${summary.dryRun ? 'Would be hashed' : 'Hashed'} first (had no hash): ${summary.hashedFirst}`);
  console.log(`  Already hash-only:                 ${summary.alreadyClean}`);
  console.log('');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initDb();
  console.log(
    `\nRemoving readable client passwords in ${settings().dbName}${options.dryRun ? ' (dry run)' : ''}`
  );
  printSummary(await strip(getDb(), options));
  await closeDb();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('\nMigration failed:', err.message, '\n');
    await closeDb().catch(() => {});
    process.exit(1);
  });
}

module.exports = { strip, parseArgs };
