import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encryptToken,decryptToken,hasCalendarScope,GOOGLE_CALENDAR_SCOPE,safeReturnPath} from '../google-tokens.mjs';
process.env.OAUTH_TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('hex');

test('Google credentials are encrypted, authenticated and bound to their account',()=>{
 const encrypted=encryptToken('private-access-token','google:123');
 assert.ok(!encrypted.includes('private-access-token'));
 assert.equal(decryptToken(encrypted,'google:123'),'private-access-token');
 assert.notEqual(encrypted,encryptToken('private-access-token','google:123'));
 assert.throws(()=>decryptToken(encrypted,'google:456'));
 const parts=encrypted.split('.');parts[2]=Buffer.alloc(16).toString('base64url');
 assert.throws(()=>decryptToken(parts.join('.'),'google:123'));
 assert.throws(()=>decryptToken('legacy-plaintext','google:123'));
 assert.equal(encryptToken(null,'google:123'),null);
});
test('Calendar access requires the exact approved event scope; redirect stays on site',()=>{
 assert.equal(hasCalendarScope('openid'),false);
 assert.equal(hasCalendarScope('https://www.googleapis.com/auth/calendar.readonly'),false);
 assert.equal(hasCalendarScope(`openid ${GOOGLE_CALENDAR_SCOPE}`),true);
 for(const path of ['https://evil.test','//evil.test','/\\evil.test'])assert.equal(safeReturnPath(path,'https://moa.test'),'/');
 assert.equal(safeReturnPath('/family?tab=calendar','https://moa.test'),'/family?tab=calendar');
});
