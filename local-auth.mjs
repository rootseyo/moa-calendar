import {randomBytes, scrypt as scryptCallback, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
const N=1<<15, r=8, p=1, keylen=64;
export function normalizeEmail(value){return typeof value==='string'?value.trim().toLowerCase():'';}
export function validEmail(value){return value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
export async function hashPassword(password){
 if(typeof password!=='string'||password.length<12||password.length>128)throw new Error('비밀번호는 12~128자로 입력해 주세요.');
 const salt=randomBytes(16);const derived=await scrypt(password,salt,keylen,{N,r,p,maxmem:64*1024*1024});
 return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}
export async function verifyPassword(password,encoded){
 try{const [scheme,n,block,parallel,saltText,keyText]=encoded.split('$');if(scheme!=='scrypt'||Number(n)!==N||Number(block)!==r||Number(parallel)!==p)return false;
  const salt=Buffer.from(saltText,'base64url'),expected=Buffer.from(keyText,'base64url');if(salt.length!==16||expected.length!==keylen)return false;
  const actual=await scrypt(String(password),salt,keylen,{N,r,p,maxmem:64*1024*1024});return timingSafeEqual(actual,expected);
 }catch{return false;}
}
