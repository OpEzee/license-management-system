'use strict';

const { MongoClient, ObjectId } = require('mongodb');

const DEFAULT_URI = 'mongodb://127.0.0.1:27017';
const DEFAULT_DB = 'opezee_licenses';

let client = null;
let db = null;

function settings() {
  return {
    uri: process.env.MONGODB_URI || DEFAULT_URI,
    dbName: process.env.MONGODB_DB || DEFAULT_DB,
  };
}

/**
 * Returns the database handle. The driver connects lazily on the first
 * operation, so this is safe to call synchronously from any service.
 */
function getDb() {
  if (db) return db;
  const { uri, dbName } = settings();
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  db = client.db(dbName);
  return db;
}

function collection(name) {
  return getDb().collection(name);
}

/**
 * Document ids are plain strings rather than ObjectIds: the records carried
 * over from Firestore keep their original ids (product links and bookmarks
 * that contain them keep working), and new records use the same shape.
 */
function newId() {
  return new ObjectId().toHexString();
}

/** Indexes behind the lookups the services make on every request. */
async function ensureIndexes() {
  const d = getDb();
  await Promise.all([
    d.collection('licenses').createIndex({ licenseKey: 1 }, { unique: true }),
    d.collection('licenses').createIndex({ clientUserId: 1 }),
    d.collection('licenses').createIndex({ productName: 1 }),
    d.collection('licenses').createIndex({ createdAt: -1 }),
    d.collection('clients').createIndex({ username: 1 }),
    d.collection('admins').createIndex({ email: 1 }, { unique: true }),
    d.collection('emailConfigs').createIndex({ email: 1 }),
    d.collection('products').createIndex({ createdAt: -1 }),
  ]);
}

/** Connects, checks the server answers and makes sure the indexes exist. */
async function initDb() {
  getDb();
  await client.connect();
  await db.command({ ping: 1 });
  await ensureIndexes();
  return db;
}

async function closeDb() {
  if (client) await client.close();
  client = null;
  db = null;
}

module.exports = { initDb, getDb, collection, newId, closeDb, ensureIndexes, settings };
