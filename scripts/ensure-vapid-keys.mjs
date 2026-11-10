import {readFileSync, appendFileSync, chmodSync} from 'node:fs';
import webpush from 'web-push';

const file = new URL('../.env', import.meta.url);
let env = '';
try {
  env = readFileSync(file, 'utf8');
} catch (e) {
  // If .env doesn't exist yet, start empty
}

const matchPub = env.match(/^VAPID_PUBLIC_KEY=(.*)$/m);
const matchPriv = env.match(/^VAPID_PRIVATE_KEY=(.*)$/m);

if (!matchPub || !matchPriv) {
  const keys = webpush.generateVAPIDKeys();
  const addition = `\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:admin@example.com\n`;
  appendFileSync(file, addition);
  try {
    chmodSync(file, 0o600);
  } catch {}
  console.log('VAPID keys generated and configured in .env.');
} else {
  console.log('VAPID keys already configured.');
}
