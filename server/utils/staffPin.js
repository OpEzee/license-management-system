'use strict';

/*
 * The staff PIN in front of the hosted /client/pin page (CLIENT_PIN).
 *
 * In production, a missing PIN or the old example value counts as not
 * configured: the details endpoint answers 503 PIN_NOT_CONFIGURED rather than
 * open with a PIN anyone who read .env.example knows. The server still starts,
 * because licence verification for every product must not depend on a
 * staff-only screen being set up.
 */

const PIN_PATTERN = /^\d{4,8}$/;

// The value .env.example used to ship. Still accepted outside production, so
// local runs and the tests keep working.
const EXAMPLE_PIN = '1968';

/**
 * { configured, pin, reason }. `reason` explains a missing configuration, for
 * the start-up log only. It is never sent to a caller.
 */
function staffPin(env = process.env) {
  const pin = String(env.CLIENT_PIN || '').trim();
  const production = env.NODE_ENV === 'production';

  if (!pin) return { configured: false, pin: '', reason: 'CLIENT_PIN is not set' };
  if (!PIN_PATTERN.test(pin)) {
    return { configured: false, pin: '', reason: 'CLIENT_PIN must be 4 to 8 digits' };
  }
  if (production && pin === EXAMPLE_PIN) {
    return {
      configured: false,
      pin: '',
      reason: `CLIENT_PIN is the example value ${EXAMPLE_PIN}, which is refused in production`,
    };
  }
  return { configured: true, pin, reason: null };
}

module.exports = { staffPin, PIN_PATTERN, EXAMPLE_PIN };
