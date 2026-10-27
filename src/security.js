import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { config } from './config.js';

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  if (password.length < 10) throw new Error('Password must be at least 10 characters.');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, encoded) {
  const [salt, stored] = encoded.split(':'); const actual = scryptSync(password, salt, 64); const expected = Buffer.from(stored, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
function key() { return createHash('sha256').update(config.encryptionKey).digest(); }
export function encryptSecret(value) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.'); }
export function decryptSecret(value) { const [iv, tag, data] = value.split('.').map((x) => Buffer.from(x, 'base64')); const decipher = createDecipheriv('aes-256-gcm', key(), iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'); }
export function redact(value, secrets = []) { let text = typeof value === 'string' ? value : JSON.stringify(value); for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[REDACTED]'); return text; }
export function sign(value) { return createHmac('sha256', key()).update(value).digest('base64url'); }
export function safeEqual(a, b) { const x = Buffer.from(a || ''); const y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); }
function privateIp(ip) { return /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\.|^::1$|^fc|^fd|^fe80/i.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip); }
export async function validateOutboundUrl(raw) {
  let url; try { url = new URL(raw); } catch { throw new Error('HTTP URL is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are allowed.');
  if (url.username || url.password) throw new Error('Credentials in URLs are not allowed.');
  if (!config.allowPrivateNetwork) {
    const records = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
    if (!records.length || records.some((r) => privateIp(r.address))) throw new Error('Private and local network destinations are blocked.');
  }
  return url;
}
