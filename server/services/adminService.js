'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { collection, newId } = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');

const COLLECTION = 'admins';
const EMAIL_COLLECTION = 'emailConfigs';
const BCRYPT_ROUNDS = 12;

function admins() {
  return collection(COLLECTION);
}

function emails() {
  return collection(EMAIL_COLLECTION);
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new ApiError(
      500,
      'Server authentication is not configured',
      'JWT_SECRET_MISSING'
    );
  }
  return secret;
}

/** Never leaks passwordHash, whatever the caller does with the result. */
function toPublicAdmin(data) {
  return {
    id: data._id,
    email: data.email,
    name: data.name || 'Administrator',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

async function findAdminByEmail(email) {
  return admins().findOne({ email: String(email).trim().toLowerCase() });
}

function signToken(admin) {
  return jwt.sign({ sub: admin.id, email: admin.email, role: 'admin' }, jwtSecret(), {
    expiresIn: process.env.TOKEN_EXPIRES_IN || '12h',
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, jwtSecret());
  } catch {
    // Expired and tampered tokens are deliberately indistinguishable to callers.
    throw new ApiError(401, 'Your session has expired. Please sign in again.', 'INVALID_TOKEN');
  }
}

/**
 * Creates or resets the admin account. Used by `npm run create-admin`; it is
 * not reachable over HTTP.
 */
async function upsertAdmin({ email, password, name }) {
  const normalized = String(email).trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const existing = await findAdminByEmail(normalized);

  if (existing) {
    const updated = await admins().findOneAndUpdate(
      { _id: existing._id },
      {
        $set: {
          passwordHash,
          name: name || existing.name || 'Administrator',
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );
    return { created: false, admin: toPublicAdmin(updated) };
  }

  const now = new Date();
  const doc = {
    _id: newId(),
    email: normalized,
    passwordHash,
    name: name || 'Administrator',
    createdAt: now,
    updatedAt: now,
  };
  await admins().insertOne(doc);
  return { created: true, admin: toPublicAdmin(doc) };
}

async function login({ email, password }) {
  const doc = await findAdminByEmail(email);

  // Compare against a dummy hash when the account is unknown, so that a wrong
  // email and a wrong password take the same time to answer.
  const hash = doc ? doc.passwordHash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = await bcrypt.compare(String(password), hash);

  if (!doc || !ok) {
    throw new ApiError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const admin = toPublicAdmin(doc);
  return { token: signToken(admin), admin };
}

async function getAdminById(id) {
  const doc = await admins().findOne({ _id: String(id) });
  if (!doc) throw new ApiError(401, 'Account no longer exists', 'ADMIN_NOT_FOUND');
  return toPublicAdmin(doc);
}

async function changePassword(adminId, { currentPassword, newPassword }) {
  const doc = await admins().findOne({ _id: String(adminId) });
  if (!doc) throw new ApiError(401, 'Account no longer exists', 'ADMIN_NOT_FOUND');

  const ok = await bcrypt.compare(String(currentPassword), doc.passwordHash);
  if (!ok) {
    throw new ApiError(400, 'Your current password is incorrect', 'WRONG_CURRENT_PASSWORD');
  }

  if (String(currentPassword) === String(newPassword)) {
    throw new ApiError(
      400,
      'The new password must be different from the current one',
      'PASSWORD_UNCHANGED'
    );
  }

  await admins().updateOne(
    { _id: doc._id },
    {
      $set: {
        passwordHash: await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS),
        updatedAt: new Date(),
      },
    }
  );

  return { success: true };
}

// --- Email configuration -----------------------------------------------------

function toPublicEmail(data) {
  return {
    id: data._id,
    email: data.email,
    label: data.label || '',
    isDefault: Boolean(data.isDefault),
    createdAt: toIso(data.createdAt),
  };
}

async function findEmailOrThrow(id) {
  const doc = await emails().findOne({ _id: String(id) });
  if (!doc) throw new ApiError(404, 'Email configuration not found', 'EMAIL_NOT_FOUND');
  return doc;
}

async function listEmails() {
  const docs = await emails().find().sort({ createdAt: 1 }).toArray();
  return docs.map(toPublicEmail);
}

async function addEmail({ email, label }) {
  const normalized = String(email).trim().toLowerCase();

  if (await emails().findOne({ email: normalized }, { projection: { _id: 1 } })) {
    throw new ApiError(409, 'That email is already configured', 'EMAIL_EXISTS');
  }

  // The very first address configured becomes the default automatically,
  // so there is never a state with addresses but no default.
  const isDefault = (await emails().countDocuments({}, { limit: 1 })) === 0;

  const doc = {
    _id: newId(),
    email: normalized,
    label: label || '',
    isDefault,
    createdAt: new Date(),
  };
  await emails().insertOne(doc);
  return toPublicEmail(doc);
}

/**
 * Edits an existing address, including whether it is a default. Any number of
 * addresses may be default at once — marking one never unmarks another.
 */
async function updateEmail(id, { email, label, isDefault }) {
  await findEmailOrThrow(id);

  const updates = {};

  if (email !== undefined) {
    const normalized = String(email).trim().toLowerCase();
    const clash = await emails().findOne({ email: normalized }, { projection: { _id: 1 } });
    if (clash && clash._id !== id) {
      throw new ApiError(409, 'That email is already configured', 'EMAIL_EXISTS');
    }
    updates.email = normalized;
  }

  // An empty label is a real value here — it clears the label.
  if (label !== undefined) updates.label = label || '';
  if (isDefault !== undefined) updates.isDefault = Boolean(isDefault);

  if (Object.keys(updates).length) await emails().updateOne({ _id: id }, { $set: updates });
  return toPublicEmail(await emails().findOne({ _id: id }));
}

/** Marks an address as a default, or clears that mark. Others are untouched. */
async function setDefaultEmail(id, isDefault = true) {
  await findEmailOrThrow(id);
  const doc = await emails().findOneAndUpdate(
    { _id: id },
    { $set: { isDefault: Boolean(isDefault) } },
    { returnDocument: 'after' }
  );
  return toPublicEmail(doc);
}

async function deleteEmail(id) {
  const doc = await findEmailOrThrow(id);

  // Deleting a default is fine while another default remains; the list should
  // never be left with addresses but no default at all.
  const all = await emails().find().toArray();
  const otherDefaults = all.filter((d) => d._id !== id && Boolean(d.isDefault));

  if (Boolean(doc.isDefault) && all.length > 1 && otherDefaults.length === 0) {
    throw new ApiError(
      400,
      'Mark another email as default before deleting this one',
      'CANNOT_DELETE_DEFAULT'
    );
  }

  await emails().deleteOne({ _id: id });
  return { id };
}

module.exports = {
  COLLECTION,
  EMAIL_COLLECTION,
  upsertAdmin,
  login,
  verifyToken,
  getAdminById,
  changePassword,
  findAdminByEmail,
  listEmails,
  addEmail,
  updateEmail,
  setDefaultEmail,
  deleteEmail,
};
