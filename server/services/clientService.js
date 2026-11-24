'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { collection: getCollection, newId } = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');
const licenseService = require('./licenseService');

const COLLECTION = 'clients';
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

// Generated passwords: uppercase and digits without the look-alikes I L O U 0 1,
// so a POC reading one off a screen or hearing it on the phone gets it right.
// 30 symbols x 12 = about 59 bits, far past what the client-login rate limit
// lets anyone guess. No separators: the product compares the password exactly.
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const GENERATED_PASSWORD_LENGTH = 12;

function collection() {
  return getCollection(COLLECTION);
}

async function findOrThrow(id) {
  const doc = await collection().findOne({ _id: String(id) });
  if (!doc) throw new ApiError(404, 'Client not found', 'CLIENT_NOT_FOUND');
  return doc;
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const normalizeUsername = (value) => String(value || '').trim().toLowerCase();

/**
 * Never carries a password or its hash, to anyone. Only the bcrypt hash is
 * stored; a generated password is handed back once, by the call that made it.
 */
function toPublicClient(data) {
  return {
    id: data._id,
    clientName: data.clientName,
    companyName: data.companyName,
    username: data.username,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

async function findByUsername(username) {
  return collection().findOne({ username: normalizeUsername(username) });
}

/** Usernames are the product's login identity, so they must be unique. */
async function assertUsernameAvailable(username, exceptId) {
  const existing = await findByUsername(username);
  if (existing && existing._id !== exceptId) {
    throw new ApiError(409, 'That username is already taken', 'USERNAME_TAKEN');
  }
}

/**
 * The POC name identifies the person a license is issued to, so no two client
 * accounts may share one. One POC can hold any number of licenses — that is
 * the point of the name being unique: every license naming it belongs to the
 * same person rather than to a second account that happens to be called the
 * same thing.
 */
async function assertPocAvailable(clientName, exceptId) {
  const normalized = normalizeUsername(clientName);
  if (!normalized) return;

  // Compared in code rather than with an equality query: the stored value
  // keeps its original casing, so a query would miss "Sajid" vs "sajid".
  const all = await collection().find({}, { projection: { clientName: 1 } }).toArray();
  const clash = all.find(
    (doc) => doc._id !== exceptId && normalizeUsername(doc.clientName) === normalized
  );
  if (clash) {
    throw new ApiError(409, 'That POC name is already taken', 'POC_TAKEN');
  }
}

/** Company names identify the organisation, so no two accounts may share one. */
async function assertCompanyAvailable(companyName, exceptId) {
  const normalized = normalizeUsername(companyName);
  if (!normalized) return;

  // Compared in code rather than with an equality query: the stored value
  // keeps its original casing, so a query would miss "ABC Pvt Ltd" vs "abc pvt ltd".
  const all = await collection().find({}, { projection: { companyName: 1 } }).toArray();
  const clash = all.find(
    (doc) => doc._id !== exceptId && normalizeUsername(doc.companyName) === normalized
  );
  if (clash) {
    throw new ApiError(409, 'That company name is already taken', 'COMPANY_TAKEN');
  }
}

function assertPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(
      400,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      'WEAK_PASSWORD'
    );
  }
}

/** A fresh password from PASSWORD_ALPHABET, drawn with a CSPRNG. */
function generatePassword() {
  let out = '';
  for (let i = 0; i < GENERATED_PASSWORD_LENGTH; i += 1) {
    out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

/**
 * Creates a POC account. Without a password one is generated and returned
 * once as `generatedPassword` — it is never stored readably, so this is the
 * only time anyone sees it. A typed password (admin API only) is hashed and
 * never sent back; `generatedPassword` is then null.
 */
async function createClient({ clientName, companyName, username, password }) {
  const normalized = normalizeUsername(username);
  await assertUsernameAvailable(normalized);
  await assertPocAvailable(clientName);
  await assertCompanyAvailable(companyName);

  const generatedPassword = password ? null : generatePassword();
  const secret = password || generatedPassword;
  assertPasswordStrength(secret);

  const now = new Date();
  const doc = {
    _id: newId(),
    clientName,
    companyName,
    username: normalized,
    passwordHash: await bcrypt.hash(secret, BCRYPT_ROUNDS),
    createdAt: now,
    updatedAt: now,
  };
  await collection().insertOne(doc);

  // Licenses issued to this name before the account existed now belong to it,
  // so the Clients page shows one row rather than two and the product login
  // finds them.
  await licenseService.adoptUnlinkedLicenses(clientName, normalized, companyName);

  return { client: toPublicClient(doc), generatedPassword };
}

async function getClientById(id) {
  return toPublicClient(await findOrThrow(id));
}

/**
 * Replaces the POC's password with a generated one, returned once. The old
 * one stops working at once on every product they sign in to.
 */
async function resetPassword(id) {
  const doc = await findOrThrow(id);
  const generatedPassword = generatePassword();
  await collection().updateOne(
    { _id: doc._id },
    {
      $set: { passwordHash: await bcrypt.hash(generatedPassword, BCRYPT_ROUNDS), updatedAt: new Date() },
      // Records from before hash-only may still hold a readable copy.
      $unset: { password: '' },
    }
  );
  return { client: await getClientById(doc._id), generatedPassword };
}

async function updateClient(id, { clientName, companyName, username, password }) {
  const doc = await findOrThrow(id);

  // Read before writing: this is what the licenses are currently matched on,
  // and it is needed again after the account has already been changed.
  const previousUsername = doc.username;

  const updates = { updatedAt: new Date() };

  if (clientName !== undefined) {
    await assertPocAvailable(clientName, id);
    updates.clientName = clientName;
  }

  if (companyName !== undefined) {
    await assertCompanyAvailable(companyName, id);
    updates.companyName = companyName;
  }

  if (username !== undefined) {
    const normalized = normalizeUsername(username);
    await assertUsernameAvailable(normalized, id);
    updates.username = normalized;
  }

  // Blank means "leave the password alone". A new one is only ever hashed.
  let unset;
  if (password) {
    assertPasswordStrength(password);
    updates.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    unset = { password: '' };
  }

  await collection().updateOne(
    { _id: doc._id },
    { $set: updates, ...(unset ? { $unset: unset } : {}) }
  );

  // Their licenses have to follow the edit. A changed email in particular is
  // what licenses are matched on, so leaving them behind splits the Clients
  // page into two rows for the same person — which reads as a duplicate having
  // been created rather than the existing one edited.
  await licenseService.relinkClientLicenses(previousUsername, {
    ...(updates.username !== undefined ? { username: updates.username } : {}),
    ...(updates.clientName !== undefined ? { clientName: updates.clientName } : {}),
    ...(updates.companyName !== undefined ? { companyName: updates.companyName } : {}),
  });

  return getClientById(doc._id);
}

/** How many licenses are filed under this POC email, leaving out the one being edited (if any). */
async function licensesFiledUnder(username, exceptLicenseId) {
  const user = normalizeUsername(username);
  const licenses = await licenseService.listLicenses();
  return licenses.filter(
    (l) => l.id !== exceptLicenseId && normalizeUsername(l.clientUserId) === user
  ).length;
}

/**
 * Creates or updates the POC account a license is filed under, from the
 * license form — which is where POC credentials are now entered.
 *
 * The form edits ONE license, so it never changes the others. An account is
 * shared by every license with its email, and editing the account carries its
 * name, company and email to all of them (updateClient → relinkClientLicenses),
 * so the form only does that when this license is the account's only one:
 *
 * - The account is found by the license's email. When none has that email but
 *   the license was filed under another one that holds no other license, that
 *   account is this POC being edited and takes the new email. If other licenses
 *   still use it, the new email is a new POC: a new account, and the others
 *   stay where they are.
 * - An account other licenses also use keeps its POC name and company.
 *
 * Passwords: a new account gets a generated one, returned once as
 * `generatedPassword`. An existing account keeps its password unless one is
 * sent (admin API only; the dashboard resets instead), so `generatedPassword`
 * is null for it.
 *
 * The Clients page edits the account itself, and there every license follows.
 */
async function savePocAccount({
  clientName,
  companyName,
  email,
  password,
  previousEmail,
  licenseId,
}) {
  const username = normalizeUsername(email);
  if (!username) throw new ApiError(400, 'Email is required', 'EMAIL_REQUIRED');
  if (!String(companyName || '').trim()) {
    throw new ApiError(400, 'Company name is required', 'COMPANY_REQUIRED');
  }

  let doc = await findByUsername(username);
  if (!doc && previousEmail && normalizeUsername(previousEmail) !== username) {
    const previous = await findByUsername(previousEmail);
    if (previous && !(await licensesFiledUnder(previousEmail, licenseId))) doc = previous;
  }

  if (!doc) return createClient({ clientName, companyName, username, password });

  const shared = (await licensesFiledUnder(doc.username, licenseId)) > 0;
  const client = await updateClient(doc._id, {
    ...(shared ? {} : { clientName, companyName }),
    username,
    ...(password ? { password } : {}),
  });
  return { client, generatedPassword: null };
}

async function deleteClient(id) {
  const doc = await findOrThrow(id);

  // Licenses are matched to a client by username, so removing the account
  // while licenses still point at it would strand them.
  const username = doc.username;
  const licenses = await licenseService.listLicenses();
  const inUse = licenses.some((l) => normalizeUsername(l.clientUserId) === username);
  if (inUse) {
    throw new ApiError(
      409,
      'This client still has licenses. Delete those licenses first.',
      'CLIENT_IN_USE'
    );
  }

  await collection().deleteOne({ _id: doc._id });
  return { id };
}

/**
 * The Clients page shows two kinds of row:
 *   - registered clients, who have login credentials for the product
 *   - user IDs that only appear on a license, kept visible so nothing is lost
 *     and so credentials can be added for them
 */
async function listClients() {
  const [accounts, licenses] = await Promise.all([
    collection().find().sort({ createdAt: -1 }).toArray(),
    licenseService.listLicenses(),
  ]);

  const rows = new Map();

  accounts.forEach((doc) => {
    const client = toPublicClient(doc);
    rows.set(normalizeUsername(client.username), {
      ...client,
      hasLogin: true,
      products: [],
      totalLicenses: 0,
      activeLicenses: 0,
      pendingLicenses: 0,
      expiredLicenses: 0,
      deactivatedLicenses: 0,
      latestExpiry: null,
    });
  });

  licenses.forEach((license) => {
    // A license links to an account by user ID when it has one. When it only
    // names a client, that name is the key, so it still shows up here.
    const key =
      normalizeUsername(license.clientUserId) || `name:${normalizeUsername(license.clientName)}`;
    if (key === 'name:') return;

    if (!rows.has(key)) {
      rows.set(key, {
        id: null,
        hasLogin: false,
        clientName: license.clientName,
        companyName: license.companyName,
        username: license.clientUserId || '',
        createdAt: null,
        updatedAt: null,
        products: [],
        totalLicenses: 0,
        activeLicenses: 0,
        pendingLicenses: 0,
        expiredLicenses: 0,
        deactivatedLicenses: 0,
        latestExpiry: null,
      });
    }

    const row = rows.get(key);
    row.totalLicenses += 1;
    if (license.status === 'active') row.activeLicenses += 1;
    else if (license.status === 'pending') row.pendingLicenses += 1;
    else if (license.status === 'deactivated') row.deactivatedLicenses += 1;
    else row.expiredLicenses += 1;

    if (license.productName && !row.products.includes(license.productName)) {
      row.products.push(license.productName);
    }
    if (!row.latestExpiry || license.expiryDate > row.latestExpiry) {
      row.latestExpiry = license.expiryDate;
    }
  });

  return [...rows.values()].sort((a, b) =>
    (a.clientName || '').localeCompare(b.clientName || '')
  );
}

/**
 * Credential check for the product's own login screen. Returns the client and
 * the licenses issued to them, so the product can authenticate and decide what
 * the user may access in a single call.
 */
async function login({ username, password, productName }) {
  const doc = await findByUsername(username);

  // Compare against a dummy hash when the username is unknown, so that a wrong
  // username and a wrong password take the same time to answer.
  const hash = doc
    ? doc.passwordHash
    : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = await bcrypt.compare(String(password), hash);

  if (!doc || !ok) {
    throw new ApiError(401, 'Invalid username or password', 'INVALID_CREDENTIALS');
  }

  const client = toPublicClient(doc);
  const all = await licenseService.listLicenses();

  const licenses = all
    .filter((l) => normalizeUsername(l.clientUserId) === normalizeUsername(client.username))
    .filter((l) =>
      productName
        ? l.productName.trim().toLowerCase() === String(productName).trim().toLowerCase()
        : true
    )
    .map((l) => ({
      licenseKey: l.licenseKey,
      productName: l.productName,
      startDate: l.startDate,
      expiryDate: l.expiryDate,
      status: l.status,
      valid: l.status === 'active',
    }));

  return {
    client: {
      id: client.id,
      clientName: client.clientName,
      companyName: client.companyName,
      username: client.username,
    },
    licenses,
  };
}

module.exports = {
  COLLECTION,
  MIN_PASSWORD_LENGTH,
  generatePassword,
  createClient,
  getClientById,
  updateClient,
  resetPassword,
  savePocAccount,
  deleteClient,
  listClients,
  login,
  findByUsername,
};
