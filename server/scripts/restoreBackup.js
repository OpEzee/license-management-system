'use strict';

/*
 * Loads a JSON backup into MongoDB.
 *
 *   npm run restore-db                 # newest folder in backups/
 *   npm run restore-db -- <folder>     # a specific backup folder
 *
 * Reads every <collection>.json in the folder (as written by `npm run backup-db`,
 * or by the one-off Firestore export taken before the move to MongoDB).
 * Dates stored as { "$date": "<ISO>" } become real dates again, and each
 * document keeps its original _id.
 *
 * Safe to re-run: documents are upserted by _id, so restoring twice does not
 * duplicate anything. Documents in the database that are not in the backup are
 * left alone.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { initDb, getDb, closeDb, settings } = require('../config/db');

const BACKUP_ROOT = path.join(__dirname, '../../backups');

function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$date') return new Date(value.$date);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
  }
  return value;
}

function pickFolder(arg) {
  if (arg) return path.resolve(arg);
  if (!fs.existsSync(BACKUP_ROOT)) throw new Error(`No backups folder at ${BACKUP_ROOT}`);
  const folders = fs
    .readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => {
      const ta = fs.statSync(path.join(BACKUP_ROOT, a)).mtimeMs;
      const tb = fs.statSync(path.join(BACKUP_ROOT, b)).mtimeMs;
      return tb - ta;
    });
  if (!folders.length) throw new Error(`No backup folders in ${BACKUP_ROOT}`);
  return path.join(BACKUP_ROOT, folders[0]);
}

async function main() {
  const folder = pickFolder(process.argv[2]);
  const files = fs.readdirSync(folder).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  if (!files.length) throw new Error(`No collection files in ${folder}`);

  await initDb();
  const db = getDb();
  console.log(`\nRestoring ${folder}\n  into ${settings().uri} / ${settings().dbName}\n`);

  for (const file of files) {
    const name = path.basename(file, '.json');
    const docs = revive(JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8')));
    if (!docs.length) {
      console.log(`  ${name}: 0 documents`);
      continue;
    }
    const result = await db.collection(name).bulkWrite(
      docs.map((doc) => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
      }))
    );
    console.log(
      `  ${name}: ${docs.length} documents (${result.upsertedCount} new, ${result.modifiedCount} updated)`
    );
  }

  await closeDb();
  console.log('\nRestore complete.\n');
}

main().catch(async (err) => {
  console.error('\nRestore failed:', err.message, '\n');
  await closeDb().catch(() => {});
  process.exit(1);
});
