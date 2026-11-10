import {readFileSync,appendFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const file=new URL('../.env',import.meta.url);
const env=readFileSync(file,'utf8');
const match=env.match(/^OAUTH_TOKEN_ENCRYPTION_KEY=(.*)$/m);
if(match){
 const value=match[1].trim().replace(/^['"]|['"]$/g,'');
 if(!/^[a-f\d]{64}$/i.test(value))throw new Error('Existing OAuth encryption key is invalid; refusing to replace it');
}else{
 appendFileSync(file,`\nOAUTH_TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`);
}
chmodSync(file,0o600);
console.log('OAuth encryption key is configured; secret value is not displayed.');
