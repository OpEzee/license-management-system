'use strict';

const { collection: getCollection, newId } = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');
const { resolveLicensePeriod } = require('../utils/licenseDates');
const {
  generateLicenseKey,
  normalizeLicenseKey,
} = require('../utils/generateLicenseKey');

const COLLECTION = 'licenses';

// How many machines one key may run on. Licenses written before the limit
// existed have no field and count as the default.
const DEFAULT_MAX_SCREENS = 1;
const MAX_SCREENS_LIMIT = 100;

/** Machine numbers are compared trimmed and case-insensitively, and stored that way. */
const normalizeMachine = (value) => String(value || '').trim().toLowerCase();

function collection() {
  return getCollection(COLLECTION);
}

async function findOrThrow(id) {
  const doc = await collection().findOne({ _id: String(id) });
  if (!doc) throw new ApiError(404, 'License not found', 'LICENSE_NOT_FOUND');
  return doc;
}

async function findByKey(licenseKey) {
  return collection().findOne({ licenseKey: normalizeLicenseKey(licenseKey) });
}

const normalizeUserId = (value) => String(value || '').trim().toLowerCase();

/**
 * username -> { clientName, companyName } for every client account.
 *
 * Read directly from the collection rather than through clientService, which
 * depends on this module; going the other way would be a require cycle.
 */
async function clientDirectory() {
  const docs = await getCollection('clients')
    .find({}, { projection: DIRECTORY_FIELDS })
    .toArray();
  const map = new Map();
  docs.forEach((data) => {
    if (!data.username) return;
    map.set(normalizeUserId(data.username), {
      clientName: data.clientName,
      companyName: data.companyName,
    });
  });
  return map;
}

const DIRECTORY_FIELDS = { username: 1, clientName: 1, companyName: 1 };

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The user ID toPublicLicense links a license by, including the legacy field. */
const linkedUserIdOf = (doc) => doc.clientUserId || doc.clientEmail || '';

/**
 * The directory for ONE license: just its linked account, in the same shape
 * as clientDirectory(), so toPublicLicense reads it identically. This is what
 * /verify, /sync and the other single-license reads use, instead of loading
 * every client on each call.
 *
 * Usernames are stored lowercased and trimmed, so the indexed exact match
 * nearly always hits. Records carried over from Firestore may not be, and
 * clientDirectory() matched those after normalising them; the
 * case-insensitive fallback keeps that, and only runs on a miss.
 */
async function linkedClientDirectory(doc) {
  const key = normalizeUserId(linkedUserIdOf(doc));
  const map = new Map();
  if (!key) return map;

  const clients = getCollection('clients');
  const account =
    (await clients.findOne({ username: key }, { projection: DIRECTORY_FIELDS })) ||
    (await clients.findOne(
      { username: { $regex: `^\\s*${escapeRegex(key)}\\s*$`, $options: 'i' } },
      { projection: DIRECTORY_FIELDS }
    ));

  if (account && account.username) {
    map.set(key, { clientName: account.clientName, companyName: account.companyName });
  }
  return map;
}

/** Date | string -> ISO string (or null). */
function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Status is always derived, never read from the stored field — a document
 * written a year ago would otherwise still claim to be "active".
 *
 * - deactivated: switched off by an admin; overrides the dates, because it is
 *   an explicit decision and the admin needs to see that it is in force
 * - pending: the start date is in the future
 * - active:  start date reached and expiry not yet passed
 * - expired: expiry date has passed
 */
function computeStatus(startDate, expiryDate, deactivated = false, now = new Date()) {
  if (deactivated) return 'deactivated';

  const expiryIso = toIso(expiryDate);
  if (!expiryIso) return 'expired';
  if (new Date(expiryIso).getTime() <= now.getTime()) return 'expired';

  const startIso = toIso(startDate);
  if (startIso && new Date(startIso).getTime() > now.getTime()) return 'pending';

  return 'active';
}

function toPublicLicense(data, directory) {
  // Licenses created before start dates and the user-id rename fall back to
  // their old fields, so existing documents keep working untouched.
  const startDate = data.startDate || data.createdAt;
  const clientUserId = data.clientUserId || data.clientEmail || '';
  const deactivated = Boolean(data.deactivated);

  // The client account is authoritative; the stored copies are the fallback for
  // licenses issued to a user ID that has no account.
  const account = directory?.get(normalizeUserId(clientUserId));

  return {
    id: data._id,
    licenseKey: data.licenseKey,
    // The name stored on the license wins: it is what the admin typed on the
    // form. A linked client account is only the fallback, for licenses issued
    // before the name was captured directly.
    clientName: data.clientName || account?.clientName || '',
    companyName: data.companyName || account?.companyName || '',
    clientUserId,
    productName: data.productName,
    // Who sold this license. Blank on licenses created before it was tracked.
    soldBy: data.soldBy || '',
    duration: data.duration || 'custom',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    startDate: toIso(startDate),
    expiryDate: toIso(data.expiryDate),
    deactivated,
    status: computeStatus(startDate, data.expiryDate, deactivated),
    // Digital Diya only: how many screen-app PCs run on this key, as its
    // server last reported on sync. Null until it has.
    screens: toScreens(data.screens),
    // The machines /verify and /sync have admitted, out of maxScreens. Not to
    // be confused with `screens` above, which Digital Diya reports itself.
    maxScreens: Number.isInteger(data.maxScreens) ? data.maxScreens : DEFAULT_MAX_SCREENS,
    claimedMachines: (data.claimedMachines || []).map((m) => ({
      machineNumber: m.machineNumber,
      firstSeenAt: toIso(m.firstSeenAt),
      lastSeenAt: toIso(m.lastSeenAt),
    })),
  };
}

function toScreens(value) {
  if (!value || !Number.isInteger(value.used)) return null;
  return {
    used: value.used,
    limit: Number.isInteger(value.limit) ? value.limit : null,
    plan: value.plan || null,
    updatedAt: toIso(value.updatedAt),
  };
}

/**
 * Generates a key and confirms no license already has it before handing it
 * back. Six characters give about 600 million keys, so a clash is rare; a few
 * retries cover it.
 */
async function generateUniqueLicenseKey(attempts = 10) {
  for (let i = 0; i < attempts; i += 1) {
    const key = generateLicenseKey();
    const existing = await collection().findOne({ licenseKey: key }, { projection: { _id: 1 } });
    if (!existing) return key;
  }
  throw new ApiError(500, 'Could not allocate a unique license key', 'KEY_ALLOCATION_FAILED');
}

/**
 * The login of the one existing POC account with this name, if there is
 * exactly one.
 *
 * A POC is one person with many licenses, so a license issued by name alone
 * has to land on that person's account — otherwise the Clients page shows a
 * second row for them and the product login never sees the license. Two
 * accounts sharing a name cannot be told apart here; the form makes the
 * admin pick, and this leaves the license unlinked rather than guess.
 */
function soleAccountNamed(directory, clientName) {
  const name = normalizeUserId(clientName);
  if (!name) return '';
  const matches = [...directory.entries()].filter(
    ([, account]) => normalizeUserId(account.clientName) === name
  );
  return matches.length === 1 ? matches[0][0] : '';
}

async function createLicense(payload) {
  const directory = await clientDirectory();
  const clientUserId =
    normalizeUserId(payload.clientUserId) || soleAccountNamed(directory, payload.clientName);
  payload = { ...payload, clientUserId };
  const account = directory.get(clientUserId);

  // The name typed on the form wins. A matching client account only fills in
  // what was left blank, so a license can name a client who has no account.
  const clientName = payload.clientName || account?.clientName;
  const companyName = payload.companyName || account?.companyName || '';
  if (!clientName) {
    throw new ApiError(400, 'Client name is required', 'CLIENT_NAME_REQUIRED');
  }

  const licenseKey = await generateUniqueLicenseKey();
  const period = resolveLicensePeriod({
    startDate: payload.startDate,
    expiryDate: payload.expiryDate,
    duration: payload.duration,
  });

  const startTs = period.startDate;
  const expiryTs = period.expiryDate;
  const now = new Date();

  const doc = {
    _id: newId(),
    licenseKey,
    clientName,
    companyName,
    clientUserId: payload.clientUserId || '',
    productName: payload.productName,
    soldBy: payload.soldBy,
    duration: period.duration,
    createdAt: now,
    updatedAt: now,
    startDate: startTs,
    expiryDate: expiryTs,
    deactivated: false,
    // Stored for convenience when browsing the database; the API always recomputes.
    status: computeStatus(startTs, expiryTs, false),
    maxScreens: payload.maxScreens ?? DEFAULT_MAX_SCREENS,
    claimedMachines: [],
  };

  await collection().insertOne(doc);
  return toPublicLicense(doc, directory);
}

async function listLicenses() {
  const [docs, directory] = await Promise.all([
    collection().find().sort({ createdAt: -1 }).toArray(),
    clientDirectory(),
  ]);
  return docs.map((doc) => toPublicLicense(doc, directory));
}

async function getLicenseById(id) {
  const doc = await findOrThrow(id);
  return toPublicLicense(doc, await linkedClientDirectory(doc));
}

async function updateLicense(id, payload) {
  const doc = await findOrThrow(id);

  const current = toPublicLicense(doc, await clientDirectory());
  const updates = { updatedAt: new Date() };

  ['clientName', 'companyName', 'clientUserId', 'productName', 'soldBy'].forEach((field) => {
    if (payload[field] !== undefined) updates[field] = payload[field];
  });

  // The client name identifies the license everywhere it is listed, so an edit
  // is never allowed to leave it blank.
  if (updates.clientName !== undefined && !String(updates.clientName).trim()) {
    delete updates.clientName;
  }

  // An unlinked license given an existing POC's name joins that POC, exactly
  // as a new one would. A license already linked keeps its link.
  if (!normalizeUserId(updates.clientUserId ?? current.clientUserId)) {
    const linked = soleAccountNamed(
      await clientDirectory(),
      updates.clientName ?? current.clientName
    );
    if (linked) updates.clientUserId = linked;
  }

  // Any change to the period is re-resolved as a whole, so a new duration
  // recomputes the expiry from whichever start date now applies.
  const touchesPeriod =
    payload.startDate !== undefined ||
    payload.expiryDate !== undefined ||
    payload.duration !== undefined;

  if (touchesPeriod) {
    const period = resolveLicensePeriod({
      startDate: payload.startDate ?? current.startDate,
      expiryDate: payload.expiryDate ?? current.expiryDate,
      duration: payload.duration ?? current.duration,
    });
    updates.startDate = period.startDate;
    updates.expiryDate = period.expiryDate;
    updates.duration = period.duration;
    updates.status = computeStatus(updates.startDate, updates.expiryDate, current.deactivated);
  }

  // licenseKey is deliberately not updatable — clients already hold it.

  // Lowering the limit below the machines already admitted would cut off a
  // working installation without saying which one. The size check rides on
  // the write itself, so a machine claimed a moment ago is counted too.
  const filter = { _id: doc._id };
  if (payload.maxScreens !== undefined) {
    updates.maxScreens = payload.maxScreens;
    filter.$expr = {
      $lte: [{ $size: { $ifNull: ['$claimedMachines', []] } }, payload.maxScreens],
    };
  }

  const result = await collection().updateOne(filter, { $set: updates });
  if (!result.matchedCount) throw maxScreensInUse(await findOrThrow(id));
  return getLicenseById(doc._id);
}

function maxScreensInUse(doc) {
  const used = (doc.claimedMachines || []).length;
  return new ApiError(
    409,
    `${used} ${used === 1 ? 'machine is' : 'machines are'} using this key. Release machines first, then lower Max screens.`,
    'MACHINES_IN_USE'
  );
}

/**
 * Checked before the license form also saves the POC account, so a rejected
 * limit does not leave the account changed and the license not. The write in
 * updateLicense still re-checks, which is what actually guards a race.
 */
async function assertMaxScreensFits(id, maxScreens) {
  if (maxScreens === undefined) return;
  const doc = await findOrThrow(id);
  if ((doc.claimedMachines || []).length > maxScreens) throw maxScreensInUse(doc);
}

/**
 * Admits the machine a product verifies or syncs from, out of the license's
 * maxScreens slots. Called only for a license that is otherwise valid, so an
 * expired or switched-off key never uses up a slot.
 *
 * Each step is one atomic write, never a read followed by a write: two
 * machines verifying at the same moment cannot both take the last slot, and
 * one machine racing itself cannot take two.
 *
 * Returns 'admitted', 'machine_required' or 'screen_limit_reached'.
 */
async function admitMachine(license, machineNumber) {
  const machine = normalizeMachine(machineNumber);

  // A product that names no machine is let through while nothing is claimed:
  // the limit only starts once a machine has identified itself. After that it
  // has to, or one unnamed install could sit beside the full set of slots.
  if (!machine) {
    return license.claimedMachines.length ? 'machine_required' : 'admitted';
  }

  const now = new Date();
  const touch = () =>
    collection().updateOne(
      { _id: license.id, 'claimedMachines.machineNumber': machine },
      { $set: { 'claimedMachines.$.lastSeenAt': now } }
    );

  // A machine that already holds a slot is always accepted.
  if ((await touch()).matchedCount) return 'admitted';

  const claimed = await collection().findOneAndUpdate(
    {
      _id: license.id,
      'claimedMachines.machineNumber': { $ne: machine },
      $expr: {
        $lt: [
          { $size: { $ifNull: ['$claimedMachines', []] } },
          { $ifNull: ['$maxScreens', DEFAULT_MAX_SCREENS] },
        ],
      },
    },
    { $push: { claimedMachines: { machineNumber: machine, firstSeenAt: now, lastSeenAt: now } } },
    { projection: { _id: 1 } }
  );
  if (claimed) return 'admitted';

  // The push also fails when this same machine claimed its slot between the
  // two writes above, so look once more before calling the license full.
  if ((await touch()).matchedCount) return 'admitted';
  return 'screen_limit_reached';
}

/** Frees one slot, for when a client replaces a machine. */
async function releaseMachine(id, machineNumber) {
  const machine = normalizeMachine(machineNumber);
  const doc = await findOrThrow(id);

  const result = await collection().updateOne(
    { _id: doc._id, 'claimedMachines.machineNumber': machine },
    { $pull: { claimedMachines: { machineNumber: machine } }, $set: { updatedAt: new Date() } }
  );
  if (!result.matchedCount) {
    throw new ApiError(404, 'That machine is not using this license', 'MACHINE_NOT_FOUND');
  }
  return getLicenseById(doc._id);
}

/**
 * Switches a license off or back on. A deactivated license keeps its dates but
 * stops verifying immediately, so a client's product loses access on its next
 * check without the admin having to delete anything.
 */
async function setLicenseDeactivated(id, deactivated) {
  const data = await findOrThrow(id);
  await collection().updateOne(
    { _id: data._id },
    {
      $set: {
        deactivated: Boolean(deactivated),
        status: computeStatus(data.startDate || data.createdAt, data.expiryDate, Boolean(deactivated)),
        updatedAt: new Date(),
      },
    }
  );

  return getLicenseById(data._id);
}

/**
 * Points licenses that only name a client at a newly created account.
 *
 * A license created from the Licenses page carries a client name but no user
 * ID. When credentials are later added for that name, those licenses have to
 * adopt the new username — otherwise the Clients page keeps showing two rows
 * for the same person and the product login finds no licenses for them.
 *
 * Only licenses with no user ID at all are touched; one already linked to
 * someone keeps its link.
 */
async function adoptUnlinkedLicenses(clientName, username, companyName) {
  const name = normalizeUserId(clientName);
  const user = normalizeUserId(username);
  const company = normalizeUserId(companyName);
  if (!name || !user) return 0;

  const all = await collection().find().toArray();
  const orphans = all.filter((data) => {
    if (normalizeUserId(data.clientUserId)) return false;
    if (normalizeUserId(data.clientName) !== name) return false;

    // Client names may repeat across companies, so a license that names a
    // company only joins an account with the same one. A license with no
    // company recorded — the usual case from the Licenses form — goes by name.
    const licenseCompany = normalizeUserId(data.companyName);
    return !licenseCompany || !company || licenseCompany === company;
  });

  if (orphans.length) {
    await collection().updateMany(
      { _id: { $in: orphans.map((doc) => doc._id) } },
      { $set: { clientUserId: user, updatedAt: new Date() } }
    );
  }
  return orphans.length;
}

async function deleteLicense(id) {
  const doc = await findOrThrow(id);
  await collection().deleteOne({ _id: doc._id });
  return { id };
}

/**
 * Shared lookup behind /verify, /sync, the Digital Diya pair and the PIN
 * details. Returns a plain result object rather than throwing, because each
 * outcome maps to a specific response body. The machine limit is not applied
 * here: only /verify and /sync enforce it, through admitMachine().
 */
async function checkLicense({ licenseKey, productName }) {
  const doc = await findByKey(licenseKey);

  if (!doc) return { outcome: 'not_found' };

  const license = toPublicLicense(doc, await linkedClientDirectory(doc));

  // Product is checked before dates: a key used in the wrong product should say
  // so, rather than leaking that it happens to be expired elsewhere.
  if (
    productName &&
    license.productName.trim().toLowerCase() !== String(productName).trim().toLowerCase()
  ) {
    return { outcome: 'product_mismatch', license };
  }

  if (license.status === 'deactivated') return { outcome: 'deactivated', license };
  if (license.status === 'expired') return { outcome: 'expired', license };
  if (license.status === 'pending') return { outcome: 'pending', license };

  return { outcome: 'valid', license };
}


/**
 * Digital Diya's sync carries how many screen-app PCs use the key on its
 * server and how many its plan allows: { used, limit, plan }. Stored on the
 * license for the Licenses page ("2 / 4 · Standard"), and only written when it
 * changes, not on every sync.
 */
async function recordScreens(license, screens) {
  const next = { used: screens.used, limit: screens.limit ?? null, plan: screens.plan || null };
  const prev = license.screens;
  if (prev && prev.used === next.used && prev.limit === next.limit && prev.plan === next.plan) {
    return license;
  }
  const updatedAt = new Date();
  await collection().updateOne({ _id: license.id }, { $set: { screens: { ...next, updatedAt } } });
  return { ...license, screens: { ...next, updatedAt: toIso(updatedAt) } };
}

/**
 * Self-service updates made by the product itself, not by an admin.
 *
 * The caller proves it is entitled the way /verify does: by holding the
 * license key. There is no token — the product holds no admin credentials — so
 * these endpoints can only ever touch the one license whose key was sent, and
 * only while that license is usable.
 *
 * Whatever the product changes is also written to the linked client account
 * when there is one, so the Clients page and the product login stay in step
 * with the Licenses page rather than drifting apart.
 */
async function updateLicenseContact({ licenseKey, productName, clientName, clientUserId }) {
  const doc = await findByKey(licenseKey);
  if (!doc) throw new ApiError(404, 'Invalid license key', 'LICENSE_NOT_FOUND');

  const current = toPublicLicense(doc, await linkedClientDirectory(doc));

  if (
    productName &&
    current.productName.trim().toLowerCase() !== String(productName).trim().toLowerCase()
  ) {
    throw new ApiError(403, 'License is not valid for this product', 'PRODUCT_MISMATCH');
  }

  // A license that cannot be used cannot be edited either: an expired or
  // switched-off installation has no business rewriting its own record.
  if (current.status !== 'active') {
    throw new ApiError(403, `License is ${current.status}`, 'LICENSE_NOT_ACTIVE');
  }

  const updates = { updatedAt: new Date() };
  if (clientName !== undefined) updates.clientName = String(clientName).trim();
  if (clientUserId !== undefined) updates.clientUserId = String(clientUserId).trim();

  // Keep the linked client account in step, matched on the user id the license
  // had *before* this change.
  const clients = getCollection('clients');
  const account = await clients.findOne({ username: normalizeUserId(current.clientUserId) });

  if (account) {
    const accountUpdates = { updatedAt: new Date() };

    if (updates.clientName) accountUpdates.clientName = updates.clientName;

    if (updates.clientUserId !== undefined) {
      const nextUsername = normalizeUserId(updates.clientUserId);
      // The username is how the client signs in to the product, so it still has
      // to be unique even when the product is the one changing it.
      const clash = await clients.findOne({ username: nextUsername }, { projection: { _id: 1 } });
      if (clash && clash._id !== account._id) {
        throw new ApiError(409, 'That email is already in use', 'EMAIL_TAKEN');
      }
      accountUpdates.username = nextUsername;
    }

    await clients.updateOne({ _id: account._id }, { $set: accountUpdates });
  }

  await collection().updateOne({ _id: doc._id }, { $set: updates });
  return getLicenseById(doc._id);
}

/**
 * Carries an edited client account through to their licenses.
 *
 * Licenses are matched to a client by user id, and the Licenses table shows the
 * name stored on the license. So renaming a client — or changing the email they
 * sign in with — has to reach their licenses too, or the Clients page splits
 * into two rows for the same person and the two pages disagree.
 */
async function relinkClientLicenses(previousUsername, { username, clientName, companyName }) {
  const previous = normalizeUserId(previousUsername);
  if (!previous) return 0;

  const all = await collection().find({}, { projection: { clientUserId: 1 } }).toArray();
  const mine = all.filter((doc) => normalizeUserId(doc.clientUserId) === previous);
  if (!mine.length) return 0;

  const updates = { updatedAt: new Date() };
  if (username !== undefined) updates.clientUserId = normalizeUserId(username);
  if (clientName !== undefined) updates.clientName = String(clientName).trim();
  if (companyName !== undefined) updates.companyName = String(companyName).trim();

  await collection().updateMany(
    { _id: { $in: mine.map((doc) => doc._id) } },
    { $set: updates }
  );
  return mine.length;
}

async function getStats() {
  const licenses = await listLicenses();
  const active = licenses.filter((l) => l.status === 'active').length;
  const pending = licenses.filter((l) => l.status === 'pending').length;
  const deactivated = licenses.filter((l) => l.status === 'deactivated').length;
  // Distinct clients are keyed on the client user id, the stable identifier.
  const clients = new Set(licenses.map((l) => (l.clientUserId || '').toLowerCase()));

  return {
    totalClients: clients.size,
    activeLicenses: active,
    pendingLicenses: pending,
    deactivatedLicenses: deactivated,
    expiredLicenses: licenses.length - active - pending - deactivated,
    totalLicenses: licenses.length,
  };
}

/**
 * Clients are derived from licenses rather than stored separately, so they can
 * never drift out of sync with the licenses that define them.
 */
async function listClients() {
  const licenses = await listLicenses();
  const byClient = new Map();

  licenses.forEach((license) => {
    const key = (license.clientUserId || '').toLowerCase();
    if (!byClient.has(key)) {
      byClient.set(key, {
        clientUserId: license.clientUserId,
        clientName: license.clientName,
        companyName: license.companyName,
        products: [],
        totalLicenses: 0,
        activeLicenses: 0,
        expiredLicenses: 0,
        pendingLicenses: 0,
        deactivatedLicenses: 0,
        latestExpiry: null,
      });
    }

    const client = byClient.get(key);
    client.totalLicenses += 1;
    if (license.status === 'active') client.activeLicenses += 1;
    else if (license.status === 'pending') client.pendingLicenses += 1;
    else if (license.status === 'deactivated') client.deactivatedLicenses += 1;
    else client.expiredLicenses += 1;

    if (license.productName && !client.products.includes(license.productName)) {
      client.products.push(license.productName);
    }
    if (!client.latestExpiry || license.expiryDate > client.latestExpiry) {
      client.latestExpiry = license.expiryDate;
    }
  });

  return [...byClient.values()].sort((a, b) =>
    (a.clientName || '').localeCompare(b.clientName || '')
  );
}

module.exports = {
  COLLECTION,
  createLicense,
  listLicenses,
  getLicenseById,
  updateLicense,
  setLicenseDeactivated,
  deleteLicense,
  admitMachine,
  releaseMachine,
  assertMaxScreensFits,
  normalizeMachine,
  DEFAULT_MAX_SCREENS,
  MAX_SCREENS_LIMIT,
  adoptUnlinkedLicenses,
  relinkClientLicenses,
  checkLicense,
  recordScreens,
  updateLicenseContact,
  getStats,
  listClients,
  computeStatus,
  toPublicLicense,
  // Exported for the test that proves the single lookup answers like the full one.
  clientDirectory,
  linkedClientDirectory,
};
