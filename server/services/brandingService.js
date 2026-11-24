'use strict';

const { collection } = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');

const COLLECTION = 'settings';
const DOC_ID = 'branding';

// Rendered only inside an <img src="...">, where an SVG cannot execute script.
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

// The logo travels with every branding request, so it is kept small — far
// under MongoDB's 16 MB document limit.
const MAX_DATA_URL_LENGTH = 700_000;

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/;

function settings() {
  return collection(COLLECTION);
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Validates an incoming logo. Rejects anything that is not a base64 image data
 * URL of an allowed type and a sane size.
 */
function assertValidLogo(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl) {
    throw new ApiError(400, 'A logo image is required', 'LOGO_REQUIRED');
  }

  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new ApiError(
      400,
      'That image is too large. Please use a logo under 500 KB.',
      'LOGO_TOO_LARGE'
    );
  }

  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) {
    throw new ApiError(
      400,
      'Unsupported image. Use a PNG, JPEG, WebP or SVG file.',
      'LOGO_INVALID'
    );
  }

  const [, mimeType] = match;
  if (!ALLOWED_TYPES.includes(mimeType)) {
    throw new ApiError(400, 'Unsupported image type', 'LOGO_INVALID');
  }

  return mimeType;
}

async function getBranding() {
  const data = await settings().findOne({ _id: DOC_ID });
  if (!data) return { logo: null, fileName: null, updatedAt: null };

  return {
    logo: data.logo || null,
    fileName: data.fileName || null,
    mimeType: data.mimeType || null,
    updatedAt: toIso(data.updatedAt),
  };
}

async function setLogo({ logo, fileName }) {
  const mimeType = assertValidLogo(logo);

  await settings().updateOne(
    { _id: DOC_ID },
    {
      $set: {
        logo,
        mimeType,
        fileName: fileName ? String(fileName).slice(0, 200) : null,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  return getBranding();
}

async function clearLogo() {
  const existing = await settings().findOne({ _id: DOC_ID }, { projection: { _id: 1 } });
  if (!existing) return { logo: null, fileName: null, updatedAt: null };

  await settings().updateOne(
    { _id: DOC_ID },
    { $set: { logo: null, mimeType: null, fileName: null, updatedAt: new Date() } }
  );

  return getBranding();
}

module.exports = {
  COLLECTION,
  DOC_ID,
  ALLOWED_TYPES,
  MAX_DATA_URL_LENGTH,
  getBranding,
  setLogo,
  clearLogo,
};
