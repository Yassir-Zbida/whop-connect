/**
 * Security policy helpers (passwords, registration, session secret).
 */

export const PASSWORD_MIN_LENGTH = 12;
const DEFAULT_SESSION_SECRET = 'whop-admin-secret-change-in-production';

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export function validatePassword(password) {
  const p = password == null ? '' : String(password);
  if (p.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) {
    return {
      ok: false,
      message: 'Password must include at least one letter and one number.',
    };
  }
  return { ok: true };
}

export function isRegistrationAllowed() {
  if (process.env.ALLOW_REGISTRATION === 'false') return false;
  return true;
}

export function isAdminEmailPromotionAllowed() {
  return process.env.ALLOW_ADMIN_EMAIL_PROMOTION === 'true';
}

export function validateSessionSecret(secret) {
  const s = secret == null ? '' : String(secret).trim();
  if (!s || s === DEFAULT_SESSION_SECRET) {
    return {
      ok: false,
      message: 'Set a strong SESSION_SECRET in .env (at least 32 random characters).',
    };
  }
  if (s.length < 32) {
    return {
      ok: false,
      message: 'SESSION_SECRET must be at least 32 characters.',
    };
  }
  return { ok: true };
}

export function ensureSessionSecret(isProductionEnv) {
  const secret = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
  const check = validateSessionSecret(secret);
  if (isProductionEnv && !check.ok) {
    console.error(`SECURITY: ${check.message}`);
    process.exit(1);
  }
  if (!isProductionEnv && !check.ok) {
    console.warn(`SECURITY: ${check.message}`);
  }
  return secret;
}

export function allowSharedWhopEnvFallback() {
  return !isProduction() && process.env.ALLOW_SHARED_WHOP_ENV === 'true';
}
