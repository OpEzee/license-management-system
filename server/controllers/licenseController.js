'use strict';

const crypto = require('crypto');
const licenseService = require('../services/licenseService');
const clientService = require('../services/clientService');
const mailService = require('../services/mailService');
const brandingService = require('../services/brandingService');
const { staffPin } = require('../utils/staffPin');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * The license form saves the POC's sign-in for the product: the email and
 * company, with `pocLogin: true`. The dashboard never sends a password; a new
 * account gets a generated one. Admin API callers may still send `password`,
 * which also counts as asking for the account. The account is saved first, so
 * a clash (an email or company already used by another POC) stops the license.
 */
const wantsPocLogin = (body) => body.pocLogin === true || Boolean(body.password);

// licenseId: the license being edited (none on create) — the POC account's other
// licenses are never changed from this one's form.
// Resolves to the generated password when this save created the account.
async function savePocFrom(body, previousEmail, licenseId) {
  if (!wantsPocLogin(body)) return null;
  const { generatedPassword } = await clientService.savePocAccount({
    clientName: body.clientName,
    companyName: body.companyName,
    email: body.clientUserId,
    password: body.password,
    previousEmail,
    licenseId,
  });
  return generatedPassword;
}

// Shown once: the password is stored only as a hash, so this response is the
// only place it ever appears.
const withPocPassword = (generated) => (generated ? { pocPassword: generated } : {});

const create = asyncHandler(async (req, res) => {
  const generated = await savePocFrom(req.body);
  const license = await licenseService.createLicense(req.body);
  res.status(201).json({
    success: true,
    message: 'License created successfully',
    license,
    ...withPocPassword(generated),
  });
});

const list = asyncHandler(async (req, res) => {
  const licenses = await licenseService.listLicenses();
  res.json({ success: true, count: licenses.length, licenses });
});

const stats = asyncHandler(async (req, res) => {
  res.json({ success: true, stats: await licenseService.getStats() });
});

const getOne = asyncHandler(async (req, res) => {
  const license = await licenseService.getLicenseById(req.params.id);
  res.json({ success: true, license });
});

const update = asyncHandler(async (req, res) => {
  // Before the POC account is saved, so a refused limit changes nothing.
  await licenseService.assertMaxScreensFits(req.params.id, req.body.maxScreens);
  let generated = null;
  if (wantsPocLogin(req.body)) {
    const current = await licenseService.getLicenseById(req.params.id);
    generated = await savePocFrom(req.body, current.clientUserId, req.params.id);
  }
  const license = await licenseService.updateLicense(req.params.id, req.body);
  res.json({
    success: true,
    message: 'License updated successfully',
    license,
    ...withPocPassword(generated),
  });
});

const setStatus = asyncHandler(async (req, res) => {
  const { deactivated } = req.body;
  const license = await licenseService.setLicenseDeactivated(req.params.id, deactivated);
  res.json({
    success: true,
    message: deactivated ? 'License deactivated' : 'License reactivated',
    license,
  });
});

/** Whether the server can send email at all — the UI adapts to the answer. */
const mailStatus = asyncHandler(async (req, res) => {
  res.json({ success: true, configured: mailService.isConfigured() });
});

const share = asyncHandler(async (req, res) => {
  const license = await licenseService.getLicenseById(req.params.id);
  const { recipients } = req.body;

  // The logo is decorative; a branding failure must not block the email.
  let logo = null;
  try {
    logo = (await brandingService.getBranding()).logo;
  } catch {
    logo = null;
  }

  const result = await mailService.sendLicense({ license, recipients, logo });

  res.json({
    success: true,
    message: 'License details sent to the recipient',
    sentTo: result.accepted,
  });
});

const remove = asyncHandler(async (req, res) => {
  await licenseService.deleteLicense(req.params.id);
  res.json({ success: true, message: 'License deleted successfully' });
});

/** Frees a machine's slot, for when a client replaces hardware. */
const releaseMachine = asyncHandler(async (req, res) => {
  const license = await licenseService.releaseMachine(req.params.id, req.params.machineNumber);
  res.json({ success: true, message: 'Machine released', license });
});

/**
 * The machine limit, for /verify and /sync only. Returns null when the machine
 * may use the key, or the refusal to send: 403 with valid:false and a code the
 * product can show a specific message for.
 */
async function machineRefusal(license, machineNumber) {
  const outcome = await licenseService.admitMachine(license, machineNumber);
  if (outcome === 'admitted') return null;

  if (outcome === 'machine_required') {
    return {
      code: 'MACHINE_NUMBER_REQUIRED',
      message: 'This license is registered to specific machines. The product must send its machine number.',
    };
  }

  const n = license.maxScreens;
  return {
    code: 'SCREEN_LIMIT_REACHED',
    message: `All ${n} ${n === 1 ? 'machine' : 'machines'} allowed for this license are in use. Ask your administrator to release one.`,
  };
}

/**
 * Public endpoint used by the product. Response shapes are fixed by contract,
 * and no internal fields (document id, client user id, timestamps) are exposed.
 */
const verify = asyncHandler(async (req, res) => {
  const { licenseKey, productName } = req.body;
  const result = await licenseService.checkLicense({ licenseKey, productName });

  if (result.outcome === 'not_found') {
    return res.status(404).json({
      success: false,
      valid: false,
      message: 'Invalid license key',
    });
  }

  if (result.outcome === 'product_mismatch') {
    return res.status(403).json({
      success: false,
      valid: false,
      message: 'License is not valid for this product',
    });
  }

  if (result.outcome === 'deactivated') {
    return res.status(200).json({
      success: true,
      valid: false,
      message: 'License has been deactivated',
      license: {
        licenseKey: result.license.licenseKey,
        productName: result.license.productName,
        startDate: result.license.startDate,
        expiryDate: result.license.expiryDate,
        status: 'deactivated',
      },
    });
  }

  if (result.outcome === 'expired') {
    return res.status(200).json({
      success: true,
      valid: false,
      message: 'License has expired',
      license: {
        licenseKey: result.license.licenseKey,
        productName: result.license.productName,
        startDate: result.license.startDate,
        expiryDate: result.license.expiryDate,
        status: 'expired',
      },
    });
  }

  if (result.outcome === 'pending') {
    return res.status(200).json({
      success: true,
      valid: false,
      message: 'License has not started yet',
      license: {
        licenseKey: result.license.licenseKey,
        productName: result.license.productName,
        startDate: result.license.startDate,
        expiryDate: result.license.expiryDate,
        status: 'pending',
      },
    });
  }

  const refusal = await machineRefusal(result.license, req.body.machineNumber);
  if (refusal) {
    return res.status(403).json({ success: false, valid: false, ...refusal });
  }

  return res.status(200).json({
    success: true,
    valid: true,
    message: 'License is valid',
    license: {
      licenseKey: result.license.licenseKey,
      clientName: result.license.clientName,
      companyName: result.license.companyName,
      productName: result.license.productName,
      startDate: result.license.startDate,
      expiryDate: result.license.expiryDate,
      status: 'active',
    },
  });
});

/**
 * The licence details a product shows its staff behind a PIN (the hosted
 * /client/pin page). The PIN is the server's CLIENT_PIN; the answer is the
 * whole record — POC, email, company, dates and status — whatever the status,
 * since staff check an expired licence too. Nothing is changed.
 */
function pinMatches(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const details = asyncHandler(async (req, res) => {
  // Read per request, so a changed environment needs no restart to apply.
  const { configured, pin } = staffPin();
  if (!configured) {
    return res.status(503).json({ success: false, code: 'PIN_NOT_CONFIGURED', message: 'The PIN is not set up on the license server.' });
  }
  if (!pinMatches(req.body.pin, pin)) {
    return res.status(401).json({ success: false, code: 'WRONG_PIN', message: 'The PIN is incorrect.' });
  }

  const result = await licenseService.checkLicense({
    licenseKey: req.body.licenseKey,
    productName: req.body.productName,
  });
  if (result.outcome === 'not_found') {
    return res.status(404).json({ success: false, code: 'LICENSE_NOT_FOUND', message: 'That licence key was not found.' });
  }
  if (result.outcome === 'product_mismatch') {
    return res.status(403).json({ success: false, code: 'PRODUCT_MISMATCH', message: 'That licence key is for another product.' });
  }

  const { license } = result;
  return res.status(200).json({
    success: true,
    license: {
      licenseKey: license.licenseKey,
      clientName: license.clientName,
      clientUserId: license.clientUserId,
      companyName: license.companyName,
      productName: license.productName,
      startDate: license.startDate,
      expiryDate: license.expiryDate,
      status: license.status,
    },
  });
});

/** The one product the dedicated validate endpoint answers for. */
const DIGITAL_DIYA = 'Digital Diya';

const VALIDATE_MESSAGES = {
  valid: 'License is valid',
  expired: 'License has expired',
  pending: 'License has not started yet',
  deactivated: 'License has been deactivated',
};

/**
 * Digital Diya's own check: is this key valid, yes or no. The product is fixed
 * here rather than sent, so a key issued for any other product is refused, and
 * the other products keep using /verify and /sync exactly as before.
 *
 * Every answer has the same flat shape — `valid`, `status`, `message` — so the
 * caller only ever needs to read `valid`.
 */
const validateDigitalDiya = asyncHandler(async (req, res) => {
  const result = await licenseService.checkLicense({
    licenseKey: req.body.licenseKey,
    productName: DIGITAL_DIYA,
  });

  if (result.outcome === 'not_found') {
    return res.status(404).json({
      success: false,
      valid: false,
      status: 'invalid',
      message: 'Invalid license key',
    });
  }

  if (result.outcome === 'product_mismatch') {
    return res.status(403).json({
      success: false,
      valid: false,
      status: 'invalid',
      message: `License is not valid for ${DIGITAL_DIYA}`,
    });
  }

  const { license } = result;
  return res.status(200).json({
    success: true,
    valid: result.outcome === 'valid',
    status: license.status,
    message: VALIDATE_MESSAGES[result.outcome],
    license: {
      licenseKey: license.licenseKey,
      productName: license.productName,
      clientName: license.clientName,
      // The POC's email: the product's status page shows it beside the POC.
      clientUserId: license.clientUserId,
      companyName: license.companyName,
      startDate: license.startDate,
      expiryDate: license.expiryDate,
    },
  });
});

/**
 * Digital Diya's auto-sync: the same check as validateDigitalDiya, in the flat
 * shape of /sync, for the product to call on a timer and notice when its key
 * expires or is switched off. The product owns the interval; nothing is
 * scheduled here. Every answer carries `checkedAt`.
 */
const syncDigitalDiya = asyncHandler(async (req, res) => {
  const result = await licenseService.checkLicense({
    licenseKey: req.body.licenseKey,
    productName: DIGITAL_DIYA,
  });
  const checkedAt = new Date().toISOString();

  if (result.outcome === 'not_found') {
    return res.status(404).json({
      success: false,
      valid: false,
      status: 'invalid',
      message: 'Invalid license key',
      checkedAt,
    });
  }

  if (result.outcome === 'product_mismatch') {
    return res.status(403).json({
      success: false,
      valid: false,
      status: 'invalid',
      message: `License is not valid for ${DIGITAL_DIYA}`,
      checkedAt,
    });
  }

  let { license } = result;
  if (req.body.screens) license = await licenseService.recordScreens(license, req.body.screens);
  return res.status(200).json({
    success: true,
    valid: result.outcome === 'valid',
    status: license.status,
    message: VALIDATE_MESSAGES[result.outcome],
    licenseKey: license.licenseKey,
    productName: license.productName,
    startDate: license.startDate,
    expiryDate: license.expiryDate,
    screens: license.screens,
    // Who to contact, as validate gives it: a POC renamed (or given an email) in
    // the console reaches the product's status page at the next sync.
    license: { clientName: license.clientName, clientUserId: license.clientUserId },
    checkedAt,
  });
});

/**
 * Lightweight polling endpoint the product calls hourly. Same checks as
 * /verify, but a flat response shaped for a periodic refresh. Nothing is
 * scheduled server-side; the product owns the interval.
 */
const sync = asyncHandler(async (req, res) => {
  const { licenseKey, productName } = req.body;
  const result = await licenseService.checkLicense({ licenseKey, productName });
  const checkedAt = new Date().toISOString();

  if (result.outcome === 'not_found') {
    return res.status(404).json({
      success: false,
      valid: false,
      status: 'invalid',
      message: 'Invalid license key',
      checkedAt,
    });
  }

  if (result.outcome === 'product_mismatch') {
    return res.status(403).json({
      success: false,
      valid: false,
      status: 'invalid',
      message: 'License is not valid for this product',
      checkedAt,
    });
  }

  const messages = {
    valid: 'License is valid',
    expired: 'License has expired',
    pending: 'License has not started yet',
    deactivated: 'License has been deactivated',
  };

  if (result.outcome === 'valid') {
    const refusal = await machineRefusal(result.license, req.body.machineNumber);
    if (refusal) {
      return res.status(403).json({
        success: false,
        valid: false,
        status: 'invalid',
        ...refusal,
        checkedAt,
      });
    }
  }

  return res.status(200).json({
    success: true,
    valid: result.outcome === 'valid',
    status: result.license.status,
    message: messages[result.outcome],
    licenseKey: result.license.licenseKey,
    productName: result.license.productName,
    startDate: result.license.startDate,
    expiryDate: result.license.expiryDate,
    checkedAt,
  });
});

/**
 * Two self-service endpoints the product calls to correct the details it holds.
 * Both authenticate the way /verify does: by the license key. Kept as separate
 * endpoints so a product can change one without having to
 * send, and risk overwriting, the other.
 */
const updatePoc = asyncHandler(async (req, res) => {
  const { licenseKey, productName } = req.body;
  // Accepts either name for the field, as the two endpoints are a pair.
  const pocName = req.body.pocName ?? req.body.poc_name ?? req.body.clientName;
  const license = await licenseService.updateLicenseContact({
    licenseKey,
    productName,
    clientName: pocName,
  });

  res.json({
    success: true,
    message: 'POC name updated',
    license: {
      licenseKey: license.licenseKey,
      pocName: license.clientName,
      email: license.clientUserId,
      productName: license.productName,
    },
  });
});

const updateEmail = asyncHandler(async (req, res) => {
  const { licenseKey, productName, email } = req.body;
  const license = await licenseService.updateLicenseContact({
    licenseKey,
    productName,
    clientUserId: email,
  });

  res.json({
    success: true,
    message: 'Email updated',
    license: {
      licenseKey: license.licenseKey,
      pocName: license.clientName,
      email: license.clientUserId,
      productName: license.productName,
    },
  });
});

module.exports = {
  details,
  create,
  list,
  stats,
  getOne,
  update,
  setStatus,
  share,
  mailStatus,
  remove,
  releaseMachine,
  verify,
  validateDigitalDiya,
  syncDigitalDiya,
  updatePoc,
  updateEmail,
  sync,
};
