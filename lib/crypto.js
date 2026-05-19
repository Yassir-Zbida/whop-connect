/**
 * AES-256-GCM encryption for secrets at rest (Whop API keys, webhook secrets).
 * Set ENCRYPTION_KEY in production (32 bytes as 64-char hex or base64).
 */

import crypto from 'crypto';

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

let cachedKey = null;

function parseEncryptionKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  try {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 32) return buf;
  } catch (_) {
    /* ignore */
  }
  return null;
}

export function getEncryptionKey() {
  if (cachedKey) return cachedKey;
  cachedKey = parseEncryptionKey(process.env.ENCRYPTION_KEY);
  return cachedKey;
}

export function ensureEncryptionKey(isProduction) {
  if (!isProduction) return;
  const key = getEncryptionKey();
  if (!key) {
    console.error(
      'SECURITY: ENCRYPTION_KEY is required in production (32 bytes as 64-char hex or base64).'
    );
    process.exit(1);
  }
}

export function encrypt(plaintext) {
  const text = plaintext == null ? '' : String(plaintext);
  if (!text) return '';
  const key = getEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY is required to store secrets in production');
    }
    return text;
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${ciphertext.toString('base64url')}:${tag.toString('base64url')}`;
}

export function decrypt(stored) {
  const value = stored == null ? '' : String(stored);
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value;
  const key = getEncryptionKey();
  if (!key) {
    throw new Error('Cannot decrypt stored secret without ENCRYPTION_KEY');
  }
  const payload = value.slice(PREFIX.length);
  const [ivB64, ctB64, tagB64] = payload.split(':');
  if (!ivB64 || !ctB64 || !tagB64) {
    throw new Error('Invalid encrypted value format');
  }
  const iv = Buffer.from(ivB64, 'base64url');
  const ciphertext = Buffer.from(ctB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Base64-encode webhook secret for Whop SDK / Standard Webhooks verifier. */
export function encodeWebhookKeyForSdk(rawSecret) {
  if (!rawSecret) return null;
  return Buffer.from(String(rawSecret), 'utf8').toString('base64');
}
