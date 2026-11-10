import { locale, translateMessage, languageControl } from './locale.js?v=20261102-time-range-v1';
import { english } from './translations.js?v=20261028-instant-calendar-v1';
import { EVENT_COLORS, shiftLocalDateTime, weeklyEventRanges, repeatEventRanges, isValidLocalDateTime, calculateDdayDiff, formatDdayLabel, sortDdayEvents, moveDdayOrder, resolveAdjustedEndDateTime } from './event-utils.js?v=20261028-instant-calendar-v1';
import { getHoliday, getActiveRegion, getRegionName } from './holidays.js?v=20261028-instant-calendar-v1';
import { formatKoreanLunarDate, getKoreanLunarDate } from './lunar.js?v=20261028-instant-calendar-v1';
import { WEATHER_PRESET_LOCATIONS, parseOpenMeteoDaily, renderWeatherBadgeHtml, renderHourlyWeatherItemsHtml, getSavedWeatherLocation, saveWeatherLocation, isWeatherEnabled, setWeatherEnabled, getWeatherLocationDisplayName, buildOpenMeteoForecastUrl, buildOpenMeteoGeocodingUrl } from './weather.js?v=20261028-cancel-v1';
const $ = s=>document.querySelector(s);
const app=$('#app');
const mobileCalendar=window.matchMedia('(max-width:600px)');
mobileCalendar.addEventListener('change',()=>{
 if(current)renderCalendar();
});
let deletingCalendarId=null;
let me={providers:{kakao:true,google:true}}, calendars=[], current, events=[], connection, sessions=[], connected=false, editing=null;
let monthlyItems=[], monthlyLoadError=false, monthlyLoading=true, eventLoadRequest=0;
let editingMonthlyItem=null, monthlySaving=false;
const monthlyChecking=new Set();
let monthlyCollapsed=true;

let month=new Date(new Date().getFullYear(),new Date().getMonth(),1), selected=dateKey(new Date());
let viewMode='month'; // 'day' | 'week' | 'month'
let selectedCalendarIds=new Set();
let userCalendarColors={};
let activeColorPickerCalId=null;
const calendarStreams=new Map();
const calendarColorNames={sage:'초록색',blue:'파란색',peach:'살구색',lavender:'보라색',coral:'빨간색',rose:'분홍색',yellow:'노란색',teal:'민트색',orange:'주황색',cyan:'하늘색',indigo:'남색',slate:'회색'};
const dateNotes=new Map(), noteDrafts=new Map(), monthNotes=new Map(), monthNoteDrafts=new Map();
let notesRequest=0, monthNotesRequest=0;
let weatherForecast={};
let weatherLocation=getSavedWeatherLocation();
let weatherRequest=0;
let selectedEvent=null; // selected event object for copy-paste or selection highlight
let copiedEvent=null;   // copied event object for Cmd+C / Cmd+V
let dragEvent=null;     // event being dragged
let resizingEvent=null; // event being resized in day view

// Restore cached preferences only after their state variables are initialized.
try{const cachedMe=JSON.parse(localStorage.getItem('moa_cached_me'));if(cachedMe?.user)me=cachedMe;}catch{}
try{const cachedCals=JSON.parse(localStorage.getItem('moa_cached_calendars'));if(Array.isArray(cachedCals)&&cachedCals.length)calendars=cachedCals;}catch{}
loadUserCalendarPreferences();
if(calendars.length){
 const pathSlug=location.pathname.replace(/^\/+/,'').split('/')[0];
 if(pathSlug&&!['invite','en','ko'].includes(pathSlug)){const match=calendars.find(c=>c.slug===pathSlug||c.id===pathSlug);if(match)current=match;}
 if(!current)current=calendars.find(c=>c.id===sessionStorage.getItem('calendar'))||calendars[0];
 initSelectedCalendars();
}

function loadUserCalendarPreferences(){
 try{userCalendarColors=JSON.parse(localStorage.getItem('moa_calendar_colors'))||{};}catch{userCalendarColors={};}
}
function getCalendarColor(cal){
 if(!cal)return 'sage';
 return userCalendarColors[cal.id]||cal.color||'sage';
}
function initSelectedCalendars(){
 let saved;
 try{saved=JSON.parse(localStorage.getItem('moa_selected_calendars'));}catch{}
 if(Array.isArray(saved)){
  const valid=saved.filter(id=>calendars.some(c=>c.id===id));
  selectedCalendarIds=new Set(valid);
  return;
 }
 selectedCalendarIds=new Set(calendars.map(c=>c.id));
}
function saveSelectedCalendars(){
 try{localStorage.setItem('moa_selected_calendars',JSON.stringify([...selectedCalendarIds]));}catch{}
}

function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tr=s=>locale==='en'?(english[s]||s):s;

async function api(path,method='GET',data){
 const r=await fetch(path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const b=await r.json();
 if(!r.ok){if(r.status===401&&!path.startsWith('/auth/email/')){connection?.close();location.reload();}throw Object.assign(new Error(translateMessage(b.error||'요청에 실패했습니다.')),{status:r.status});}
 return b;
}

let toastTimer;
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
const emptyIcon='<span class="empty-icon">▦</span>';

function renderLoading(title='불러오는 중...',sub='잠시만 기다려 주세요.'){
 app.innerHTML=`<main class="loading"><div class="loading-box"><div class="loading-spinner"></div><h1 class="loading-title">${esc(title)}</h1><p class="loading-sub">${esc(sub)}</p></div></main>`;
}

async function boot(){
 try{
  loadUserCalendarPreferences();
  const isAuthRoute=location.pathname.startsWith('/auth')||location.search.includes('error=');
  if(!$('#workspace-root')&&!isAuthRoute&&!location.pathname.startsWith('/invite/')){
   renderShell();
   renderCalendar();
  }
  me=await api('/api/me');
  const urlParams=new URLSearchParams(location.search);
  const loginErr=urlParams.get('error');
  let loginErrMsg='';
  if(loginErr){
   if(loginErr==='state_mismatch'||loginErr==='oauth_expired'||loginErr==='oauth_consumed'){
    loginErrMsg='로그인 세션이 만료되었습니다. 다시 시도해 주세요.';
   } else if(loginErr==='calendar_permission_denied'){
    loginErrMsg='구글 캘린더 읽기 권한에 동의해야 일정을 가져올 수 있어요.';
   } else if(loginErr==='link_session_changed'){
    loginErrMsg='계정 연결 세션이 변경되었어요. 다시 연결해 주세요.';
   } else if(loginErr==='google_account_mismatch'){
    loginErrMsg='로그인에 연결된 Google 계정을 선택해 주세요.';
   } else if(loginErr==='login'){
    loginErrMsg='로그인이 취소되었거나 실패했습니다.';
   }
   history.replaceState({},'',location.pathname);
  }
  if(!me.user){
   try{localStorage.removeItem('moa_cached_me');localStorage.removeItem('moa_cached_calendars');}catch{}
   closeSettingsPage();
   return renderLogin(loginErrMsg);
  }
  try{localStorage.setItem('moa_cached_me',JSON.stringify(me));}catch{}
  if(location.pathname.startsWith('/invite/')){
   try{
    const result=await api(`/api/invite/${location.pathname.split('/')[2]}`,'POST',{});
    sessionStorage.setItem('calendar',result.id);
    history.replaceState({},'','/');
    toast('캘린더에 참여했어요.');
   }catch(e){renderLogin(e.message,true);return;}
  }
  calendars=await api('/api/calendars');
  try{localStorage.setItem('moa_cached_calendars',JSON.stringify(calendars));}catch{}
  loadUserCalendarPreferences();
  if(urlParams.get('linked')){
   const pName=urlParams.get('linked')==='google'?'Google':'카카오';
   toast(`${pName} 계정이 연동되었어요.`);
   history.replaceState({},'',location.pathname);
  } else if(urlParams.get('error')==='already_linked'){
   toast('이미 다른 사용자에 연동되어 있는 계정입니다.');
   history.replaceState({},'',location.pathname);
  }
  const pathSlug=location.pathname.replace(/^\/+/,'').split('/')[0];
  if(pathSlug&&!['invite','en','ko'].includes(pathSlug)){const match=calendars.find(c=>c.slug===pathSlug||c.id===pathSlug);if(match)current=match;}
  if(!current)current=calendars.find(c=>c.id===sessionStorage.getItem('calendar'))||calendars[0];
  initSelectedCalendars();
  renderShell();
  renderCalendar();
  loadWeatherForecast();
  if(current)selectCalendar(current.slug||current.id,false);
  handleWidgetUrlParams();
  if(isSettingsRoute())restoreSettingsRoute();
  if(loginErrMsg)toast(translateMessage(loginErrMsg));
 }catch(e){
  if(!$('#workspace-root')){
   app.innerHTML=`<main class="fatal"><h1>연결을 확인해 주세요</h1><p>${esc(e.message)}</p><button id="retry" class="primary">다시 시도</button></main>`;
   $('#retry').onclick=boot;
  }else{
   toast(e.message);
  }
 }
}

function renderLogin(error='',signedIn=false){
 const currentUrl=encodeURIComponent(location.pathname+location.search);
 const kakaoBtn=me.providers.kakao?`<a class="social kakao" href="/auth/kakao?next=${currentUrl}"><b>●</b> 카카오로 시작하기</a>`:`<a class="social kakao unavailable" aria-disabled="true"><b>●</b> 카카오로 시작하기</a>`;
 const googleBtn=me.providers.google?`<a class="social google" href="/auth/google?next=${currentUrl}"><b>G</b> Google로 시작하기</a>`:`<a class="social google unavailable" aria-disabled="true"><b>G</b> Google로 시작하기</a>`;
 app.innerHTML=`<main class="login"><section class="login-story"><a class="brand" href="/"><span class="brand-mark">m</span>모아<span class="brand-sub">moa calendar</span></a><div class="story-copy"><span class="eyebrow">A LITTLE MORE TOGETHER</span><h1>각자의 하루를,<br>우리의 시간으로.</h1><p>함께할 시간을 모으는 가장 쉬운 방법.<br>링크 하나로 초대하고, 같은 캘린더에서 만나요.</p><div class="story-tags"><span>↗ ${tr('링크로 간편 초대')}</span><span>◉ ${tr('실시간 일정 공유')}</span><span>🌤 ${tr('날씨 확인')}</span><span>🚩 ${tr('D-Day 디데이')}</span></div></div><div class="illustration" aria-hidden="true"><div class="paper"><div class="paper-top">OUR DAYS <span>함께하는 10월 ⛅ 19°</span></div><div class="paper-grid">${Array.from({length:21},(_,i)=>`<span>${i+1}</span>`).join('')}</div><div class="paper-event coral paper-dday">제주 여행 <span>D-5</span></div><div class="paper-event sage">함께하는 저녁 <span>19:00</span></div><div class="paper-event peach">주말 나들이 <span>10:00</span></div></div><div class="float-note">● 함께 보고 있어요</div></div><p class="story-footer">작은 약속부터, 함께 만드는 일상까지.</p></section><section class="login-panel"><div class="login-box"><span class="eyebrow">WELCOME TO MOA</span><h2>${signedIn?'초대를 확인해 주세요':location.pathname.startsWith('/invite/')?'함께할 시간에 초대받았어요':'반가워요, 모아입니다'}</h2><p class="muted">${signedIn?'초대한 사람에게 새로운 링크를 요청해 주세요.':'이메일 또는 소셜 계정으로 로그인하고, 함께할 캘린더를 시작하세요.'}</p>${error?`<p class="form-error">${esc(error)}</p>`:''}${signedIn?'<a class="primary full" href="/">내 캘린더로 이동</a>':`<div class="social-login-group">${googleBtn}${kakaoBtn}</div><div class="auth-divider"><span>${tr('또는 이메일로')}</span></div><div class="email-auth"><div class="auth-mode-tabs" role="tablist"><button type="button" class="auth-mode active" data-auth-mode="login" role="tab" aria-selected="true">${tr('로그인')}</button><button type="button" class="auth-mode" data-auth-mode="register" role="tab" aria-selected="false">${tr('회원가입')}</button></div><form id="email-auth-form"><label id="auth-name-wrap" hidden>${tr('이름')}<input id="auth-name" name="name" maxlength="100" autocomplete="name" placeholder="${tr('이름')}"></label><label>${tr('이메일 주소')}<input id="auth-email" name="email" type="email" maxlength="254" autocomplete="email" required placeholder="name@example.com"></label><label>${tr('비밀번호')}<input id="auth-password" name="password" type="password" minlength="1" maxlength="128" autocomplete="current-password" required placeholder="${tr('비밀번호')}" aria-describedby="auth-password-help"></label><label id="auth-confirm-wrap" hidden>${tr("비밀번호 확인")}<input id="auth-confirm" type="password" minlength="12" maxlength="128" autocomplete="new-password" placeholder="${tr("비밀번호 확인")}"></label><label id="auth-terms-wrap" class="auth-terms" hidden><input id="auth-terms" type="checkbox"><span>${tr("서비스 이용약관에 동의합니다.")} <a href="/terms.html" target="_blank" rel="noopener">${tr("서비스 이용약관")}</a> · <a href="/privacy.html" target="_blank" rel="noopener">${tr("개인정보 처리방침")}</a></span></label><small id="auth-password-help" class="auth-help">${tr('비밀번호를 입력해 주세요.')}</small><p id="auth-error" class="form-error" role="alert"></p><button id="email-auth-submit" class="primary full" type="submit">${tr('로그인')}</button></form></div>${me.demo?'<div class="demo-section"><span>개발용 체험</span><form id="demo-form"><label class="sr-only" for="demo-name">체험 이름</label><input id="demo-name" maxlength="30" placeholder="체험할 이름" required><button class="secondary" type="submit">둘러보기 →</button></form><small>개발 환경에서만 제공되는 테스트 로그인입니다.</small></div>':''}`}</div><div class="login-bottom"><div class="login-legal-links"><a href="/privacy.html?v=20261014-email-auth-v1" target="_blank">개인정보 처리방침</a><span>·</span><a href="/terms.html?v=20261014-todo-v2" target="_blank">서비스 이용약관</a></div><span>나의 일정도, 우리의 약속도. 모아.</span></div></section></main>`;
 const authForm=$('#email-auth-form');
 if(authForm){
  let mode='login';
  const setMode=next=>{mode=next;const registering=mode==='register';$('#auth-name-wrap').hidden=!registering;$('#auth-name').required=registering;$('#auth-terms-wrap').hidden=!registering;$('#auth-terms').required=registering;$('#auth-confirm-wrap').hidden=!registering;$('#auth-confirm').required=registering;$('#auth-password').minLength=registering?12:1;$('#auth-password').autocomplete=registering?'new-password':'current-password';$('#auth-password-help').textContent=tr(registering?'비밀번호는 12자 이상이어야 합니다.':'비밀번호를 입력해 주세요.');$('#email-auth-submit').textContent=tr(registering?'회원가입':'로그인');document.querySelectorAll('[data-auth-mode]').forEach(button=>{const active=button.dataset.authMode===mode;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});$('#auth-error').textContent='';};
  document.querySelectorAll('[data-auth-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.authMode));
  authForm.onsubmit=async event=>{event.preventDefault();const button=$('#email-auth-submit'),message=$('#auth-error');button.disabled=true;message.textContent='';try{const data={email:$('#auth-email').value,password:$('#auth-password').value};if(mode==='register'){if($('#auth-password').value!==$('#auth-confirm').value)throw new Error(tr('비밀번호가 일치하지 않습니다.'));data.name=$('#auth-name').value.trim();data.acceptedTerms=$('#auth-terms').checked;}await api(`/auth/email/${mode}`,'POST',data);await boot();}catch(error){message.textContent=error.message;}finally{button.disabled=false;}};
 }
 $('.login-box').insertAdjacentHTML('beforeend',languageControl());
 if($('#demo-form'))$('#demo-form').onsubmit=async e=>{e.preventDefault();try{await api('/auth/demo','POST',{name:$('#demo-name').value});await boot();}catch(e){toast(e.message);}};
}

let sidebarCollapsed = localStorage.getItem('moa_sidebar_collapsed') === 'true';
let rightCollapsed = localStorage.getItem('moa_right_collapsed') === 'true';
let updateSidebarState, updateRightState;

function formatKoreanTime(timeStr){
 if(locale==='en')return new Date(timeStr).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
 if(!timeStr) return '';
 const [hStr, mStr] = timeStr.slice(11).split(':');
 const h = parseInt(hStr, 10);
 const m = parseInt(mStr, 10);
 const period = h < 12 ? '오전' : '오후';
 const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
 if (m === 0) {
  return `${period}${displayH}시`;
 }
 return `${period}${displayH}시${m}분`;
}

function mobileNavIcon(kind){
 const paths={day:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9h16M9 13h6M9 16h4"/>',week:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9h16M9 9v11M15 9v11"/>',month:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9h16M9 9v11M15 9v11M4 14h16"/>',sessions:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1"/>',profile:'<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>'};
 return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}
function renderMobileProfile(){
 if(!me?.user)return;
 const googleCalendarDisconnectLabel=locale==='en'?'Disconnect Google Calendar access':'Google 캘린더 권한 해제';
 const googleCalendarConnectLabel=locale==='en'?'Connect Google Calendar access':'Google 캘린더 권한 연결';
 $('#mobile-profile-name').textContent=me.user.name;
 $('#mobile-profile-avatar').textContent=me.user.name.slice(0,1);
 const provider=me.user.id.split(':')[0];
 $('#mobile-profile-login').textContent={kakao:'카카오 계정으로 로그인',google:'구글 계정으로 로그인',demo:'체험 계정'}[provider]||'로그인한 계정';
 $('#mobile-profile-calendar-count').textContent=calendars.length;
 $('#mobile-profile-calendars').innerHTML=calendars.length?calendars.map(c=>{
  const isGoogle=Boolean(c.is_google||c.name.includes('Google')||c.name.includes('구글'));
  const isICloud=Boolean(c.is_icloud||c.name.includes('iCloud')||c.name.includes('아이클라우드'));
  return `<button type="button" class="mobile-menu-item mobile-menu-calendar ${c.id===current?.id?'active':''}" data-profile-calendar="${esc(c.slug||c.id)}" aria-pressed="${c.id===current?.id}"><span class="dot calendar-color-dot ${esc(c.color||'sage')}" aria-hidden="true"></span><span>${esc(c.name)}</span>${isGoogle?'<small class="google-cal-pill" title="Google 캘린더 연동">G</small>':''}${isICloud?'<small class="icloud-cal-pill" title="iCloud 캘린더 연동">iCloud</small>':''}<small>${{owner:'관리자',editor:'편집',viewer:'보기'}[c.role]||''}</small></button>`;
 }).join(''):'<p class="muted small">아직 참여한 캘린더가 없어요.</p>';

 const linkedEl = $('#profile-linked-accounts');
 if(linkedEl){
  if(me.demo && me.user.id.startsWith('demo:')){
   $('#profile-linked-section').hidden = true;
  } else {
   $('#profile-linked-section').hidden = false;
   const linked = Array.isArray(me.user.linked) ? me.user.linked : [provider];
   const currentPath = encodeURIComponent(location.pathname + location.search);
   
   const kakaoLinked = linked.includes('kakao');
   const googleLinked = linked.includes('google');
   const icloudLinked = Boolean(me.user.hasICloudCalendar);
   
   let html = '<div class="linked-accounts-list">';
   
   // Google
   html += `<div class="linked-account-item">
    <div class="linked-account-info">
     <b class="google-badge">G</b>
     <span>Google 로그인</span>
    </div>
    ${googleLinked ? '<span class="status-badge connected">연동됨</span>' : '<span class="status-badge">연결되지 않음</span>'}
   </div>
   <div class="linked-account-item"><div class="linked-account-info"><span>Google 캘린더</span></div>
   ${me.user.hasGoogleCalendar ? `<button type="button" class="text-button danger" data-disconnect-google>${googleCalendarDisconnectLabel}</button>` : (me.providers.google ? `<a href="/auth/google?link=true&next=${currentPath}" class="link-btn">${googleCalendarConnectLabel}</a>` : '<span class="status-badge disabled">준비 중</span>')}
   </div>`;

   // Apple iCloud
   const icloudManageLabel = locale === 'en' ? 'Manage' : '연동 관리';
   const icloudConnectLabel = locale === 'en' ? 'Connect' : '연동하기';
   html += `<div class="linked-account-item">
    <div class="linked-account-info">
     <b class="apple-badge-icon" style="width:20px;height:20px;font-size:11px;"></b>
     <span>iCloud 캘린더</span>
    </div>
    ${icloudLinked 
      ? `<button type="button" class="text-button" data-open-integrations="icloud">${icloudManageLabel}</button>` 
      : `<button type="button" class="link-btn" data-open-integrations="icloud">${icloudConnectLabel}</button>`}
   </div>`;
   
   // Kakao
   html += `<div class="linked-account-item">
    <div class="linked-account-info">
     <b class="kakao-badge">●</b>
     <span>카카오 계정</span>
    </div>
    ${kakaoLinked 
      ? '<span class="status-badge connected">연동됨</span>' 
      : (me.providers.kakao ? `<a href="/auth/kakao?link=true&next=${currentPath}" class="link-btn">연동하기</a>` : '<span class="status-badge disabled">준비 중</span>')}
   </div>`;
   
   html += '</div>';
   linkedEl.innerHTML = html;
   linkedEl.insertAdjacentHTML('beforeend',locale==='en'?'<p class="muted small">Disconnecting Calendar keeps your sign-in account and imported calendars. You can delete imported calendars or events directly in Calendar Management.</p>':'<p class="muted small">캘린더 연결을 해제해도 로그인 계정과 이미 가져온 캘린더는 유지돼요. 가져온 캘린더나 일정은 캘린더 관리에서 직접 삭제할 수 있어요.</p>');
  }
 }
}

function getCalendarTitle(){
 if(selectedCalendarIds.size===0)return current?.name||'내 캘린더';
 const selectedList=calendars.filter(c=>selectedCalendarIds.has(c.id));
 const first=selectedList[0]||current;
 if(!first)return '내 캘린더';
 if(selectedCalendarIds.size===1)return first.name;
 return `${first.name} 외 ${selectedCalendarIds.size-1}개`;
}

function calendarIsReadOnly(cal){return !cal||cal.role==='viewer'||Boolean(cal.read_only);}
function defaultCalendar(){return calendars.find(cal=>!calendarIsReadOnly(cal))||null;}

function renderCalendarMetaChips(){
 const selectedList=calendars.filter(c=>selectedCalendarIds.has(c.id));
 if(selectedList.length===0)return '<span class="calendar-meta-empty muted small">선택된 캘린더가 없어요</span>';
 return selectedList.map(c=>`<span class="calendar-meta-chip"><i class="dot ${getCalendarColor(c)}"></i> ${esc(c.name)}</span>`).join(' ');
}

function renderCalendarListItems(isMobile=false){
 return calendars.map(c=>{
  const isSelected=selectedCalendarIds.has(c.id);
  const isCurrent=c.id===current?.id;
  const color=getCalendarColor(c);
  const rowClass=isMobile?'mobile-menu-calendar-row':'calendar-item-row';
  const calAttr=isMobile?`data-more-calendar="${esc(c.slug||c.id)}"`:`data-calendar="${esc(c.slug||c.id)}"`;
  const isGoogle=Boolean(c.is_google||c.name.includes('Google')||c.name.includes('구글'));
  const isICloud=Boolean(c.is_icloud||c.name.includes('iCloud')||c.name.includes('아이클라우드'));
  const providerMark=isICloud?'<svg class="calendar-provider-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.7 1.1c.1 1.5-.9 2.8-2.4 3-.1-1.4.9-2.7 2.4-3ZM12.8 8.2c0 1.4.8 2.3 1.6 2.7-.4 1.1-1.5 3.9-3 3.9-.8 0-1.3-.5-2.2-.5s-1.5.5-2.2.5c-1.5 0-3.5-3.6-3.5-6 0-2.2 1.4-3.8 3.3-3.8 1 0 1.6.5 2.4.5.7 0 1.4-.6 2.5-.5 1 .1 1.9.6 2.4 1.3-.9.5-1.3 1.2-1.3 1.9Z"/></svg>':isGoogle?'<span class="calendar-provider-mark" aria-hidden="true">G</span>':'';
  return `<div class="${rowClass} ${isMobile?(isCurrent?'is-current':''):(isSelected?'is-checked':'')} ${isCurrent?'is-current':''}">
   ${isMobile?'':`<button type="button" class="calendar-check-toggle ${isSelected?'checked':''}" data-toggle-cal="${c.id}" aria-label="${esc(c.name)} 선택 토글" aria-pressed="${isSelected}" title="선택 토글">${isSelected?'✓':''}</button>`}
   <button type="button" class="calendar-color-dot-btn ${color}" data-color-cal-id="${c.id}" aria-label="${esc(c.name)} 색상 변경" title="${isICloud?'iCloud · ':isGoogle?'Google · ':''}색상 변경">${providerMark}</button>
   <button type="button" class="calendar-title-btn" ${calAttr} aria-current="${isCurrent?'page':'false'}" title="${esc(c.name)}">
    <span class="calendar-name-label">${esc(c.name)}</span>
    ${c.role==='owner'?'<small class="owner-pill">나</small>':''}
   </button>
   <button type="button" class="calendar-manage-btn" data-manage-cal="${esc(c.slug||c.id)}" aria-label="${esc(c.name)} 관리" title="캘린더 관리">⚙</button>
  </div>`;
 }).join('');
}

function attachCalendarInteractions(){
 document.querySelectorAll('[data-toggle-cal]').forEach(b=>{
  b.onclick=e=>{
   e.stopPropagation();
   toggleCalendarSelect(b.dataset.toggleCal);
  };
 });
 document.querySelectorAll('[data-color-cal-id]').forEach(b=>{
  b.onclick=e=>{
   e.stopPropagation();
   openColorPicker(b.dataset.colorCalId, b);
  };
 });
 document.querySelectorAll('[data-calendar]').forEach(b=>{
  b.onclick=()=>{
   selectCalendar(b.dataset.calendar);
  };
 });
 document.querySelectorAll('[data-manage-cal]').forEach(b=>{
  b.onclick=e=>{
   e.stopPropagation();
   openCalendarDetails(b.dataset.manageCal);
  };
 });
}

function renderCalendarListUI(){
 const list=$('#calendar-list');
 if(list)list.innerHTML=renderCalendarListItems(false);
 const badge=$('#cal-count-badge');
 if(badge)badge.textContent=`${selectedCalendarIds.size}/${calendars.length}`;
 const chips=$('#calendar-meta-chips');
 if(chips)chips.innerHTML=renderCalendarMetaChips();
 const topTitle=$('.calendar-title');
 if(topTitle){topTitle.textContent=getCalendarTitle();topTitle.title=getCalendarTitle();}
 renderMobileMenuCalendars();
 attachCalendarInteractions();
}

function getCalendarFooterText(){
 const reg=getActiveRegion();
 const regName=getRegionName(reg,locale);
 const weatherPart=isWeatherEnabled()?(locale==='en'?` · Weather: ${getWeatherLocationDisplayName(weatherLocation,'en')}`:` · 날씨: ${getWeatherLocationDisplayName(weatherLocation,'ko')}`):'';
 if(reg==='none')return (locale==='en'?'Calendar time zone · Korea (KST) · No holidays':'기준 시간 · 한국 (KST) · 공휴일 없음')+weatherPart;
 return (locale==='en'?`Calendar time zone · Korea (KST) · Holidays: ${regName}`:`기준 시간 · 한국 (KST) · 공휴일: ${regName}`)+weatherPart;
}

const settingsSections={
 calendars:{title:'캘린더 관리',description:'함께 쓰는 캘린더와 연결된 외부 캘린더를 관리하세요.'},
 icloud:{title:'iCloud 캘린더 연동',description:'Apple 캘린더의 일정을 모아에서도 편하게 확인하세요.'},
 migrate:{title:'캘린더 모으기',description:'여러 캘린더의 일정을 기존 모아 캘린더로 가져오세요.'},
 google:{title:'Google 캘린더 가져오기',description:'원하는 기간의 일정을 새 캘린더로 가져오세요.'},
 account:{title:'계정 및 프로필',description:'함께하는 사람들에게 보이는 내 이름과 연결된 계정을 관리하세요.'},
 preferences:{title:'언어 및 지역',description:'익숙한 언어와 지역으로 캘린더를 사용하세요.'},
 sessions:{title:'함께 보는 세션',description:'현재 캘린더에 접속 중인 기기와 참여자를 확인하세요.'},
 calendar:{title:'캘린더 상세 설정',description:'캘린더 이름, 색상과 참여 권한을 관리하세요.'}
};
let settingsReturnPath='/';
const isSettingsRoute=()=>/^\/settings(?:\/|$)/.test(location.pathname);
const isSettingsPanel=section=>!$('#settings-page').hidden&&!$(`[data-settings-panel="${section}"]`).hidden;

function initializeSettingsPage(){
 document.querySelectorAll('[data-settings-mount]').forEach(mount=>{
  const source=document.getElementById(mount.dataset.settingsMount);
  while(source.firstChild)mount.append(source.firstChild);
  source.remove();
 });
 $('#settings-preferences-mount').append($('#language-settings'));
 // Profile calendar choices belong in Calendar Management.
 $('#mobile-profile-calendars').closest('section').hidden=true;
 $('[data-profile-action="create"]').hidden=true;
 document.querySelectorAll('[data-settings-icon]').forEach(el=>{
  const kind=el.dataset.settingsIcon;
  const extra={cloud:'<path d="M7 18a5 5 0 1 1 1-10 6 6 0 0 1 11 3 3.5 3.5 0 0 1-1 7Z"/>',import:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',preferences:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>'};
  el.innerHTML=extra[kind]?`<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${extra[kind]}</svg>`:mobileNavIcon(kind);
 });
 $('#settings-page').addEventListener('click',e=>{
  const link=e.target.closest('[data-settings-section],[data-settings-return]');
  if(link&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){
   e.preventDefault();
   if(link.hasAttribute('data-settings-return')){returnToCalendar();return;}
   openSettingsPage(link.dataset.settingsSection);return;
  }
  if(e.target.closest('[data-settings-create],[data-profile-action="create"]'))$('#create-dialog').showModal();
  if(e.target.closest('[data-profile-action="logout"]'))$('#logout').click();
  const calendarButton=e.target.closest('[data-profile-calendar]');
  if(calendarButton)openCalendarDetails(calendarButton.dataset.profileCalendar);
 });
 $('#settings-mobile-navigation').onchange=e=>openSettingsPage(e.target.value);
 $('#icloud-password-toggle').onclick=e=>{
  const input=$('#icloud-password-input'),show=input.type==='password';
  input.type=show?'text':'password';
  e.currentTarget.textContent=show?'숨기기':'표시';
  e.currentTarget.setAttribute('aria-pressed',String(show));
  e.currentTarget.setAttribute('aria-label',show?'앱 암호 숨기기':'앱 암호 표시');
 };
 initializePushSettings();
}

function openSettingsPage(section='calendars',updateUrl=true,calendarIdent=''){
 if(!me?.user)return;
 if(!settingsSections[section])section='calendars';
 if(!isSettingsRoute()||settingsReturnPath==='/')settingsReturnPath=current?'/'+(current.slug||current.id):'/';
 const path=section==='calendar'?'/settings/calendars/'+encodeURIComponent(calendarIdent):'/settings/'+section;
 if(updateUrl&&location.pathname!==path)history.pushState({settings:section},'',path);
 app.hidden=true;$('#settings-page').hidden=false;
 document.body.classList.add('settings-open');
 document.querySelectorAll('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==section);
 const navSection=section==='calendar'?'calendars':section;
 document.querySelectorAll('#settings-navigation [data-settings-section]').forEach(link=>{
  if(link.dataset.settingsSection===navSection)link.setAttribute('aria-current','page');
  else link.removeAttribute('aria-current');
 });
 $('#settings-mobile-navigation').value=navSection;
 const meta=settingsSections[section];
 $('#settings-page-title').textContent=meta.title;
 $('#settings-page-description').textContent=meta.description;
 document.title=meta.title+' · 모아 캘린더';
 $('#settings-user-name').textContent=me.user.name;
 $('#settings-user-avatar').textContent=me.user.name.slice(0,1);
 $('#settings-calendar-count').textContent=locale==='en'?`${calendars.length} calendars`:`총 ${calendars.length}개 캘린더`;
 document.querySelectorAll('[data-settings-return]').forEach(link=>link.href=settingsReturnPath);
 if(section==='calendars')loadSettingsCalendars();
 if(section==='icloud'){
  $('#icloud-connect-error').textContent='';$('#icloud-sync-status-msg').textContent='';
  switchIntegrationTab('icloud');loadCalendarIntegrations();
 }
 if(section==='account'){
  renderMobileProfile();updateWeatherSettingsUI();$('#profile-name-input').value=me.user.name;$('#profile-name-error').textContent='';
 }
 if(section==='google')prepareGoogleImport();
 if(section==='migrate')loadMigrationSources();
 if(section==='preferences'){updatePushSettingsUI();updateWeatherSettingsUI();}
 window.scrollTo(0,0);
 $('#settings-page-title').focus({preventScroll:true});
}

function closeSettingsPage(){
 const page=$('#settings-page');
 if(!page||page.hidden)return;
 page.hidden=true;app.hidden=false;
 document.body.classList.remove('settings-open');
 document.title=locale==='en'?'Moa Calendar | Real-time shared calendar':'모아 캘린더 | 함께 쓰는 실시간 공유 캘린더';
 // Do not retain a typed credential after leaving Settings.
 $('#icloud-password-input').value='';
 $('#icloud-password-input').type='password';
 $('#icloud-password-toggle').textContent=locale==='en'?'Show':'표시';
 $('#icloud-password-toggle').setAttribute('aria-pressed','false');
 $('#icloud-password-toggle').setAttribute('aria-label',locale==='en'?'Show app password':'앱 암호 표시');
}

function restoreSettingsRoute(){
 const parts=location.pathname.split('/').filter(Boolean);
 if(parts[1]==='calendars'&&parts[2]){
  const ident=decodeURIComponent(parts[2]);
  if(calendars.some(c=>c.id===ident||c.slug===ident)){openCalendarDetails(ident,false);return;}
 }
 openSettingsPage(parts[1]||'calendars',false);
}

async function returnToCalendar(){
 closeSettingsPage();
 const path=current?'/'+(current.slug||current.id):'/';
 if(location.pathname!==path)history.pushState({},'',path);
 if(current)await selectCalendar(current.slug||current.id,false);
 else{renderShell();renderCalendar();}
 $(mobileCalendar.matches?'#mobile-more-trigger':'#desktop-settings-trigger')?.focus({preventScroll:true});
}

function renderShell(){
 const workspaceClass=`workspace ${sidebarCollapsed?'sidebar-collapsed':''} ${rightCollapsed?'right-collapsed':''}`.trim();
 app.innerHTML=`<div class="${workspaceClass}" id="workspace-root">
  <aside class="sidebar" id="main-sidebar" aria-label="캘린더 메뉴">
  <button class="side-open-btn left" id="open-sidebar-btn" title="왼쪽 메뉴 펼치기" aria-label="왼쪽 메뉴 펼치기" aria-controls="main-sidebar" aria-expanded="false">›</button>
   <button class="mobile-panel-toggle" id="mobile-sidebar-toggle" aria-controls="sidebar-content" aria-expanded="${!sidebarCollapsed}"><span><span class="brand-mark" aria-hidden="true">m</span> 캘린더 메뉴</span><span class="panel-toggle-hint">${sidebarCollapsed?'펼치기':'접기'} <span aria-hidden="true">${sidebarCollapsed?'⌄':'⌃'}</span></span></button>
   <div class="sidebar-content" id="sidebar-content">
   <a class="brand sidebar-brand" href="/"><span class="brand-mark">m</span><span class="sidebar-brand-name">모아</span></a>
   <button class="panel-arrow-btn panel-edge-toggle left-toggle" id="collapse-sidebar-btn" title="왼쪽 메뉴 접기" aria-label="왼쪽 메뉴 접기" aria-controls="main-sidebar" aria-expanded="true">‹</button>
   <button class="primary full" id="new-event">＋ 일정 만들기</button>
   <button class="secondary full schedule-share-trigger-btn" id="open-schedule-share-btn" type="button"><span aria-hidden="true">↗</span> 일정 공유 링크</button>
   <div class="nav-caption">MY SPACE</div>
   <div class="nav-active">▦ <span>공유 캘린더</span></div>
   <div class="calendar-heading"><span>내 캘린더 <span class="calendar-count-badge" id="cal-count-badge">${selectedCalendarIds.size}/${calendars.length}</span></span><button class="icon" id="new-calendar" aria-label="새 캘린더 만들기"><span aria-hidden="true">＋</span><span class="calendar-create-label">새 캘린더 만들기</span></button></div>
   <div id="calendar-list">${renderCalendarListItems(false)}</div>
   <div class="sidebar-notes" id="sidebar-notes">
    <section class="sidebar-note-section month-note-section date-note-section" id="month-note-section" aria-labelledby="month-note-heading">
     <div class="section-title"><h3 id="month-note-heading">월 메모</h3><span class="month-note-badge date-note-badge" id="month-note-badge">노트</span></div>
     <p class="date-note-description">이 캘린더의 이번 달 메모예요.</p>
     <form id="month-note-form"><label class="sr-only" for="month-note-input">선택한 월의 메모</label><textarea id="month-note-input" maxlength="5000" rows="4" placeholder="이 달에 기억해 둘 내용을 적어주세요."></textarea><p id="month-note-error" class="form-error" role="alert"></p><div class="date-note-actions"><button type="button" id="edit-month-note" class="secondary">수정</button><button type="button" id="cancel-month-note" class="text-button">취소</button><button type="submit" id="save-month-note" class="primary">저장</button></div><p id="month-note-status" class="small" role="status" aria-live="polite"></p></form>
    </section>
   </div>
   <div class="profile sidebar-profile"><span class="avatar">${esc((me?.user?.name||'').slice(0,1))}</span><span>${esc(me?.user?.name||'내 계정')}<small>${me?.demo&&me?.user?.id?.startsWith('demo:')?'체험 계정':'나의 계정'}</small></span><button class="icon" id="logout" aria-label="로그아웃" title="로그아웃">↪</button></div>
   </div>
  </aside>
  <main class="main">
   <header class="topbar">
    <div class="calendar-title-group">
     <h1 class="calendar-title" title="${esc(getCalendarTitle())}">${esc(getCalendarTitle())}</h1>
    </div>
    <div class="topbar-actions">
     <button class="secondary" id="share" hidden aria-label="초대 링크 및 캘린더 주소 공유"><span aria-hidden="true">↗</span><span class="share-label-desktop">초대 / 주소 공유</span><span class="share-label-mobile">초대·공유</span></button>
     <button class="mobile-search-trigger" id="mobile-search-trigger" type="button" aria-label="일정 검색" aria-controls="calendar-search" aria-expanded="false"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg></button>
     <button class="mobile-more-trigger" id="mobile-more-trigger" type="button" aria-label="설정 페이지 열기" aria-controls="settings-page"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
    </div>
   </header>
   <div class="workspace-body">
    <section class="calendar-section">
     <div class="calendar-toolbar">
      <div class="calendar-heading-block">
       <div class="month-heading"><h2 id="month-title"></h2></div>
       <div class="calendar-view-controls">
        <button class="today-button" id="today">오늘</button>
        <div class="view-mode-group" role="tablist" aria-label="캘린더 보기 형식"><button class="view-btn ${viewMode==='day'?'active':''}" data-view="day" role="tab" aria-selected="${viewMode==='day'}">일간</button><button class="view-btn ${viewMode==='week'?'active':''}" data-view="week" role="tab" aria-selected="${viewMode==='week'}">주간</button><button class="view-btn ${viewMode==='month'?'active':''}" data-view="month" role="tab" aria-selected="${viewMode==='month'}">월간</button></div>
        <div class="month-nav" role="group" aria-label="달력 기간 이동"><button class="icon" id="prev" aria-label="이전 기간"><span aria-hidden="true">‹</span></button><button class="icon" id="next" aria-label="다음 기간"><span aria-hidden="true">›</span></button></div>
       </div>
      </div>
      <div class="dday-widget-bar" id="dday-widget-bar" role="region" aria-label="D-Day 위젯" hidden></div>
     </div>
     <div class="calendar-meta"><span id="calendar-meta-chips">${renderCalendarMetaChips()}</span><span id="sync-status" role="status">연결 중</span></div>
     <div id="calendar"></div>
     <div class="calendar-footer"><span>${getCalendarFooterText()}</span></div>
    </section>
    <aside class="right-panel" id="details-panel" aria-label="캘린더 정보">
  <button class="side-open-btn right" id="open-right-btn" title="오른쪽 패널 펼치기" aria-label="오른쪽 패널 펼치기" aria-controls="details-panel" aria-expanded="false">‹</button>
     <button class="mobile-panel-toggle" id="mobile-right-toggle" aria-controls="right-panel-content" aria-expanded="${!rightCollapsed}"><span id="mobile-agenda-summary">선택한 날짜의 일정</span><span class="panel-toggle-hint">${rightCollapsed?'펼치기':'접기'} <span aria-hidden="true">${rightCollapsed?'⌄':'⌃'}</span></span></button>
     <div class="right-panel-content" id="right-panel-content">
     <button class="panel-arrow-btn panel-edge-toggle right-toggle" id="collapse-right-btn" title="오른쪽 패널 접기" aria-label="오른쪽 패널 접기" aria-controls="details-panel" aria-expanded="true">›</button>
     <div class="right-panel-toolbar" id="right-panel-toolbar">
      <div class="calendar-search" id="calendar-search"><label class="sr-only" for="event-search">일정 검색</label><input id="event-search" type="search" placeholder="일정 검색" autocomplete="off"><div id="event-search-results" class="event-search-results" hidden></div></div>
      <button type="button" class="desktop-settings-trigger secondary" id="desktop-settings-trigger" aria-label="캘린더 설정 열기" aria-controls="settings-page"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m10 3-.7 2.4-2 .9L5 5.6 3 9l1.8 1.7v2.6L3 15l2 3.4 2.3-.7 2 .9L10 21h4l.7-2.4 2-.9 2.3.7 2-3.4-1.8-1.7v-2.6L21 9l-2-3.4-2.3.7-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/></svg><span>설정</span></button>
     </div>
     <section id="monthly-items" class="monthly-items ${monthlyCollapsed?'collapsed':''}" aria-labelledby="monthly-items-heading"></section>
     <section class="presence-card">
      <div class="section-title"><h3>지금 함께 보는 중</h3><span id="session-count" class="count">0</span></div>
      <p class="muted small">이 캘린더에 접속한 세션이에요.</p>
      <div id="presence-list"></div>
     </section>
     <section class="agenda">
      <div class="section-title"><h3 id="agenda-date"></h3><button class="icon" id="agenda-add" aria-label="선택한 날짜에 일정 추가">＋</button></div>
      <p class="muted small" id="agenda-count"></p>
      <div id="agenda-list"></div>
     </section>
     <section class="date-note-section" id="date-note-section" aria-labelledby="date-note-heading">
      <div class="section-title"><h3 id="date-note-heading">날짜별 노트</h3><span class="date-note-badge" id="date-note-badge">노트</span></div>
      <p class="date-note-description">이 캘린더의 참여자들과 함께 보는 메모예요.</p>
      <form id="date-note-form"><label class="sr-only" for="date-note-input">선택한 날짜의 메모</label><textarea id="date-note-input" maxlength="5000" rows="5" placeholder="이 날짜에 기억해 둘 내용을 적어주세요."></textarea><p id="date-note-error" class="form-error" role="alert"></p><div class="date-note-actions"><button type="button" id="edit-date-note" class="secondary">수정</button><button type="button" id="cancel-date-note" class="text-button">취소</button><button type="submit" id="save-date-note" class="primary">저장</button></div><p id="date-note-status" class="small" role="status" aria-live="polite"></p></form>
     </section>
     </div>
    </aside>
   </div>
  </main>
  <nav class="mobile-bottom-nav" aria-label="모바일 하단 메뉴">
   ${['day','week','month'].map((mode,i)=>`<button type="button" data-view="${mode}" aria-pressed="${viewMode===mode}">${mobileNavIcon(mode)}<span>${['일간','주간','월간'][i]}</span></button>`).join('')}
   <button type="button" id="mobile-sessions-trigger" aria-controls="settings-page">${mobileNavIcon('sessions')}<span>접속 <span id="mobile-nav-session-count">0</span></span></button>
   <button type="button" id="mobile-profile-trigger" aria-controls="settings-page">${mobileNavIcon('profile')}<span>마이페이지</span></button>
  </nav>
  <button class="mobile-create-action" id="mobile-create-event" aria-label="선택한 날짜에 새 일정 만들기"><span aria-hidden="true">＋</span></button>
 </div>`;

 $('#date-note-input').oninput=updateNoteDraft;
 $('#edit-date-note').onclick=()=>setNoteEditing(true);
 $('#cancel-date-note').onclick=()=>setNoteEditing(false,true);
 $('#date-note-form').onsubmit=saveDateNote;
 $('#month-note-input').oninput=updateMonthNoteDraft;
 $('#edit-month-note').onclick=()=>setMonthNoteEditing(true);
 $('#cancel-month-note').onclick=()=>setMonthNoteEditing(false,true);
 $('#month-note-form').onsubmit=saveMonthNote;
 $('#new-calendar').onclick=()=>$('#create-dialog').showModal();
 $('#open-schedule-share-btn').onclick=()=>openScheduleShareDialog();
 $('#new-event').onclick=e=>openEvent(null,null,null,e.currentTarget);
 $('#mobile-create-event').onclick=e=>openEvent(null,null,null,e.currentTarget);
 $('#agenda-add').onclick=e=>openEvent(null,null,null,e.currentTarget);
 $('#event-search').oninput=renderEventSearch;
 $('#mobile-search-trigger').onclick=()=>setMobileSearchOpen(!$('#calendar-search').classList.contains('is-open'));
 $('#event-search').onkeydown=e=>{if(e.key==='Escape'&&mobileCalendar.matches){setMobileSearchOpen(false);$('#mobile-search-trigger').focus();}};
 $('#event-form').elements.reminder_enabled.onchange=async e=>{
  $('#event-form').elements.reminder_minutes.disabled=!e.target.checked;
  if(e.target.checked&&!window.MoaAndroidBridge&&'Notification' in window&&Notification.permission==='default'){
   try{await Notification.requestPermission();}catch{}
  }
 };
 $('#event-form').elements.reminder_minutes.disabled=true;
 $('#event-search-results').onclick=e=>{
  const monthlyRow=e.target.closest('[data-search-monthly]');
  if(monthlyRow){
   const item=monthlyItems.find(item=>item.id===monthlyRow.dataset.searchMonthly);if(!item)return;
   month=new Date(`${item.month}-01T12:00:00`);selected=`${item.month}-01`;
   $('#event-search-results').hidden=true;
   if(mobileCalendar.matches)setMobileSearchOpen(false);
   renderCalendar();openMonthlyItem(item);return;
  }
  const row=e.target.closest('[data-search-event]'); if(!row)return;
  const event=events.find(item=>item.id===row.dataset.searchEvent); if(!event)return;
  selected=event.start.slice(0,10); month=new Date(`${selected}T12:00:00`); $('#event-search-results').hidden=true;
  if(mobileCalendar.matches)setMobileSearchOpen(false);
  if(viewMode==='month')viewMode='day'; renderCalendar(); openEvent(event,null,null);
 };
 $('#share').disabled=!current||current.role!=='owner';
 $('#share').onclick=()=>{
  $('#invite-result').hidden=true;
  $('#share-dialog .form-error').textContent='';
  if($('#calendar-url'))$('#calendar-url').value=`${location.origin}/${current.slug||current.id}`;
  $('#share-dialog').showModal();
 };
 $('#logout').onclick=async()=>{
  try{
   localStorage.removeItem('moa_cached_me');
   localStorage.removeItem('moa_cached_calendars');
  }catch{}
  await api('/auth/logout','POST',{});
  connection?.close();
  await boot();
 };
 $('#mobile-menu-account').textContent=me?.user?.name||'';
 $('#mobile-more-trigger').onclick=()=>openSettingsPage('calendars');
 $('#desktop-settings-trigger').onclick=()=>openSettingsPage('calendars');
 $('#mobile-sessions-trigger').onclick=()=>openSettingsPage('sessions');
 $('#mobile-profile-trigger').onclick=()=>openSettingsPage('account');
 attachCalendarInteractions();
 $('#cal-count-badge')?.addEventListener('click',toggleSelectAll);

 updateSidebarState=(collapsed)=>{
  sidebarCollapsed=collapsed;
  localStorage.setItem('moa_sidebar_collapsed',String(collapsed));
  $('#workspace-root')?.classList.toggle('sidebar-collapsed',collapsed);
  $('#open-sidebar-btn')?.setAttribute('aria-expanded',String(!collapsed));
  $('#collapse-sidebar-btn')?.setAttribute('aria-expanded',String(!collapsed));
  $('#mobile-sidebar-toggle')?.setAttribute('aria-expanded',String(!collapsed));
  $('#mobile-sidebar-toggle .panel-toggle-hint').innerHTML=`${collapsed?'펼치기':'접기'} <span aria-hidden="true">${collapsed?'⌄':'⌃'}</span>`;
 };

 updateRightState=(collapsed)=>{
  rightCollapsed=collapsed;
  localStorage.setItem('moa_right_collapsed',String(collapsed));
  $('#workspace-root')?.classList.toggle('right-collapsed',collapsed);
  $('#open-right-btn')?.setAttribute('aria-expanded',String(!collapsed));
  $('#collapse-right-btn')?.setAttribute('aria-expanded',String(!collapsed));
  $('#mobile-right-toggle')?.setAttribute('aria-expanded',String(!collapsed));
  $('#mobile-right-toggle .panel-toggle-hint').innerHTML=`${collapsed?'펼치기':'접기'} <span aria-hidden="true">${collapsed?'⌄':'⌃'}</span>`;
 };

 $('#mobile-sidebar-toggle').onclick=()=>updateSidebarState(!sidebarCollapsed);
 $('#mobile-right-toggle').onclick=()=>updateRightState(!rightCollapsed);
 $('#collapse-sidebar-btn').onclick=()=>updateSidebarState(true);
 $('#open-sidebar-btn').onclick=()=>updateSidebarState(false);
 $('#collapse-right-btn').onclick=()=>updateRightState(true);
 $('#open-right-btn').onclick=()=>updateRightState(false);

 $('#prev').onclick=()=>movePeriod(-1);
 $('#next').onclick=()=>movePeriod(1);
 $('#today').onclick=()=>{
  const now=new Date();
  month=new Date(now.getFullYear(),now.getMonth(),1);
  selected=dateKey(now);
  renderCalendar();
 };

 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
  setViewMode(b.dataset.view);
 });

 renderCalendar();
}

function setViewMode(mode){
 if(!['day','week','month'].includes(mode))return;
 viewMode=mode;
 document.querySelectorAll('.view-btn').forEach(btn=>{
  const active=btn.dataset.view===mode;
  btn.classList.toggle('active',active);
  btn.setAttribute('aria-selected',active);
 });
 renderCalendar();
}

function movePeriod(n){
 if(viewMode==='month'){
  month=new Date(month.getFullYear(),month.getMonth()+n,1);
  selected=dateKey(month);
 }else if(viewMode==='week'){
  const cur=new Date(`${selected}T12:00:00`);
  cur.setDate(cur.getDate()+(n*7));
  selected=dateKey(cur);
  month=new Date(cur.getFullYear(),cur.getMonth(),1);
 }else if(viewMode==='day'){
  const cur=new Date(`${selected}T12:00:00`);
  cur.setDate(cur.getDate()+n);
  selected=dateKey(cur);
  month=new Date(cur.getFullYear(),cur.getMonth(),1);
 }
 renderCalendar();
}

async function selectCalendar(ident,updateUrl=true){
 if(updateUrl)closeSettingsPage();
 connected=false;sessions=[];dateNotes.clear();monthNotes.clear();notesRequest++;monthNotesRequest++;
 const target=calendars.find(c=>c.id===ident||c.slug===ident);
 if(!target)return;
 current=target;
 selectedCalendarIds.add(current.id);
 saveSelectedCalendars();
 const canonicalId=current.id,canonicalPath='/'+(current.slug||current.id);
 sessionStorage.setItem('calendar',canonicalId);
 if(updateUrl&&location.pathname!==canonicalPath)history.pushState({calendar:canonicalId},'',canonicalPath);
 renderShell();
 renderCalendar();
 const loadPromise=(async ()=>{
  try{
   await loadAllSelectedEvents();
   renderCalendar();
   await loadDateNotes();
   await loadMonthNotes();
   renderSelectedDate();
   syncCalendarStreams();
  }catch(e){toast(e.message);}
 })();
 return loadPromise;
}

async function toggleCalendarSelect(calId){
 if(selectedCalendarIds.has(calId)){
  selectedCalendarIds.delete(calId);
 }else{
  selectedCalendarIds.add(calId);
  if(!current||!selectedCalendarIds.has(current.id)){
   const target=calendars.find(c=>c.id===calId);
   if(target)current=target;
  }
 }
 saveSelectedCalendars();
 renderCalendarListUI();
 renderCalendar();
 const loadPromise=(async ()=>{
  try{
   await loadAllSelectedEvents();
   renderCalendar();
   syncCalendarStreams();
  }catch(e){toast(e.message);}
 })();
 return loadPromise;
}

async function toggleSelectAll(){
 if(selectedCalendarIds.size>0){
  selectedCalendarIds=new Set();
 }else{
  selectedCalendarIds=new Set(calendars.map(c=>c.id));
 }
 saveSelectedCalendars();
 renderCalendarListUI();
 try{
  await loadAllSelectedEvents();
  renderCalendar();
  syncCalendarStreams();
 }catch(e){toast(e.message);}
}

async function loadAllSelectedEvents(){
 const request=++eventLoadRequest;
 const targetCalendars=calendars.filter(c=>selectedCalendarIds.has(c.id));
 if(targetCalendars.length===0){
  events=[];
  monthlyItems=[];monthlyLoadError=false;monthlyLoading=false;
  return;
 }
 const results=await Promise.all(targetCalendars.map(async cal=>{
  try{
   const [eventResult,monthlyResult]=await Promise.allSettled([api(`/api/calendars/${cal.id}/events`),api(`/api/calendars/${cal.id}/monthly-items`)]);
   const list=eventResult.status==='fulfilled'?eventResult.value:[];
   const calColor=getCalendarColor(cal);
   return {monthly:monthlyResult.status==='fulfilled'?monthlyResult.value:[],monthlyError:monthlyResult.status==='rejected',events:list.map(ev=>({
    ...ev,
    calendar_id:cal.id,
    calendar_name:cal.name,
    calendar_color:calColor,
    calendar_role:cal.role
   }))};
  }catch(err){
   console.error(`이벤트 로드 실패 (${cal.name}):`,err);
   return {events:[],monthly:[],monthlyError:true};
  }
 }));
 if(request!==eventLoadRequest)return;
 events=results.flatMap(result=>result.events);
 monthlyItems=results.flatMap(result=>result.monthly);
 monthlyLoadError=results.some(result=>result.monthlyError);monthlyLoading=false;
 scheduleBrowserReminders();
}

function syncCalendarStreams(){
 const activeIds=new Set(selectedCalendarIds);
 if(current)activeIds.add(current.id);
 for(const [calId, stream] of calendarStreams.entries()){
  if(!activeIds.has(calId)){
   stream.close();
   calendarStreams.delete(calId);
  }
 }
 for(const calId of activeIds){
  if(calendarStreams.has(calId))continue;
  const isPrimary=calId===current?.id;
  try{
   const stream=new EventSource(`/api/calendars/${calId}/stream`);
   calendarStreams.set(calId,stream);
   stream.onopen=()=>{
    if(isPrimary){connected=true;revealCalendar();renderPresence();validateCalendarAccess();loadDateNotes().catch(error=>toast(error.message));loadMonthNotes().catch(error=>toast(error.message));}
   };
   stream.onerror=()=>{
    if(isPrimary){connected=false;renderPresence();validateCalendarAccess(true);}
   };
   stream.addEventListener('change',async()=>{
    try{
     await loadAllSelectedEvents();
     renderCalendar();
    }catch(e){if(e.status===403&&current?.id===calId)denyCalendarAccess(e.message);else toast(e.message);}
   });
   if(isPrimary){
    connection=stream;
    stream.addEventListener('access-revoked',()=>{if(deletingCalendarId===calId){stream.close();return;}if(current?.id===calId)denyCalendarAccess('이 캘린더의 참여 권한이 해제됐어요.');else stream.close();});
    stream.addEventListener('session-ended',()=>{if(current?.id===calId)denyCalendarAccess('관리자가 이 기기의 세션을 종료했어요. 다시 로그인해 주세요.');else stream.close();});
    stream.addEventListener('notes',()=>loadDateNotes().catch(e=>toast(e.message)));
    stream.addEventListener('month-notes',()=>loadMonthNotes().catch(e=>toast(e.message)));
    stream.addEventListener('profile',async()=>{
     try{const account=await api('/api/me');if(account.user?.id===me.user?.id){me.user=account.user;renderAccountName();}}catch(error){toast(error.message);}
    });
    stream.addEventListener('calendar',()=>refreshCalendarMetadata().catch(e=>toast(e.message)));
    stream.addEventListener('members',()=>{if(isSettingsPanel('calendar')&&managedCalendar?.id===calId)loadCalendarDetails(false);});
    stream.addEventListener('presence',e=>{
     if(current?.id!==calId)return;
     sessions=JSON.parse(e.data);
     renderPresence();
     if(isSettingsPanel('calendar')&&managedCalendar?.id===calId)loadCalendarDetails(false);
    });
   }
  }catch(e){console.error(`스트림 생성 실패 (${calId}):`,e);}
 }
}

function openColorPicker(calId, anchorElem){
 activeColorPickerCalId=calId;
 const popover=$('#calendar-color-popover');
 const grid=$('#calendar-color-popover-grid');
 if(!popover||!grid)return;
 const cal=calendars.find(c=>c.id===calId);
 const currentColor=getCalendarColor(cal);
 grid.innerHTML=EVENT_COLORS.map(color=>`
  <button type="button" class="color-swatch-btn ${color} ${color===currentColor?'selected':''}" data-choose-color="${color}" aria-label="${calendarColorNames[color]}" title="${calendarColorNames[color]}">${color===currentColor?'✓':''}</button>
 `).join('');
 popover.hidden=false;

 grid.querySelectorAll('[data-choose-color]').forEach(btn=>{
  btn.onclick=e=>{
   e.stopPropagation();
   const chosen=btn.dataset.chooseColor;
   const targetCalId=activeColorPickerCalId;
   closeColorPicker();
   if(targetCalId)setCalendarColor(targetCalId, chosen);
  };
 });

 if(anchorElem && typeof anchorElem.getBoundingClientRect === 'function'){
  const rect=anchorElem.getBoundingClientRect();
  const popW=popover.offsetWidth||190;
  const popH=popover.offsetHeight||76;
  let left=rect.right+8;
  if(left+popW>window.innerWidth-10){
   left=Math.max(10,rect.left-popW-8);
  }
  let top=rect.top - 6;
  if(top+popH>window.innerHeight-10){
   top=Math.max(10,window.innerHeight-popH-10);
  }
  if(top<10)top=10;
  popover.style.left=`${Math.round(left)}px`;
  popover.style.top=`${Math.round(top)}px`;
 }
}

function closeColorPicker(){
 const popover=$('#calendar-color-popover');
 if(popover)popover.hidden=true;
 activeColorPickerCalId=null;
}

document.addEventListener('click', e=>{
 const popover=$('#calendar-color-popover');
 if(popover&&!popover.hidden&&!e.target.closest('#calendar-color-popover')&&!e.target.closest('[data-color-cal-id]')){
  closeColorPicker();
 }
});

async function setCalendarColor(calId, color){
 userCalendarColors[calId]=color;
 try{localStorage.setItem('moa_calendar_colors',JSON.stringify(userCalendarColors));}catch{}
 const cal=calendars.find(c=>c.id===calId);
 if(cal)cal.color=color;
 if(current?.id===calId)current.color=color;
 events.forEach(ev=>{
  if(ev.calendar_id===calId){
   ev.calendar_color=color;
  }
 });
 renderCalendarListUI();
 renderCalendar();
 if(cal&&cal.role==='owner'){
  api(`/api/calendars/${calId}/settings`,'PUT',{name:cal.name,color}).catch(console.error);
 }
}

function renderMobileMenuCalendars(){
 const el=$('#mobile-menu-calendars');
 if(!el)return;
 el.innerHTML=calendars.length?renderCalendarListItems(true):'<p class="muted small">새 캘린더를 만들어 시작하세요.</p>';
 attachCalendarInteractions();
}

function renderCalendarManagementLists(connections=[]){
 const calendarList=$('#calendar-management-list');
 if(calendarList)calendarList.innerHTML=calendars.length?calendars.map((cal,index)=>`<div class="calendar-management-row"><span class="dot calendar-color-dot ${esc(getCalendarColor(cal))}" aria-hidden="true"></span><span class="calendar-management-name">${esc(cal.name)}${cal.id===defaultCalendar()?.id?`<small>기본 캘린더</small>`:''}</span><span class="calendar-order-actions"><button type="button" data-calendar-order="${cal.id}" data-order-step="-1" aria-label="${esc(cal.name)} 위로 이동" ${index===0?'disabled':''}>↑</button><button type="button" data-calendar-order="${cal.id}" data-order-step="1" aria-label="${esc(cal.name)} 아래로 이동" ${index===calendars.length-1?'disabled':''}>↓</button></span><small>${{owner:'관리자',editor:'편집',viewer:'보기'}[cal.role]||''}</small><button type="button" class="secondary" data-management-calendar="${esc(cal.slug||cal.id)}">관리</button></div>`).join(''):'<p class="muted small">아직 참여한 캘린더가 없어요.</p>';
 const externalList=$('#external-calendar-management-list');
 const external=(connections||[]).flatMap(conn=>(conn.calendars||[]).map(cal=>({...cal,provider:conn.provider,accountEmail:conn.accountEmail,connectionStatus:conn.connectionStatus})));
 if(externalList)externalList.innerHTML=external.length?external.map(cal=>`<div class="calendar-management-row external-calendar-management-row"><span class="apple-badge-icon" aria-hidden="true">${cal.provider==='icloud'?'':'↗'}</span><span class="calendar-management-name">${esc(cal.displayName)}<small>${esc(cal.accountEmail||'')}</small></span><small>${cal.provider==='icloud'?'iCloud':'Google'}</small><button type="button" class="text-button danger" data-unlink-external-calendar="${esc(cal.id)}" data-external-calendar-name="${esc(cal.displayName)}">연결 해제</button></div>`).join(''):'<p class="muted small">연결된 외부 캘린더가 없어요.</p>';
}

function openCalendarManagement(){openSettingsPage('calendars');}
async function loadSettingsCalendars(){
 $('#calendar-management-error').textContent='';
 renderCalendarManagementLists();
 try{
  const result=await api('/api/me/calendar-connections');
  renderCalendarManagementLists(result.connections||[]);
 }catch(error){$('#calendar-management-error').textContent=error.message;}
}

function dayEvents(key){return events.filter(e=>e.start.slice(0,10)<=key&&e.end>`${key}T00:00`).sort((a,b)=>Number(Boolean(b.all_day))-Number(Boolean(a.all_day))||a.start.localeCompare(b.start));}
function shiftDate(key,days){const d=new Date(`${key}T12:00:00`);d.setDate(d.getDate()+days);return dateKey(d);}

function getEventRange(e){
 const startKey=(e.start||'').slice(0,10);
 const endStr=e.end||e.start||'';
 const endKey=/^00:00(?::00(?:\.000)?)?$/.test(endStr.slice(11))?shiftDate(endStr.slice(0,10),-1):endStr.slice(0,10);
 const safeEndKey=endKey<startKey?startKey:endKey;
 return {startKey,endKey:safeEndKey,multiDay:safeEndKey>startKey};
}

function allocateWeekSlots(weekKeys,eventList=events){
 const weekStartKey=weekKeys[0];
 const weekEndKey=weekKeys[6];

 const overlapping=eventList.filter(e=>{
  const {startKey,endKey}=getEventRange(e);
  return startKey<=weekEndKey&&endKey>=weekStartKey;
 });

 const eventMetas=overlapping.map(e=>{
  const {startKey,endKey,multiDay}=getEventRange(e);
  const sIdx=weekKeys.indexOf(startKey);
  const startCol=sIdx===-1?0:sIdx;
  const eIdx=weekKeys.indexOf(endKey);
  const endCol=eIdx===-1?6:eIdx;
  return {
   event:e,
   startKey,
   endKey,
   multiDay,
   startCol,
   endCol,
   spanInWeek:endCol-startCol+1
  };
 });

 eventMetas.sort((a,b)=>{
  if(a.multiDay!==b.multiDay)return a.multiDay?-1:1;
  if(a.startCol!==b.startCol)return a.startCol-b.startCol;
  if(b.spanInWeek!==a.spanInWeek)return b.spanInWeek-a.spanInWeek;
  const aAllDay=Number(Boolean(a.event.all_day));
  const bAllDay=Number(Boolean(b.event.all_day));
  if(aAllDay!==bAllDay)return bAllDay-aAllDay;
  if(a.event.start!==b.event.start)return a.event.start.localeCompare(b.event.start);
  return String(a.event.id).localeCompare(String(b.event.id));
 });

 const colSlots=Array.from({length:7},()=>[]);

 for(const meta of eventMetas){
  let slot=0;
  while(true){
   let conflict=false;
   for(let c=meta.startCol;c<=meta.endCol;c++){
    if(colSlots[c][slot]!==undefined&&colSlots[c][slot]!==null){
     conflict=true;
     break;
    }
   }
   if(!conflict)break;
   slot++;
  }

  for(let c=meta.startCol;c<=meta.endCol;c++){
   while(colSlots[c].length<slot){
    colSlots[c].push(null);
   }
   colSlots[c][slot]=meta.event;
  }
 }

 return colSlots;
}

const dateLabel=d=>d.toLocaleDateString(locale==='en'?'en-US':'ko-KR',{month:'long',day:'numeric',weekday:'short'});
const dayNames=Array.from({length:7},(_,i)=>new Date(2026,9,11+i).toLocaleDateString(locale==='en'?'en-US':'ko-KR',{weekday:'short'}));
function formatPeriodTitle(){
 const options={year:'numeric',month:'long'};
 if(viewMode==='month')return month.toLocaleDateString(locale==='en'?'en-US':'ko-KR',options);
 const d=new Date(`${selected}T12:00:00`);
 if(viewMode==='day')return d.toLocaleDateString(locale==='en'?'en-US':'ko-KR',{...options,day:'numeric',weekday:'short'});
 const start=new Date(d);start.setDate(d.getDate()-d.getDay());
 const end=new Date(start);end.setDate(start.getDate()+6);
 return new Intl.DateTimeFormat(locale==='en'?'en-US':'ko-KR',{...options,day:'numeric'}).formatRange(start,end);
}

function syncWithAndroidWidget(){
 if(window.MoaAndroidBridge){
  try{
   if(typeof window.MoaAndroidBridge.syncEventsData==='function'){
    window.MoaAndroidBridge.syncEventsData(
     JSON.stringify(events||[]),
     JSON.stringify(calendars||[])
    );
   }else if(typeof window.MoaAndroidBridge.syncWidget==='function'){
    window.MoaAndroidBridge.syncWidget();
   }
  }catch(e){
   console.warn('Android sync error:',e);
  }
 }
}

function handleWidgetUrlParams(){
 const params=new URLSearchParams(location.search);
 const action=params.get('action');
 const date=params.get('date');
 const eventId=params.get('event_id');
 if(action||date||eventId){
  window.handleMoaWidgetAction(action,date,eventId);
  const cleanUrl=new URL(location.href);
  cleanUrl.searchParams.delete('action');
  cleanUrl.searchParams.delete('date');
  cleanUrl.searchParams.delete('event_id');
  history.replaceState({},'',cleanUrl.pathname+(cleanUrl.search?cleanUrl.search:'')+cleanUrl.hash);
 }
}

window.handleMoaWidgetAction=function(action,date,eventId){
 if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date)){
  selected=date;
  currentDate=new Date(`${date}T00:00:00`);
  renderCalendar();
 }
 if(action==='new_event'||action==='new-event'){
  const targetDate=date||selected||new Date().toISOString().slice(0,10);
  setTimeout(()=>{
   openEvent(null,`${targetDate}T09:00`,`${targetDate}T10:00`);
  },80);
 }else if(eventId){
  const found=(events||[]).find(e=>e.id===eventId);
  if(found){
   setTimeout(()=>{
    openEvent(found);
   },80);
  }
 }
};

let browserReminderTimers=[];
document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleBrowserReminders();});
setInterval(scheduleBrowserReminders, 60 * 60 * 1000);
function scheduleBrowserReminders(){
 syncWithAndroidWidget();
 browserReminderTimers.forEach(timer=>clearTimeout(timer)); browserReminderTimers=[];
 if(!('Notification' in window)||Notification.permission!=='granted')return;
 const now=Date.now();
 for(const ev of events){if(!ev.reminder_enabled||ev.is_cancelled)continue;
  const start=new Date(`${ev.start}:00`).getTime(), due=start-Number(ev.reminder_minutes||10)*60000, delay=due-now;
  if(delay<0||delay>2147480000)continue;
  browserReminderTimers.push(setTimeout(()=>{
   if(Notification.permission==='granted'){
    const n=new Notification(ev.title,{body:'일정이 곧 시작돼요.',tag:`event-${ev.id}`,icon:'/icons/icon-192.png'});
    n.onclick=()=>{window.focus();};
   }
  },delay));
 }
}

function urlBase64ToUint8Array(base64String) {
 const padding = '='.repeat((4 - base64String.length % 4) % 4);
 const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
 const rawData = window.atob(base64);
 const outputArray = new Uint8Array(rawData.length);
 for (let i = 0; i < rawData.length; ++i) {
  outputArray[i] = rawData.charCodeAt(i);
 }
 return outputArray;
}

let swRegistration = null;
async function registerServiceWorker() {
 if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
 try {
  swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return swRegistration;
 } catch (err) {
  console.warn('Service Worker registration failed:', err);
  return null;
 }
}

async function getPushSubscription() {
 if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
 try {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
 } catch {
  return null;
 }
}

async function subscribeToPush() {
 if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
  throw new Error('이 브라우저는 웹 푸시 알림을 지원하지 않습니다.');
 }
 const perm = await Notification.requestPermission();
 if (perm !== 'granted') {
  throw new Error('브라우저 알림 권한이 허용되지 않았습니다.');
 }
 const reg = await navigator.serviceWorker.ready;
 let sub = await reg.pushManager.getSubscription();
 if (!sub) {
  const res = await api('/api/push/vapid-public-key');
  if (!res?.publicKey) throw new Error('푸시 공개 키를 가져오지 못했습니다.');
  sub = await reg.pushManager.subscribe({
   userVisibleOnly: true,
   applicationServerKey: urlBase64ToUint8Array(res.publicKey)
  });
 }
 await api('/api/push/subscribe', 'POST', { subscription: sub });
 return sub;
}

async function unsubscribeFromPush() {
 const sub = await getPushSubscription();
 if (sub) {
  await api('/api/push/unsubscribe', 'POST', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
 }
}

async function updatePushSettingsUI() {
 const card = $('#push-settings-card');
 if (!card) return;
 const toggle = $('#push-notification-toggle');
 const statusText = $('#push-status-text');
 const testAction = $('#push-test-action');
 const iosHint = $('#push-ios-hint');

 const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
 const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

 if (isIOS && !isStandalone && iosHint) {
  iosHint.hidden = false;
 }

 if (window.MoaAndroidBridge) {
  if (toggle) { toggle.checked = true; toggle.disabled = true; }
  if (statusText) statusText.textContent = '안드로이드 앱 전용 알림 매니저로 보호받고 있어요.';
  if (testAction) testAction.hidden = true;
  return;
 }

 if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
  if (toggle) { toggle.checked = false; toggle.disabled = true; }
  if (statusText) statusText.textContent = '이 환경은 웹 푸시를 지원하지 않아요.';
  if (testAction) testAction.hidden = true;
  return;
 }

 if (Notification.permission === 'denied') {
  if (toggle) { toggle.checked = false; toggle.disabled = false; }
  if (statusText) statusText.textContent = '브라우저 설정에서 알림이 차단되어 있어요.';
  if (testAction) testAction.hidden = true;
  return;
 }

 const sub = await getPushSubscription();
 if (sub) {
  if (toggle) { toggle.checked = true; toggle.disabled = false; }
  if (statusText) statusText.textContent = '백그라운드 푸시 알림이 활성화되어 있어요.';
  if (testAction) testAction.hidden = false;
 } else {
  if (toggle) { toggle.checked = false; toggle.disabled = false; }
  if (statusText) statusText.textContent = '스위치를 켜서 브라우저가 꺼져도 알림을 받아보세요.';
  if (testAction) testAction.hidden = true;
 }
}

function initializePushSettings() {
 const toggle = $('#push-notification-toggle');
 if (toggle) {
  toggle.onchange = async () => {
   const want = toggle.checked;
   toggle.disabled = true;
   try {
    if (want) {
     await subscribeToPush();
     toast('웹 푸시 알림을 켰어요.');
    } else {
     await unsubscribeFromPush();
     toast('웹 푸시 알림을 껐어요.');
    }
   } catch (e) {
    toast(e.message);
   } finally {
    toggle.disabled = false;
    await updatePushSettingsUI();
   }
  };
 }

 const testBtn = $('#push-test-btn');
 if (testBtn) {
  testBtn.onclick = async () => {
   testBtn.disabled = true;
   const resSpan = $('#push-test-result');
   if (resSpan) resSpan.textContent = '전송 중…';
   try {
    const res = await api('/api/push/test', 'POST', {});
    if (resSpan) resSpan.textContent = res.sentCount > 0 ? '테스트 알림을 보냈어요!' : '구독 정보를 찾지 못했어요.';
    toast('테스트 푸시 알림을 발송했어요.');
   } catch (e) {
    if (resSpan) resSpan.textContent = '전송 실패';
    toast(e.message);
   } finally {
    testBtn.disabled = false;
   }
  };
 }
}

function setMobileSearchOpen(open){
 $('#calendar-search').classList.toggle('is-open',open);
 $('#mobile-search-trigger').setAttribute('aria-expanded',String(open));
 const input=$('#event-search');
 if(open)input.focus({preventScroll:true});
 else{input.blur();input.value='';renderEventSearch();}
}

function renderEventSearch(){
 const input=$('#event-search'), box=$('#event-search-results'); if(!input||!box)return;
 const query=input.value.trim().toLocaleLowerCase(locale==='en'?'en-US':'ko-KR');
 if(!query){box.hidden=true;box.innerHTML='';return;}
 const matches=[...events,...monthlyItems].filter(e=>`${e.title||''} ${e.category||''}`.toLocaleLowerCase(locale==='en'?'en-US':'ko-KR').includes(query)).slice(0,12);
 box.innerHTML=matches.length?matches.map(e=>e.month?`<button type="button" class="event-search-result" data-search-monthly="${esc(e.id)}"><strong>${esc(e.title)}</strong><span>${e.is_todo?'To Do':'월간 일정'} · ${esc(e.month)}</span></button>`:`<button type="button" class="event-search-result" data-search-event="${esc(e.id)}"><strong>${esc(e.title)}</strong><span>${esc(e.category||'카테고리 없음')} · ${esc(e.start.slice(0,10))}</span></button>`).join(''):'<p class="event-search-empty">검색 결과가 없어요.</p>';
 box.hidden=false;
}

function visibleMonth(){return viewMode==='month'?dateKey(month).slice(0,7):selected.slice(0,7);}

function renderMonthlyItems(){
 const section=$('#monthly-items');if(!section)return;
 section.hidden=!current;if(!current)return;
 const items=monthlyItems.filter(item=>item.month===visibleMonth()&&selectedCalendarIds.has(item.calendar_id)).sort((a,b)=>Number(a.completed)-Number(b.completed));
 const count=items.length;
 const badgeHtml=count>0?`<span class="monthly-badge">${count}</span>`:'';
 section.classList.toggle('collapsed',monthlyCollapsed);
 section.innerHTML=`<div class="monthly-items-header">
  <button type="button" class="monthly-toggle-btn" id="monthly-toggle-btn" aria-expanded="${!monthlyCollapsed}" aria-label="${monthlyCollapsed?'이달의 일정 펼치기':'이달의 일정 접기'}">
   <span class="monthly-toggle-icon" aria-hidden="true">${monthlyCollapsed?'▸':'▾'}</span>
   <h3 id="monthly-items-heading">이달의 일정</h3>
   ${badgeHtml}
  </button>
  <button type="button" id="add-monthly-item" class="monthly-add" ${!defaultCalendar()?'disabled':''} title="월간 항목 추가"><span aria-hidden="true">＋</span> 추가</button>
 </div>
 <div class="monthly-items-body" id="monthly-items-body" ${monthlyCollapsed?'hidden':''}>
  <p class="monthly-items-hint">날짜 없이 이달의 일정과 To Do를 모아보세요.</p>
  ${monthlyLoadError?'<p class="monthly-load-error" role="status">월간 항목을 불러오지 못했어요. <button type="button" id="retry-monthly-items">다시 시도</button></p>':''}
  <div class="monthly-items-list">${count?items.map(item=>{
   const cal=calendars.find(c=>c.id===item.calendar_id),readonly=calendarIsReadOnly(cal);
   return `<div class="monthly-item ${item.completed?'completed':''}">
    ${item.is_todo?`<label class="monthly-check"><input type="checkbox" data-monthly-check="${esc(item.id)}" aria-label="${esc(item.title)} — ${item.completed?'완료됨':'미완료'}" ${item.completed?'checked':''} ${readonly||monthlyChecking.has(item.id)?'disabled':''}></label>`:`<span class="monthly-event-marker" aria-hidden="true">•</span>`}
    <button type="button" class="monthly-item-detail" data-monthly-item="${esc(item.id)}"><span class="monthly-item-title">${esc(item.title)}</span><span class="monthly-item-calendar"><span class="dot calendar-color-dot ${esc(getCalendarColor(cal))}" aria-hidden="true"></span>${esc(cal?.name||'')}</span></button>
   </div>`;
  }).join(''):`<p class="monthly-items-empty">${monthlyLoading?'불러오는 중…':monthlyLoadError?'':selectedCalendarIds.size?'아직 등록된 월간 항목이 없어요.':'표시할 캘린더를 선택해 주세요.'}</p>`}</div>
 </div>`;
 $('#monthly-toggle-btn').onclick=()=>{
  monthlyCollapsed=!monthlyCollapsed;
  renderMonthlyItems();
 };
 $('#add-monthly-item').onclick=()=>openMonthlyItem();
 if($('#retry-monthly-items'))$('#retry-monthly-items').onclick=async()=>{await loadAllSelectedEvents();renderCalendar();};
 section.querySelectorAll('[data-monthly-item]').forEach(button=>button.onclick=()=>openMonthlyItem(monthlyItems.find(item=>item.id===button.dataset.monthlyItem)));
 section.querySelectorAll('[data-monthly-check]').forEach(input=>input.onchange=()=>toggleMonthlyItem(input));
}

async function toggleMonthlyItem(input){
 const item=monthlyItems.find(item=>item.id===input.dataset.monthlyCheck);
 if(!item||monthlyChecking.has(item.id))return;
 monthlyChecking.add(item.id);input.disabled=true;
 try{
  const saved=await api(`/api/calendars/${item.calendar_id}/monthly-items/${item.id}`,'PATCH',{version:item.version,completed:input.checked});
  const index=monthlyItems.findIndex(row=>row.id===item.id);
  if(index!==-1&&monthlyItems[index].version<=saved.version)monthlyItems[index]=saved;
 }catch(error){toast(error.message);await loadAllSelectedEvents();}
 finally{monthlyChecking.delete(item.id);renderMonthlyItems();}
}

function setMonthlyItemMode(editable){
 const form=$('#monthly-item-form'),canEdit=!calendarIsReadOnly(editingMonthlyItem?calendars.find(cal=>cal.id===editingMonthlyItem.calendar_id):defaultCalendar());
 const editing=editable&&canEdit;
 for(const field of form.querySelectorAll('input,textarea,select'))field.disabled=!editing;
 form.elements.calendar_id.disabled=!editing||Boolean(editingMonthlyItem);
 $('#monthly-item-heading').textContent=editing?(editingMonthlyItem?'월간 항목 수정':'월간 항목 추가'):'월간 항목 보기';
 $('#edit-monthly-item').hidden=editing||!canEdit;
 $('#delete-monthly-item').hidden=!editing||!editingMonthlyItem;
 $('#save-monthly-item').hidden=!editing;
}

function openMonthlyItem(item=null){
 if(monthlySaving)return;
 const form=$('#monthly-item-form');form.reset();
 editingMonthlyItem=item?{...item}:null;
 form.elements.title.value=item?.title||'';
 form.elements.month.value=item?.month||visibleMonth();
 form.elements.notes.value=item?.notes||'';
 form.elements.item_type.value=item?.is_todo?'todo':'event';
 const choices=item?calendars.filter(cal=>cal.id===item.calendar_id):calendars.filter(cal=>!calendarIsReadOnly(cal));
 form.elements.calendar_id.innerHTML=choices.map(cal=>`<option value="${esc(cal.id)}">${esc(cal.name)}</option>`).join('');
 form.querySelector('.form-error').textContent='';
 setMonthlyItemMode(!item);
 $('#monthly-item-dialog').showModal();
 if(!item)form.elements.title.focus({preventScroll:true});
}

$('#edit-monthly-item').onclick=()=>{setMonthlyItemMode(true);$('#monthly-item-form').elements.title.focus();};
$('#monthly-item-form').onsubmit=async event=>{
 event.preventDefault();if(monthlySaving)return;
 const form=event.currentTarget,calendarId=editingMonthlyItem?.calendar_id||form.elements.calendar_id.value;
 if(!calendarId)return;
 const data={title:form.elements.title.value,month:form.elements.month.value,notes:form.elements.notes.value,is_todo:form.elements.item_type.value==='todo',...(editingMonthlyItem?{version:editingMonthlyItem.version}:{})};
 monthlySaving=true;$('#save-monthly-item').disabled=true;$('#delete-monthly-item').disabled=true;
 form.querySelector('.form-error').textContent='';
 try{
  await api(`/api/calendars/${calendarId}/monthly-items${editingMonthlyItem?`/${editingMonthlyItem.id}`:''}`,editingMonthlyItem?'PUT':'POST',data);
  $('#monthly-item-dialog').close();
  selectedCalendarIds.add(calendarId);saveSelectedCalendars();
  month=new Date(`${data.month}-01T12:00:00`);
  if(selected.slice(0,7)!==data.month)selected=`${data.month}-01`;
  renderCalendarListUI();syncCalendarStreams();
  await loadAllSelectedEvents();renderCalendar();toast('월간 항목을 저장했어요.');
 }catch(error){form.querySelector('.form-error').textContent=error.message;}
 finally{monthlySaving=false;$('#save-monthly-item').disabled=false;$('#delete-monthly-item').disabled=false;}
};
$('#delete-monthly-item').onclick=async()=>{
 if(!editingMonthlyItem||monthlySaving||!confirm(tr('이 월간 항목을 삭제할까요?')))return;
 const item={...editingMonthlyItem};monthlySaving=true;$('#delete-monthly-item').disabled=true;$('#save-monthly-item').disabled=true;
 try{
  await api(`/api/calendars/${item.calendar_id}/monthly-items/${item.id}`,'DELETE',{version:item.version});
  $('#monthly-item-dialog').close();await loadAllSelectedEvents();renderCalendar();toast('월간 항목을 삭제했어요.');
 }catch(error){$('#monthly-item-form .form-error').textContent=error.message;}
 finally{monthlySaving=false;$('#delete-monthly-item').disabled=false;$('#save-monthly-item').disabled=false;}
};

let dragDdayId=null;
function getSavedDdayOrder(){
 try{
  const parsed=JSON.parse(localStorage.getItem('moa_dday_order'));
  return Array.isArray(parsed)?parsed:[];
 }catch{
  return [];
 }
}
function saveDdayOrder(ids){
 try{localStorage.setItem('moa_dday_order',JSON.stringify(ids));}catch{}
}
function renderDdayWidgets(){
 const bar=$('#dday-widget-bar');
 if(!bar)return;
 const ddayEvents=events.filter(e=>Boolean(e.is_dday));
 if(!current||!ddayEvents.length){
  bar.hidden=true;
  bar.innerHTML='';
  return;
 }
 const today=dateKey(new Date());
 const sorted=sortDdayEvents(ddayEvents,getSavedDdayOrder());
 const canReorder=sorted.length>1;
 bar.hidden=false;
 bar.innerHTML=sorted.map((ev,idx)=>{
  const label=formatDdayLabel(ev.start,today);
  const diff=calculateDdayDiff(ev.start,today);
  const stateClass=diff===0?'is-dday-today':diff<0?'is-dday-past':'is-dday-upcoming';
  const color=esc(ev.color||'sage');
  const dateStr=esc(ev.start.slice(0,10));
  const cancelledClass=ev.is_cancelled?'is-cancelled':'';
  return `<div class="dday-widget ${color} ${stateClass} ${cancelledClass}" draggable="${canReorder}" data-dday-widget="${esc(ev.id)}">
   ${canReorder?`<button type="button" class="dday-move-btn" data-dday-move="${esc(ev.id)}" data-dday-step="-1" aria-label="${esc(ev.title)} 앞으로 이동" title="${locale==='en'?'Move left':'앞으로 이동'}" ${idx===0?'disabled':''}>‹</button>`:''}
   <button type="button" class="dday-widget-main" data-dday-open="${esc(ev.id)}" title="${esc(ev.title)} (${dateStr})">
    <span class="dday-badge">${esc(label)}</span>
    <span class="dday-title">${esc(ev.title)}</span>
   </button>
   ${canReorder?`<button type="button" class="dday-move-btn" data-dday-move="${esc(ev.id)}" data-dday-step="1" aria-label="${esc(ev.title)} 뒤로 이동" title="${locale==='en'?'Move right':'뒤로 이동'}" ${idx===sorted.length-1?'disabled':''}>›</button>`:''}
  </div>`;
 }).join('');
 bar.querySelectorAll('[data-dday-move]').forEach(btn=>{
  btn.onclick=e=>{
   e.stopPropagation();
   const nextOrder=moveDdayOrder(ddayEvents,getSavedDdayOrder(),btn.dataset.ddayMove,Number(btn.dataset.ddayStep));
   saveDdayOrder(nextOrder);
   renderDdayWidgets();
  };
 });
 bar.querySelectorAll('[data-dday-open]').forEach(btn=>{
  btn.onclick=e=>{
   e.stopPropagation();
   const ev=events.find(item=>item.id===btn.dataset.ddayOpen);
   if(!ev)return;
   selected=ev.start.slice(0,10);
   month=new Date(`${selected}T12:00:00`);
   renderCalendar();
   openEvent(ev,null,null,btn);
  };
 });
 if(canReorder){
  bar.querySelectorAll('[data-dday-widget]').forEach(card=>{
   card.ondragstart=e=>{
    dragDdayId=card.dataset.ddayWidget;
    card.classList.add('is-dragging');
    if(e.dataTransfer){
     e.dataTransfer.effectAllowed='move';
     try{e.dataTransfer.setData('text/plain',dragDdayId);}catch{}
    }
   };
   card.ondragend=()=>{
    dragDdayId=null;
    bar.querySelectorAll('.dday-widget').forEach(el=>el.classList.remove('is-dragging','drag-over'));
   };
   card.ondragover=e=>{
    if(!dragDdayId||dragDdayId===card.dataset.ddayWidget)return;
    e.preventDefault();
    if(e.dataTransfer)e.dataTransfer.dropEffect='move';
    card.classList.add('drag-over');
   };
   card.ondragleave=()=>{
    card.classList.remove('drag-over');
   };
   card.ondrop=e=>{
    e.preventDefault();
    card.classList.remove('drag-over');
    if(!dragDdayId||dragDdayId===card.dataset.ddayWidget)return;
    const nextOrder=moveDdayOrder(ddayEvents,getSavedDdayOrder(),dragDdayId,card.dataset.ddayWidget);
    dragDdayId=null;
    saveDdayOrder(nextOrder);
    renderDdayWidgets();
   };
  });
 }
}

function renderCalendar(){
 if(!$('#calendar'))return;
 const curMonthKey=visibleMonth();
 $('#month-title').innerHTML=`${esc(formatPeriodTitle())}${monthNoteMarker(curMonthKey)}`;
 $('#month-title').onclick=()=>{
  const section=$('#month-note-section');
  if(section){
   if(sidebarCollapsed&&updateSidebarState)updateSidebarState(false);
   section.scrollIntoView({behavior:'smooth',block:'nearest'});
   const input=$('#month-note-input');
   if(input&&!input.readOnly)input.focus();
  }
 };
 $('#workspace-root').dataset.currentView=viewMode;
 $('#workspace-root').dataset.hasCalendar=String(Boolean(current));
 document.querySelectorAll('.mobile-bottom-nav [data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===viewMode)));
 renderMonthlyItems();
 renderDdayWidgets();

 if(!current){
  $('#calendar').innerHTML=`<div class="empty-calendar">${emptyIcon}<h2>함께할 시간을 모아볼까요?</h2><p>첫 캘린더를 만들고 소중한 사람을 초대하세요.</p><button class="primary" id="first-calendar">첫 캘린더 만들기</button></div>`;
  $('#first-calendar').onclick=()=>$('#create-dialog').showModal();
 } else {
  if(viewMode==='month') renderMonthView();
  else if(viewMode==='week') renderWeekView();
  else renderDayView();

  attachEventInteractions();
 }

 renderSelectedDate();
 renderPresence();
 renderMobileMenu();
}

function renderAgendaItem(e){
 const eventColor=esc(e.color||'sage');
 return `<button class="agenda-item ${eventColor} ${e.is_todo?'is-todo has-todo':''} ${e.completed?'is-completed':''} ${e.is_cancelled?'is-cancelled':''}" data-agenda="${esc(e.id)}"><div class="todo-detail-line">${renderTodoCheck(e,'agenda-todo-check')}<strong>${esc(e.title)}</strong></div></button>`;
}

function renderSelectedDate(){
 const d=new Date(`${selected}T12:00:00`);
 const holiday=getHoliday(selected);
 const holidayBadge=holiday?` <span class="agenda-holiday-badge">${esc(holiday)}</span>`:'';
 $('#agenda-date').innerHTML=`${esc(dateLabel(d))}${holidayBadge}${renderWeatherBadge(selected,'agenda')}${renderLunarLabel(selected,'agenda')}`;
 const items=dayEvents(selected);
 $('#agenda-count').textContent=`${items.length}개의 일정이 있어요`;
 $('#mobile-agenda-summary').textContent=`${dateLabel(d)}${holiday?` (${holiday})`:''} · ${items.length} ${locale==='en'?'events':'개 일정'}`;
 $('#agenda-list').innerHTML=items.length?items.map(renderAgendaItem).join(''):`<div class="empty-agenda">${emptyIcon}<p>아직 일정이 없어요.<br>새로운 약속을 더해보세요.</p></div>`;
 document.querySelectorAll('[data-agenda]').forEach(b=>b.onclick=e=>{
  if(e.target.closest('[data-todo-check]'))return;
  openEvent(events.find(ev=>ev.id===b.dataset.agenda), null, null, b);
 });
 document.querySelectorAll('#agenda-list [data-todo-check]').forEach(cb=>{
  cb.onclick=e=>toggleEventCompleted(cb.dataset.todoCheck, e);
 });
 $('#new-event').disabled=!defaultCalendar();
 $('#mobile-create-event').hidden=!defaultCalendar();
 $('#agenda-add').disabled=!defaultCalendar();
 renderDateNote();
 renderMonthNote();
 renderGeneralNote();
}

function renderMobileMenu(){
 renderMobileMenuCalendars();
 document.querySelectorAll('[data-more-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.moreView===viewMode)));
 $('#mobile-more-dialog [data-mobile-action=share]').disabled=!current||current.role!=='owner';
 $('#mobile-more-dialog [data-mobile-action=sessions]').disabled=!current;
 $('#mobile-more-dialog [data-mobile-action=manage]').disabled=!current;
 renderMobileProfile();
}

function renderWeatherBadge(date,kind='month'){
 if(!isWeatherEnabled())return '';
 const entry=weatherForecast[date];
 if(!entry)return '';
 return renderWeatherBadgeHtml(entry,kind,locale);
}

function updateCalendarFooter(){
 const footer=$('.calendar-footer span');
 if(footer)footer.textContent=getCalendarFooterText();
}

async function loadWeatherForecast(loc=getSavedWeatherLocation()){
 weatherLocation=loc;
 updateCalendarFooter();
 updateWeatherSettingsUI();
 if(!isWeatherEnabled()){renderCalendar();return;}
 const reqId=++weatherRequest;
 try{
  const params=new URLSearchParams({lat:String(loc.latitude),lon:String(loc.longitude),timezone:loc.timezone||'Asia/Seoul'});
  let data;
  try{
   data=await api(`/api/weather?${params.toString()}`);
  }catch{
   const res=await fetch(buildOpenMeteoForecastUrl(loc));
   if(res.ok)data=await res.json();
  }
  if(reqId!==weatherRequest)return;
  weatherForecast=parseOpenMeteoDaily(data?.daily,data?.hourly);
  renderCalendar();
  updateWeatherSettingsUI();
 }catch(err){
  console.warn('Weather load error:',err);
 }
}

function updateWeatherSettingsUI(){
 const enabled=isWeatherEnabled();
 const loc=getSavedWeatherLocation();
 weatherLocation=loc;
 for(const toggle of [$('#weather-display-toggle'),$('#profile-weather-display-toggle')].filter(Boolean)){
  toggle.checked=enabled;
 }
 const controls=$('#weather-location-controls');
 if(controls)controls.hidden=!enabled;
 const select=$('#weather-location-select');
 if(select){
  const isPreset=WEATHER_PRESET_LOCATIONS.some(p=>p.id===loc.id);
  const options=WEATHER_PRESET_LOCATIONS.map(p=>`<option value="${esc(p.id)}" ${p.id===loc.id?'selected':''}>${esc(locale==='en'?p.nameEn:p.name)}${p.country&&p.country!=='대한민국'?` (${esc(p.country)})`:''}</option>`);
  if(!isPreset){
   options.unshift(`<option value="${esc(loc.id)}" selected>${esc(getWeatherLocationDisplayName(loc,locale))}</option>`);
  }
  select.innerHTML=options.join('');
 }
 const displayName=getWeatherLocationDisplayName(loc,locale);
 const status=$('#weather-location-status');
 if(status){
  status.textContent=locale==='en'
   ?`Active location: ${displayName} (${Number(loc.latitude).toFixed(2)}°, ${Number(loc.longitude).toFixed(2)}°) · Source: Open-Meteo`
   :`현재 설정된 위치: ${displayName} (${Number(loc.latitude).toFixed(2)}°, ${Number(loc.longitude).toFixed(2)}°) · 데이터 출처: Open-Meteo`;
 }
 const profileSummary=$('#profile-weather-location-summary');
 if(profileSummary){
  profileSummary.textContent=locale==='en'?`Weather location: ${displayName}`:`날씨 위치: ${displayName}`;
 }
 updateCalendarFooter();
}

function initializeWeatherSettings(){
 const toggles=[$('#weather-display-toggle'),$('#profile-weather-display-toggle')].filter(Boolean);
 for(const toggle of toggles){
  toggle.checked=isWeatherEnabled();
  toggle.onchange=()=>{
   setWeatherEnabled(toggle.checked);
   updateWeatherSettingsUI();
   if(toggle.checked)loadWeatherForecast();
   else renderCalendar();
  };
 }
 const select=$('#weather-location-select');
 if(select){
  select.onchange=()=>{
   const chosen=WEATHER_PRESET_LOCATIONS.find(p=>p.id===select.value);
   if(!chosen)return;
   const saved=saveWeatherLocation(chosen);
   const results=$('#weather-location-results');
   if(results){results.hidden=true;results.innerHTML='';}
   toast(locale==='en'?`Weather location set to ${saved.nameEn}.`:`날씨 위치를 ‘${saved.name}’(으)로 설정했어요.`);
   loadWeatherForecast(saved);
  };
 }
 const queryInput=$('#weather-location-query');
 const searchBtn=$('#weather-location-search-btn');
 const resultsBox=$('#weather-location-results');
 let searchResults=[];
 const runSearch=async()=>{
  const q=queryInput?.value.trim()||'';
  if(!q){
   if(resultsBox){resultsBox.hidden=true;resultsBox.innerHTML='';}
   return;
  }
  if(searchBtn)searchBtn.disabled=true;
  if(resultsBox){
   resultsBox.hidden=false;
   resultsBox.innerHTML=`<p class="muted small weather-search-msg">${locale==='en'?'Searching locations…':'위치를 검색하는 중…'}</p>`;
  }
  try{
   let list=[];
   try{
    const res=await api(`/api/weather/locations?q=${encodeURIComponent(q)}&lang=${locale}`);
    list=res.results||[];
   }catch{
    const res=await fetch(buildOpenMeteoGeocodingUrl(q,locale));
    if(res.ok){
     const raw=await res.json();
     list=(raw.results||[]).map(item=>({
      id:`geo:${item.id||`${Number(item.latitude).toFixed(4)},${Number(item.longitude).toFixed(4)}`}`,
      name:String(item.name||'').trim(),
      nameEn:String(item.name||'').trim(),
      admin1:String(item.admin1||'').trim(),
      country:String(item.country||'').trim(),
      latitude:Number(Number(item.latitude).toFixed(4)),
      longitude:Number(Number(item.longitude).toFixed(4)),
      timezone:String(item.timezone||'Asia/Seoul')
     }));
    }
   }
   searchResults=list;
   if(!resultsBox)return;
   if(!list.length){
    resultsBox.innerHTML=`<p class="muted small weather-search-msg">${locale==='en'?'No matching locations found.':'검색 결과가 없어요. 다른 도시 이름으로 검색해 보세요.'}</p>`;
    return;
   }
   resultsBox.innerHTML=list.map((item,idx)=>{
    const sub=[item.admin1,item.country].filter(Boolean).join(' · ');
    return `<button type="button" class="weather-location-result-btn" data-weather-loc-idx="${idx}"><strong>${esc(locale==='en'?(item.nameEn||item.name):item.name)}</strong>${sub?`<span>${esc(sub)}</span>`:''}</button>`;
   }).join('');
  }catch(err){
   if(resultsBox)resultsBox.innerHTML=`<p class="form-error small">${esc(err.message)}</p>`;
  }finally{
   if(searchBtn)searchBtn.disabled=false;
  }
 };
 if(searchBtn)searchBtn.onclick=runSearch;
 if(queryInput){
  queryInput.onkeydown=e=>{
   if(e.key==='Enter'){e.preventDefault();runSearch();}
  };
 }
 if(resultsBox){
  resultsBox.onclick=e=>{
   const btn=e.target.closest('[data-weather-loc-idx]');
   if(!btn)return;
   const chosen=searchResults[Number(btn.dataset.weatherLocIdx)];
   if(!chosen)return;
   const saved=saveWeatherLocation(chosen);
   resultsBox.hidden=true;
   resultsBox.innerHTML='';
   if(queryInput)queryInput.value='';
   toast(locale==='en'?`Weather location set to ${getWeatherLocationDisplayName(saved,'en')}.`:`날씨 위치를 ‘${getWeatherLocationDisplayName(saved,'ko')}’(으)로 설정했어요.`);
   loadWeatherForecast(saved);
  };
 }
 const geoBtn=$('#weather-geolocate-btn');
 if(geoBtn){
  geoBtn.onclick=()=>{
   if(!('geolocation' in navigator)){
    toast(locale==='en'?'Geolocation is not supported by this browser.':'이 브라우저에서는 현재 위치 기능을 지원하지 않아요.');
    return;
   }
   geoBtn.disabled=true;
   navigator.geolocation.getCurrentPosition(pos=>{
    geoBtn.disabled=false;
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Seoul';
    const saved=saveWeatherLocation({
     id:'gps',
     name:'현재 위치',
     nameEn:'Current location',
     latitude:pos.coords.latitude,
     longitude:pos.coords.longitude,
     timezone:tz
    });
    toast(locale==='en'?'Weather location updated to your current location.':'현재 위치로 날씨 설정을 변경했어요.');
    loadWeatherForecast(saved);
   },()=>{
    geoBtn.disabled=false;
    toast(locale==='en'?'Could not access your current location. Please check browser permissions.':'현재 위치를 가져올 수 없어요. 위치 권한을 확인하거나 도시를 검색해 주세요.');
   },{enableHighAccuracy:false,timeout:8000,maximumAge:300000});
  };
 }
 updateWeatherSettingsUI();
 const hourlyDialog=$('#weather-hourly-dialog');
 if(hourlyDialog&&!('closedBy' in HTMLDialogElement.prototype)){
  hourlyDialog.addEventListener('click',event=>{
   if(event.target!==hourlyDialog)return;
   const rect=hourlyDialog.getBoundingClientRect();
   const isDialogContent=rect.top<=event.clientY&&event.clientY<=rect.top+rect.height&&rect.left<=event.clientX&&event.clientX<=rect.left+rect.width;
   if(isDialogContent)return;
   hourlyDialog.close();
  });
 }
 document.addEventListener('click',e=>{
  const badge=e.target.closest('[data-weather-date]');
  if(!badge)return;
  e.stopPropagation();
  openWeatherHourlyDialog(badge.dataset.weatherDate);
 });
}

function openWeatherHourlyDialog(date){
 const entry=weatherForecast[date];
 const dialog=$('#weather-hourly-dialog');
 if(!entry||!dialog)return;
 const d=new Date(`${date}T12:00:00`);
 const locName=getWeatherLocationDisplayName(weatherLocation,locale);
 const locEl=$('#weather-hourly-location');
 if(locEl)locEl.textContent=locName;
 const titleEl=$('#weather-hourly-title');
 if(titleEl)titleEl.textContent=locale==='en'?`${dateLabel(d)} · Hourly Forecast`:`${dateLabel(d)} 시간대별 날씨`;
 const summaryEl=$('#weather-daily-summary');
 if(summaryEl){
  const condText=locale==='en'?(entry.labelEn||entry.label):entry.label;
  const probPart=entry.rainProbability!==null&&entry.rainProbability!==undefined&&(entry.showRainProbability||entry.rainProbability>0)
   ?`<span class="weather-summary-prob">💧 ${locale==='en'?`Rain ${entry.rainProbability}%`:`강수확률 ${entry.rainProbability}%`}</span>`
   :'';
  const tempPart=entry.tempMin!==null&&entry.tempMax!==null
   ?`<span class="weather-summary-temp">${locale==='en'?`Low ${entry.tempMin}° / High ${entry.tempMax}°`:`최저 ${entry.tempMin}° / 최고 ${entry.tempMax}°`}</span>`
   :'';
  summaryEl.innerHTML=`<div class="weather-summary-main"><span class="weather-summary-emoji" aria-hidden="true">${entry.emoji}</span><strong>${esc(condText)}</strong></div><div class="weather-summary-meta">${probPart}${tempPart}</div>`;
 }
 const now=new Date();
 const nowHourKey=`${dateKey(now)}T${String(now.getHours()).padStart(2,'0')}:00`;
 const listEl=$('#weather-hourly-list');
 if(listEl){
  listEl.innerHTML=renderHourlyWeatherItemsHtml(entry,locale,nowHourKey);
 }
 dialog.showModal();
 const activeRow=listEl?.querySelector('.is-now');
 if(activeRow&&typeof activeRow.scrollIntoView==='function'){
  activeRow.scrollIntoView({block:'center'});
 }else if(listEl){
  listEl.scrollTop=0;
 }
}

function lunarDatesEnabled(){
 try{return getActiveRegion()==='KR'&&localStorage.getItem('moa_lunar_dates')!=='false';}
 catch{return getActiveRegion()==='KR';}
}
function renderLunarLabel(date,kind='day'){
 if(!lunarDatesEnabled())return '';
 const compact=kind==='month'||kind==='week',text=formatKoreanLunarDate(date,locale,compact);
 if(!text)return '';
 return `<span class="lunar-date lunar-date-${kind}" title="${esc(formatKoreanLunarDate(date,locale))}">${esc(text)}</span>`;
}
function initializeLunarSettings(){
 const toggles=[$('#lunar-display-toggle'),$('#profile-lunar-display-toggle')].filter(Boolean);
 for(const toggle of toggles){
  toggle.checked=lunarDatesEnabled();toggle.disabled=getActiveRegion()!=='KR';
  toggle.onchange=()=>{
   try{localStorage.setItem('moa_lunar_dates',String(toggle.checked));}catch{}
   for(const other of toggles)other.checked=toggle.checked;
   renderCalendar();
  };
 }
 if(getActiveRegion()!=='KR'){
  for(const id of ['#lunar-display-description','#profile-lunar-display-description']){
   const description=$(id);if(description)description.textContent=translateMessage('지역을 대한민국으로 설정하면 사용할 수 있어요.');
  }
 }
}

function renderMonthView(){
 const visibleCount=mobileCalendar.matches?4:3;
 const start=new Date(month.getFullYear(),month.getMonth(),1-month.getDay());
 const days=Array.from({length:42},(_,i)=>{
  const d=new Date(start);
  d.setDate(start.getDate()+i);
  const key=dateKey(d);
  return {d,key,items:dayEvents(key),holiday:getHoliday(key)};
 });

 const weekAllocations=[];
 for(let w=0;w<6;w++){
  const weekKeys=days.slice(w*7,w*7+7).map(day=>day.key);
  weekAllocations.push(allocateWeekSlots(weekKeys));
 }

 $('#calendar').innerHTML=`<div class="weekdays">${dayNames.map(d=>`<span>${d}</span>`).join('')}</div><div class="month-grid">${days.map((day,i)=>{
  const {d,key,items,holiday}=day;
  const col=i%7;
  const weekIndex=Math.floor(i/7);
  const daySlots=weekAllocations[weekIndex][col]||[];

  let trimmed=[...daySlots];
  while(trimmed.length>0&&!trimmed[trimmed.length-1])trimmed.pop();

  let visibleSlots=trimmed.slice(0,visibleCount);
  while(visibleSlots.length>0&&!visibleSlots[visibleSlots.length-1])visibleSlots.pop();

  const renderedEvents=visibleSlots.filter(Boolean);
  const hiddenCount=items.length-renderedEvents.length;
  const holidayClass=holiday?'is-holiday':d.getDay()===6?'is-saturday':'';

  return `<div class="day ${d.getMonth()!==month.getMonth()?'outside':''} ${key===selected?'selected':''} ${holidayClass}" data-date-cell="${key}" data-drop-date="${key}">
   <div class="day-header-row">
    <div class="calendar-date-pair">
     <button class="day-number ${key===dateKey(new Date())?'is-today':''}" data-date="${key}" aria-label="${key}${holiday?` (${holiday})`:''} 일정 보기" aria-pressed="${key===selected}">${d.getDate()}${noteDateMarker(key)}</button>
     ${renderWeatherBadge(key,'month')}
    </div>
    <div class="calendar-date-detail">
     ${renderLunarLabel(key,'month')}
     ${holiday?`<span class="day-holiday-name" title="${esc(holiday)}">${esc(holiday)}</span>`:''}
    </div>
   </div>
   <div class="day-events">
     ${visibleSlots.map(e=>e?renderEventPill(e,true,key,{col}):'<div class="event-pill-spacer" aria-hidden="true"></div>').join('')}
     ${hiddenCount>0?`<button class="more-events" data-date="${key}" aria-label="${key}의 모든 일정 보기">+${hiddenCount}개</button>`:''}
   </div>
  </div>`;
 }).join('')}</div>`;
}

function renderWeekView(){
 const selDate=new Date(`${selected}T12:00:00`);
 const dayOfWeek=selDate.getDay();
 const weekStart=new Date(selDate);
 weekStart.setDate(selDate.getDate()-dayOfWeek);

 $('#calendar').innerHTML=`<div class="week-grid">${Array.from({length:7},(_,i)=>{
  const d=new Date(weekStart);
  d.setDate(weekStart.getDate()+i);
  const key=dateKey(d),items=dayEvents(key),holiday=getHoliday(key);
  const isToday=key===dateKey(new Date());
  const holidayClass=holiday?'is-holiday':d.getDay()===6?'is-saturday':'';
  return `<div class="week-col ${key===selected?'is-selected':''} ${holidayClass}" data-date-cell="${key}" data-drop-date="${key}">
   <div class="week-col-header">
     <div class="day-name">${dayNames[i]}</div>
     <div class="calendar-date-pair">
     <button class="day-num ${isToday?'is-today':''}" data-date="${key}" aria-label="${key}${holiday?` (${holiday})`:''} 선택" aria-pressed="${key===selected}">${d.getDate()}${noteDateMarker(key)}</button>
     ${renderWeatherBadge(key,'week')}
     </div>
     <div class="calendar-date-detail">
     ${renderLunarLabel(key,'week')}
     ${holiday?`<div class="week-holiday-name" title="${esc(holiday)}">${esc(holiday)}</div>`:''}
     </div>
   </div>
   <div class="week-col-events">
     ${items.map(e=>renderEventPill(e)).join('')}
   </div>
  </div>`;
 }).join('')}</div>`;
}

function renderDayView(){
 const selDate=new Date(`${selected}T12:00:00`);
 const items=dayEvents(selected);
 const holiday=getHoliday(selected);
 const holidayBadge=holiday?`<span class="agenda-holiday-badge">${esc(holiday)}</span>`:'';

 if(mobileCalendar.matches){
  $('#calendar').innerHTML=`<div class="day-view-container compact-day-view"><div class="day-view-header"><div class="day-view-title">${dateLabel(selDate)}${holidayBadge}${renderWeatherBadge(selected,'day')}${renderLunarLabel(selected,'day')} ${noteDateMarker(selected)} <span class="count">${items.length}개</span></div><button class="icon" id="mobile-day-add" aria-label="선택한 날짜에 일정 추가">＋</button></div><div class="compact-day-events">${items.length?items.map(e=>renderDayEventCard(e,true)).join(''):'<p class="muted small">아직 일정이 없어요. 새 약속을 추가해 보세요.</p>'}</div></div>`;
  $('#mobile-day-add').disabled=!defaultCalendar();
  $('#mobile-day-add').onclick=e=>openEvent(null,null,null,e.currentTarget);
  return;
 }
 const hours=Array.from({length:24},(_,i)=>i);
 $('#calendar').innerHTML=`<div class="day-view-container">
   <div class="day-view-header">
     <div class="day-view-title">${dateLabel(selDate)}${holidayBadge}${renderWeatherBadge(selected,'day')}${renderLunarLabel(selected,'day')} ${noteDateMarker(selected)} 일정 목록</div>
     <span class="count">${items.length}개</span>
   </div>
   <div class="day-all-day-lane" data-drop-date="${selected}"><span class="day-all-day-label">하루 종일</span><div class="day-all-day-events">${items.filter(e=>e.all_day).map(e=>renderEventPill(e)).join('')||'<span class="muted small">일정 없음</span>'}</div></div>
   <div class="day-slots">
     ${hours.map(h=>{
       const hourStr=String(h).padStart(2,'0');
       const slotEvents=items.filter(e=>{
        if(e.all_day)return false;
        const eStartDate=e.start.slice(0,10),eEndDate=e.end.slice(0,10);
        const startH=parseInt(e.start.slice(11,13),10),startM=parseInt(e.start.slice(14,16),10)||0;
        let endH=parseInt(e.end.slice(11,13),10),endM=parseInt(e.end.slice(14,16),10)||0;
        if(isNaN(endH))endH=startH+1;
        const startMin=eStartDate<selected?0:startH*60+startM;
        let endMin=eEndDate>selected?1440:endH*60+endM;
        if(endMin<=startMin)endMin=startMin+60;
        return startMin < (h+1)*60 && endMin > h*60;
       });
       return `<div class="day-slot">
         <div class="day-slot-time">${hourStr}:00</div>
         <div class="day-slot-content" data-drop-date="${selected}" data-drop-hour="${hourStr}" data-slot-hour="${h}">
           ${slotEvents.map(e=>{
             const eStartDate=e.start.slice(0,10),eEndDate=e.end.slice(0,10);
             const startH=parseInt(e.start.slice(11,13),10),startM=parseInt(e.start.slice(14,16),10)||0;
             let endH=parseInt(e.end.slice(11,13),10),endM=parseInt(e.end.slice(14,16),10)||0;
             if(isNaN(endH))endH=startH+1;
             const startMin=eStartDate<selected?0:startH*60+startM;
             let endMin=eEndDate>selected?1440:endH*60+endM;
             if(endMin<=startMin)endMin=startMin+60;
             const isStart=eStartDate===selected?h===Math.floor(startMin/60):h===0;
             const isEnd=eEndDate===selected?h===Math.floor((endMin-1)/60):h===23;
             return renderDayEventCard(e,false,{isStart,isEnd,hour:h});
           }).join('')}
         </div>
       </div>`;
     }).join('')}
   </div>
 </div>`;
}

async function toggleEventCompleted(eventId, e){
 if(e){e.stopPropagation();e.preventDefault();}
 const ev=events.find(item=>item.id===eventId);
 if(!ev)return;
 const calId=ev.calendar_id||current?.id;
 if(!calId)return;
 const cal=calendars.find(c=>c.id===calId);
 if(calendarIsReadOnly(cal))return;
 const next=!ev.completed;
 ev.completed=next; // Optimistic update
 renderCalendar();
 try{
  await api(`/api/calendars/${calId}/events/${ev.id}`,'PUT',{
   ...ev,
   is_todo:true,
   completed:next,
   version:ev.version
  });
 }catch(err){
  ev.completed=!next; // Revert on failure
  renderCalendar();
  toast(err.message);
 }
}

function renderTodoCheck(e, extraClass=""){
 if(!e.is_todo)return "";
 return `<span class="todo-check-btn ${extraClass} ${e.completed?"checked":""}" data-todo-check="${e.id}" role="checkbox" aria-checked="${Boolean(e.completed)}" title="${e.completed?"완료됨":"미완료"}" aria-label="${e.completed?"완료됨":"미완료"}"></span>`;
}

function renderEventPill(e,isMonthView=false,monthKey='',meta={}){
 const isSelected=selectedEvent?.id===e.id;
 const todoClass=e.is_todo?"is-todo":"";
 const completedClass=e.completed?"is-completed":"";
 const cancelledClass=e.is_cancelled?"is-cancelled":"";
 const eventColor=esc(e.color||'sage');
 if(isMonthView){
  const {startKey,endKey,multiDay}=typeof getEventRange==='function'?getEventRange(e):(()=>{
   const sKey=(e.start||'').slice(0,10);
   const eStr=e.end||e.start||'';
   const eKey=/^00:00(?::00(?:\.000)?)?$/.test(eStr.slice(11))?(typeof shiftDate==='function'?shiftDate(eStr.slice(0,10),-1):eStr.slice(0,10)):eStr.slice(0,10);
   const safeEKey=eKey<sKey?sKey:eKey;
   return {startKey:sKey,endKey:safeEKey,multiDay:safeEKey>sKey};
  })();
  const col=meta?.col??-1;
  const isWeekStart=col===0;
  const isWeekEnd=col===6;
  const weekRowClass=multiDay?`${isWeekStart?' week-row-start':''}${isWeekEnd?' week-row-end':''}`:'';
  const segmentClass=multiDay?` multi-day-segment ${monthKey===startKey?'segment-start':monthKey===endKey?'segment-end':'segment-middle'}${weekRowClass}`:'';
  const startTimeKo=e.all_day?'':formatKoreanTime(e.start);
  const showTitle=monthKey===startKey||!multiDay||col===0;
  const showTime=(monthKey===startKey)&&Boolean(startTimeKo);
  return `<button draggable="true" class="event-pill ${eventColor}${segmentClass} ${isSelected?'selected-event':''} ${todoClass} ${completedClass} ${cancelledClass}" data-event="${e.id}" aria-label="${esc(e.title)}" title="${esc(e.title)}${startTimeKo?` (${startTimeKo})`:''}">
   ${showTitle?`${renderTodoCheck(e)}<span class="event-title">${esc(e.title)}</span>${showTime?`<small class="event-pill-time">${startTimeKo}</small>`:''}`:''}
  </button>`;
 }
 return `<button draggable="true" class="event-pill ${eventColor} ${isSelected?'selected-event':''} ${todoClass} ${completedClass} ${cancelledClass}" data-event="${e.id}" aria-label="${esc(e.title)}" title="${esc(e.title)}${e.category?` [${esc(e.category)}]`:''}">
  ${e.category?`<span class="category-badge">${esc(e.category)}</span>`:''}
  ${renderTodoCheck(e)}<span class="event-title">${esc(e.title)}</span>
  <small>${e.all_day?'하루 종일':(e.end&&e.end.slice(11)!==e.start.slice(11)?`${e.start.slice(11)}~${e.end.slice(11)}`:e.start.slice(11))}</small>
 </button>`;
}

function renderDayEventCard(e,compact=false,spanInfo={isStart:true,isEnd:true,hour:0}){
 const isSelected=selectedEvent?.id===e.id;
 const todoClass=e.is_todo?"is-todo":"";
 const completedClass=e.completed?"is-completed":"";
 const cancelledClass=e.is_cancelled?"is-cancelled":"";
 const eventColor=esc(e.color||'sage');
 const {isStart=true,isEnd=true,hour=0}=spanInfo||{};
 const isMultiHour=!isStart||!isEnd;
 const spanClass=isMultiHour?(isStart?'event-span-start':isEnd?'event-span-end':'event-span-middle'):'';
 const hourStr=String(hour).padStart(2,'0');

 if(compact){
  return `<button type="button" class="day-event-card compact-event-card ${eventColor} ${isSelected?'selected-event':''} ${todoClass} ${completedClass} ${cancelledClass}" data-event="${e.id}" title="${esc(e.title)}" aria-label="${esc(e.title)}">
   <div class="day-event-info ${e.is_todo?'todo-day-info':''}">
    ${e.category?`<span class="agenda-category">${esc(e.category)}</span>`:''}
    ${renderTodoCheck(e)}<strong>${esc(e.title)}</strong>
    ${e.is_todo?(e.all_day?'':`<small class="todo-inline-time">${formatKoreanTime(e.start)}</small>`):`<small>${e.start.slice(11)} ~ ${e.end.slice(11)}</small>`}
   </div>
   ${e.notes?`<small class="muted">${esc(e.notes)}</small>`:''}
  </button>`;
 }

 if(!isStart){
  return `<div draggable="false" class="day-event-card ${spanClass} ${eventColor} ${isSelected?'selected-event':''} ${todoClass} ${completedClass} ${cancelledClass}" data-event="${e.id}" title="${esc(e.title)} (${e.start.slice(11)} ~ ${e.end.slice(11)})" aria-label="${esc(e.title)}">
   <div class="day-event-info">
    <span class="event-span-indicator" aria-hidden="true">↳</span>
    <strong>${esc(e.title)}</strong>
    <small class="event-span-status">${isEnd?`(~ ${e.end.slice(11)} 종료)`:`(${hourStr}:00 ~ ${String(hour+1).padStart(2,'0')}:00 진행 중)`}</small>
   </div>
   ${isEnd?`<div class="event-resize-handle" data-resize-event="${e.id}" title="드래그하여 일정 종료 시간 조정"></div>`:''}
  </div>`;
 }

 return `<div draggable="true" class="day-event-card ${spanClass} ${eventColor} ${isSelected?'selected-event':''} ${todoClass} ${completedClass} ${cancelledClass}" data-event="${e.id}" title="${esc(e.title)}" aria-label="${esc(e.title)}">
  <div class="day-event-info ${e.is_todo?'todo-day-info':''}">
   ${e.category?`<span class="agenda-category">${esc(e.category)}</span>`:''}
   ${renderTodoCheck(e)}<strong>${esc(e.title)}</strong>
   ${e.is_todo?(e.all_day?'':`<small class="todo-inline-time">${formatKoreanTime(e.start)}</small>`):`<small class="event-time-range">${e.start.slice(11)} ~ ${e.end.slice(11)}</small>`}
  </div>
  ${e.notes?`<small class="muted">${esc(e.notes)}</small>`:''}
  ${isEnd?`<div class="event-resize-handle" data-resize-event="${e.id}" title="드래그하여 일정 종료 시간 조정"></div>`:''}
 </div>`;
}

function attachEventInteractions(){
 const selectDate=key=>{
  selected=key;
  if(mobileCalendar.matches){renderCalendar();return;}
  document.querySelectorAll('[data-date-cell]').forEach(cell=>{
   cell.classList.toggle('selected',cell.classList.contains('day')&&cell.dataset.dateCell===key);
   cell.classList.toggle('is-selected',cell.classList.contains('week-col')&&cell.dataset.dateCell===key);
  });
  document.querySelectorAll('[data-date]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.date===key)));
  renderSelectedDate();
 };
 document.querySelectorAll('[data-date]').forEach(button=>button.onclick=e=>{
  e.stopPropagation();selectDate(button.dataset.date);
  if(mobileCalendar.matches&&button.classList.contains('more-events'))$('#details-panel').scrollIntoView({block:'start'});
 });
 document.querySelectorAll('[data-date-cell]').forEach(cell=>{
  cell.onclick=e=>{
   if(e.target.closest('[data-event],[data-date],[data-weather-date]'))return;
   selectDate(cell.dataset.dateCell);
  };
  cell.ondblclick=e=>{
   if(mobileCalendar.matches||e.target.closest('[data-event],.more-events,[data-weather-date]')||!current||current.role==='viewer')return;
   e.preventDefault();selected=cell.dataset.dateCell;
   openEvent(null,`${selected}T09:00`,`${selected}T10:00`,cell);
  };
 });

 // Day view slots click & drag selection to create event
 let isSelectingSlot=false;
 let selectStartHour=null;
 let selectEndHour=null;
 let activeSlotElem=null;

 document.querySelectorAll('.day-slot-content').forEach(slot=>{
  slot.onmousedown=e=>{
   if(e.target.closest('[data-event]')||e.target.closest('.event-resize-handle'))return;
   if(!current||current.role==='viewer')return;
   if(e.button!==0)return; // only left click
   isSelectingSlot=true;
   activeSlotElem=slot;
   selectStartHour=parseInt(slot.dataset.slotHour,10);
   selectEndHour=selectStartHour;
   updateSlotSelectionUI();
  };

  slot.onmouseenter=()=>{
   if(!isSelectingSlot)return;
   selectEndHour=parseInt(slot.dataset.slotHour,10);
   updateSlotSelectionUI();
  };

  slot.onclick=e=>{
   if(e.target.closest('[data-event]')||e.target.closest('.event-resize-handle'))return;
   if(isSelectingSlot&&selectStartHour!==selectEndHour)return; // Handled by mouseup
   if(!current||current.role==='viewer')return;
   const h=parseInt(slot.dataset.slotHour,10);
   const startHStr=String(h).padStart(2,'0');
   const endHStr=String(Math.min(23,h+1)).padStart(2,'0');
   openEvent(null,`${selected}T${startHStr}:00`,`${selected}T${endHStr}:00`,slot);
  };
 });

 window.addEventListener('mouseup',e=>{
  if(!isSelectingSlot)return;
  isSelectingSlot=false;
  if(selectStartHour!==null&&selectEndHour!==null){
   const minH=Math.min(selectStartHour,selectEndHour);
   const maxH=Math.max(selectStartHour,selectEndHour);
   const startHStr=String(minH).padStart(2,'0');
   const endHStr=String(Math.min(23,maxH+1)).padStart(2,'0');
   clearSlotSelectionUI();
   if(minH!==maxH){
    openEvent(null,`${selected}T${startHStr}:00`,`${selected}T${endHStr}:00`,activeSlotElem);
   }
  }
  selectStartHour=null;
  selectEndHour=null;
  activeSlotElem=null;
 }, {once:false});

 function updateSlotSelectionUI(){
  if(selectStartHour===null||selectEndHour===null)return;
  const minH=Math.min(selectStartHour,selectEndHour);
  const maxH=Math.max(selectStartHour,selectEndHour);
  document.querySelectorAll('.day-slot-content').forEach(s=>{
   const h=parseInt(s.dataset.slotHour,10);
   s.classList.toggle('slot-selecting',h>=minH&&h<=maxH);
  });
 }

 function clearSlotSelectionUI(){
  document.querySelectorAll('.day-slot-content').forEach(s=>s.classList.remove('slot-selecting'));
 }

 // Resize handles on day event cards
 document.querySelectorAll('[data-resize-event]').forEach(handle=>{
  handle.onmousedown=e=>{
   e.stopPropagation();
   e.preventDefault();
   if(!current||current.role==='viewer')return;
   const evId=handle.dataset.resizeEvent;
   const evObj=events.find(ev=>ev.id===evId);
   if(!evObj)return;

   resizingEvent=evObj;
   const card=handle.closest('.day-event-card');
   card?.classList.add('resizing');
   const startH=parseInt(evObj.start.slice(11,13),10);
   const startM=evObj.start.slice(14,16);

   let targetEndH=parseInt(evObj.end.slice(11,13),10);

   const onMouseMove=moveEvent=>{
    const elem=document.elementFromPoint(moveEvent.clientX,moveEvent.clientY);
    const slotContent=elem?.closest('.day-slot-content');
    if(slotContent?.dataset?.slotHour){
     const currentHoverH=parseInt(slotContent.dataset.slotHour,10);
     targetEndH=Math.max(startH+1,currentHoverH+1);
     const timeSmall=card?.querySelector('small');
     if(timeSmall){
      timeSmall.textContent=`${evObj.start.slice(11)} ~ ${String(Math.min(23,targetEndH)).padStart(2,'0')}:${startM}`;
     }
    }
   };

   const onMouseUp=async()=>{
    window.removeEventListener('mousemove',onMouseMove);
    window.removeEventListener('mouseup',onMouseUp);
    card?.classList.remove('resizing');
    if(resizingEvent){
     const finalEndH=Math.min(23,Math.max(startH+1,targetEndH));
     const newEndTime=`${String(finalEndH).padStart(2,'0')}:${startM}`;
     const newEndStr=`${evObj.end.slice(0,10)}T${newEndTime}`;
     if(newEndStr!==evObj.end){
      await resizeEventDuration(evObj,newEndStr);
     }
     resizingEvent=null;
    }
   };

   window.addEventListener('mousemove',onMouseMove);
   window.addEventListener('mouseup',onMouseUp);
  };
 });

 // Todo checkbox clicks
 document.querySelectorAll('[data-todo-check]').forEach(cb=>{
  cb.onclick=e=>toggleEventCompleted(cb.dataset.todoCheck, e);
 });

 // Event selection, double click edit, drag & drop move
 document.querySelectorAll('[data-event]').forEach(el=>{
  const evId=el.dataset.event;
  const evObj=events.find(e=>e.id===evId);
  if(!evObj)return;

  el.onclick=e=>{
   if(e.target.closest('[data-todo-check]'))return;
   e.stopPropagation();
   selectedEvent=evObj;
   document.querySelectorAll('.selected-event').forEach(n=>n.classList.remove('selected-event'));
   document.querySelectorAll(`[data-event="${evId}"]`).forEach(n=>n.classList.add('selected-event'));
   if(mobileCalendar.matches)openEvent(evObj,null,null,el);
  };

  el.ondblclick=e=>{
   e.stopPropagation();
   if(mobileCalendar.matches)return;
   openEvent(evObj, null, null, el);
  };

  // Drag and drop setup
  el.ondragstart=e=>{
   if(resizingEvent){e.preventDefault();return;}
   if(calendarIsReadOnly(calendars.find(c=>c.id===(evObj.calendar_id||current?.id)))||evObj.sync_pending){e.preventDefault();return;}
   dragEvent=evObj;
   selectedEvent=evObj;
   el.classList.add('dragging');
   e.dataTransfer.effectAllowed='move';
   e.dataTransfer.setData('text/plain',evObj.id);
  };

  el.ondragend=()=>{
   el.classList.remove('dragging');
   dragEvent=null;
   document.querySelectorAll('.drag-over').forEach(n=>n.classList.remove('drag-over'));
  };
 });

 document.querySelectorAll('[data-drop-date]').forEach(target=>{
  target.ondragover=e=>{
   if(!dragEvent||!current||current.role==='viewer')return;
   e.preventDefault();
   e.dataTransfer.dropEffect='move';
   target.classList.add('drag-over');
  };

  target.ondragleave=()=>target.classList.remove('drag-over');

  target.ondrop=async e=>{
   e.preventDefault();
   target.classList.remove('drag-over');
   const ev=dragEvent;
   if(!ev||!current||current.role==='viewer')return;
   const newDate=target.dataset.dropDate;
   const dropHour=target.dataset.dropHour;
   if(!newDate)return;

   await moveEventDate(ev,newDate,dropHour);
  };
 });
}

async function resizeEventDuration(ev,newEndStr){
 const updatedPayload={
  title:ev.title,
  start:ev.start,
  end:newEndStr,
  color:ev.color,
  all_day:Boolean(ev.all_day),
  category:ev.category||'',
  notes:ev.notes||'',
  version:ev.version
 };
 const targetCalId=ev.calendar_id||current?.id;
 try{
  await api(`/api/calendars/${targetCalId}/events/${ev.id}`,'PUT',updatedPayload);
  toast(`'${ev.title}' 일정의 시간을 변경했어요.`);
  await loadAllSelectedEvents();
  renderCalendar();
 }catch(err){
  toast(err.message);
  renderCalendar();
 }
}

async function moveEventDate(ev,newDate,dropHour){
 const origStartDate=ev.start.slice(0,10);
 const origStartTime=ev.start.slice(11);
 const origEndDate=ev.end.slice(0,10);
 const origEndTime=ev.end.slice(11);

 let newStartTime=origStartTime;
 let newEndTime=origEndTime;

 if(dropHour!==undefined&&!ev.all_day){
  const [startH,startM]=origStartTime.split(':').map(Number);
  const [endH,endM]=origEndTime.split(':').map(Number);
  const durMinutes=(endH*60+endM)-(startH*60+startM);
  const targetH=parseInt(dropHour,10);
  newStartTime=`${String(targetH).padStart(2,'0')}:${String(startM||0).padStart(2,'0')}`;
  const endMinutes=targetH*60+(startM||0)+(durMinutes>0?durMinutes:60);
  const newEndH=Math.min(23,Math.floor(endMinutes/60));
  const newEndM=endMinutes%60;
  newEndTime=`${String(newEndH).padStart(2,'0')}:${String(newEndM).padStart(2,'0')}`;
  if(newEndTime<=newStartTime){newEndTime='23:59';}
 }

 const dayDiff=Math.round((new Date(`${newDate}T12:00:00`)-new Date(`${origStartDate}T12:00:00`))/(86400000));
 const newEndDateObj=new Date(`${origEndDate}T12:00:00`);
 newEndDateObj.setDate(newEndDateObj.getDate()+dayDiff);
 const newEndDate=dateKey(newEndDateObj);

 const updatedPayload={
  title:ev.title,
  start:`${newDate}T${newStartTime}`,
  end:`${newEndDate}T${newEndTime}`,
  color:ev.color,
  all_day:Boolean(ev.all_day),
  category:ev.category||'',
  notes:ev.notes||'',
  version:ev.version
 };

 const targetCalId=ev.calendar_id||current?.id;
 try{
  await api(`/api/calendars/${targetCalId}/events/${ev.id}`,'PUT',updatedPayload);
  selected=newDate;
  toast(`일정을 ${newDate}로 이동했어요.`);
  await loadAllSelectedEvents();
  renderCalendar();
 }catch(err){
  toast(err.message);
 }
}

async function copyAndPasteEvent(targetDate){
 if(!copiedEvent||!current)return;
 const targetCal=defaultCalendar();
 if(!targetCal){toast('편집할 수 있는 캘린더가 없어요.');return;}
 const targetCalId=targetCal.id;

 const origStartDate=copiedEvent.start.slice(0,10);
 const origStartTime=copiedEvent.start.slice(11);
 const origEndDate=copiedEvent.end.slice(0,10);
 const origEndTime=copiedEvent.end.slice(11);

 const dayDiff=Math.round((new Date(`${targetDate}T12:00:00`)-new Date(`${origStartDate}T12:00:00`))/(86400000));
 const newEndDateObj=new Date(`${origEndDate}T12:00:00`);
 newEndDateObj.setDate(newEndDateObj.getDate()+dayDiff);
 const newEndDate=dateKey(newEndDateObj);

 const payload={
  title:copiedEvent.title,
  start:`${targetDate}T${origStartTime}`,
  end:`${newEndDate}T${origEndTime}`,
  color:copiedEvent.color,
  all_day:Boolean(copiedEvent.all_day),
  category:copiedEvent.category||'',
  is_todo:Boolean(copiedEvent.is_todo),
  is_dday:Boolean(copiedEvent.is_dday),
  is_cancelled:Boolean(copiedEvent.is_cancelled),
  completed:Boolean(copiedEvent.completed),
  notes:copiedEvent.notes||''
 };

 try{
  await api(`/api/calendars/${targetCalId}/events`,'POST',payload);
  selectedCalendarIds.add(targetCalId);saveSelectedCalendars();
  selected=targetDate;
  toast(`'${copiedEvent.title}' 일정을 ${targetDate}에 붙여넣었어요.`);
  await loadAllSelectedEvents();
  renderCalendar();
 }catch(err){
  toast(err.message);
 }
}

async function deleteEventById(ev){
 if(!ev)return;
 const cal=calendars.find(c=>c.id===(ev.calendar_id||current?.id))||current;
 if(calendarIsReadOnly(cal)){
  toast(translateMessage('읽기 전용 캘린더의 일정은 삭제할 수 없어요.'));
  return;
 }
 if(!confirm(translateMessage('이 일정을 삭제할까요?')))return;
 const targetCalId=ev.calendar_id||current.id;
 try{
  await api(`/api/calendars/${targetCalId}/events/${ev.id}`,'DELETE',{version:ev.version});
  if($('#event-dialog').open)$('#event-dialog').close();
  if(selectedEvent?.id===ev.id)selectedEvent=null;
  if(copiedEvent?.id===ev.id)copiedEvent=null;
  toast(translateMessage('일정을 삭제했어요.'));
  await loadAllSelectedEvents();
  renderCalendar();
 }catch(e){
  toast(e.message);
  if($('#event-dialog').open)$('#event-form .form-error').textContent=e.message;
 }
}

// Keyboard shortcuts: d, w, m, Delete/Backspace, Cmd+C, Cmd+V
window.addEventListener('keydown',e=>{
 if(document.querySelector('.tt-page[open],.tt-editor[open]'))return;
 if(!$('#settings-page').hidden)return;
 const targetTag=e.target?.tagName;
 if(['INPUT','TEXTAREA','SELECT'].includes(targetTag)||e.target?.isContentEditable)return;

 const key=e.key.toLowerCase();
 const isMetaOrCtrl=e.metaKey||e.ctrlKey;

 if(key==='delete'||key==='backspace'){
  if(document.querySelector('#event-dialog[open]')&&editing){
   e.preventDefault();
   deleteEventById(editing);
   return;
  }
  if(!document.querySelector('dialog[open]')&&selectedEvent){
   e.preventDefault();
   deleteEventById(selectedEvent);
   return;
  }
 }

 if(document.querySelector('dialog[open]'))return;

 if(!isMetaOrCtrl){
  if(key==='d'){
   e.preventDefault();
   setViewMode('day');
   toast('일간 보기로 전환');
  }else if(key==='w'){
   e.preventDefault();
   setViewMode('week');
   toast('주간 보기로 전환');
  }else if(key==='m'){
   e.preventDefault();
   setViewMode('month');
   toast('월간 보기로 전환');
  }
  return;
 }

 if(isMetaOrCtrl&&key==='c'){
  if(selectedEvent){
   e.preventDefault();
   copiedEvent={...selectedEvent};
   toast(`'${copiedEvent.title}' 일정을 복사했어요. 원하는 날짜를 선택하고 Cmd+V 로 붙여넣으세요.`);
  }
 }else if(isMetaOrCtrl&&key==='v'){
  if(copiedEvent){
   e.preventDefault();
   copyAndPasteEvent(selected);
  }
 }
});

function renderPresence(){
 if(!$('#sync-status'))return;
 $('#sync-status').textContent=!current?'캘린더를 만들어 시작하세요':connected?'● 실시간으로 연결됨':'○ 다시 연결하는 중';
 $('#sync-status').className=connected?'online':'';
 $('#session-count').textContent=connected?sessions.length:0;
 $('#presence-list').innerHTML=!connected?'<p class="muted small">연결되면 접속 세션이 표시돼요.</p>':sessions.map(s=>`<div class="presence-person"><span class="avatar">${esc(s.name.slice(0,1))}</span><div><strong>${esc(s.name)}</strong><small>${new Date(s.joined).toLocaleTimeString((locale==='en'?'en-US':'ko-KR'),{hour:'2-digit',minute:'2-digit'})} 접속${s.is_current?' · 현재 세션':''}</small></div><i class="online-dot"></i>${s.can_end?`<button type="button" class="member-text-action" data-end-session="${esc(s.id)}" data-session-name="${esc(s.name)}" aria-label="${esc(s.name)}님 세션 종료">종료</button>`:''}</div>`).join('');
 const count=connected?sessions.length:0;
 $('#mobile-nav-session-count').textContent=count;
 $('#mobile-session-count').textContent=count;
 $('#mobile-sessions-calendar').textContent=current?.name||'선택한 캘린더가 없어요.';
 $('#mobile-session-status').textContent=!current?'캘린더를 선택하면 접속 세션이 표시돼요.':connected?'실시간으로 연결됨':'다시 연결하는 중 · 접속 정보를 기다리고 있어요.';
 $('#mobile-presence-list').innerHTML=!current?'<p class="muted small">캘린더를 선택해 주세요.</p>':!connected?'<p class="muted small">연결되면 접속 세션이 표시돼요.</p>':sessions.length?sessions.map(s=>`<div class="presence-person"><span class="avatar">${esc(s.name.slice(0,1))}</span><div><strong>${esc(s.name)}</strong><small>${new Date(s.joined).toLocaleTimeString((locale==='en'?'en-US':'ko-KR'),{hour:'2-digit',minute:'2-digit'})}부터 접속${s.is_current?' · 현재 세션':''}</small></div><span class="online-dot" aria-label="접속 중"></span>${s.can_end?`<button type="button" class="member-text-action" data-end-session="${esc(s.id)}" data-session-name="${esc(s.name)}" aria-label="${esc(s.name)}님 세션 종료">종료</button>`:''}</div>`).join(''):'<p class="muted small">현재 표시할 접속 세션이 없어요.</p>';
 $('#mobile-sessions-trigger').disabled=!current;
}

let timedEventRange={start:'09:00',end:'10:00'};
function updateRepeatPreview(){
 const f=$('#event-form');
 const freq=!editing?f.elements.repeat_frequency.value:'none';
 const repeating=freq!=='none';
 $('#repeat-duration').hidden=!repeating;
 const isMonthlyOrYearly=freq==='monthly'||freq==='yearly';
 if($('#repeat-calendar-type-wrap'))$('#repeat-calendar-type-wrap').hidden=!repeating||!isMonthlyOrYearly;
 const countInput=f.elements.repeat_weeks;
 countInput.disabled=!repeating||f.elements.title.disabled;

 const unitLabel=$('#repeat-duration-unit');
 const descLabel=$('#repeat-description');
 if(freq==='yearly'){
  countInput.max='10';
  if(unitLabel)unitLabel.textContent=locale==='en'?'years':'년';
  if(descLabel)descLabel.textContent=locale==='en'?'Total years including the first event. (Max 10 years)':'첫 일정을 포함한 년 수예요. (최대 10년)';
  if(!countInput.value||Number(countInput.value)>10||Number(countInput.value)<1)countInput.value='5';
 }else if(freq==='monthly'){
  countInput.max='36';
  if(unitLabel)unitLabel.textContent=locale==='en'?'months':'개월';
  if(descLabel)descLabel.textContent=locale==='en'?'Total months including the first event. (Max 36 months)':'첫 일정을 포함한 개월 수예요. (최대 36개월)';
  if(!countInput.value||Number(countInput.value)>36||Number(countInput.value)<1)countInput.value='12';
 }else{
  countInput.max='52';
  if(unitLabel)unitLabel.textContent=locale==='en'?'weeks':'주';
  if(descLabel)descLabel.textContent=locale==='en'?'Total weeks including the first event. (Max 52 weeks)':'첫 일정을 포함한 주 수예요. (최대 52주)';
  if(!countInput.value||Number(countInput.value)>52||Number(countInput.value)<1)countInput.value='4';
 }

 const count=Number(countInput.value);
 const submit=f.querySelector('[type=submit]');
 submit.textContent=repeating&&Number.isInteger(count)&&count>=1?`${count}개 일정 만들기`:'일정 저장';
 if(!repeating){$('#repeat-preview').textContent='';return;}

 const calendarType=f.elements.repeat_calendar_type?.value||'solar';
 let start=f.elements.start.value,end=f.elements.end.value;
 if(f.elements.all_day.checked&&start&&end){start+='T00:00';end=shiftDate(end,1)+'T00:00';}
 try{
  const ranges=repeatEventRanges(start,end,{frequency:freq,calendarType,count});
  const first=new Date(`${ranges[0].start.slice(0,10)}T12:00:00`);
  const last=new Date(`${ranges.at(-1).start.slice(0,10)}T12:00:00`);
  const date=d=>d.toLocaleDateString((locale==='en'?'en-US':'ko-KR'),{year:'numeric',month:'long',day:'numeric'});
  const firstDayStr=ranges[0].start.slice(0,10);
  const lunar=getKoreanLunarDate(firstDayStr);
  let summaryPrefix='';
  if(freq==='weekly'){
   summaryPrefix=`${locale==='en'?'Every':'매주'} ${dayNames[first.getDay()]}`;
  }else if(freq==='monthly'){
   if(calendarType==='lunar'&&lunar){
    summaryPrefix=`${locale==='en'?'Every month on Lunar day ':'매달 음력 '}${lunar.day}일`;
   }else{
    summaryPrefix=`${locale==='en'?'Every month on day ':'매달 '}${first.getDate()}일`;
   }
  }else if(freq==='yearly'){
   if(calendarType==='lunar'&&lunar){
    summaryPrefix=`${locale==='en'?'Every year on Lunar ':'매년 음력 '}${lunar.intercalation?'윤 ':''}${lunar.month}월 ${lunar.day}일`;
   }else{
    summaryPrefix=`${locale==='en'?'Every year on ':'매년 '}${first.getMonth()+1}월 ${first.getDate()}일`;
   }
  }
  $('#repeat-preview').textContent=`${summaryPrefix} · ${count} ${locale==='en'?'occurrences':'회'}\n${date(first)} ~ ${date(last)}`;
 }catch{
  $('#repeat-preview').textContent='날짜와 반복 기간을 선택하면 생성할 일정을 보여드려요.';
 }
}
$('#event-form').elements.repeat_frequency.onchange=updateRepeatPreview;
$('#event-form').elements.repeat_weeks.oninput=updateRepeatPreview;
document.querySelectorAll('input[name="repeat_calendar_type"]').forEach(r=>r.onchange=updateRepeatPreview);
function syncEventEnd(){
 const f=$('#event-form'),start=f.elements.start.value,end=f.elements.end.value;
 const adjusted=resolveAdjustedEndDateTime(start,end,f.elements.all_day.checked);
 if(adjusted)f.elements.end.value=adjusted;
 updateRepeatPreview();
}
$('#event-form').elements.start.oninput=syncEventEnd;
$('#event-form').elements.start.onchange=syncEventEnd;
$('#event-form').elements.end.oninput=updateRepeatPreview;
$('#event-form').elements.end.onchange=updateRepeatPreview;
function updateEventDateInputs(allDay,start,end){
 const f=$('#event-form');
 f.elements.start.type=allDay?'date':'datetime-local';
 f.elements.end.type=allDay?'date':'datetime-local';
 f.elements.start.value=start;
 f.elements.end.value=end;
 $('#event-start-label').textContent=allDay?'시작 날짜':'시작 시간';
 $('#event-end-label').textContent=allDay?'종료 날짜':'종료 시간';
}
$('#event-form').elements.all_day.onchange=e=>{
 const f=$('#event-form'),start=f.elements.start.value,end=f.elements.end.value;
 if(e.target.checked){
  timedEventRange={start:start.slice(11)||'09:00',end:end.slice(11)||'10:00'};
  const lastDay=end.endsWith('T00:00')&&end.slice(0,10)>start.slice(0,10)?shiftDate(end.slice(0,10),-1):end.slice(0,10);
  updateEventDateInputs(true,start.slice(0,10),lastDay);
 }else{
  updateEventDateInputs(false,start?`${start}T${timedEventRange.start}`:'',end?`${end}T${timedEventRange.end}`:'');
  syncEventEnd();
 }
 updateRepeatPreview();
};
function openEvent(event,defaultStart,defaultEnd,anchorElem,copying=false){
 if(!current)return;
 editing=event&&!copying?{...event}:null;
 const dlg=$('#event-dialog');
 const f=$('#event-form');
 f.reset();
 f.elements.title.value=event?.title||'';
 const start=event?.start||defaultStart||`${selected}T09:00`;
 const end=event?.end||defaultEnd||`${selected}T10:00`;
 const allDay=Boolean(event?.all_day);
 f.elements.all_day.checked=allDay;
 if(f.elements.is_todo)f.elements.is_todo.checked=Boolean(event?.is_todo);
 if(f.elements.is_dday)f.elements.is_dday.checked=Boolean(event?.is_dday);
 if(f.elements.is_cancelled)f.elements.is_cancelled.checked=Boolean(event?.is_cancelled);
 f.elements.reminder_enabled.checked=Boolean(event?.reminder_enabled); f.elements.reminder_minutes.value=String(event?.reminder_minutes||10); f.elements.reminder_minutes.disabled=!f.elements.reminder_enabled.checked;
 timedEventRange={start:allDay?'09:00':start.slice(11),end:allDay?'10:00':end.slice(11)};
 updateEventDateInputs(allDay,allDay?start.slice(0,10):start,allDay?shiftDate(end.slice(0,10),-1):end);
 f.elements.color.value=event?.color||'sage';
 f.elements.category.value=event?.category||'';
 f.elements.notes.value=event?.notes||'';

 const calSelect=$('#event-calendar-select');
 const calSelectLabel=$('#event-calendar-select-label');
 if(calSelect&&calSelectLabel){
  const writable=calendars.filter(c=>!calendarIsReadOnly(c));
  if(writable.length>0){
   calSelect.innerHTML=writable.map(c=>`<option value="${c.id}">${esc(c.name)}${c.role==='owner'?' (나)':''}</option>`).join('');
   const targetId=editing?(editing.calendar_id||current.id):writable[0].id;
   calSelect.value=targetId;
   calSelect.disabled=false;
   calSelectLabel.hidden=false;
  }else{
   calSelectLabel.hidden=true;
  }
 }
 const targetCal=editing?(calendars.find(c=>c.id===editing.calendar_id)||current):defaultCalendar();
 const readonly=calendarIsReadOnly(targetCal)||Boolean(editing?.sync_pending);
 $('#event-sync-status').textContent=editing?.sync_pending?(editing.sync_error||'iCloud에 캘린더 이동을 반영 중입니다. 잠시 후 다시 수정할 수 있어요.'):'';
 [...f.elements].forEach(el=>{if(['INPUT','SELECT','TEXTAREA'].includes(el.tagName))el.disabled=readonly;});
 if(calSelect&&readonly&&editing){calSelect.innerHTML=`<option value="${targetCal.id}">${esc(targetCal.name)}</option>`;calSelectLabel.hidden=false;}
 f.querySelector('[type=submit]').hidden=readonly;
 $('#event-repeat-options').hidden=Boolean(editing)||readonly;
 updateRepeatPreview();
 $('#event-heading').textContent=readonly?'일정 보기':editing?'일정 수정':copying?'일정 복사':'새로운 일정';
 $('#copy-event').hidden=!editing||!defaultCalendar();
 $('#delete-event').hidden=!editing||readonly;
 f.querySelector('.form-error').textContent='';

 dlg.showModal();
 dlg.style.transform='';
 dlg.scrollTop=0;
 if(!event&&!readonly)f.elements.title.focus({preventScroll:true});
 if(mobileCalendar.matches){
  dlg.style.left='';dlg.style.top='';
  return;
 }

 if(anchorElem && typeof anchorElem.getBoundingClientRect === 'function'){
  const rect=anchorElem.getBoundingClientRect();
  const dlgW=dlg.offsetWidth||350;
  const dlgH=dlg.offsetHeight||380;
  let left=rect.right+10;
  if(left+dlgW > window.innerWidth - 12){
   left=Math.max(12, rect.left - dlgW - 10);
  }
  let top=rect.top;
  if(top+dlgH > window.innerHeight - 12){
   top=Math.max(12, window.innerHeight - dlgH - 12);
  }
  dlg.style.left=`${Math.round(left)}px`;
  dlg.style.top=`${Math.round(top)}px`;
 }else{
  dlg.style.left='50%';
  dlg.style.top='50%';
  dlg.style.transform='translate(-50%, -50%)';
 }
}

$('#event-dialog').addEventListener('click',e=>{
 const rect=e.currentTarget.getBoundingClientRect();
 const isInDialog=rect.top<=e.clientY&&e.clientY<=rect.bottom&&rect.left<=e.clientX&&e.clientX<=rect.right;
 if(!isInDialog){
  e.currentTarget.close();
 }
});

$('#event-form').onsubmit=async e=>{
 e.preventDefault();
 const f=e.currentTarget;
 if(f.dataset.saving==='true')return;
 const b=Object.fromEntries(new FormData(f));
 const isRepeating=!editing&&b.repeat_frequency&&b.repeat_frequency!=='none';
 if(isRepeating){
  b.repeat_count=Number(b.repeat_weeks);
  b.repeat_weeks=b.repeat_frequency==='weekly'?b.repeat_count:1;
  b.repeat_calendar_type=f.elements.repeat_calendar_type?.value||'solar';
 }else{
  delete b.repeat_frequency;
  delete b.repeat_calendar_type;
  delete b.repeat_count;
  delete b.repeat_weeks;
 }
 b.all_day=f.elements.all_day.checked;
 b.is_todo=Boolean(f.elements.is_todo?.checked);
 b.is_dday=Boolean(f.elements.is_dday?.checked);
 b.is_cancelled=Boolean(f.elements.is_cancelled?.checked);
 b.reminder_enabled=Boolean(f.elements.reminder_enabled?.checked); b.reminder_minutes=Number(f.elements.reminder_minutes.value||10);
 if(b.reminder_enabled&&'Notification' in window&&Notification.permission==='default'){try{await Notification.requestPermission();}catch{}}
 if(b.reminder_enabled&&'Notification' in window&&Notification.permission==='denied')toast('브라우저 설정에서 알림 권한을 허용해 주세요.');
 if(b.reminder_enabled&&!window.MoaAndroidBridge&&'serviceWorker' in navigator&&'PushManager' in window&&Notification.permission!=='denied'){
  getPushSubscription().then(sub=>{if(!sub)subscribeToPush().catch(()=>{});}).catch(()=>{});
 }
 if(b.all_day){
  if(!b.start||!b.end||b.end<b.start){f.querySelector('.form-error').textContent='종료 날짜는 시작 날짜와 같거나 이후여야 해요.';return;}
  b.start=`${b.start}T00:00`;
  b.end=`${shiftDate(b.end,1)}T00:00`;
 }
 if(editing)b.version=editing.version;
 const targetCalId=$('#event-calendar-select')?.value||defaultCalendar()?.id;
 if(!targetCalId){f.querySelector('.form-error').textContent='편집할 수 있는 캘린더가 없어요.';return;}
 const sourceCalId=editing?(editing.calendar_id||current.id):targetCalId;
 b.calendar_id=targetCalId;
 const submit=f.querySelector('[type=submit]');
 const submitText=submit.textContent;
 f.dataset.saving='true';submit.disabled=true;submit.textContent='저장 중…';
 try{
  const result=await api(`/api/calendars/${sourceCalId}/events${editing?`/${editing.id}`:''}`,editing?'PUT':'POST',b);
  $('#event-dialog').close();
  selectedCalendarIds.add(targetCalId);saveSelectedCalendars();
  toast(result.syncPending?'일정을 이동했어요. iCloud 반영은 자동으로 다시 시도합니다.':result.moved?'일정의 캘린더를 변경했어요.':result.created>1?`${result.created}개의 반복 일정을 만들었어요.`:'일정을 저장했어요.');
  await loadAllSelectedEvents();
  renderCalendar();
 }catch(e){f.querySelector('.form-error').textContent=e.message;}
 finally{f.dataset.saving='false';submit.disabled=false;submit.textContent=submitText;}
};

$('#copy-event').onclick=e=>{e.stopPropagation();if(editing){const source={...editing};$('#event-dialog').close();openEvent(source,null,null,null,true);}};

$('#delete-event').onclick=()=>{
 if(editing)deleteEventById(editing);
};

$('#create-form').onsubmit=async e=>{
 e.preventDefault();
 const fd=new FormData(e.currentTarget);
 const name=fd.get('name'),slug=fd.get('slug');
 try{
  const c=await api('/api/calendars','POST',{name,...(slug?{slug}:{})});
  $('#create-dialog').close();
  e.target.reset();
  calendars=await api('/api/calendars');
  await selectCalendar(c.slug||c.id);
 }catch(e){$('#create-form .form-error').textContent=e.message;}
};

if($('#copy-calendar-url'))$('#copy-calendar-url').onclick=async()=>{
 try{await navigator.clipboard.writeText($('#calendar-url').value);toast('캘린더 주소를 복사했어요.');}
 catch{$('#calendar-url').select();toast('주소를 복사해 주세요.');}
};

window.onpopstate=()=>{
 if(isSettingsRoute()){restoreSettingsRoute();return;}
 closeSettingsPage();
 const slug=location.pathname.replace(/^\/+/,'').split('/')[0];
 const match=calendars.find(c=>c.slug===slug||c.id===slug);
 if(match)selectCalendar(match.slug||match.id,false);
};

$('#make-invite').onclick=async()=>{
 try{
  const result=await api(`/api/calendars/${current.id}/invites`,'POST',{role:$('#invite-role').value});
  $('#invite-url').value=result.url;
  $('#invite-result').hidden=false;
 }catch(e){$('#share-dialog .form-error').textContent=e.message;}
};

$('#copy-invite').onclick=async()=>{
 try{await navigator.clipboard.writeText($('#invite-url').value);toast('초대 링크를 복사했어요.');}
 catch{$('#invite-url').select();toast('링크를 선택했어요. 직접 복사해 주세요.');}
};

$('#revoke-invites').onclick=async()=>{
 if(!confirm('기존 초대 링크를 모두 만료시킬까요? 이미 참여한 멤버는 유지됩니다.'))return;
 try{
  await api(`/api/calendars/${current.id}/invites`,'DELETE',{});
  $('#invite-result').hidden=true;
  toast('기존 초대 링크를 만료시켰어요.');
 }catch(e){$('#share-dialog .form-error').textContent=e.message;}
};

document.querySelectorAll('.close').forEach(b=>b.onclick=()=>b.closest('dialog').close());

let managedCalendar=null, calendarDetailsRequest=0, calendarDetailsReady=false;
async function refreshCalendarMetadata(){
 calendars=await api('/api/calendars');
 const updated=calendars.find(c=>c.id===current?.id);
 if(updated){
  current=updated;
  const title=$('.topbar h1');if(title){title.textContent=getCalendarTitle();title.title=getCalendarTitle();}
  if($('#share'))$('#share').disabled=current.role!=='owner';
  renderCalendar();
 }
 renderCalendarListUI();
}
function openCalendarDetails(ident,updateUrl=true){
 managedCalendar=calendars.find(c=>c.id===ident||c.slug===ident);
 if(!managedCalendar)return;
 calendarDetailsReady=false;
 $('#calendar-settings-form').hidden=true;
 $('#calendar-details-members').innerHTML='';
 $('#calendar-details-invites-section').hidden=true;
 if($('#details-invite-result'))$('#details-invite-result').hidden=true;
 if($('#details-invite-url'))$('#details-invite-url').value='';
 $('#calendar-details-error').textContent='';
 $('#calendar-member-count').textContent='0';
 $('#calendar-details-status').textContent='캘린더 정보를 불러오는 중…';
 $('#view-managed-calendar').disabled=false;
 $('#calendar-delete-section').hidden=true;
 openSettingsPage('calendar',updateUrl,ident);
 loadCalendarDetails(true);
}
$('#calendar-management-list')?.addEventListener('click',async e=>{
 const orderButton=e.target.closest('[data-calendar-order]');
 if(orderButton){
  const index=calendars.findIndex(c=>c.id===orderButton.dataset.calendarOrder),target=index+Number(orderButton.dataset.orderStep);
  if(index<0||target<0||target>=calendars.length)return;
  const ids=calendars.map(c=>c.id);[ids[index],ids[target]]=[ids[target],ids[index]];
  document.querySelectorAll('[data-calendar-order]').forEach(b=>b.disabled=true);
  try{await api('/api/calendars/order','PUT',{calendarIds:ids});await refreshCalendarMetadata();loadSettingsCalendars();toast('캘린더 순서를 저장했어요.');}
  catch(error){toast(error.message);loadSettingsCalendars();}
  return;
 }

 const button=e.target.closest('[data-management-calendar]');
 if(!button)return;
 
 openCalendarDetails(button.dataset.managementCalendar);
});
$('#external-calendar-management-list')?.addEventListener('click',async e=>{
 const button=e.target.closest('[data-unlink-external-calendar]');
 if(!button||button.disabled)return;
 const name=button.dataset.externalCalendarName||'외부 캘린더';
 if(!confirm('"'+name+'" 연동을 해제할까요? 이미 가져온 캘린더와 일정은 유지됩니다.'))return;
 button.disabled=true;
 try{
  await api('/api/me/external-calendars/'+button.dataset.unlinkExternalCalendar,'DELETE',{});
  calendars=await api('/api/calendars');
  renderCalendarListUI();
  const result=await api('/api/me/calendar-connections');
  renderCalendarManagementLists(result.connections||[]);
  await loadCalendarIntegrations();
  toast('외부 캘린더 연동을 해제했어요. 가져온 캘린더와 일정은 유지됩니다.');
 }catch(error){$('#calendar-management-error').textContent=error.message;button.disabled=false;}
});
async function loadCalendarDetails(initialize=false){
 if(!managedCalendar||!isSettingsPanel('calendar'))return;
 const id=managedCalendar.id, request=++calendarDetailsRequest;
 try{
  const data=await api(`/api/calendars/${id}/details`);
  if(request!==calendarDetailsRequest||managedCalendar?.id!==id||!isSettingsPanel('calendar'))return;
  managedCalendar={...managedCalendar,...data.calendar,role:data.role};
  const owner=data.role==='owner', form=$('#calendar-settings-form');
  const isGoogle=Boolean(data.calendar?.is_google||data.calendar?.name?.includes('Google')||data.calendar?.name?.includes('구글'));
  const isICloud=Boolean(data.calendar?.is_icloud||data.calendar?.name?.includes('iCloud')||data.calendar?.name?.includes('아이클라우드'));
  if(isGoogle)managedCalendar.is_google=true;
  if(isICloud)managedCalendar.is_icloud=true;
  if(initialize||!calendarDetailsReady){
   form.elements.name.value=data.calendar.name;
   form.elements.name.disabled=!owner;
   $('#calendar-settings-colors').innerHTML=EVENT_COLORS.map(color=>`<label class="calendar-color-option" title="${calendarColorNames[color]}"><input type="radio" class="sr-only" name="color" value="${color}" aria-label="${calendarColorNames[color]}" ${color===data.calendar.color?'checked':''} ${owner?'':'disabled'}><span class="calendar-color-swatch ${color}" aria-hidden="true"></span></label>`).join('');
   $('#save-calendar-settings').hidden=!owner;
  }
  form.elements.name.disabled=!owner;
  form.querySelectorAll('[name=color]').forEach(input=>input.disabled=!owner);
  $('#save-calendar-settings').hidden=!owner;
  $('#calendar-delete-section').hidden=!owner;
  calendarDetailsReady=true;form.hidden=false;
  $('#calendar-details-status').textContent=owner
   ?(isGoogle
     ?(locale==='en'?'Google Calendar linked · You can change the name, color or delete this calendar.':'Google 캘린더 연동 · 이름과 색상을 변경하거나 삭제할 수 있어요.')
     :isICloud
     ?(locale==='en'?'iCloud Calendar linked · You can change the name, color or delete this calendar.':'iCloud 캘린더 연동 · 이름과 색상을 변경하거나 삭제할 수 있어요.')
     :(locale==='en'?'Calendar Administrator · You can change the name and color.':'캘린더 관리자 · 이름과 색상을 변경할 수 있어요.'))
   :`${data.role==='editor'?(locale==='en'?'Participating with edit access':'편집 권한으로 참여 중'):(locale==='en'?'Participating with view-only access':'보기 권한으로 참여 중')}`;
  $('#calendar-member-count').textContent=data.members.length;
  $('#calendar-details-members').innerHTML=data.members.map(person=>`<div class="calendar-person-row"><span class="avatar">${esc(person.name.slice(0,1))}</span><div class="calendar-person-info"><strong>${esc(person.name)}${person.id===me.user.id?' <small>(나)</small>':''}</strong><span>${{owner:'관리자',editor:'일정 편집 가능',viewer:'일정 보기만'}[person.role]}${person.sessions?` · 접속 중 (${person.sessions}개 세션)`:''}</span></div>${owner&&person.role!=='owner'?`<button type="button" class="admin-transfer-action" data-transfer-member="${esc(person.id)}" data-person-name="${esc(person.name)}" aria-label="${esc(person.name)}님 관리자 지정">관리자 지정</button><button type="button" class="member-text-action" data-remove-member="${esc(person.id)}" data-person-name="${esc(person.name)}" aria-label="${esc(person.name)}님 내보내기">내보내기</button>`:''}</div>`).join('');
  $('#calendar-details-invites-section').hidden=!owner;
  $('#calendar-details-invites').innerHTML=data.invites.length?data.invites.map((invite,i)=>{
   const roleText=invite.role==='editor'?(locale==='en'?'Can edit events':'일정 편집 가능'):(locale==='en'?'View only':'일정 보기만');
   const expDate=new Date(Number(invite.expires)).toLocaleDateString(locale==='en'?'en-US':'ko-KR');
   const signups=Array.isArray(invite.signups)?invite.signups:[];
   const signupListHtml=signups.length>0
    ?`<div class="invite-signups-list">${signups.map(s=>{
       const d=new Date(s.joined_at);
       const timeStr=d.toLocaleDateString(locale==='en'?'en-US':'ko-KR',{month:'numeric',day:'numeric'})+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
       return `<span class="invite-signup-pill" title="${esc(s.name)} (${timeStr})"><span class="signup-name">${esc(s.name)}</span><span class="signup-time">${timeStr}</span></span>`;
      }).join('')}</div>`
    :`<span class="muted small">${locale==='en'?'No members have joined with this link yet.':'아직 이 링크로 가입한 사람이 없어요.'}</span>`;
   return `<div class="calendar-invite-card"><div class="calendar-invite-header"><div class="calendar-person-info"><strong>${locale==='en'?'Invite Link':'초대 링크'} ${i+1}</strong><span>${roleText} · ${expDate} ${locale==='en'?'expires':'만료'}</span></div><div class="calendar-invite-actions">${invite.url?`<button type="button" class="member-text-action invite-copy-action" data-copy-invite-url="${esc(invite.url)}" aria-label="${locale==='en'?'Copy Invite Link':'초대 링크'} ${i+1} ${locale==='en'?'copy':'복사'}">${locale==='en'?'Copy link':'링크 복사'}</button>`:''}<button type="button" class="member-text-action" data-cancel-invite="${esc(invite.id)}" aria-label="${locale==='en'?'Cancel Invite Link':'초대 링크'} ${i+1} ${locale==='en'?'cancel':'취소'}">${locale==='en'?'Cancel':'취소'}</button></div></div><div class="calendar-invite-signups-box"><div class="calendar-invite-signups-title">${locale==='en'?'Joined members':'가입한 사람'} (${signups.length}${locale==='en'?'':'명'})</div>${signupListHtml}</div></div>`;
  }).join(''):`<p class="muted small">${locale==='en'?'No active invite links. Create a new one above.':'현재 유효한 초대 링크가 없어요. 위에서 새 초대 링크를 만들어 보세요.'}</p>`;
 }catch(error){
  if(request===calendarDetailsRequest&&managedCalendar?.id===id)$('#calendar-details-error').textContent=error.message;
 }
}
$('#calendar-settings-form').onsubmit=async e=>{
 e.preventDefault();if(!managedCalendar||managedCalendar.role!=='owner')return;
 const id=managedCalendar.id, form=e.currentTarget, submit=$('#save-calendar-settings');
 submit.disabled=true;$('#calendar-details-error').textContent='';
 try{
  await api(`/api/calendars/${id}/settings`,'PUT',{name:form.elements.name.value,color:form.elements.color.value});
  await refreshCalendarMetadata();await loadCalendarDetails(true);toast('캘린더 이름과 색상을 저장했어요.');
 }catch(error){$('#calendar-details-error').textContent=error.message;}
 finally{submit.disabled=false;}
};
$('[data-settings-mount="calendar-details-dialog"]').addEventListener('click',async e=>{
 const copyBtn=e.target.closest('[data-copy-invite-url]');
 if(copyBtn){
  const url=copyBtn.dataset.copyInviteUrl;
  if(url){
   try{
    await navigator.clipboard.writeText(url);
    toast(locale==='en'?'Copied invite link.':'초대 링크를 복사했어요.');
   }catch{
    prompt(locale==='en'?'Copy invite link:':'초대 링크를 복사해 주세요:',url);
   }
  }
  return;
 }
 const button=e.target.closest('[data-remove-member],[data-cancel-invite],[data-transfer-member]');
 if(!button||button.disabled||managedCalendar?.role!=='owner')return;
 const removing=Boolean(button.dataset.removeMember), transfer=Boolean(button.dataset.transferMember), id=managedCalendar.id;
 if(!confirm(transfer?`${button.dataset.personName}님을 관리자로 지정할까요? 함께 캘린더를 관리하게 됩니다.`:removing?`${button.dataset.personName}님을 내보낼까요? 현재 접속도 종료됩니다.`:'이 초대 링크를 취소할까요?'))return;
 button.disabled=true;$('#calendar-details-error').textContent='';
 try{
  await api(transfer?`/api/calendars/${id}/administrator`:removing?`/api/calendars/${id}/members`:`/api/calendars/${id}/invites/${button.dataset.cancelInvite}`,transfer?'PUT':'DELETE',transfer?{user_id:button.dataset.transferMember}:removing?{user_id:button.dataset.removeMember}:{});
  if(transfer)await refreshCalendarMetadata();
  await loadCalendarDetails(transfer);toast(transfer?'관리자로 지정했어요.':removing?'참여자를 내보냈어요.':'초대를 취소했어요.');
 }catch(error){$('#calendar-details-error').textContent=error.message;button.disabled=false;}
});
$('#details-make-invite-btn')?.addEventListener('click',async()=>{
 if(!managedCalendar||managedCalendar.role!=='owner')return;
 const btn=$('#details-make-invite-btn');
 btn.disabled=true;$('#calendar-details-error').textContent='';
 try{
  const role=$('#details-invite-role')?.value||'editor';
  const result=await api(`/api/calendars/${managedCalendar.id}/invites`,'POST',{role});
  if($('#details-invite-url'))$('#details-invite-url').value=result.url;
  if($('#details-invite-result'))$('#details-invite-result').hidden=false;
  try{
   await navigator.clipboard.writeText(result.url);
   toast(locale==='en'?'Created invite link and copied to clipboard.':'초대 링크를 만들고 클립보드에 복사했어요.');
  }catch{
   toast(locale==='en'?'Created invite link. Please copy and share.':'초대 링크를 만들었어요. 복사해 공유해 주세요.');
  }
  await loadCalendarDetails();
 }catch(error){
  $('#calendar-details-error').textContent=error.message;
 }finally{
  btn.disabled=false;
 }
});
$('#details-copy-invite-btn')?.addEventListener('click',async()=>{
 const url=$('#details-invite-url')?.value;
 if(!url)return;
 try{
  await navigator.clipboard.writeText(url);
  toast(locale==='en'?'Copied invite link.':'초대 링크를 복사했어요.');
 }catch{
  $('#details-invite-url')?.select();
  toast(locale==='en'?'Link selected. Please copy manually.':'링크를 선택했어요. 직접 복사해 주세요.');
 }
});
$('#view-managed-calendar').onclick=()=>{
 if(!managedCalendar)return;
 const id=managedCalendar.id;selectCalendar(id);
};
$('#delete-calendar-btn').onclick=async()=>{
 if(!managedCalendar||managedCalendar.role!=='owner')return;
 const id=managedCalendar.id;
 const name=managedCalendar.name||'캘린더';
 const isGoogle=Boolean(managedCalendar.is_google||name.includes('Google')||name.includes('구글'));
 const isICloud=Boolean(managedCalendar.is_icloud||name.includes('iCloud')||name.includes('아이클라우드'));
 const msg=isGoogle
  ?(locale==='en'
    ?`Delete "${name}"? All imported events and members in this calendar will be permanently deleted.\n(Events in your original Google Calendar will not be affected.)`
    :`"${name}" 캘린더를 삭제할까요? 구글에서 가져온 모든 일정과 참여자 정보가 영구적으로 삭제됩니다.\n(구글 원본 캘린더의 일정은 삭제되지 않습니다.)`)
  :isICloud
  ?(locale==='en'
    ?`Delete "${name}"? All synced events and members in this calendar will be permanently deleted.\n(Events in your original Apple iCloud Calendar will not be affected.)`
    :`"${name}" 캘린더를 삭제할까요? 동기화된 모든 일정과 참여 정보가 삭제됩니다.\n(Apple iCloud 원본 캘린더의 일정은 삭제되지 않습니다.)`)
  :(locale==='en'
    ?`Delete "${name}"? All events and members in this calendar will be permanently deleted and cannot be recovered.`
    :`"${name}" 캘린더를 삭제할까요? 등록된 모든 일정과 참여 정보가 영구적으로 삭제되며 복구할 수 없습니다.`);
 if(!confirm(msg))return;
 const submit=$('#delete-calendar-btn');
 submit.disabled=true;$('#calendar-details-error').textContent='';
 deletingCalendarId=id;
 try{
  await api(`/api/calendars/${id}`,'DELETE',{});
  calendarStreams.get(id)?.close();calendarStreams.delete(id);
  selectedCalendarIds.delete(id);
  calendars=await api('/api/calendars');
  if(current?.id===id)current=calendars.find(c=>selectedCalendarIds.has(c.id))||calendars[0]||null;
  managedCalendar=null;
  saveSelectedCalendars();
  history.replaceState({settings:'calendars'},'','/settings/calendars');
  if(current)await selectCalendar(current.slug||current.id,false);
  else{
   sessionStorage.removeItem('calendar');events=[];sessions=[];dateNotes.clear();if(typeof monthNotes!=='undefined'&&monthNotes.clear)monthNotes.clear();
   renderShell();renderCalendar();syncCalendarStreams();
  }
  openSettingsPage('calendars',false);
  toast(translateMessage('캘린더를 삭제했어요.'));
 }catch(error){$('#calendar-details-error').textContent=error.message;}
 finally{deletingCalendarId=null;submit.disabled=false;}
};
function openGoogleImportDialog(){openSettingsPage('google');}
function prepareGoogleImport(){
 $('#google-import-error').textContent='';
 $('#google-import-share').checked=false;
 renderGoogleImportAuthorization();

}
$('#btn-import-google').onclick=async()=>{
 const btn=$('#btn-import-google');
 const prevText=btn.textContent;
 btn.disabled=true;btn.textContent='새 캘린더를 만들고 가져오는 중…';
 $('#google-import-error').textContent='';
 try{
  if(!me.user.hasGoogleCalendar)throw new Error('구글 캘린더 권한을 먼저 연결해 주세요.');
  if(!$('#google-import-share').checked)throw new Error('가져온 일정의 공유 안내를 확인해 주세요.');
  const calendarName=$('#google-import-calendar-name').value.trim();
  if(!calendarName)throw new Error('새 캘린더 이름을 입력해 주세요.');
  const range=$('#google-import-range')?.value||'3';
  const res=await api('/api/google-calendar/import','POST',{calendarName,range,shareAcknowledged:true});
  
  calendars=await api('/api/calendars');
  selectedCalendarIds=new Set([res.id]);saveSelectedCalendars();
  await selectCalendar(res.id);
  toast(locale==='en'?`Imported ${res.imported} events into ${res.calendarName}.`:`${res.calendarName} 캘린더에 ${res.imported}개의 일정을 가져왔어요.`);
 }catch(e){
  $('#google-import-error').textContent=e.message;
  try{me=await api('/api/me');renderGoogleImportAuthorization();}catch{}
 }finally{
  btn.disabled=!me?.user?.hasGoogleCalendar;btn.textContent=prevText;
 }
};

let currentICloudConnection=null;

function switchIntegrationTab(tabName){
 document.querySelectorAll('[data-provider-tab]').forEach(tab=>{
  const active=tab.dataset.providerTab===tabName;
  tab.classList.toggle('active',active);
  tab.setAttribute('aria-selected',String(active));
 });
 $('#icloud-integration-panel').hidden=(tabName!=='icloud');
 $('#google-integration-panel').hidden=(tabName!=='google');
}

document.querySelectorAll('[data-provider-tab]').forEach(tab=>{
 tab.onclick=()=>{
  if(tab.classList.contains('disabled')||tab.getAttribute('aria-disabled')==='true')return;
  switchIntegrationTab(tab.dataset.providerTab);
 };
});

function openCalendarIntegrationsDialog(initialTab='icloud'){
 openSettingsPage(initialTab==='google'?'google':'icloud');
}

async function refreshICloudCalendars(){
 const knownIds=new Set(calendars.map(cal=>cal.id));
 calendars=await api('/api/calendars');
 let changed=false;
 for(const cal of calendars){
  if(!knownIds.has(cal.id)){selectedCalendarIds.add(cal.id);changed=true;}
 }
 if(changed)saveSelectedCalendars();
}

async function loadCalendarIntegrations(){
 try{
  const res=await api('/api/me/calendar-connections');
  const minutes=Number(res.syncIntervalMinutes)||15;
  $('#settings-sync-interval').textContent=locale==='en'?`iCloud syncs automatically every ${minutes} minutes. Use Sync Now whenever you need.`:`iCloud는 ${minutes}분마다 자동 동기화됩니다. 필요할 때 ‘지금 동기화’를 사용할 수 있어요.`;
  const icloudConn=res.connections?.find(c=>c.provider==='icloud');
  currentICloudConnection=icloudConn||null;
  renderICloudView(icloudConn);
  renderGoogleTabView();
 }catch(err){
  $('#icloud-connect-error').textContent=err.message;
 }
}

function renderICloudView(conn){
 const form=$('#icloud-connect-form');
 const view=$('#icloud-connected-view');
 if(!conn){
  form.hidden=false;
  view.hidden=true;
  $('#icloud-email-input').value='';
  $('#icloud-password-input').value='';
  return;
 }
 form.hidden=true;
 view.hidden=false;
 $('#icloud-connected-email').textContent=conn.accountEmail;
 const statusBadge=$('#icloud-connection-status-badge');
 if(conn.connectionStatus==='connected'){
  statusBadge.className='status-badge connected';
  statusBadge.textContent=locale==='en'?'Connected':'연결됨';
 }else if(conn.connectionStatus==='invalid_credentials'){
  statusBadge.className='status-badge danger';
  statusBadge.textContent=locale==='en'?'Auth Error (Check App Password)':'인증 실패 (앱 암호 확인)';
 }else{
  statusBadge.className='status-badge danger';
  statusBadge.textContent=locale==='en'?'Error':'오류';
 }

 const lastSync=conn.lastSyncAt
  ?new Date(conn.lastSyncAt).toLocaleString(locale==='en'?'en-US':'ko-KR')
  :(locale==='en'?'Never synced':'동기화 기록 없음');
 $('#icloud-last-sync-time').textContent=(locale==='en'?'Last sync: ':'마지막 동기화: ')+lastSync;

 const syncMsg=$('#icloud-sync-status-msg');
 if(conn.lastSyncError){
  syncMsg.textContent=conn.lastSyncError;
  syncMsg.hidden=false;
 }else{
  syncMsg.textContent='';
  syncMsg.hidden=true;
 }

 const cals=conn.calendars||[];
 $('#icloud-calendar-count').textContent=String(cals.length);
 const list=$('#icloud-calendars-list');
 if(cals.length===0){
  list.innerHTML=`<p class="muted small">${locale==='en'?'No iCloud calendars found.':'연결된 iCloud 캘린더가 없어요.'}</p>`;
  return;
 }
 list.innerHTML=cals.map(cal=>{
  const color=cal.color||'sage';
  const isEnabled=cal.isEnabled;
  const isReadOnly=cal.isReadOnly;
  const syncDirection=cal.syncDirection||'read_only';
  return `<div class="icloud-cal-item ${isEnabled?'enabled':''}" data-ext-id="${cal.id}">
   <label class="icloud-cal-info">
    <input type="checkbox" data-action="toggle-cal" data-ext-id="${cal.id}" ${isEnabled?'checked':''} aria-label="${esc(cal.displayName)} 동기화 활성화">
    <span class="dot calendar-color-dot ${color}" aria-hidden="true"></span>
    <strong class="icloud-cal-title">${esc(cal.displayName)}</strong>
    ${isReadOnly?`<span class="read-only-badge">${locale==='en'?'Read-only':'읽기 전용'}</span>`:''}
   </label>
   <div class="icloud-cal-controls">
    <select class="sync-direction-select" data-action="select-direction" data-ext-id="${cal.id}" ${isReadOnly||!isEnabled?'disabled':''} aria-label="${esc(cal.displayName)} 동기화 방향">
     <option value="read_only" ${syncDirection==='read_only'?'selected':''}>${locale==='en'?'Read-only':'읽기 전용'}</option>
     <option value="two_way" ${syncDirection==='two_way'?'selected':''} ${isReadOnly?'disabled':''}>${locale==='en'?'Two-way':'양방향'}</option>
    </select>
    <button type="button" class="secondary small-action-btn" data-action="sync-single" data-ext-id="${cal.id}" ${isEnabled?'':'disabled'} aria-label="${esc(cal.displayName)} ${locale==='en'?'Sync':'동기화'}">${locale==='en'?'Sync':'동기화'}</button>
   </div>
  </div>`;
 }).join('');
}

function renderGoogleTabView(){
 const hasGoogle=Boolean(me?.user?.hasGoogleCalendar);
 const badge=$('#google-tab-status-badge');
 if(badge){
  badge.className=hasGoogle?'status-badge connected':'status-badge';
  badge.textContent=hasGoogle?(locale==='en'?'Connected':'연동됨'):(locale==='en'?'Not connected':'연결되지 않음');
 }
 const actions=$('#google-tab-actions');
 if(actions){
  const next=encodeURIComponent(location.pathname+location.search);
  if(hasGoogle){
   actions.innerHTML=`<button type="button" id="btn-open-google-import" class="primary full">${locale==='en'?'Import Google Calendar':'Google 캘린더 불러오기'}</button>`;
   $('#btn-open-google-import')?.addEventListener('click',()=>{
    
    openGoogleImportDialog();
   });
  }else{
   actions.innerHTML=me.providers?.google
    ?`<a class="secondary full link-btn-block" href="/auth/google?link=true&next=${next}">${locale==='en'?'Connect Google Calendar':'Google 캘린더 권한 연결'}</a>`
    :`<p class="muted small">${locale==='en'?'Google Calendar integration is coming soon.':'Google 캘린더 연동 준비 중입니다.'}</p>`;
  }
 }
}

$('#btn-open-google-import')?.addEventListener('click',()=>{
 
 openGoogleImportDialog();
});

$('#icloud-connect-form')?.addEventListener('submit',async e=>{
 e.preventDefault();
 const btn=$('#btn-connect-icloud');
 const emailInput=$('#icloud-email-input');
 const pwInput=$('#icloud-password-input');
 const errEl=$('#icloud-connect-error');
 const email=emailInput.value.trim();
 const password=pwInput.value.trim();
 if(!email||!password)return;

 const originalText=btn.textContent;
 btn.disabled=true;
 btn.textContent=locale==='en'?'Connecting to iCloud…':'iCloud 연결 중…';
 errEl.textContent='';
 try{
  await api('/api/me/calendar-connections/icloud','POST',{email,password});
  pwInput.value='';
  me=await api('/api/me');
  await refreshICloudCalendars();
  renderCalendarListUI();
  renderMobileProfile();
  await loadCalendarIntegrations();
  toast(locale==='en'?'Connected to Apple iCloud Calendar.':'iCloud 캘린더를 연결했어요.');
 }catch(err){
  errEl.textContent=err.message;
 }finally{
  btn.disabled=false;
  btn.textContent=originalText;
 }
});

$('#btn-sync-icloud-now')?.addEventListener('click',async()=>{
 if(!currentICloudConnection)return;
 const btn=$('#btn-sync-icloud-now');
 const prevText=btn.textContent;
 btn.disabled=true;
 btn.textContent=locale==='en'?'Syncing…':'동기화 중…';
 $('#icloud-sync-status-msg').textContent='';
 try{
  const syncResult=await api(`/api/me/calendar-connections/${currentICloudConnection.id}/sync`,'POST',{});
  me=await api('/api/me');
  await refreshICloudCalendars();
  if(current){events=await api(`/api/calendars/${current.id}/events`);}
  renderCalendarListUI();
  renderCalendar();
  await loadCalendarIntegrations();
  const failures=(syncResult.results||[]).filter(result=>result.ok===false);
  if(failures.length)throw new Error(failures[0].error||'iCloud 동기화에 실패했습니다.');
  if(!syncResult.results?.length){
   toast(locale==='en'?'Enable a calendar to sync.':'동기화할 캘린더를 활성화해 주세요.');return;
  }
  if(syncResult.results.every(result=>result.skipped)){
   const inProgress=syncResult.results.every(result=>result.reason==='Sync already in progress');
   toast(inProgress?(locale==='en'?'Sync is already in progress.':'이미 동기화가 진행 중입니다. 잠시 후 확인해 주세요.'):(locale==='en'?'Check the iCloud connection and enabled calendars.':'iCloud 연결 상태와 캘린더 활성화 여부를 확인해 주세요.'));return;
  }
  toast(locale==='en'?'Synced with iCloud Calendar.':'iCloud 캘린더와 동기화했어요.');
 }catch(err){
  $('#icloud-sync-status-msg').textContent=err.message;
  $('#icloud-sync-status-msg').hidden=false;
  toast(err.message);
 }finally{
  btn.disabled=false;
  btn.textContent=prevText;
 }
});

$('#icloud-calendars-list')?.addEventListener('change',async e=>{
 const toggle=e.target.closest('[data-action="toggle-cal"]');
 if(toggle){
  const extId=toggle.dataset.extId;
  const isEnabled=toggle.checked;
  toggle.disabled=true;
  try{
   await api(`/api/me/external-calendars/${extId}`,'PATCH',{isEnabled});
   me=await api('/api/me');
   await refreshICloudCalendars();
   if(current)events=await api(`/api/calendars/${current.id}/events`);
   renderCalendarListUI();
   renderCalendar();
   await loadCalendarIntegrations();
   toast(locale==='en'?'Saved calendar settings.':'캘린더 설정을 저장했어요.');
  }catch(err){
   toggle.checked=!isEnabled;
   toast(err.message);
  }finally{
   toggle.disabled=false;
  }
  return;
 }

 const dirSelect=e.target.closest('[data-action="select-direction"]');
 if(dirSelect){
  const extId=dirSelect.dataset.extId;
  const syncDirection=dirSelect.value;
  dirSelect.disabled=true;
  try{
   await api(`/api/me/external-calendars/${extId}`,'PATCH',{syncDirection});
   await refreshCalendarMetadata();
   toast(locale==='en'?'Sync direction updated.':'동기화 방향을 저장했어요.');
  }catch(err){
   toast(err.message);
   await loadCalendarIntegrations();
  }finally{
   dirSelect.disabled=false;
  }
 }
});

$('#icloud-calendars-list')?.addEventListener('click',async e=>{
 const syncBtn=e.target.closest('[data-action="sync-single"]');
 if(syncBtn){
  const extId=syncBtn.dataset.extId;
  const prevText=syncBtn.textContent;
  syncBtn.disabled=true;
  syncBtn.textContent='…';
  try{
   const syncResult=await api(`/api/me/external-calendars/${extId}/sync`,'POST',{});
   if(syncResult.skipped){
    toast(syncResult.reason==='Sync already in progress'?(locale==='en'?'Sync is already in progress.':'이미 동기화가 진행 중입니다. 잠시 후 확인해 주세요.'):(locale==='en'?'Check the iCloud connection and enabled calendars.':'iCloud 연결 상태와 캘린더 활성화 여부를 확인해 주세요.'));return;
   }
   await refreshICloudCalendars();
   if(current)events=await api(`/api/calendars/${current.id}/events`);
   renderCalendarListUI();
   renderCalendar();
   await loadCalendarIntegrations();
   toast(locale==='en'?'Calendar synced.':'캘린더를 동기화했어요.');
  }catch(err){
   toast(err.message);
  }finally{
   syncBtn.disabled=false;
   syncBtn.textContent=prevText;
  }
 }
});

$('#btn-open-disconnect-icloud')?.addEventListener('click',()=>{
 $('#icloud-disconnect-dialog').showModal();
});

async function disconnectICloud(deleteEvents){
 if(!currentICloudConnection)return;
 const connId=currentICloudConnection.id;
 try{
  await api(`/api/me/calendar-connections/${connId}`,'DELETE',{deleteEvents});
  $('#icloud-disconnect-dialog').close();
  me=await api('/api/me');
  calendars=await api('/api/calendars');
  if(current&&!calendars.find(c=>c.id===current.id)){
   current=calendars[0]||null;
   selectedCalendarIds=new Set(calendars.map(c=>c.id));
   saveSelectedCalendars();
  }
  if(current)events=await api(`/api/calendars/${current.id}/events`);
  else events=[];
  renderCalendarListUI();
  renderMobileProfile();
  renderCalendar();
  await loadCalendarIntegrations();
  toast(locale==='en'?'iCloud Calendar disconnected.':'iCloud 캘린더 연결을 해제했어요.');
 }catch(err){
  toast(err.message);
 }
}

$('#btn-disconnect-keep')?.addEventListener('click',()=>disconnectICloud(false));
$('#btn-disconnect-delete')?.addEventListener('click',()=>disconnectICloud(true));

document.addEventListener('click',e=>{
 const b=e.target.closest('[data-open-integrations]');
 if(b){
  const tab=b.dataset.openIntegrations||'icloud';
  
  openCalendarIntegrationsDialog(tab);
  return;
 }
});

let checkingCalendarAccess=false, denyingCalendarAccess=false;
function concealCalendar(){
 if($('#sync-status'))$('#sync-status').textContent='캘린더 연결 확인 중...';
}
function revealCalendar(){
 const root=$('#workspace-root');
 if(root){root.classList.remove('access-concealed');root.inert=false;}
 $('#settings-page')?.classList.remove('access-concealed');
 if($('#settings-page'))$('#settings-page').inert=false;
}
async function denyCalendarAccess(message){
 if(denyingCalendarAccess||deletingCalendarId===current?.id)return;
 denyingCalendarAccess=true;
 closeSettingsPage();revealCalendar();
 connection?.close();connection=null;
 connected=false;events=[];sessions=[];current=null;calendars=[];dateNotes.clear();noteDrafts.clear();monthNotes.clear();monthNoteDrafts.clear();notesRequest++;monthNotesRequest++;
 selectedEvent=null;copiedEvent=null;dragEvent=null;editing=null;managedCalendar=null;
 document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
 document.querySelectorAll('dialog form,#settings-page form').forEach(form=>form.reset());
 ['#agenda-list','#presence-list','#mobile-presence-list','#mobile-profile-calendars','#mobile-menu-calendars','#calendar-details-members','#calendar-details-invites'].forEach(id=>{const el=$(id);if(el)el.innerHTML='';});
 if($('#sync-status'))$('#sync-status').textContent='접속 상태 확인 중...';
 sessionStorage.removeItem('calendar');history.replaceState({},'','/');toast(message);
 try{await boot();}finally{denyingCalendarAccess=false;}
}
async function validateCalendarAccess(conceal=false){
 if(!current||denyingCalendarAccess||deletingCalendarId===current.id)return;
 if(conceal)concealCalendar();
 if(checkingCalendarAccess)return;
 const id=current.id;checkingCalendarAccess=true;
 try{
  const response=await fetch(`/api/calendars/${id}/access`,{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(current?.id!==id)return;
  if(response.status===401||response.status===403){await denyCalendarAccess('접속 권한이 종료됐어요.');return;}
  if(!response.ok)throw new Error('접속 권한 확인 실패');
  const data=await response.json();
  if(current?.id!==id)return;
  revealCalendar();
  if(current.role!==data.role)await refreshCalendarMetadata();
 }catch(error){if(current?.id===id)concealCalendar();}
 finally{checkingCalendarAccess=false;}
}
$('#retry-access-check')?.addEventListener('click',()=>validateCalendarAccess(true));
setInterval(()=>validateCalendarAccess(),60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')validateCalendarAccess();});
window.addEventListener('online',()=>validateCalendarAccess());
document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-end-session]');
 if(!button||button.disabled||current?.role!=='owner')return;
 const id=current.id;
 if(!confirm(`${button.dataset.sessionName}님의 이 기기 세션을 종료할까요? 해당 기기는 로그아웃됩니다.`))return;
 button.disabled=true;
 try{
  await api(`/api/calendars/${id}/stream/${button.dataset.endSession}`,'DELETE',{});
  toast('접속 세션을 종료했어요.');
 }catch(error){toast(error.message);button.disabled=false;}
});

function renderAccountName(){
 if(!me.user||!$('#workspace-root'))return;
 const profile=$('.sidebar-profile');
 if(profile){
  profile.querySelector('.avatar').textContent=me.user.name.slice(0,1);
  profile.querySelector('span:nth-child(2)').firstChild.textContent=me.user.name;
 }
 $('#mobile-menu-account').textContent=me.user.name;
 $('#settings-user-name').textContent=me.user.name;
 $('#settings-user-avatar').textContent=me.user.name.slice(0,1);
 renderMobileProfile();
}
$('#profile-name-form').onsubmit=async e=>{
 e.preventDefault();
 const form=e.currentTarget, submit=form.querySelector('[type=submit]');
 const userId=me.user?.id, name=form.elements.name.value.trim();
 if(!name){$('#profile-name-error').textContent='이름을 입력해 주세요.';form.elements.name.focus();return;}
 submit.disabled=true;submit.textContent='저장 중…';$('#profile-name-error').textContent='';
 try{
  const result=await api('/api/me','PATCH',{name});
  if(me.user?.id!==userId)return;
  me.user={...me.user,...result.user};form.elements.name.value=result.user.name;
  renderAccountName();toast('이름을 변경했어요.');
 }catch(error){$('#profile-name-error').textContent=error.message;}
 finally{submit.disabled=false;submit.textContent='이름 저장';}
};

function noteDateMarker(date){return dateNotes.get(date)?.content?.trim()?'<span class="date-note-dot" role="img" aria-label="메모 있음"></span>':'';}
async function loadDateNotes(){
 if(!current)return;
 const id=current.id, request=++notesRequest;
 const rows=await api(`/api/calendars/${id}/notes`);
 if(current?.id!==id||request!==notesRequest)return;
 dateNotes.clear();rows.forEach(note=>dateNotes.set(note.date,note));
 renderCalendar();
}
function currentNoteDraft(){
 if(!current)return null;
 const key=`${current.id}/${selected}`, saved=dateNotes.get(selected);
 let draft=noteDrafts.get(key);
 if(!draft){draft={content:saved?.content||'',version:saved?.version||0,editing:!saved?.content,dirty:false,saving:false,error:''};noteDrafts.set(key,draft);}
 if(!draft.dirty&&!draft.saving){draft.content=saved?.content||'';draft.version=saved?.version||0;}
 if(current.role==='viewer'){draft.content=saved?.content||'';draft.version=saved?.version||0;draft.editing=false;draft.dirty=false;draft.error='';}
 return draft;
}
function renderDateNote(){
 const section=$('#date-note-section');if(!section)return;
 section.hidden=!current;if(!current)return;
 const draft=currentNoteDraft(), writable=current.role!=='viewer', input=$('#date-note-input');
 const date=new Date(`${selected}T12:00:00`);
 $('#date-note-heading').textContent=`${dateLabel(date)} ${locale==='en'?'notes':'노트'}`;
 if(input.value!==draft.content)input.value=draft.content;
 input.readOnly=!writable||!draft.editing||draft.saving;
 $('#date-note-badge').hidden=!dateNotes.get(selected)?.content;
 $('#edit-date-note').hidden=!writable||draft.editing;
 $('#edit-date-note').textContent=dateNotes.get(selected)?.content?'수정':'작성';
 $('#cancel-date-note').hidden=!writable||!draft.editing;
 $('#save-date-note').hidden=!writable||!draft.editing;
 $('#cancel-date-note').disabled=draft.saving;
 $('#save-date-note').disabled=draft.saving;
 $('#save-date-note').textContent=draft.saving?'저장 중…':'저장';
 $('#date-note-error').textContent=draft.error||'';
 $('#date-note-status').textContent=!writable?'보기 전용 · 메모는 편집 권한이 있는 참여자가 수정할 수 있어요.':draft.dirty?'아직 저장하지 않은 메모예요.':draft.editing?'최대 5,000자 · 내용을 비워 저장하면 메모 표시가 사라져요.':draft.content?'저장된 메모':'이 날짜에 저장된 메모가 없어요.';
}
function updateNoteDraft(){
 const draft=currentNoteDraft();if(!draft||draft.saving||current.role==='viewer')return;
 draft.content=$('#date-note-input').value;draft.dirty=true;draft.error='';renderDateNote();
}
function setNoteEditing(editing,reset=false){
 const draft=currentNoteDraft();if(!draft||draft.saving)return;
 if(reset){const saved=dateNotes.get(selected);draft.content=saved?.content||'';draft.version=saved?.version||0;draft.dirty=false;draft.error='';}
 draft.editing=editing;renderDateNote();if(editing)$('#date-note-input').focus();
}
async function saveDateNote(event){
 event.preventDefault();if(!current||current.role==='viewer')return;
 const draft=currentNoteDraft();if(draft.saving)return;
 const id=current.id,date=selected,key=`${id}/${date}`;
 draft.saving=true;draft.error='';notesRequest++;renderDateNote();
 try{
  const saved=await api(`/api/calendars/${id}/notes/${date}`,'PUT',{content:draft.content,version:draft.version});
  if(!current)return;
  noteDrafts.set(key,{content:saved.content,version:saved.version,editing:false,dirty:false,saving:false,error:''});
  if(current.id===id){dateNotes.set(date,saved);renderCalendar();}
  toast('메모를 저장했어요.');
 }catch(error){
  draft.error=error.message;
  if(error.status===409&&current?.id===id){try{await loadDateNotes();}catch{}}
 }finally{draft.saving=false;if(current?.id===id&&selected===date)renderDateNote();}
}

function monthNoteMarker(mKey){
 return monthNotes.get(mKey)?.content?.trim()?'<span class="month-note-dot" role="img" aria-label="월 메모 있음" title="월 메모 있음"></span>':'';
}
async function loadMonthNotes(){
 if(!current)return;
 const id=current.id, request=++monthNotesRequest;
 const rows=await api(`/api/calendars/${id}/month-notes`);
 if(current?.id!==id||request!==monthNotesRequest)return;
 monthNotes.clear();rows.forEach(note=>monthNotes.set(note.month,note));
 renderCalendar();
 renderMonthNote();
}
function currentMonthNoteDraft(){
 if(!current)return null;
 const mKey=visibleMonth(), key=`${current.id}/${mKey}`, saved=monthNotes.get(mKey);
 let draft=monthNoteDrafts.get(key);
 if(!draft){draft={content:saved?.content||'',version:saved?.version||0,editing:!saved?.content,dirty:false,saving:false,error:''};monthNoteDrafts.set(key,draft);}
 if(!draft.dirty&&!draft.saving){draft.content=saved?.content||'';draft.version=saved?.version||0;}
 if(current.role==='viewer'){draft.content=saved?.content||'';draft.version=saved?.version||0;draft.editing=false;draft.dirty=false;draft.error='';}
 return draft;
}
function renderMonthNote(){
 const section=$('#month-note-section');if(!section)return;
 section.hidden=!current;if(!current)return;
 const mKey=visibleMonth();
 const draft=currentMonthNoteDraft(), writable=current.role!=='viewer', input=$('#month-note-input');
 const [y, m]=mKey.split('-').map(Number);
 const mDate=new Date(y, m-1, 1);
 const monthTitleStr=mDate.toLocaleDateString(locale==='en'?'en-US':'ko-KR',{year:'numeric',month:'long'});
 $('#month-note-heading').textContent=`${monthTitleStr} ${locale==='en'?'notes':'노트'}`;
 if(input.value!==draft.content)input.value=draft.content;
 input.readOnly=!writable||!draft.editing||draft.saving;
 $('#month-note-badge').hidden=!monthNotes.get(mKey)?.content;
 $('#edit-month-note').hidden=!writable||draft.editing;
 $('#edit-month-note').textContent=monthNotes.get(mKey)?.content?'수정':'작성';
 $('#cancel-month-note').hidden=!writable||!draft.editing;
 $('#save-month-note').hidden=!writable||!draft.editing;
 $('#cancel-month-note').disabled=draft.saving;
 $('#save-month-note').disabled=draft.saving;
 $('#save-month-note').textContent=draft.saving?'저장 중…':'저장';
 $('#month-note-error').textContent=draft.error||'';
 $('#month-note-status').textContent=!writable?'보기 전용 · 메모는 편집 권한이 있는 참여자가 수정할 수 있어요.':draft.dirty?'아직 저장하지 않은 메모예요.':draft.editing?'최대 5,000자 · 내용을 비워 저장하면 메모 표시가 사라져요.':draft.content?'저장된 메모':'이 달에 저장된 메모가 없어요.';
}
function updateMonthNoteDraft(){
 const draft=currentMonthNoteDraft();if(!draft||draft.saving||current.role==='viewer')return;
 draft.content=$('#month-note-input').value;draft.dirty=true;draft.error='';renderMonthNote();
}
function setMonthNoteEditing(editing,reset=false){
 const draft=currentMonthNoteDraft();if(!draft||draft.saving)return;
 const mKey=visibleMonth();
 if(reset){const saved=monthNotes.get(mKey);draft.content=saved?.content||'';draft.version=saved?.version||0;draft.dirty=false;draft.error='';}
 draft.editing=editing;renderMonthNote();if(editing)$('#month-note-input').focus();
}
async function saveMonthNote(event){
 event.preventDefault();if(!current||current.role==='viewer')return;
 const draft=currentMonthNoteDraft();if(draft.saving)return;
 const id=current.id,mKey=visibleMonth(),key=`${id}/${mKey}`;
 draft.saving=true;draft.error='';monthNotesRequest++;renderMonthNote();
 try{
  const saved=await api(`/api/calendars/${id}/month-notes/${mKey}`,'PUT',{content:draft.content,version:draft.version});
  if(!current)return;
  monthNoteDrafts.set(key,{content:saved.content,version:saved.version,editing:false,dirty:false,saving:false,error:''});
  if(current.id===id){monthNotes.set(mKey,saved);renderCalendar();}
  toast('월 메모를 저장했어요.');
 }catch(error){
  draft.error=error.message;
  if(error.status===409&&current?.id===id){try{await loadMonthNotes();}catch{}}
 }finally{draft.saving=false;if(current?.id===id&&visibleMonth()===mKey)renderMonthNote();}
}

let migrationSources=[],migrationTargets=[],migrationPreview=null,migrationResult=null,migrationLoading=0,migrationBusy=false;
function invalidateMigrationPreview(){
 migrationPreview=null;$('#migration-preview').hidden=true;$('#migration-result').hidden=true;
 $('#migration-share-consent').checked=false;$('#migration-commit-btn').disabled=true;
 $('#migration-error').textContent='';
}
function renderMigrationSources(){
 const target=$('#migration-target').value;
 $('#migration-sources').innerHTML=['google','icloud','moa'].map(provider=>{
  const sources=migrationSources.filter(s=>s.provider===provider);
  if(!sources.length)return '';
  const title={google:'Google',icloud:'Apple iCloud',moa:'모아'}[provider];
  return `<div class="migration-source-group"><h4>${title}</h4>${sources.map(source=>{
   const isTarget=source.id==='moa:'+target;
   return `<label><input type="checkbox" name="migration-source" value="${esc(source.id)}" ${isTarget?'disabled':provider!=='moa'?'checked':''}><span>${esc(source.name)}</span>${isTarget?'<small>대상 캘린더</small>':''}</label>`;
  }).join('')}</div>`;
 }).join('')||'<p class="muted small">가져올 캘린더가 없어요. iCloud 또는 Google을 먼저 연결하세요.</p>';
}
async function loadMigrationSources(){
 if(migrationBusy)return;
 const request=++migrationLoading;
 invalidateMigrationPreview();
 $('#migration-preview-btn').disabled=true;
 $('#migration-source-status').textContent='캘린더를 불러오는 중…';
 try{
  const result=await api('/api/me/calendar-migration/sources');
  if(request!==migrationLoading)return;
  migrationSources=result.sources;migrationTargets=result.targets;
  $('#migration-target').innerHTML=migrationTargets.length?migrationTargets.map(target=>`<option value="${esc(target.id)}">${esc(target.name)}</option>`).join(''):'<option value="">편집할 수 있는 모아 캘린더가 없어요.</option>';
  const preferred=migrationTargets.find(t=>t.id===migrationResult?.id)||migrationTargets.find(t=>t.id===current?.id);
  if(preferred)$('#migration-target').value=preferred.id;
  renderMigrationSources();
  const next=encodeURIComponent('/settings/migrate');
  $('#migration-source-status').innerHTML=(result.errors||[]).map(error=>`<div class="migration-source-warning">${esc(error.message)}${error.needsAuthorization?`<br><a href="/auth/google?link=true&next=${next}">전체 Google 캘린더 권한 연결 ↗</a>`:''}</div>`).join('');
  if(!migrationTargets.length)$('#migration-error').textContent='캘린더 관리에서 모아 캘린더를 먼저 만들어 주세요.';
  $('#migration-preview-btn').disabled=!migrationSources.length||!migrationTargets.length;
 }catch(error){
  if(request!==migrationLoading)return;
  $('#migration-source-status').textContent='';$('#migration-error').textContent=error.message;
 }
}
function initializeMigrationUI(){
 const now=new Date(),from=new Date(now),to=new Date(now);
 from.setFullYear(from.getFullYear()-1);to.setFullYear(to.getFullYear()+1);
 $('#migration-from').value=dateKey(from);$('#migration-to').value=dateKey(to);
 $('#migration-preview-form').onchange=e=>{
  if(migrationBusy)return;
  invalidateMigrationPreview();
  if(e.target.id==='migration-target')renderMigrationSources();
 };
 $('#migration-select-all').onclick=()=>{
  if(migrationBusy)return;
  const inputs=[...document.querySelectorAll('#migration-sources input:not(:disabled)')];
  const checked=!inputs.every(input=>input.checked);
  inputs.forEach(input=>input.checked=checked);invalidateMigrationPreview();
 };
 $('#migration-preview-form').onsubmit=async e=>{
  e.preventDefault();if(migrationBusy)return;
  invalidateMigrationPreview();
  const input={targetId:$('#migration-target').value,sourceIds:[...document.querySelectorAll('#migration-sources input:checked:not(:disabled)')].map(input=>input.value),from:$('#migration-from').value,to:$('#migration-to').value,deduplicate:$('#migration-deduplicate').checked};
  if(!input.sourceIds.length){$('#migration-error').textContent='가져올 캘린더를 하나 이상 선택해 주세요.';return;}
  const request=++migrationLoading,button=$('#migration-preview-btn');
  migrationBusy=true;button.disabled=true;button.textContent='가져올 일정을 확인하는 중…';
  $('#migration-preview-form').querySelectorAll('input,select,button').forEach(control=>control.disabled=true);
  try{
   const result=await api('/api/me/calendar-migration/preview','POST',input);
   if(request!==migrationLoading)return;
   migrationPreview=result;
   $('#migration-preview-summary').textContent=locale==='en'?`${result.total} events found · ${result.imported} to import into ${result.targetName} · ${result.skipped} duplicates skipped`:`총 ${result.total}개 일정 중 ${result.imported}개를 ‘${result.targetName}’에 가져옵니다. 중복 ${result.skipped}개는 건너뜁니다.`;
   $('#migration-preview-counts').innerHTML=result.counts.map(source=>`<div class="migration-count-row"><span>${esc(({google:'Google',icloud:'iCloud',moa:'모아'}[source.provider]))} · ${esc(source.name)}</span><strong>${source.count}${locale==='en'?' events':'개'}</strong></div>`).join('');
   $('#migration-preview').hidden=false;
   $('#migration-share-consent').disabled=!result.imported;
   $('#migration-preview').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){$('#migration-error').textContent=error.message;}
  finally{
   migrationBusy=false;button.textContent='가져올 일정 미리보기';
   $('#migration-preview-form').querySelectorAll('input,select,button').forEach(control=>control.disabled=false);
   const targetInput=[...document.querySelectorAll('#migration-sources input')].find(input=>input.value==='moa:'+$('#migration-target').value);
   if(targetInput)targetInput.disabled=true;
  }
 };
 $('#migration-share-consent').onchange=e=>$('#migration-commit-btn').disabled=!migrationPreview?.imported||!e.target.checked||migrationBusy;
 $('#migration-commit-btn').onclick=async()=>{
  if(migrationBusy||!migrationPreview||!$('#migration-share-consent').checked)return;
  const button=$('#migration-commit-btn'),previewId=migrationPreview.previewId;
  migrationBusy=true;button.disabled=true;button.textContent='일정을 가져오는 중…';
  $('#migration-preview-form').inert=true;$('#migration-share-consent').disabled=true;
  $('#migration-error').textContent='';
  try{
   migrationResult=await api('/api/me/calendar-migration/commit','POST',{previewId,shareAcknowledged:true});
   const result=migrationResult;
   $('#migration-preview').hidden=true;$('#migration-result').hidden=false;
   $('#migration-result-summary').textContent=locale==='en'?`Imported ${result.imported} events into ${result.targetName}. Skipped ${result.skipped} duplicates.`:`‘${result.targetName}’에 일정 ${result.imported}개를 가져왔어요. 중복 ${result.skipped}개는 건너뛰었어요.`;
   migrationPreview=null;
   try{await loadAllSelectedEvents();renderCalendar();}catch{toast('가져오기가 완료되었습니다. 캘린더를 새로고침해 주세요.');}
   $('#migration-result').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){$('#migration-error').textContent=error.message;}
  finally{
   migrationBusy=false;button.textContent='선택한 캘린더로 가져오기';
   button.disabled=!migrationPreview;$('#migration-preview-form').inert=false;$('#migration-share-consent').disabled=false;
  }
 };
 $('#migration-view-target').onclick=()=>{if(migrationResult)selectCalendar(migrationResult.id);};
}

initializeSettingsPage();
initializeMigrationUI();
initializeLunarSettings();
initializeWeatherSettings();
registerServiceWorker();

const initialAuthPath = location.pathname.startsWith('/auth') || location.search.includes('error=');
if (!initialAuthPath && !location.pathname.startsWith('/invite/')) {
 renderShell();
 renderCalendar();
}
boot();

function renderGoogleImportAuthorization(){
 const connected=Boolean(me?.user?.hasGoogleCalendar), status=$('#google-import-authorization');
 if(!status)return;
 const next=encodeURIComponent(location.pathname+location.search);
 status.innerHTML=connected?(locale==='en'?'<p class="small">Google Calendar read access is connected.</p><button type="button" class="text-button danger" data-disconnect-google>Disconnect Google Calendar access</button>':'<p class="small">Google 캘린더 읽기 권한이 연결되어 있어요.</p><button type="button" class="text-button danger" data-disconnect-google>Google 캘린더 권한 해제</button>'):(locale==='en'?`<p class="small">Google sign-in and Calendar access are authorized separately.</p>${me.providers.google?`<a class="secondary full" href="/auth/google?link=true&next=${next}">Connect Google Calendar access</a>`:''}`:`<p class="small">Google 로그인과 캘린더 권한은 별도로 연결해요.</p>${me.providers.google?`<a class="secondary full" href="/auth/google?link=true&next=${next}">Google 캘린더 권한 연결</a>`:''}`);
 $('#btn-import-google').disabled=!connected;
}
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-disconnect-google]');
 if(!button||button.disabled)return;
 if(!confirm('구글 캘린더 연결을 해제할까요? 로그인 계정과 이미 가져온 일정은 유지됩니다.'))return;
 button.disabled=true;
 try{
  const result=await api('/api/me/google-calendar','DELETE',{});
  me=await api('/api/me');renderMobileProfile();renderGoogleImportAuthorization();
  toast(translateMessage(result.remoteRevoked?'구글 캘린더 연결을 해제했어요.':'앱의 연결 정보는 삭제했어요. Google 계정 설정에서도 앱 권한을 철회해 주세요.'));
 }catch(error){toast(error.message);button.disabled=false;}
});

function openScheduleShareDialog(){
 if(!me?.user) return;
 const dialog=$('#schedule-share-dialog');
 if(!dialog) return;

 const select=$('#share-calendar-select');
 if(select){
  select.innerHTML='<option value="all">내 모든 캘린더 일정</option>'+
   calendars.map(c=>`<option value="${c.id}" ${current?.id===c.id?'selected':''}>${esc(c.name)}</option>`).join('');
 }

 const targetDateInput=$('#share-target-date');
 if(targetDateInput){
  targetDateInput.value=selected||dateKey(new Date());
 }

 $('#create-share-error').textContent='';
 $('#created-share-result').hidden=true;
 $('#create-schedule-share-form').reset();
 if(targetDateInput)targetDateInput.value=selected||dateKey(new Date());
 if(select&&current)select.value=current.id;
 $('#share-custom-expires-wrap').hidden=true;

 switchShareTab('create');
 loadScheduleSharesBadge();
 dialog.showModal();
}

function switchShareTab(tab){
 const isCreate=tab==='create';
 $('#tab-create-share').classList.toggle('active',isCreate);
 $('#tab-create-share').setAttribute('aria-selected',String(isCreate));
 $('#tab-manage-shares').classList.toggle('active',!isCreate);
 $('#tab-manage-shares').setAttribute('aria-selected',String(!isCreate));
 $('#panel-create-share').hidden=!isCreate;
 $('#panel-manage-shares').hidden=isCreate;

 if(!isCreate){
  loadScheduleSharesList();
 }
}

async function loadScheduleSharesBadge(){
 try{
  const list=await api('/api/schedule-shares');
  const badge=$('#share-count-badge');
  if(badge)badge.textContent=String(list.length);
 }catch{}
}

async function loadScheduleSharesList(){
 const listEl=$('#share-links-list');
 const statusEl=$('#share-list-status');
 if(!listEl) return;
 statusEl.textContent='공유 링크를 불러오는 중…';
 listEl.innerHTML='';

 try{
  const shares=await api('/api/schedule-shares');
  const badge=$('#share-count-badge');
  if(badge)badge.textContent=String(shares.length);

  if(shares.length===0){
   statusEl.textContent='';
   listEl.innerHTML='<div class="empty-shares-msg">생성된 공유 링크가 없습니다.<br>새 링크 만들기 탭에서 일정을 공유해 보세요.</div>';
   return;
  }

  statusEl.textContent=`총 ${shares.length}개의 공유 링크가 있습니다.`;
  listEl.innerHTML=shares.map(s=>{
   const isExpired=s.is_expired;
   const isRevoked=s.is_revoked;
   const statusClass=isRevoked?'revoked':isExpired?'expired':'active';
   const statusText=isRevoked?'공유 중단':isExpired?'만료됨':'공유 중';
   const periodMap={day:'하루',week:'일주일',month:'이번 달'};
   const periodLabel=periodMap[s.period]||s.period;

   let expText='만료 없음';
   if(s.expires_at){
    const expDate=new Date(s.expires_at);
    expText=`${expDate.getFullYear()}.${expDate.getMonth()+1}.${expDate.getDate()} ${String(expDate.getHours()).padStart(2,'0')}:${String(expDate.getMinutes()).padStart(2,'0')} 만료`;
   }

   let lastSeenText='조회 기록 없음';
   if(s.last_viewed_at){
    const lv=new Date(s.last_viewed_at);
    lastSeenText=`${lv.getFullYear()}.${lv.getMonth()+1}.${lv.getDate()} ${String(lv.getHours()).padStart(2,'0')}:${String(lv.getMinutes()).padStart(2,'0')}`;
   }

   return `
    <div class="share-item-card" data-share-id="${s.id}">
     <div class="share-card-header">
      <div class="share-card-title-group">
       <span class="share-status-pill ${statusClass}">${statusText}</span>
       <span class="share-period-pill">${periodLabel}</span>
       <strong class="share-card-title">${esc(s.title)}</strong>
      </div>
     </div>
     <div class="share-card-meta">
      <span>📅 기준일: <strong>${esc(s.target_date)}</strong></span>
      <span>⏳ ${expText}</span>
      <span>👥 방문자: <strong>${s.visitor_count||0}명</strong></span>
      <span>👁️ 총 조회: <strong>${s.total_views||0}회</strong></span>
      <span>🕒 최근: ${lastSeenText}</span>
     </div>
     <div class="share-card-url-box">
      <input type="text" value="${esc(s.url)}" readonly class="share-url-input">
      <button type="button" class="secondary share-copy-btn" data-url="${esc(s.url)}">복사</button>
      <a href="${esc(s.url)}" target="_blank" rel="noopener" class="secondary share-open-btn">열기 ↗</a>
     </div>
     <div class="share-card-actions">
      <button type="button" class="secondary share-visitors-toggle-btn" data-share-id="${s.id}">
       <span>👥 방문자 상세 확인 (${s.visitor_count||0}명)</span> <span class="arrow-icon">▾</span>
      </button>
      <button type="button" class="danger text-button share-delete-btn" data-share-id="${s.id}">삭제</button>
     </div>
     <div class="share-visitors-panel" id="visitors-panel-${s.id}" hidden>
      <div class="visitors-loading small muted">방문자 기록 불러오는 중…</div>
     </div>
    </div>
   `;
  }).join('');

  listEl.querySelectorAll('.share-copy-btn').forEach(btn=>{
   btn.onclick=async()=>{
    try{
     await navigator.clipboard.writeText(btn.dataset.url);
     toast('공유 링크를 복사했어요.');
    }catch{
     btn.previousElementSibling?.select();
     toast('링크를 선택했어요. 복사해 주세요.');
    }
   };
  });

  listEl.querySelectorAll('.share-delete-btn').forEach(btn=>{
   btn.onclick=async()=>{
    if(!confirm('이 공유 링크를 삭제할까요? 더 이상 이 링크로 일정을 볼 수 없습니다.'))return;
    try{
     await api(`/api/schedule-shares/${btn.dataset.shareId}`,'DELETE');
     toast('공유 링크를 삭제했어요.');
     loadScheduleSharesList();
     loadScheduleSharesBadge();
    }catch(e){
     toast(e.message);
    }
   };
  });

  listEl.querySelectorAll('.share-visitors-toggle-btn').forEach(btn=>{
   btn.onclick=()=>toggleShareVisitorsPanel(btn.dataset.shareId,btn);
  });

 }catch(err){
  statusEl.textContent='공유 목록을 불러오지 못했습니다: '+err.message;
 }
}

async function toggleShareVisitorsPanel(shareId,toggleBtn){
 const panel=$(`#visitors-panel-${shareId}`);
 if(!panel) return;

 const isHidden=panel.hidden;
 panel.hidden=!isHidden;
 toggleBtn.querySelector('.arrow-icon').textContent=isHidden?'▴':'▾';

 if(isHidden){
  panel.innerHTML='<div class="small muted">방문자 기록 불러오는 중…</div>';
  try{
   const data=await api(`/api/schedule-shares/${shareId}`);
   const visitors=data.visitors||[];

   if(visitors.length===0){
    panel.innerHTML='<div class="small muted" style="padding:12px;background:#f7faf5;border-radius:8px;text-align:center;">아직 이 링크를 조회한 방문자가 없습니다.</div>';
    return;
   }

   const totalViews=visitors.reduce((acc,v)=>acc+(v.view_count||1),0);

   panel.innerHTML=`
    <div class="visitors-summary-box">
     총 <strong>${visitors.length}명</strong>의 고유 방문자가 <strong>${totalViews}회</strong> 열람했습니다.
     <small class="muted" style="display:block;margin-top:2px;">(동일한 환경/기기에서의 재방문은 동일 사용자로 인식됩니다)</small>
    </div>
    <div class="visitors-list-cards">
     ${visitors.map((v,idx)=>{
      const firstDate=new Date(v.first_seen_at);
      const lastDate=new Date(v.last_seen_at);
      const firstStr=`${firstDate.getMonth()+1}/${firstDate.getDate()} ${String(firstDate.getHours()).padStart(2,'0')}:${String(firstDate.getMinutes()).padStart(2,'0')}`;
      const lastStr=`${lastDate.getMonth()+1}/${lastDate.getDate()} ${String(lastDate.getHours()).padStart(2,'0')}:${String(lastDate.getMinutes()).padStart(2,'0')}`;
      const isRepeat=v.view_count>1;

      return `
       <div class="visitor-item">
        <div class="visitor-top">
         <span class="visitor-name">👤 ${v.logged_user_name?`${esc(v.logged_user_name)} (로그인)`:`방문자 #${idx+1}`}</span>
         <span class="visitor-views-count ${isRepeat?'repeat':''}">${v.view_count}회 조회${isRepeat?' (재방문)':''}</span>
        </div>
        <div class="visitor-env">
         <span>📱 <strong>${esc(v.device_info)}</strong></span>
        </div>
        <div class="visitor-time small muted">
         <span>최초: ${firstStr}</span>
         ${isRepeat?`<span>최근: ${lastStr}</span>`:''}
         ${v.ip?`<span>IP: ${esc(v.ip.slice(0,18))}</span>`:''}
        </div>
       </div>
      `;
     }).join('')}
    </div>
   `;
  }catch(e){
   panel.innerHTML=`<div class="form-error">방문자 기록 오류: ${esc(e.message)}</div>`;
  }
 }
}

async function handleCreateScheduleShare(event){
 event.preventDefault();
 const form=$('#create-schedule-share-form');
 const errorEl=$('#create-share-error');
 const submitBtn=$('#submit-create-share');
 errorEl.textContent='';
 submitBtn.disabled=true;

 try{
  const period=form.elements.share_period.value;
  const calendarId=$('#share-calendar-select').value;
  const targetDate=$('#share-target-date').value;
  const expiresChoice=$('#share-expires-select').value;
  let expiresIn=expiresChoice;
  if(expiresChoice==='custom'){
   const customVal=$('#share-custom-expires').value;
   if(!customVal)throw new Error('만료 일시를 선택해 주세요.');
   expiresIn=new Date(customVal).toISOString();
  }
  const title=$('#share-title-input').value.trim();

  const result=await api('/api/schedule-shares','POST',{
   period,
   calendar_id:calendarId,
   target_date:targetDate,
   expires_in:expiresIn,
   title
  });

  $('#created-share-url').value=result.url;
  $('#open-created-share-btn').href=result.url;
  $('#created-share-result').hidden=false;
  loadScheduleSharesBadge();
  toast('일정 공유 링크가 생성되었습니다!');
 }catch(err){
  errorEl.textContent=err.message;
 }finally{
  submitBtn.disabled=false;
 }
}

$('#tab-create-share')?.addEventListener('click',()=>switchShareTab('create'));
$('#tab-manage-shares')?.addEventListener('click',()=>switchShareTab('manage'));
$('#share-expires-select')?.addEventListener('change',e=>{
 $('#share-custom-expires-wrap').hidden=e.target.value!=='custom';
});
$('#create-schedule-share-form')?.addEventListener('submit',handleCreateScheduleShare);
$('#copy-created-share-btn')?.addEventListener('click',async()=>{
 const url=$('#created-share-url').value;
 try{
  await navigator.clipboard.writeText(url);
  toast('공유 링크가 클립보드에 복사되었습니다.');
 }catch{
  $('#created-share-url').select();
  toast('링크를 선택했습니다. 직접 복사해 주세요.');
 }
});
$('#view-all-shares-btn')?.addEventListener('click',()=>switchShareTab('manage'));
$('[data-mobile-action="schedule-share"]')?.addEventListener('click',()=>{
 $('#mobile-more-dialog')?.close();
 openScheduleShareDialog();
});

