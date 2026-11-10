import {db} from '../db.mjs';
try{
 const {rows}=await db.query(`SELECT
 (SELECT count(*)::int FROM users) AS users,
 (SELECT count(*)::int FROM calendars) AS calendars,
 (SELECT count(*)::int FROM events) AS events,
 (SELECT count(*)::int FROM user_accounts WHERE provider='google' AND
 ((access_token IS NOT NULL AND access_token NOT LIKE 'v1.%') OR
 (refresh_token IS NOT NULL AND refresh_token NOT LIKE 'v1.%'))) AS unencrypted_google_tokens`);
 console.log(JSON.stringify(rows[0]));
 if(rows[0].unencrypted_google_tokens)process.exitCode=1;
}finally{await db.end();}
