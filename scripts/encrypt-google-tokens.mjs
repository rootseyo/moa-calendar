// Run once after migration, with the production encryption key loaded. No token values are logged.
import { db, transaction } from '../db.mjs';
import { encryptToken, decryptToken } from '../google-tokens.mjs';
try {
 await transaction(async client => {
  const { rows } = await client.query("SELECT provider_id,user_id,access_token,refresh_token FROM user_accounts WHERE provider='google' FOR UPDATE");
  for (const row of rows) {
   const protect = value => {
    if (!value) return null;
    if (value.startsWith('v1.')) { decryptToken(value, row.user_id); return value; }
    return encryptToken(value, row.user_id);
   };
   await client.query("UPDATE user_accounts SET access_token=$1,refresh_token=$2 WHERE provider='google' AND provider_id=$3", [protect(row.access_token),protect(row.refresh_token),row.provider_id]);
  }
  console.log(`Protected Google credentials for ${rows.length} account(s). Existing accounts must confirm the new Calendar scope.`);
 });
} finally { await db.end(); }
