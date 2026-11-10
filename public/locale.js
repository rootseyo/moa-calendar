import { translateSource, translateError } from './translations.js?v=20261028-instant-calendar-v1';

const publicEnglish=/^\/en\/?$/.test(location.pathname);
const publicKorean=/^\/ko\/?$/.test(location.pathname);
const publicLocale=publicEnglish?'en':publicKorean?'ko':null;
let savedLanguage;
try{savedLanguage=localStorage.getItem('moa_language');if(publicLocale){savedLanguage=publicLocale;localStorage.setItem('moa_language',publicLocale);}}catch{}
const browserLanguage=(navigator.languages?.[0]||navigator.language||'en').toLowerCase();
export const locale=publicLocale||(['ko','en'].includes(savedLanguage)?savedLanguage:browserLanguage.startsWith('ko')?'ko':'en');
export const translateMessage=message=>locale==='en'?translateError(message):message;

let savedRegion;
try{savedRegion=localStorage.getItem('moa_region');}catch{}
export function detectRegion(){
 try{
  const tz=(Intl.DateTimeFormat().resolvedOptions().timeZone||'').toLowerCase();
  if(tz.includes('seoul')||tz.includes('korea'))return 'KR';
  if(tz.includes('tokyo')||tz.includes('japan'))return 'JP';
  if(tz.includes('london')||tz.includes('britain'))return 'GB';
  if(tz.startsWith('america/')||tz.startsWith('us/'))return 'US';
 }catch{}
 const navLang=(navigator.languages?.[0]||navigator.language||'').toLowerCase();
 if(navLang.includes('ko')||navLang.includes('kr'))return 'KR';
 if(navLang.includes('ja')||navLang.includes('jp'))return 'JP';
 if(navLang.includes('gb')||navLang.includes('uk'))return 'GB';
 if(navLang.includes('en')||navLang.includes('us'))return 'US';
 return 'KR';
}
export const region=savedRegion&&['KR','US','JP','GB','none'].includes(savedRegion)?savedRegion:(savedRegion==='none'?'none':detectRegion());

export function languageControl(){
 const choice=publicLocale||(['ko','en'].includes(savedLanguage)?savedLanguage:'auto');
 return `<label class="language-control"><span>${locale==='en'?'Language':'언어'}</span><select data-language aria-label="${locale==='en'?'Display language':'표시 언어'}"><option value="auto" ${choice==='auto'?'selected':''}>${locale==='en'?'Browser default':'브라우저 설정'}</option><option value="ko" ${choice==='ko'?'selected':''}>한국어</option><option value="en" ${choice==='en'?'selected':''}>English</option></select></label>`;
}

export function regionControl(){
 const choice=savedRegion||'auto';
 return `<label class="language-control region-control"><span>${locale==='en'?'Region (Holidays)':'지역 (공휴일)'}</span><select data-region aria-label="${locale==='en'?'Region (Holidays)':'지역 (공휴일)'}"><option value="auto" ${choice==='auto'?'selected':''}>${locale==='en'?'Auto (Browser default)':'자동 (브라우저 기준)'}</option><option value="KR" ${choice==='KR'?'selected':''}>${locale==='en'?'South Korea':'대한민국'}</option><option value="US" ${choice==='US'?'selected':''}>${locale==='en'?'United States':'미국'}</option><option value="JP" ${choice==='JP'?'selected':''}>${locale==='en'?'Japan':'일본'}</option><option value="GB" ${choice==='GB'?'selected':''}>${locale==='en'?'United Kingdom':'영국'}</option><option value="none" ${choice==='none'?'selected':''}>${locale==='en'?'No holidays':'공휴일 표시 안 함'}</option></select></label>`;
}

export function localeSettingsControl(){
 return `${languageControl()}${regionControl()}`;
}

document.documentElement.lang=locale;
if(locale==='en'){
 // Only static HTML, before application/user data is loaded. User-entered content stays intact.
 for(const element of document.querySelectorAll('dialog,#app,#settings-page'))element.innerHTML=translateSource(element.innerHTML);
 document.title='Moa Calendar | Real-time shared calendar';
}
const settings=document.querySelector('#language-settings');
if(settings)settings.innerHTML=localeSettingsControl();
document.addEventListener('change',event=>{
 if(event.target.matches('[data-language]')){
  const next=event.target.value;
  try{if(next==='auto')localStorage.removeItem('moa_language');else localStorage.setItem('moa_language',next);}catch{}
  if(location.pathname==='/'||publicLocale)location.href=next==='en'?'/en/':next==='ko'?'/ko/':'/';
  else location.reload();
  return;
 }
 if(event.target.matches('[data-region]')){
  const next=event.target.value;
  try{if(next==='auto')localStorage.removeItem('moa_region');else localStorage.setItem('moa_region',next);}catch{}
  location.reload();
  return;
 }
});
// Do not await: app.js imports this module for locale helpers.
import(locale==='en'?'/app.en.js?v=20261102-time-range-v1':'/app.js?v=20261102-time-range-v1').catch(error=>{
 const app=document.querySelector('#app');
 app.replaceChildren();
 const wrap=document.createElement('main');wrap.className='loading';
 const box=document.createElement('div');box.className='loading-box';
 const heading=document.createElement('h1');heading.className='loading-title';
 heading.textContent=locale==='en'?'Please reload the page':'페이지를 새로고침해 주세요';
 const sub=document.createElement('p');sub.className='loading-sub';
 sub.textContent=locale==='en'?'A new version has been deployed.':'새로운 업데이트가 배포되었습니다.';
 const btn=document.createElement('button');btn.type='button';btn.className='primary';
 btn.textContent=locale==='en'?'Reload':'새로고침';
 btn.onclick=()=>{
  try{
   if('serviceWorker' in navigator)navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));
   if('caches' in window)caches.keys().then(ks=>ks.forEach(k=>caches.delete(k)));
  }catch{}
  location.href=location.pathname+(location.search?location.search+'&':'?')+'_t='+Date.now();
 };
 box.append(heading,sub,btn);wrap.append(box);app.append(wrap);
 console.error(error);
});
