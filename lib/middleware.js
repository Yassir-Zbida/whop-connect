/**
 * Express middleware: CSRF, session helpers.
 */

import crypto from 'crypto';

const CSRF_EXEMPT_PREFIXES = ['/webhooks/whop/'];
const CSRF_EXEMPT_EXACT = new Set(['/health', '/csrf', '/me']);

function isCsrfExempt(path) {
  if (CSRF_EXEMPT_EXACT.has(path)) return true;
  return CSRF_EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

/** Attach raw body on webhook routes for signature verification. */
export function captureRawBody(req, res, buf) {
  if (req.originalUrl?.includes('/api/webhooks/whop/')) {
    req.rawBody = buf;
  }
}

export function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

export function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const path = req.path || '';
  if (isCsrfExempt(path)) return next();

  const headerToken = req.headers['x-csrf-token'];
  const sessionToken = req.session?.csrfToken;
  if (!headerToken || !sessionToken || headerToken !== sessionToken) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid or missing CSRF token. Refresh the page and try again.',
    });
  }
  return next();
}

export function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      resolve();
    });
  });
}
