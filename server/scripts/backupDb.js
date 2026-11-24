'use strict';

/*
 * Exports every MongoDB collection to JSON.
 *
 *   npm run backup-db
 *
 * Writes backups/mongodb-<timestamp>/<collection>.json plus a _manifest.json.
 * Dates are written as { "$date": "<ISO>" } so `npm run restore-db` can bring
 * them back exactly. The backups folder is git-ignored: it holds password
 * hashes, so keep copies somewhere private.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { initDb, getDb, closeDb, settings } = require('../config/db');

function serialize(value) {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    if (value._bsontype === 'ObjectId') return value.toHexString();
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

async function main() {
  await initDb();
  const db = getDb();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, '../../backups', `mongodb-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const summary = {};
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;
    const docs = await db.collection(name).find().toArray();
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(serialize(docs), null, 2));
    summary[name] = docs.length;
    console.log(`  ${name}: ${docs.length} documents`);
  }

  fs.writeFileSync(
    path.join(outDir, '_manifest.json'),
    JSON.stringify(
      { source: 'mongodb', database: settings().dbName, exportedAt: new Date().toISOString(), collections: summary },
      null,
      2
    )
  );

  await closeDb();
  console.log(`\nBackup written to ${outDir}\n`);
}

main().catch(async (err) => {
  console.error('\nBackup failed:', err.message, '\n');
  await closeDb().catch(() => {});
  process.exit(1);
});
