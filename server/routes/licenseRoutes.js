'use strict';

const express = require('express');
const { body, param } = require('express-validator');

const controller = require('../controllers/licenseController');
const { validate } = require('../middleware/validate');
const { requireAdmin } = require('../middleware/auth');
const { verifyLimiter, pinLimiter } = require('../middleware/rateLimiter');
const { DURATION_KEYS } = require('../utils/licenseDates');
const { MIN_PASSWORD_LENGTH } = require('../services/clientService');
const { MAX_SCREENS_LIMIT } = require('../services/licenseService');

const router = express.Router();

// `values: 'falsy'` matters: a form posts an untouched field as '', not as
// undefined, so a plain .optional() would still fail it on .notEmpty().
const text = (field, label, { max = 120, optional = false } = {}) => {
  const chain = body(field);
  return (optional ? chain.optional({ values: 'falsy' }) : chain)
    .trim()
    .escape()
    .notEmpty()
    .withMessage(`${label} is required`)
    .isLength({ max })
    .withMessage(`${label} must be at most ${max} characters`);
};

const duration = ({ optional = false } = {}) => {
  const chain = body('duration');
  return (optional ? chain.optional() : chain)
    .isIn(DURATION_KEYS)
    .withMessage('Select a valid license duration');
};

const isoDate = (field, label, { optional = false } = {}) => {
  const chain = body(field);
  return (optional ? chain.optional() : chain)
    .notEmpty()
    .withMessage(`${label} is required`)
    .isISO8601()
    .withMessage(`${label} must be a valid date`);
};

// The POC's product sign-in, saved from the license form (`pocLogin: true`).
// Optional on the wire so a license can still be saved without touching the
// account. The dashboard sends no password (a new account gets a generated
// one); the admin API may. Either way the email it signs in with has to be a
// real address.
const wantsPocLogin = (req) => req.body.pocLogin === true || Boolean(req.body.password);
const pocLogin = [
  body('pocLogin').optional().isBoolean({ strict: true }).withMessage('pocLogin must be true or false'),
  body('password')
    .optional({ values: 'falsy' })
    .isString()
    .isLength({ min: MIN_PASSWORD_LENGTH, max: 128 })
    .withMessage(`Password must be between ${MIN_PASSWORD_LENGTH} and 128 characters`),
  body('clientUserId')
    .if((value, { req }) => wantsPocLogin(req))
    .isEmail()
    .withMessage('Enter a valid email address'),
  body('companyName')
    .if((value, { req }) => wantsPocLogin(req))
    .notEmpty()
    .withMessage('Company name is required'),
];

const keyCheck = [
  body('licenseKey')
    .trim()
    .notEmpty()
    .withMessage('License key is required')
    .isLength({ max: 64 })
    .withMessage('License key is too long')
    .matches(/^[A-Za-z0-9\s-]+$/)
    .withMessage('License key contains invalid characters'),
  body('productName').optional().trim().escape().isLength({ max: 120 }),
];

// The machine a product runs on, as /verify and /sync count it against the
// license's max screens. Optional on the wire: the service decides whether a
// request without one is allowed. Other endpoints ignore it, so only these two
// validate it.
const MACHINE_PATTERN = /^[A-Za-z0-9._:-]+$/;
const machineMessage = 'Machine number may only contain letters, digits and . _ : -';
const machineCheck = body('machineNumber')
  .optional({ values: 'falsy' })
  .isString()
  .trim()
  .isLength({ max: 128 })
  .withMessage('Machine number must be at most 128 characters')
  .matches(MACHINE_PATTERN)
  .withMessage(machineMessage);

// Only a missing value is skipped, not a falsy one: 0 must be refused, not
// quietly turned into the default.
const maxScreens = () =>
  body('maxScreens')
    .optional({ values: 'null' })
    .isInt({ min: 1, max: MAX_SCREENS_LIMIT })
    .withMessage(`Max screens must be a whole number from 1 to ${MAX_SCREENS_LIMIT}`)
    .toInt();

// --- Public (product-facing) -------------------------------------------------
// Mounted before the admin guard, so products never need a token.
router.post('/verify', verifyLimiter, keyCheck, machineCheck, validate, controller.verify);
// The licence details behind the staff PIN (hosted /client/pin page).
router.post(
  '/details',
  pinLimiter,
  keyCheck,
  body('pin').isString().withMessage('PIN is required').isLength({ max: 8 }),
  validate,
  controller.details
);
router.post('/sync', verifyLimiter, keyCheck, machineCheck, validate, controller.sync);

// Digital Diya's own pair: a yes/no check, and the auto-sync it polls. Only
// the key is read: the product is fixed server-side, so a key for any other
// product is refused. Declared before the admin guard and the `/:id` routes so
// neither swallows the paths.
router.post(
  '/digital-diya/validate',
  verifyLimiter,
  keyCheck[0],
  validate,
  controller.validateDigitalDiya
);
// The sync may also carry the screens the key runs on (screen app 1.4.13):
// { used, limit, plan } — limit null when the plan sets none.
const screensCheck = [
  body('screens').optional({ values: 'null' }).isObject().withMessage('screens must be an object'),
  body('screens.used')
    .if(body('screens').isObject())
    .isInt({ min: 0, max: 10000 })
    .withMessage('screens.used must be a whole number')
    .toInt(),
  body('screens.limit')
    .if(body('screens').isObject())
    .optional({ values: 'null' })
    .isInt({ min: 1, max: 10000 })
    .withMessage('screens.limit must be a whole number')
    .toInt(),
  body('screens.plan')
    .if(body('screens').isObject())
    .optional({ values: 'null' })
    .isString()
    .trim()
    .isLength({ max: 40 })
    .withMessage('screens.plan is too long'),
];
router.post(
  '/digital-diya/sync',
  verifyLimiter,
  keyCheck[0],
  ...screensCheck,
  validate,
  controller.syncDigitalDiya
);

// Self-service: the product corrects its own contact details. Authenticated by
// the license key, so no admin token is needed.
// Declared here, before the admin guard and before the `/:id` routes, so the
// paths are not swallowed by either.
router.put(
  '/poc',
  verifyLimiter,
  [
    ...keyCheck,
    body('pocName').optional({ values: 'falsy' }).trim().escape().isLength({ max: 120 }),
    body('poc_name').optional({ values: 'falsy' }).trim().escape().isLength({ max: 120 }),
    body('clientName').optional({ values: 'falsy' }).trim().escape().isLength({ max: 120 }),
    body().custom((value) => {
      if (!value.pocName && !value.poc_name && !value.clientName) {
        throw new Error('POC name is required');
      }
      return true;
    }),
  ],
  validate,
  controller.updatePoc
);

router.put(
  '/email',
  verifyLimiter,
  [
    ...keyCheck,
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .withMessage('Enter a valid email address')
      .isLength({ max: 160 })
      // Deliberately NOT normalizeEmail(): it strips dots from gmail addresses,
      // so 'a.b@gmail.com' would be silently saved as 'ab@gmail.com'.
      .customSanitizer((v) => String(v).trim().toLowerCase()),
  ],
  validate,
  controller.updateEmail
);

// --- Admin -------------------------------------------------------------------
router.use(requireAdmin);

router.get('/stats', controller.stats);
router.get('/mail-status', controller.mailStatus);
router.get('/', controller.list);

router.post(
  '/',
  [
    text('clientName', 'Client name'),
    text('companyName', 'Company name', { optional: true }),
    // Optional: it links the license to a client account for the product
    // login. A license may instead name a client who has no account.
    text('clientUserId', 'Client user ID', { optional: true }),
    text('productName', 'Product name'),
    text('soldBy', 'Sold by'),
    duration(),
    isoDate('startDate', 'Start date'),
    // Only required for the custom duration; the service enforces that.
    isoDate('expiryDate', 'Expiry date', { optional: true }),
    // Left out means the default of one machine.
    maxScreens(),
    ...pocLogin,
  ],
  validate,
  controller.create
);

router.get('/:id', [param('id').trim().notEmpty()], validate, controller.getOne);

router.put(
  '/:id',
  [
    param('id').trim().notEmpty(),
    text('clientName', 'Client name', { optional: true }),
    text('companyName', 'Company name', { optional: true }),
    text('clientUserId', 'Client user ID', { optional: true }),
    text('productName', 'Product name', { optional: true }),
    text('soldBy', 'Sold by', { optional: true }),
    duration({ optional: true }),
    isoDate('startDate', 'Start date', { optional: true }),
    isoDate('expiryDate', 'Expiry date', { optional: true }),
    maxScreens(),
    ...pocLogin,
  ],
  validate,
  controller.update
);

router.delete(
  '/:id/machines/:machineNumber',
  [
    param('id').trim().notEmpty(),
    param('machineNumber')
      .trim()
      .notEmpty()
      .withMessage('Machine number is required')
      .isLength({ max: 128 })
      .withMessage('Machine number must be at most 128 characters')
      .matches(MACHINE_PATTERN)
      .withMessage(machineMessage),
  ],
  validate,
  controller.releaseMachine
);

router.put(
  '/:id/status',
  [
    param('id').trim().notEmpty(),
    body('deactivated')
      .isBoolean()
      .withMessage('deactivated must be true or false')
      .toBoolean(),
  ],
  validate,
  controller.setStatus
);

router.post(
  '/:id/share',
  [
    param('id').trim().notEmpty(),
    body('recipients')
      .isArray({ min: 1, max: 10 })
      .withMessage('Choose between 1 and 10 recipients'),
    body('recipients.*')
      .trim()
      .isEmail()
      .withMessage('Every recipient must be a valid email address')
      .normalizeEmail(),
  ],
  validate,
  controller.share
);

router.delete('/:id', [param('id').trim().notEmpty()], validate, controller.remove);

module.exports = router;
