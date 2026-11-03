'use strict';

const crypto = require('crypto');

// Crockford-style alphabet: no I, L, O, U, 0, 1 — avoids transcription mistakes
// when a client reads a key off an invoice or an email.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

// Keys are six characters, e.g. "K7M2Q9": short enough to read out over the
// phone or type on a kiosk keyboard. Every key mixes letters and numbers, so
// it never reads as a word or a PIN.
const KEY_LENGTH = 6;

// Keys issued before the six-character format: "OPEZ-8F4K-92LM-X7PQ". They are
// never reissued, but every one already handed out keeps working.
const LEGACY_GROUP_SIZE = 4;
const LEGACY_LENGTH = 16;

/**
 * Cryptographically secure random string from ALPHABET.
 * Uses rejection sampling so every symbol is equally likely.
 */
function randomSegment(length) {
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = '';
  while (out.length < length) {
    const bytes = crypto.randomBytes(length * 2);
    for (let i = 0; i < bytes.length && out.length < length; i += 1) {
      if (bytes[i] < max) out += ALPHABET[bytes[i] % ALPHABET.length];
    }
  }
  return out;
}

/**
 * A fresh six-character key with at least one letter and one number. Whether
 * it is already taken is the caller's question — see generateUniqueLicenseKey
 * in licenseService, which checks the database before using it.
 *
 * @returns {string} e.g. "K7M2Q9"
 */
function generateLicenseKey() {
  for (;;) {
    const key = randomSegment(KEY_LENGTH);
    if (/[A-Z]/.test(key) && /[0-9]/.test(key)) return key;
  }
}

/**
 * Normalizes user input into the stored form: " k7m 2q9 " → "K7M2Q9", and for
 * a legacy key "opez 8f4k92lmx7pq" → "OPEZ-8F4K-92LM-X7PQ".
 */
function normalizeLicenseKey(raw) {
  const compact = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (compact.length === KEY_LENGTH) return compact;
  if (compact.length === LEGACY_LENGTH) {
    return compact.match(new RegExp(`.{1,${LEGACY_GROUP_SIZE}}`, 'g')).join('-');
  }
  return String(raw || '').trim().toUpperCase();
}

/** A stored key in either format. */
const LICENSE_KEY_PATTERN = /^(?:[A-Z0-9]{6}|[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3})$/;

module.exports = { generateLicenseKey, normalizeLicenseKey, LICENSE_KEY_PATTERN, KEY_LENGTH };
