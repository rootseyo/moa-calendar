import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const GOOGLE_CALENDAR_LIST_SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
export function hasCalendarScope(scope = '') {
 return scope.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE);
}
function key() {
 const value = process.env.OAUTH_TOKEN_ENCRYPTION_KEY || '';
 if (!/^[a-f\d]{64}$/i.test(value)) throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY must be a 32-byte hexadecimal key');
 return Buffer.from(value, 'hex');
}
export function encryptSecret(value, context = '') {
 if (!value) return null;
 const iv = randomBytes(12);
 const cipher = createCipheriv('aes-256-gcm', key(), iv);
 cipher.setAAD(Buffer.from(String(context)));
 const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
 return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
export function decryptSecret(value, context = '') {
 if (!value) return null;
 const [version, iv, tag, ciphertext, extra] = value.split('.');
 if (version !== 'v1' || !iv || !tag || !ciphertext || extra) throw new Error('Invalid encrypted secret');
 const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
 decipher.setAAD(Buffer.from(String(context)));
 decipher.setAuthTag(Buffer.from(tag, 'base64url'));
 return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
export function encryptToken(value, userId) {
 return encryptSecret(value, `google:${userId}`);
}
export function decryptToken(value, userId) {
 return decryptSecret(value, `google:${userId}`);
}
export function safeReturnPath(value, origin) {
 if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
 try { const url = new URL(value, origin); return url.origin === origin ? url.pathname + url.search : '/'; }
 catch { return '/'; }
}
