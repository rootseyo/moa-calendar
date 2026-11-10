import http from 'node:http';
import { db, query, transaction } from './db.mjs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { servePublicPage } from './public-pages.mjs';
import { GOOGLE_CALENDAR_LIST_SCOPE, GOOGLE_CALENDAR_SCOPE, hasCalendarScope, encryptToken, decryptToken, encryptSecret, decryptSecret, safeReturnPath } from './google-tokens.mjs';
import { EVENT_COLORS, isValidLocalDateTime, weeklyEventRanges, repeatEventRanges } from './public/event-utils.js';
import { WEATHER_PRESET_LOCATIONS, buildOpenMeteoForecastUrl, buildOpenMeteoGeocodingUrl } from './public/weather.js';
import { discoverICloudCalendars, hexToClosestDwmColor } from './caldav.mjs';
import { createSyncEngine } from './caldav-sync.mjs';
import { createCalendarMigration } from './calendar-migration.mjs';
import {createCalendarMoveQueue} from './calendar-moves.mjs';
import {hashPassword,verifyPassword,normalizeEmail,validEmail} from './local-auth.mjs';
import { parseEnvironment, getWeekRange, getMonthRange, renderSharedScheduleHtml } from './schedule-shares.mjs';
import {
  getVapidPublicKey,
  savePushSubscription,
  deletePushSubscription,
  sendPushToUser,
  notifyCalendarActivity,
  startReminderWorker
} from './push-notifications.mjs';
const port = Number(process.env.PORT || 3000);
const origin = process.env.APP_URL || `http://localhost:${port}`;
const demo = process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production';
const all = async (q,...p) => (await query(q,p)).rows;
const one = async (q,...p) => (await query(q,p)).rows[0];
const run = (q,...p) => query(q,p);
const token = () => randomBytes(32).toString('base64url');
const hash = x => createHash('sha256').update(x).digest('hex');
const clients = new Map();
const passwordAttempts=new Map();
function passwordLimit(key){const now=Date.now(),entry=passwordAttempts.get(key);if(!entry||now-entry.since>15*60_000){passwordAttempts.set(key,{since:now,count:0});return false;}return entry.count>=8;}
function recordPasswordAttempt(key){const now=Date.now(),entry=passwordAttempts.get(key);if(!entry||now-entry.since>15*60_000)passwordAttempts.set(key,{since:now,count:1});else entry.count++;if(passwordAttempts.size>5000)for(const [k,v] of passwordAttempts)if(now-v.since>15*60_000)passwordAttempts.delete(k);}
function presence(id,viewer) { return [...clients.values()].filter(c=>c.calendar===id).map(c=>({id:c.id,name:c.user.name,joined:c.joined,is_current:c.session===viewer?.session,can_end:viewer?.role==='owner'&&c.session!==viewer.session})); }
function broadcast(id,event='change') { for(const c of clients.values()) if(c.calendar===id) c.res.write(`event: ${event}\ndata: ${JSON.stringify(event==='presence'?presence(id,c):{})}\n\n`); }
let calendarMoves;
const syncEngine = createSyncEngine({
  hasPendingMove: id=>calendarMoves?.hasPending(id)??false,
  dbQuery: query,
  dbTransaction: transaction,
  broadcastFn: broadcast,
});
calendarMoves=createCalendarMoveQueue({query,engine:syncEngine,broadcast});
function fail(status,message) { throw Object.assign(new Error(message),{status}); }
async function member(ident,user) { const m=await one("SELECT c.id, c.name, m.role FROM calendars c JOIN members m ON m.calendar_id=c.id JOIN users u ON u.id=m.user_id WHERE (c.id=$1 OR c.slug=$1) AND m.user_id=$2 AND c.status='ACTIVE' AND u.status='ACTIVE'",ident,user.id); if(!m) fail(403,'이 캘린더에 접근할 권한이 없습니다.'); return m; }
async function administratorTask(id,user,work){
 return transaction(async client=>{
  const mem=(await client.query("SELECT role FROM members WHERE calendar_id=$1 AND user_id=$2 FOR UPDATE",[id,user.id])).rows[0];
  if(mem?.role!=='owner')fail(403,'관리자만 사용할 수 있는 기능입니다.');
  return work(client);
 });
}
async function writeAccess(ident,user) {
 const m=await member(ident,user);
 if(m.role==='viewer')fail(403,'읽기 전용 멤버는 일정을 수정할 수 없습니다.');
 const readOnly=await one("SELECT 1 FROM calendars c WHERE c.id=$1 AND (c.source_provider='google' OR EXISTS(SELECT 1 FROM external_calendars ec WHERE ec.calendar_id=c.id AND (ec.is_read_only OR ec.sync_direction='read_only'))) ",m.id);
 if(readOnly)fail(403,'읽기 전용 캘린더입니다. 기본 캘린더에 일정을 복사해 주세요.');
}
function cookie(name,value,age) { return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${origin.startsWith('https:')?'; Secure':''}`; }
async function signIn(res,id,name) { await run('INSERT INTO users(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET updated_at=now()',id,name); const account=await one('SELECT status FROM users WHERE id=$1',id);if(account.status!=='ACTIVE')fail(403,'이용이 정지된 계정입니다.');const t=token(); await run('INSERT INTO sessions(token,user_id,expires) VALUES($1,$2,$3)',hash(t),id,Date.now()+604800000); res.setHeader('Set-Cookie',cookie('session',t,604800)); }
const providers = {
 google:{auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',info:'https://openidconnect.googleapis.com/v1/userinfo',scope:'openid',calendarScope:`openid ${GOOGLE_CALENDAR_SCOPE} ${GOOGLE_CALENDAR_LIST_SCOPE}`,id:process.env.GOOGLE_CLIENT_ID,secret:process.env.GOOGLE_CLIENT_SECRET},
 kakao:{auth:'https://kauth.kakao.com/oauth/authorize',token:'https://kauth.kakao.com/oauth/token',info:'https://kapi.kakao.com/v2/user/me',scope:'profile_nickname',id:process.env.KAKAO_CLIENT_ID,secret:process.env.KAKAO_CLIENT_SECRET}
};
async function getLinkedAccounts(userId) {
 try {
  const rows = await all('SELECT provider, created_at FROM user_accounts WHERE user_id=$1', userId);
  return rows.map(r=>r.provider);
 } catch { return []; }
}
async function clearGoogleCalendar(userId) {
 return transaction(async client=>{
  await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
  const {rows}=await client.query("SELECT access_token,refresh_token FROM user_accounts WHERE user_id=$1 AND provider='google' FOR UPDATE",[userId]);
  await client.query("UPDATE user_accounts SET access_token=NULL,refresh_token=NULL,token_expires=NULL,token_scope='',updated_at=now() WHERE user_id=$1 AND provider='google'",[userId]);
  await client.query('UPDATE users SET google_calendar_generation=google_calendar_generation+1 WHERE id=$1',[userId]);
  await client.query("DELETE FROM oauth WHERE linked_user_id=$1 AND provider='google'",[userId]);
  return rows;
 });
}
async function getValidGoogleAccessToken(userId) {
 const acc=await one("SELECT a.*,u.google_calendar_generation FROM user_accounts a JOIN users u ON u.id=a.user_id WHERE a.user_id=$1 AND a.provider='google'",userId);
 if(!acc||!hasCalendarScope(acc.token_scope))return null;
 if(acc.access_token&&Number(acc.token_expires)>Date.now()+60000)return decryptToken(acc.access_token,userId);
 if(!acc.refresh_token)return null;
 const tokenRes=await fetch(providers.google.token,{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'refresh_token',refresh_token:decryptToken(acc.refresh_token,userId),client_id:providers.google.id,client_secret:providers.google.secret}),signal:AbortSignal.timeout(10000)
 });
 const data=await tokenRes.json();
 if(!tokenRes.ok||!data.access_token){
  if(data.error==='invalid_grant')await run("UPDATE user_accounts SET access_token=NULL,refresh_token=NULL,token_expires=NULL,token_scope='' WHERE user_id=$1 AND provider='google' AND refresh_token=$2",userId,acc.refresh_token);
  return null;
 }
 if(data.scope&&!hasCalendarScope(data.scope))return null;
 const result=await run("UPDATE user_accounts SET access_token=$1,token_expires=$2,updated_at=now() WHERE user_id=$3 AND provider='google' AND refresh_token=$4 AND EXISTS(SELECT 1 FROM users WHERE id=$3 AND google_calendar_generation=$5)",encryptToken(data.access_token,userId),Date.now()+Number(data.expires_in||3600)*1000,userId,acc.refresh_token,acc.google_calendar_generation);
 return result.rowCount?data.access_token:null;
}
const calendarMigration=createCalendarMigration({query,transaction,getGoogleToken:getValidGoogleAccessToken,broadcast});
const weatherForecastCache=new Map();
const weatherLocationCache=new Map();
async function body(req) { let s=''; for await(const c of req) {s+=c;if(s.length>16000)fail(413,'요청이 너무 큽니다.');} try{return JSON.parse(s||'{}');}catch{fail(400,'잘못된 요청입니다.');} }
const validText = (v,max=100) => typeof v==='string' && v.trim().length>0 && v.length<=max;
async function handleRequest(req,res){
 const url=new URL(req.url,origin), p=url.pathname;
 const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')));
 const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 const redirect=to=>{res.writeHead(302,{Location:to});res.end();};
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
 const analyticsHost=process.env.ANALYTICS_ENDPOINT?(()=>{try{return new URL(process.env.ANALYTICS_ENDPOINT).origin;}catch{return '';}})():'';
 res.setHeader('Content-Security-Policy',`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' ${analyticsHost?analyticsHost+' ':''}https://api.open-meteo.com https://geocoding-api.open-meteo.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
 try{
 if(!['GET','HEAD'].includes(req.method) && req.headers.origin!==origin) fail(403,'허용되지 않은 요청 출처입니다.');
 if (p.startsWith('/api/') || p.startsWith('/auth/')) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
 if(p==='/api/health'){
  if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return json({error:'Method not allowed'},405);}
  if(req.method==='HEAD'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end();}
  return json({status:'ok'});
 }
 if(p==='/api/weather'&&req.method==='GET'){
  const lat=Number(url.searchParams.get('lat')??37.5665);
  const lon=Number(url.searchParams.get('lon')??126.9780);
  const tz=String(url.searchParams.get('timezone')||'Asia/Seoul').trim()||'Asia/Seoul';
  if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180)fail(400,'위치 좌표를 확인해 주세요.');
  const cacheKey=`${lat.toFixed(3)},${lon.toFixed(3)},${tz}`;
  const cached=weatherForecastCache.get(cacheKey);
  if(cached&&cached.expires>Date.now())return json(cached.data);
  try{
   const upstream=await fetch(buildOpenMeteoForecastUrl({latitude:lat,longitude:lon,timezone:tz}),{signal:AbortSignal.timeout(8000)});
   if(!upstream.ok)fail(502,'날씨 정보를 불러오지 못했습니다.');
   const raw=await upstream.json();
   const data={daily:raw.daily||{},hourly:raw.hourly||{},latitude:raw.latitude??lat,longitude:raw.longitude??lon,timezone:raw.timezone||tz};
   if(weatherForecastCache.size>=200)weatherForecastCache.delete(weatherForecastCache.keys().next().value);
   weatherForecastCache.set(cacheKey,{expires:Date.now()+30*60_000,data});
   return json(data);
  }catch(err){
   if(err.status)throw err;
   fail(502,'날씨 정보를 불러오지 못했습니다.');
  }
 }
 if(p==='/api/weather/locations'&&req.method==='GET'){
  const q=String(url.searchParams.get('q')||'').trim();
  const lang=url.searchParams.get('lang')==='en'?'en':'ko';
  if(!validText(q,80))fail(400,'검색할 지역 이름을 입력해 주세요.');
  const qLower=q.toLowerCase();
  const localMatches=WEATHER_PRESET_LOCATIONS.filter(loc=>loc.name.toLowerCase().includes(qLower)||loc.nameEn.toLowerCase().includes(qLower)||(loc.admin1&&loc.admin1.toLowerCase().includes(qLower))).slice(0,5);
  const cacheKey=`${lang}:${qLower}`;
  const cached=weatherLocationCache.get(cacheKey);
  if(cached&&cached.expires>Date.now())return json({results:cached.results});
  try{
   const upstream=await fetch(buildOpenMeteoGeocodingUrl(q,lang),{signal:AbortSignal.timeout(8000)});
   let remoteResults=[];
   if(upstream.ok){
    const raw=await upstream.json();
    remoteResults=(raw.results||[]).map(item=>({
     id:`geo:${item.id||`${Number(item.latitude).toFixed(4)},${Number(item.longitude).toFixed(4)}`}`,
     name:String(item.name||'').trim(),
     nameEn:String(item.name||'').trim(),
     admin1:String(item.admin1||'').trim(),
     country:String(item.country||'').trim(),
     latitude:Number(Number(item.latitude).toFixed(4)),
     longitude:Number(Number(item.longitude).toFixed(4)),
     timezone:String(item.timezone||'Asia/Seoul')
    })).filter(item=>item.name&&Number.isFinite(item.latitude)&&Number.isFinite(item.longitude));
   }
   const merged=[...localMatches];
   for(const r of remoteResults){
    if(!merged.some(m=>Math.abs(m.latitude-r.latitude)<0.05&&Math.abs(m.longitude-r.longitude)<0.05))merged.push(r);
   }
   const results=merged.slice(0,8);
   if(weatherLocationCache.size>=200)weatherLocationCache.delete(weatherLocationCache.keys().next().value);
   weatherLocationCache.set(cacheKey,{expires:Date.now()+60*60_000,results});
   return json({results});
  }catch{
   return json({results:localMatches});
  }
 }
 const shareViewRoute = p.match(/^\/(?:s|share)\/([a-zA-Z0-9_-]+)$/);
 if (shareViewRoute && ['GET', 'HEAD'].includes(req.method)) {
  const shareToken = shareViewRoute[1];
  const share = await one(`
    SELECT s.*, u.name as owner_name, c.name as calendar_name
    FROM schedule_shares s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN calendars c ON c.id = s.calendar_id
    WHERE s.token = $1
  `, shareToken);

  if (!share) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = 404;
    return res.end(req.method === 'HEAD' ? undefined : renderSharedScheduleHtml({
      share: { title: '일정을 찾을 수 없습니다' },
      isRevoked: true,
      origin
    }));
  }

  const isExpired = Boolean(share.expires_at && new Date(share.expires_at) < new Date());
  const isRevoked = Boolean(share.is_revoked);

  const cookieHeader = req.headers.cookie || '';
  const cookieMatch = cookieHeader.match(/moa_svid=([0-9a-fA-F-]{36})/);
  let visitorSessionId = cookieMatch ? cookieMatch[1] : null;
  if (!visitorSessionId) {
    visitorSessionId = randomUUID();
  }
  res.setHeader('Set-Cookie', `moa_svid=${visitorSessionId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);

  if (!isExpired && !isRevoked) {
    const ua = req.headers['user-agent'] || '';
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
    const referer = req.headers['referer'] || '';
    const deviceInfo = parseEnvironment(ua);

    let loggedUserId = null;
    const sessCookie = cookieHeader.match(/session=([a-zA-Z0-9_-]+)/)?.[1];
    if (sessCookie) {
      const logged = await one('SELECT user_id FROM sessions WHERE token=$1 AND expires>$2', hash(sessCookie), Date.now());
      if (logged) loggedUserId = logged.user_id;
    }

    try {
      await transaction(async client => {
        const existing = (await client.query(
          'SELECT id FROM schedule_share_visitors WHERE share_id=$1 AND visitor_session_id=$2 FOR UPDATE',
          [share.id, visitorSessionId]
        )).rows[0];

        let visitorRowId;
        if (existing) {
          visitorRowId = existing.id;
          await client.query(
            'UPDATE schedule_share_visitors SET view_count=view_count+1, last_seen_at=now(), ip=$1, user_agent=$2, device_info=$3, user_id=COALESCE(user_id, $4) WHERE id=$5',
            [ip, ua, deviceInfo, loggedUserId, visitorRowId]
          );
        } else {
          visitorRowId = randomUUID();
          await client.query(
            'INSERT INTO schedule_share_visitors (id, share_id, visitor_session_id, user_id, ip, user_agent, device_info, view_count, first_seen_at, last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7,1,now(),now())',
            [visitorRowId, share.id, visitorSessionId, loggedUserId, ip, ua, deviceInfo]
          );
        }

        await client.query(
          'INSERT INTO schedule_share_views (id, share_id, visitor_id, ip, user_agent, referer, viewed_at) VALUES ($1,$2,$3,$4,$5,$6,now())',
          [randomUUID(), share.id, visitorRowId, ip, ua, referer]
        );
      });
    } catch (err) {
      console.warn('Failed to record share visitor log:', err.message);
    }
  }

  if (isExpired || isRevoked) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = 410;
    return res.end(req.method === 'HEAD' ? undefined : renderSharedScheduleHtml({ share, isExpired, isRevoked, origin }));
  }

  const targetDateStr = share.target_date instanceof Date
    ? share.target_date.toISOString().slice(0, 10)
    : String(share.target_date).slice(0, 10);

  let rangeStart, rangeEnd;
  if (share.period === 'day') {
    rangeStart = `${targetDateStr}T00:00:00`;
    rangeEnd = `${targetDateStr}T23:59:59`;
  } else if (share.period === 'week') {
    const { monStr, sunStr } = getWeekRange(targetDateStr);
    rangeStart = `${monStr}T00:00:00`;
    rangeEnd = `${sunStr}T23:59:59`;
  } else {
    const { firstDay, lastDay } = getMonthRange(targetDateStr);
    rangeStart = `${firstDay}T00:00:00`;
    rangeEnd = `${lastDay}T23:59:59`;
  }

  let events = [];
  if (share.calendar_id) {
    events = await all(`
      SELECT e.*
      FROM events e
      JOIN calendars c ON c.id=e.calendar_id
      WHERE e.calendar_id = $1
        AND e.start <= $2
        AND e.end >= $3
        AND (e.is_cancelled IS NOT TRUE)
        AND c.status = 'ACTIVE'
      ORDER BY e.start, e.title
    `, share.calendar_id, rangeEnd, rangeStart);
  } else {
    events = await all(`
      SELECT e.*
      FROM events e
      JOIN members m ON m.calendar_id = e.calendar_id
      JOIN calendars c ON c.id = e.calendar_id
      WHERE m.user_id = $1
        AND e.start <= $2
        AND e.end >= $3
        AND (e.is_cancelled IS NOT TRUE)
        AND c.status = 'ACTIVE'
      ORDER BY e.start, e.title
    `, share.user_id, rangeEnd, rangeStart);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(req.method === 'HEAD' ? undefined : renderSharedScheduleHtml({ share, events, origin }));
 }
 if (servePublicPage(req, res, p, origin)) return;
 const user=cookies.session?await one('SELECT users.*,sessions.expires FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=$1 AND expires>$2',hash(cookies.session),Date.now()):null;
 if(user?.status==='SUSPENDED') fail(403,'이용이 정지된 계정입니다.');
 if(p==='/api/me'&&req.method==='GET'){
  let linked = [];
  let hasGoogleCalendar = false;
  let hasICloudCalendar = false;
  if(user){
   linked = await getLinkedAccounts(user.id);
   const gToken = await one("SELECT access_token,refresh_token,token_scope,token_expires FROM user_accounts WHERE user_id=$1 AND provider='google'", user.id);
   hasGoogleCalendar = Boolean(gToken && hasCalendarScope(gToken.token_scope) && (gToken.refresh_token || (gToken.access_token && Number(gToken.token_expires)>Date.now())));
   const icloudConn = await one("SELECT id, connection_status FROM calendar_connections WHERE user_id=$1 AND provider='icloud'", user.id).catch(()=>null);
   hasICloudCalendar = Boolean(icloudConn && icloudConn.connection_status === 'connected');
  }
  return json({user:user?{id:user.id,name:user.name,linked,hasGoogleCalendar,hasICloudCalendar}:null,demo,providers:Object.fromEntries(Object.entries(providers).map(([k,v])=>[k,Boolean(v.id&&(k==='kakao'||v.secret))]))});
 }
 if(p==='/api/me'&&req.method==='PATCH'){
 if(!user)fail(401,'로그인이 필요합니다.');const b=await body(req);
 const name=typeof b.name==='string'?b.name.trim():'';
 if(!validText(name,100)||/[\x00-\x1f\x7f]/.test(name))fail(400,'이름은 1~100자로 입력해 주세요.');
 await run('UPDATE users SET name=$1,updated_at=now() WHERE id=$2',name,user.id);
 const affected=await all('SELECT calendar_id FROM members WHERE user_id=$1',user.id);
 for(const c of clients.values())if(c.user.id===user.id){c.user={...c.user,name};c.res.write('event: profile\ndata: {}\n\n');}
 for(const c of affected){broadcast(c.calendar_id,'presence');broadcast(c.calendar_id,'members');}
 return json({user:{id:user.id,name}});
 }
 if(p==='/auth/email/register'&&req.method==='POST'){
  const b=await body(req),email=normalizeEmail(b.email),password=b.password,name=typeof b.name==='string'?b.name.trim():'';
  if(!validEmail(email))fail(400,'올바른 이메일 주소를 입력해 주세요.');
  if(typeof password!=='string'||password.length<12||password.length>128)fail(400,'비밀번호는 12~128자로 입력해 주세요.');
  if(b.acceptedTerms!==true)fail(400,'서비스 이용약관에 동의해 주세요.');
  if(!validText(name,100)||/[\x00-\x1f\x7f]/.test(name))fail(400,'이름은 1~100자로 입력해 주세요.');
  const emailKey=`email:${email}`;
  if(passwordLimit(emailKey))fail(429,'잠시 후 다시 시도해 주세요.');
  recordPasswordAttempt(emailKey);
  const passwordHash=await hashPassword(password),id=`email:${randomUUID()}`;
  try{await transaction(async client=>{await client.query('INSERT INTO users(id,name) VALUES($1,$2)',[id,name]);await client.query('INSERT INTO local_accounts(user_id,email,password_hash,terms_accepted_at) VALUES($1,$2,$3,now())',[id,email,passwordHash]);});}
  catch(error){if(error.code==='23505')fail(409,'이미 가입된 이메일입니다.');throw error;}
  await signIn(res,id,name);return json({ok:true},201);
 }
 if(p==='/auth/email/login'&&req.method==='POST'){
  const b=await body(req),email=normalizeEmail(b.email),password=typeof b.password==='string'?b.password:'';
  if(!validEmail(email)||!password||password.length>128)fail(400,'이메일 또는 비밀번호를 확인해 주세요.');
  const emailKey=`email:${email}`;
  if(passwordLimit(emailKey))fail(429,'로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.');
  const account=await one('SELECT a.user_id,a.password_hash,u.name,u.status FROM local_accounts a JOIN users u ON u.id=a.user_id WHERE a.email=$1',email);
  const accepted=account&&await verifyPassword(password,account.password_hash);
  if(!accepted){recordPasswordAttempt(emailKey);fail(401,'이메일 또는 비밀번호를 확인해 주세요.');}
  passwordAttempts.delete(emailKey);
  if(account.status!=='ACTIVE')fail(403,'이용이 정지된 계정입니다.');
  await signIn(res,account.user_id,account.name);return json({ok:true});
 }
 if(p==='/auth/demo' && req.method==='POST' && demo){const b=await body(req);await signIn(res,`demo:${randomUUID()}`,validText(b.name,30)?b.name:'체험 사용자');return json({ok:true});}
 if(p==='/auth/logout' && req.method==='POST'){if(cookies.session){await run('DELETE FROM sessions WHERE token=$1',hash(cookies.session));for(const [id,c] of clients)if(c.session===hash(cookies.session)){clients.delete(id);c.res.end();broadcast(c.calendar,'presence');}}res.setHeader('Set-Cookie',cookie('session','',0));return json({ok:true});}
 const auth=p.match(/^\/auth\/(google|kakao)(\/callback)?$/);
 if(auth){
 const provider=auth[1],cfg=providers[provider];if(!cfg.id || (provider==='google'&&!cfg.secret))fail(503,'소셜 로그인 키가 아직 설정되지 않았습니다.');
 const callback=`${origin}/auth/${provider}/callback`;
 if(!auth[2]){
  const state=token(),verifier=token();
  const next=safeReturnPath(url.searchParams.get('next'),origin);
  const isLink=url.searchParams.get('link')==='true'&&Boolean(user);
  await run('DELETE FROM oauth WHERE expires<$1',Date.now());
  await run('INSERT INTO oauth(state,provider,verifier,next,expires,linked_user_id,google_generation) VALUES($1,$2,$3,$4,$5,$6,$7)',hash(state),provider,verifier,next,Date.now()+600000,isLink?user.id:null,isLink?user.google_calendar_generation:null);
  res.setHeader('Set-Cookie',cookie('oauth_state',state,600));
  const target=new URL(cfg.auth);
  const reqScope = (provider==='google' && isLink)?cfg.calendarScope:cfg.scope;
  target.search=new URLSearchParams({client_id:cfg.id,redirect_uri:callback,response_type:'code',scope:reqScope,state,...(provider==='google'?{code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',...(isLink?{access_type:'offline',prompt:'consent'}:{})}:{})});
  return redirect(target.href);
 }
 const state=url.searchParams.get('state');
 if(!state || cookies.oauth_state!==state){
  console.warn('OAUTH_STATE_MISMATCH:',{receivedState:Boolean(state),hasCookie:Boolean(cookies.oauth_state),match:cookies.oauth_state===state});
  return redirect('/?error=state_mismatch');
 }
 const record=await one('SELECT * FROM oauth WHERE state=$1 AND provider=$2 AND expires>$3',hash(state),provider,Date.now());
 if(!record||record.next.startsWith('link:'))return redirect('/?error=oauth_expired');
 const consumed=await run('DELETE FROM oauth WHERE state=$1',hash(state));
 if(!consumed.rowCount)return redirect('/?error=oauth_consumed');
 res.setHeader('Set-Cookie',cookie('oauth_state','',0));
 if(!url.searchParams.get('code'))return redirect('/?error=login');
 const tokenRes=await fetch(cfg.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code'),client_id:cfg.id,redirect_uri:callback,...(cfg.secret?{client_secret:cfg.secret}:{}),...(provider==='google'?{code_verifier:record.verifier}:{})}),signal:AbortSignal.timeout(10000)});
 const tokens=await tokenRes.json();
 if(!tokenRes.ok||!tokens.access_token){
  console.error('OAUTH_TOKEN_ERROR:',tokenRes.status);
  fail(502,'로그인 인증에 실패했습니다.');
 }
 const infoRes=await fetch(cfg.info,{headers:{Authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(10000)});
 const info=await infoRes.json();
 const id=provider==='google'?info.sub:info.id;
 if(!infoRes.ok||!id){
  console.error('OAUTH_INFO_ERROR:',infoRes.status);
  fail(502,'프로필을 불러올 수 없습니다.');
 }
 const returnUrl=safeReturnPath(record.next,origin);
 const withResult=(key,value)=>{const result=new URL(returnUrl,origin);result.searchParams.set(key,value);return result.pathname+result.search;};
 if(record.linked_user_id){
  if(!user||user.id!==record.linked_user_id)return redirect(withResult('error','link_session_changed'));
  if(provider==='google'&&!hasCalendarScope(tokens.scope||''))return redirect(withResult('error','calendar_permission_denied'));
  const result=await transaction(async client=>{
   const account=(await client.query('SELECT status,google_calendar_generation FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
   if(account?.status!=='ACTIVE'||(provider==='google'&&account.google_calendar_generation!==record.google_generation))return 'link_session_changed';
   const existingOther=(await client.query('SELECT user_id FROM user_accounts WHERE provider=$1 AND provider_id=$2',[provider,String(id)])).rows[0];
   if(existingOther&&existingOther.user_id!==user.id)return 'already_linked';
   const sameProvider=(await client.query('SELECT provider_id FROM user_accounts WHERE provider=$1 AND user_id=$2',[provider,user.id])).rows[0];
   if(sameProvider&&sameProvider.provider_id!==String(id))return 'google_account_mismatch';
   if(provider==='google'){
    await client.query(`INSERT INTO user_accounts(provider,provider_id,user_id,access_token,refresh_token,token_expires,token_scope)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider,provider_id) DO UPDATE SET
     access_token=excluded.access_token,refresh_token=COALESCE(excluded.refresh_token,user_accounts.refresh_token),
     token_expires=excluded.token_expires,token_scope=excluded.token_scope,updated_at=now()`,
     [provider,String(id),user.id,encryptToken(tokens.access_token,user.id),encryptToken(tokens.refresh_token,user.id),Date.now()+Number(tokens.expires_in||3600)*1000,tokens.scope]);
   }else{
    await client.query('INSERT INTO user_accounts(provider,provider_id,user_id) VALUES($1,$2,$3) ON CONFLICT(provider,provider_id) DO NOTHING',[provider,String(id),user.id]);
   }
   return null;
  });
  return redirect(result?withResult('error',result):withResult('linked',provider));
 }
 const existingAcc = await one('SELECT user_id FROM user_accounts WHERE provider=$1 AND provider_id=$2', provider, String(id));
 let effectiveUserId = existingAcc?.user_id;
 if(!effectiveUserId){
  effectiveUserId = `${provider}:${id}`;
  await run('INSERT INTO users(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET updated_at=now()', effectiveUserId, provider==='google'?'구글 사용자':(info.kakao_account?.profile?.nickname||'카카오 사용자'));
  await run('INSERT INTO user_accounts(provider,provider_id,user_id) VALUES($1,$2,$3) ON CONFLICT(provider,provider_id) DO NOTHING',provider,String(id),effectiveUserId);
 }

 await signIn(res, effectiveUserId, provider==='google'?'구글 사용자':(info.kakao_account?.profile?.nickname||'카카오 사용자'));
 return redirect(returnUrl);
 }
 if(p==='/api/push/vapid-public-key'&&req.method==='GET'){
  return json({publicKey:getVapidPublicKey()});
 }
 if(p.startsWith('/api/')){
 if(!user)fail(401,'로그인이 필요합니다.');
 if(p==='/api/push/subscribe'&&req.method==='POST'){
  const b=await body(req);
  await savePushSubscription({run},user.id,b.subscription,req.headers['user-agent']);
  return json({ok:true});
 }
 if(p==='/api/push/unsubscribe'&&req.method==='POST'){
  const b=await body(req);
  await deletePushSubscription({run},b.endpoint);
  return json({ok:true});
 }
 if(p==='/api/push/test'&&req.method==='POST'){
  const result=await sendPushToUser({all,run},user.id,{
   title:'모아 캘린더 알림 테스트',
   body:'푸시 알림이 정상적으로 작동하고 있어요!',
   tag:'test-push',
   url:'/'
  });
  return json({ok:true,sentCount:result.sentCount});
 }
 if(p==='/api/me/google-calendar' && req.method==='DELETE'){
  const credentials=await clearGoogleCalendar(user.id);
  let remoteRevoked=true;
  for(const acc of credentials){
   const stored=acc.refresh_token||acc.access_token;if(!stored)continue;
   try{
    const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:decryptToken(stored,user.id)}),signal:AbortSignal.timeout(10000)});
    const invalidToken=response.status===400&&(await response.json().catch(()=>({}))).error==='invalid_token';
    remoteRevoked=remoteRevoked&&(response.ok||invalidToken);
   }catch{remoteRevoked=false;}
  }
  return json({ok:true,remoteRevoked});
 }
 if(p==='/api/me/calendar-migration/sources' && req.method==='GET')return json(await calendarMigration.listSources(user.id));
 if(p==='/api/me/calendar-migration/preview' && req.method==='POST')return json(await calendarMigration.preview(user.id,await body(req)));
 if(p==='/api/me/calendar-migration/commit' && req.method==='POST')return json(await calendarMigration.commit(user.id,await body(req)));
 if(p==='/api/me/calendar-connections' && req.method==='GET'){
  const connections = await all('SELECT id, provider, account_email, connection_status, last_sync_at, last_sync_error, created_at, updated_at FROM calendar_connections WHERE user_id=$1 ORDER BY created_at', user.id);
  for(const conn of connections){
   const rows = await all('SELECT id, calendar_id, external_calendar_id, calendar_url, display_name, color, is_enabled, is_read_only, sync_direction, last_sync_at FROM external_calendars WHERE connection_id=$1 ORDER BY display_name', conn.id);
   conn.calendars = rows.map(cal=>({id:cal.id,calendarId:cal.calendar_id,externalCalendarId:cal.external_calendar_id,calendarUrl:cal.calendar_url,displayName:cal.display_name,color:cal.color,isEnabled:cal.is_enabled,isReadOnly:cal.is_read_only,syncDirection:cal.sync_direction,lastSyncAt:cal.last_sync_at}));
  }
  return json({syncIntervalMinutes:Number(process.env.CALDAV_SYNC_INTERVAL_MS||15*60*1000)/60000,connections:connections.map(conn=>({id:conn.id,provider:conn.provider,accountEmail:conn.account_email,connectionStatus:conn.connection_status,lastSyncAt:conn.last_sync_at,lastSyncError:conn.last_sync_error,createdAt:conn.created_at,updatedAt:conn.updated_at,calendars:conn.calendars}))});
 }
 if(p==='/api/me/calendar-connections/icloud' && req.method==='POST'){
  const b = await body(req);
  const email = typeof b.email==='string'?b.email.trim():'';
  const password = typeof b.password==='string'?b.password.trim():'';
  if(!email || !email.includes('@') || email.length > 255) fail(400, '올바른 Apple 계정 이메일을 입력해 주세요.');
  if(!password || password.length < 4 || password.length > 100) fail(400, 'Apple 앱 암호를 입력해 주세요.');

  let discovery;
  try {
   discovery = await discoverICloudCalendars(email, password);
  } catch(err) {
   if(err.status === 401) fail(401, 'Apple 계정 이메일 또는 앱 암호가 올바르지 않습니다.');
   fail(502, err.message || 'iCloud CalDAV 서버 연결에 실패했습니다.');
  }

  const encrypted = encryptSecret(password, `icloud:${user.id}`);
  const connId = randomUUID();
  const createdCalendars = [];

  await transaction(async client => {
   const upsertConn = await client.query(`
    INSERT INTO calendar_connections(id, user_id, provider, account_email, encrypted_credentials, connection_status, last_sync_at, last_sync_error)
    VALUES($1, $2, 'icloud', $3, $4, 'connected', now(), NULL)
    ON CONFLICT(user_id, provider, account_email)
    DO UPDATE SET encrypted_credentials = EXCLUDED.encrypted_credentials, connection_status = 'connected', last_sync_error = NULL, updated_at = now()
    RETURNING id
   `, [connId, user.id, email, encrypted]);

   const activeConnId = upsertConn.rows[0].id;

   for(const cal of discovery.calendars){
    const extCalId = randomUUID();
    const upsertExt = await client.query(`
     INSERT INTO external_calendars(id, connection_id, external_calendar_id, calendar_url, display_name, color, is_enabled, is_read_only, sync_direction, sync_token)
     VALUES($1, $2, $3, $4, $5, $6, true, $7, 'read_only', $8)
     ON CONFLICT(connection_id, external_calendar_id)
     DO UPDATE SET calendar_url = EXCLUDED.calendar_url, display_name = EXCLUDED.display_name, is_read_only = EXCLUDED.is_read_only, updated_at = now()
     RETURNING id, calendar_id, is_enabled, sync_direction
    `, [extCalId, activeConnId, cal.externalCalendarId, cal.calendarUrl, cal.displayName, cal.color, cal.isReadOnly, cal.syncToken || cal.ctag || null]);

    const record = upsertExt.rows[0];

    if(!record.calendar_id && record.is_enabled){
     const internalCalId = randomUUID();
     const slug = randomBytes(8).toString('hex');
     const dwmColor = cal.dwmColor || hexToClosestDwmColor(cal.color);
     const calName = `iCloud - ${cal.displayName}`.slice(0, 50);

     await client.query('INSERT INTO calendars(id, name, owner, slug, color) VALUES($1, $2, $3, $4, $5)', [internalCalId, calName, user.id, slug, dwmColor]);
     await client.query('INSERT INTO members(calendar_id, user_id, role) VALUES($1, $2, $3)', [internalCalId, user.id, 'owner']);
     await client.query('UPDATE external_calendars SET calendar_id = $1 WHERE id = $2', [internalCalId, record.id]);
     await client.query("UPDATE calendars SET source_provider='icloud' WHERE id=$1",[internalCalId]);
     createdCalendars.push(record.id);
    } else if(record.is_enabled) {
     createdCalendars.push(record.id);
    }
   }
  });

  for(const extId of createdCalendars){
   syncEngine.syncExternalCalendar(extId).catch(err => console.warn('Initial sync error for', extId, err.message));
  }

  return json({ ok: true, count: discovery.calendars.length }, 201);
 }
 const patchExtCal = p.match(/^\/api\/me\/external-calendars\/([\w-]+)$/);
 if(patchExtCal && req.method==='PATCH'){
  const extId = patchExtCal[1];
  const ec = await one(`
   SELECT ec.*, cc.user_id, cc.account_email
   FROM external_calendars ec
   JOIN calendar_connections cc ON cc.id = ec.connection_id
   WHERE ec.id = $1 AND cc.user_id = $2
  `, extId, user.id);
  if(!ec) fail(404, '연동된 캘린더를 찾을 수 없습니다.');

  const b = await body(req);
  const isEnabled = b.isEnabled !== undefined ? Boolean(b.isEnabled) : ec.is_enabled;
  let syncDirection = b.syncDirection || ec.sync_direction;

  if(!['read_only', 'two_way'].includes(syncDirection)) fail(400, '동기화 방향을 확인해 주세요.');
  if(syncDirection === 'two_way' && ec.is_read_only) fail(400, '읽기 전용 캘린더는 양방향 동기화할 수 없습니다.');

  let linkedCalId = ec.calendar_id;
  await transaction(async client => {
   if(isEnabled && !linkedCalId){
    linkedCalId = randomUUID();
    const slug = randomBytes(8).toString('hex');
    const dwmColor = hexToClosestDwmColor(ec.color);
    const calName = `iCloud - ${ec.display_name}`.slice(0, 50);

    await client.query('INSERT INTO calendars(id, name, owner, slug, color) VALUES($1, $2, $3, $4, $5)', [linkedCalId, calName, user.id, slug, dwmColor]);
    await client.query('INSERT INTO members(calendar_id, user_id, role) VALUES($1, $2, $3)', [linkedCalId, user.id, 'owner']);
    await client.query("UPDATE calendars SET source_provider='icloud' WHERE id=$1",[linkedCalId]);
   }

   await client.query(`
    UPDATE external_calendars
    SET is_enabled = $1, sync_direction = $2, calendar_id = $3, updated_at = now()
    WHERE id = $4
   `, [isEnabled, syncDirection, linkedCalId, extId]);
  });

  if(isEnabled) {
   syncEngine.syncExternalCalendar(extId).catch(err => console.warn('Sync error on toggle:', err.message));
  }

  return json({ ok: true, isEnabled, syncDirection });
 }
 const unlinkExtCal = p.match(/^\/api\/me\/external-calendars\/([\w-]+)$/);
 if(unlinkExtCal && req.method==='DELETE'){
  const extId=unlinkExtCal[1];
  const ec=await one(`SELECT ec.id, ec.calendar_id, cc.user_id FROM external_calendars ec JOIN calendar_connections cc ON cc.id=ec.connection_id WHERE ec.id=$1 AND cc.user_id=$2`,extId,user.id);
  if(!ec)fail(404,'연동된 캘린더를 찾을 수 없습니다.');
  await run('DELETE FROM external_calendars WHERE id=$1',extId);
  return json({ok:true,keptCalendarId:ec.calendar_id});
 }
 const syncExtCal = p.match(/^\/api\/me\/external-calendars\/([\w-]+)\/sync$/);
 if(syncExtCal && req.method==='POST'){
  const extId = syncExtCal[1];
  const ec = await one(`
   SELECT ec.id
   FROM external_calendars ec
   JOIN calendar_connections cc ON cc.id = ec.connection_id
   WHERE ec.id = $1 AND cc.user_id = $2
  `, extId, user.id);
  if(!ec) fail(404, '연동된 캘린더를 찾을 수 없습니다.');

  const result = await syncEngine.syncExternalCalendar(extId);
  return json({ ok: true, ...result });
 }
 const syncConn = p.match(/^\/api\/me\/calendar-connections\/([\w-]+)\/sync$/);
 if(syncConn && req.method==='POST'){
  const connId = syncConn[1];
  const conn = await one('SELECT id FROM calendar_connections WHERE id = $1 AND user_id = $2', connId, user.id);
  if(!conn) fail(404, '연동 계정을 찾을 수 없습니다.');

  const results = await syncEngine.syncCalendarConnection(connId);
  return json({ ok: true, results });
 }
 const delConn = p.match(/^\/api\/me\/calendar-connections\/([\w-]+)$/);
 if(delConn && req.method==='DELETE'){
  const connId = delConn[1];
  const conn = await one('SELECT id FROM calendar_connections WHERE id = $1 AND user_id = $2', connId, user.id);
  if(!conn) fail(404, '연동 계정을 찾을 수 없습니다.');

  const b = await body(req).catch(() => ({}));
  const deleteEvents = Boolean(b.deleteEvents || url.searchParams.get('deleteEvents') === 'true');

  await transaction(async client => {
   if(deleteEvents){
    const linkedCals = (await client.query('SELECT calendar_id FROM external_calendars WHERE connection_id = $1 AND calendar_id IS NOT NULL', [connId])).rows;
    for(const row of linkedCals){
     await client.query('DELETE FROM calendars WHERE id = $1', [row.calendar_id]);
    }
   }
   await client.query('DELETE FROM calendar_connections WHERE id = $1 AND user_id = $2', [connId, user.id]);
  });

  return json({ ok: true });
 }
 if(p==='/api/schedule-shares' && req.method==='GET'){
  if(!user) fail(401,'로그인이 필요합니다.');
  const rows = await all(`
    SELECT s.*,
           c.name as calendar_name,
           COUNT(DISTINCT v.id)::int as visitor_count,
           COALESCE(SUM(v.view_count), 0)::int as total_views,
           MAX(v.last_seen_at) as last_viewed_at
    FROM schedule_shares s
    LEFT JOIN calendars c ON c.id = s.calendar_id
    LEFT JOIN schedule_share_visitors v ON v.share_id = s.id
    WHERE s.user_id = $1
    GROUP BY s.id, c.name
    ORDER BY s.created_at DESC
  `, user.id);

  return json(rows.map(r => ({
    ...r,
    url: `${origin}/s/${r.token}`,
    is_expired: Boolean(r.expires_at && new Date(r.expires_at) < new Date())
  })));
 }
 if(p==='/api/schedule-shares' && req.method==='POST'){
  if(!user) fail(401,'로그인이 필요합니다.');
  const b = await body(req);
  const period = b.period;
  if(!['day', 'week', 'month'].includes(period)) fail(400, '공유 기간(하루, 일주일, 이번 달)을 확인해 주세요.');

  let targetDate = b.target_date;
  if(!targetDate || typeof targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    targetDate = new Date().toISOString().slice(0, 10);
  }

  let calendarId = b.calendar_id;
  if(calendarId && calendarId !== 'all') {
    const m = await one('SELECT 1 FROM members WHERE calendar_id=$1 AND user_id=$2', calendarId, user.id);
    if(!m) fail(404, '캘린더를 찾을 수 없습니다.');
  } else {
    calendarId = null;
  }

  let title = typeof b.title === 'string' ? b.title.trim() : '';
  if(!title) {
    const periodNames = { day: '하루 일정', week: '이번 주 일정', month: '이번 달 일정' };
    title = `${user.name}님의 ${periodNames[period]}`;
  }
  if(title.length > 100) title = title.slice(0, 100);

  let expiresAt = null;
  const expiresIn = b.expires_in || '1d';
  const now = Date.now();
  if(expiresIn === '1h') expiresAt = new Date(now + 3600_000);
  else if(expiresIn === '1d') expiresAt = new Date(now + 86400_000);
  else if(expiresIn === '3d') expiresAt = new Date(now + 3 * 86400_000);
  else if(expiresIn === '7d') expiresAt = new Date(now + 7 * 86400_000);
  else if(expiresIn === '30d') expiresAt = new Date(now + 30 * 86400_000);
  else if(expiresIn === 'never') expiresAt = null;
  else if(typeof expiresIn === 'string' && !isNaN(Date.parse(expiresIn))) {
    expiresAt = new Date(expiresIn);
    if(expiresAt <= new Date()) fail(400, '만료 일시는 현재 이후여야 합니다.');
  }

  const id = randomUUID();
  const token = randomBytes(8).toString('base64url');

  await run(`
    INSERT INTO schedule_shares(id, token, user_id, calendar_id, title, period, target_date, expires_at)
    VALUES($1, $2, $3, $4, $5, $6, $7, $8)
  `, id, token, user.id, calendarId, title, period, targetDate, expiresAt);

  return json({
    id,
    token,
    url: `${origin}/s/${token}`,
    title,
    period,
    target_date: targetDate,
    expires_at: expiresAt
  }, 201);
 }
 const shareDetailsMatch = p.match(/^\/api\/schedule-shares\/([a-zA-Z0-9_-]+)$/);
 if(shareDetailsMatch){
  if(!user) fail(401, '로그인이 필요합니다.');
  const shareId = shareDetailsMatch[1];

  if(req.method === 'GET'){
    const share = await one(`
      SELECT s.*, c.name as calendar_name
      FROM schedule_shares s
      LEFT JOIN calendars c ON c.id=s.calendar_id
      WHERE s.id=$1 AND s.user_id=$2
    `, shareId, user.id);
    if(!share) fail(404, '공유 링크를 찾을 수 없습니다.');

    const visitors = await all(`
      SELECT v.*, u.name as logged_user_name
      FROM schedule_share_visitors v
      LEFT JOIN users u ON u.id = v.user_id
      WHERE v.share_id = $1
      ORDER BY v.last_seen_at DESC
    `, shareId);

    const recentViews = await all(`
      SELECT w.*, v.visitor_session_id, v.device_info
      FROM schedule_share_views w
      JOIN schedule_share_visitors v ON v.id = w.visitor_id
      WHERE w.share_id = $1
      ORDER BY w.viewed_at DESC
      LIMIT 50
    `, shareId);

    return json({
      share: {
        ...share,
        url: `${origin}/s/${share.token}`,
        is_expired: Boolean(share.expires_at && new Date(share.expires_at) < new Date())
      },
      visitors,
      recent_views: recentViews
    });
  }

  if(req.method === 'DELETE'){
    const result = await run('DELETE FROM schedule_shares WHERE id=$1 AND user_id=$2', shareId, user.id);
    if(!result.rowCount) fail(404, '공유 링크를 찾을 수 없습니다.');
    return json({ ok: true });
  }

  if(req.method === 'PATCH'){
    const b = await body(req);
    if(typeof b.is_revoked === 'boolean'){
      await run('UPDATE schedule_shares SET is_revoked=$1, updated_at=now() WHERE id=$2 AND user_id=$3', b.is_revoked, shareId, user.id);
      return json({ ok: true, is_revoked: b.is_revoked });
    }
    fail(400, '잘못된 수정 요청입니다.');
  }
 }
 if(p==='/api/calendars' && req.method==='GET')return json(await all("SELECT c.*,m.role,c.source_provider='google' AS is_google,(c.source_provider='icloud' OR EXISTS(SELECT 1 FROM external_calendars ec WHERE ec.calendar_id=c.id)) AS is_icloud,(m.role='viewer' OR c.source_provider='google' OR EXISTS(SELECT 1 FROM external_calendars ec WHERE ec.calendar_id=c.id AND (ec.is_read_only OR ec.sync_direction='read_only'))) AS read_only FROM calendars c JOIN members m ON m.calendar_id=c.id LEFT JOIN calendar_order o ON o.calendar_id=c.id AND o.user_id=m.user_id WHERE m.user_id=$1 AND c.status='ACTIVE' ORDER BY o.sort_order NULLS LAST,c.created_at,c.id",user.id));
 if(p==='/api/calendars/order'&&req.method==='PUT'){
  const b=await body(req),ids=b.calendarIds;
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)fail(400,'캘린더 순서를 확인해 주세요.');
  await transaction(async client=>{
   await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
   const owned=(await client.query("SELECT c.id FROM calendars c JOIN members m ON m.calendar_id=c.id WHERE m.user_id=$1 AND c.status='ACTIVE'",[user.id])).rows;
   if(owned.length!==ids.length||owned.some(c=>!ids.includes(c.id)))fail(409,'캘린더 목록이 변경되었습니다. 새로고침해 주세요.');
   for(const [index,id]of ids.entries())await client.query('INSERT INTO calendar_order(user_id,calendar_id,sort_order) VALUES($1,$2,$3) ON CONFLICT(user_id,calendar_id) DO UPDATE SET sort_order=EXCLUDED.sort_order',[user.id,id,index]);
  });return json({ok:true});
 }
 if(p==='/api/calendars' && req.method==='POST'){const b=await body(req);if(!validText(b.name,50))fail(400,'캘린더 이름을 입력해 주세요.');let slug=typeof b.slug==='string'?b.slug.trim().toLowerCase():'';if(slug){if(!/^[a-z0-9_-]{2,50}$/.test(slug))fail(400,'캘린더 주소는 2~50자의 영문 소문자, 숫자, 하이픈, 밑줄만 가능합니다.');if(['api','auth','invite','admin','en','ko','settings','app.js','style.css'].includes(slug))fail(400,'사용할 수 없는 주소입니다.');const exists=await one('SELECT id FROM calendars WHERE slug=$1',slug);if(exists)fail(409,'이미 사용 중인 캘린더 주소입니다.');}else slug=randomBytes(4).toString('hex');const id=randomUUID();await transaction(async client=>{await client.query('INSERT INTO calendars(id,name,owner,slug) VALUES($1,$2,$3,$4)',[id,b.name.trim(),user.id,slug]);await client.query('INSERT INTO members VALUES($1,$2,$3)',[id,user.id,'owner']);});return json({id,slug},201);}
 const join=p.match(/^\/api\/invite\/([A-Za-z0-9_-]+)$/);
 if(join && req.method==='POST'){
 const result=await transaction(async client=>{
  const t=hash(join[1]);
  const found=(await client.query('SELECT calendar_id FROM invites WHERE token=$1',[t])).rows[0];
  if(!found)fail(404,'초대 링크가 만료되었거나 취소되었습니다.');
  const calendar=(await client.query("SELECT id FROM calendars WHERE id=$1 AND status='ACTIVE' FOR UPDATE",[found.calendar_id])).rows[0];
  if(!calendar)fail(404,'보관된 캘린더입니다.');
  const invite=(await client.query('SELECT * FROM invites WHERE token=$1 AND expires>$2 FOR UPDATE',[t,Date.now()])).rows[0];
  if(!invite)fail(404,'초대 링크가 만료되었거나 취소되었습니다.');
  const removed=(await client.query('SELECT removed_at FROM removed_members WHERE calendar_id=$1 AND user_id=$2',[calendar.id,user.id])).rows[0];
  if(removed&&Number(invite.created_at)<=Number(removed.removed_at))fail(403,'참여가 해제된 캘린더입니다. 관리자에게 새 초대 링크를 요청해 주세요.');
  await client.query('INSERT INTO members VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[calendar.id,user.id,invite.role]);
  await client.query('DELETE FROM removed_members WHERE calendar_id=$1 AND user_id=$2',[calendar.id,user.id]);
  const signupId=randomUUID();
  await client.query('INSERT INTO invite_signups(id,invite_token,calendar_id,user_id,joined_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(invite_token,user_id) DO NOTHING',[signupId,t,calendar.id,user.id]);
  return {id:calendar.id};
 });broadcast(result.id,'members');return json(result);
 }
  const importGoogle=p.match(/^\/api\/google-calendar\/import$/);
  if(importGoogle && req.method==='POST'){
   const b=await body(req);
   const calendarName=typeof b.calendarName==='string'?b.calendarName.trim():'';
   if(!validText(calendarName,50))fail(400,'새 캘린더 이름을 1~50자로 입력해 주세요.');
   if(b.shareAcknowledged!==true)fail(400,'새 캘린더의 공유 안내를 확인해 주세요.');
   const range=b.range||'3';
   if(!['all','1y','6','3','1'].includes(range))fail(400,'가져올 기간을 확인해 주세요.');
   const generation=(await one('SELECT google_calendar_generation FROM users WHERE id=$1',user.id))?.google_calendar_generation;
   const googleToken=await getValidGoogleAccessToken(user.id);
   if(!googleToken)fail(400,'구글 계정이 연동되어 있지 않거나 구글 캘린더 권한이 없습니다. 마이페이지에서 구글 계정을 연동해 주세요.');
   let timeMin=null, timeMax=null;
   if(range==='all'){
    timeMax=new Date();timeMax.setFullYear(timeMax.getFullYear()+2);
   }else if(range==='1y'){
    timeMin=new Date();timeMin.setFullYear(timeMin.getFullYear()-1);
    timeMax=new Date();timeMax.setFullYear(timeMax.getFullYear()+1);
   }else{
    const months=Number(range);
    timeMin=new Date();timeMin.setHours(0,0,0,0);timeMin.setMonth(timeMin.getMonth()-1);
    timeMax=new Date();timeMax.setMonth(timeMax.getMonth()+months);
   }
   const items=[];
   let pageToken=null,pageCount=0;
   do{
    const gUrl=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    if(timeMin)gUrl.searchParams.set('timeMin',timeMin.toISOString());
    if(timeMax)gUrl.searchParams.set('timeMax',timeMax.toISOString());
    gUrl.searchParams.set('singleEvents','true');gUrl.searchParams.set('maxResults','250');gUrl.searchParams.set('orderBy','startTime');
    if(pageToken)gUrl.searchParams.set('pageToken',pageToken);
    const gRes=await fetch(gUrl.href,{headers:{Authorization:`Bearer ${googleToken}`},signal:AbortSignal.timeout(20000)});
    if(!gRes.ok){
     if(gRes.status===401||gRes.status===403){await clearGoogleCalendar(user.id);fail(400,'구글 캘린더 권한을 다시 연결해 주세요.');}
     fail(502,`구글 캘린더 연동 실패 (${gRes.status}): 다시 구글 계정을 연동해 주세요.`);
    }
    const gData=await gRes.json();
    if(Array.isArray(gData.items))items.push(...gData.items);
    pageToken=gData.nextPageToken||null;pageCount++;
   }while(pageToken&&pageCount<10);
   const parseKstDateTime=dtStr=>{
    const d=new Date(dtStr);if(isNaN(d))return null;
    return new Date(d.getTime()+9*60*60*1000).toISOString().slice(0,16);
   };
   const importRows=[];
   for(const item of items){
    if(item.status==='cancelled')continue;
    const title=(item.summary||'').trim().slice(0,100)||'(제목 없음)';
    let startStr='',endStr='',allDay=false;
    if(item.start?.date){
     allDay=true;const sDate=item.start.date;const eDate=item.end?.date||sDate;
     startStr=`${sDate}T00:00`;endStr=`${eDate}T00:00`;
     if(endStr<=startStr){const [y,m,d]=sDate.split('-').map(Number);endStr=`${new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10)}T00:00`;}
    }else if(item.start?.dateTime){
     startStr=parseKstDateTime(item.start.dateTime);endStr=parseKstDateTime(item.end?.dateTime||item.start.dateTime);
     if(!startStr||!endStr)continue;
     if(endStr<=startStr){const [datePart,timePart]=startStr.split('T');const [h,m]=timePart.split(':').map(Number);endStr=`${datePart}T${String(Math.min(23,h+1)).padStart(2,'0')}:${String(m).padStart(2,'0')}`;if(endStr<=startStr)endStr=`${datePart}T23:59`;}
    }else continue;
    if(!isValidLocalDateTime(startStr)||!isValidLocalDateTime(endStr)||endStr<=startStr)continue;
    importRows.push({title,start:startStr,end:endStr,allDay,notes:(item.description||'').slice(0,2000)});
   }
   const calendarId=randomUUID(),slug=randomBytes(8).toString('hex');
   await transaction(async client=>{
    const active=(await client.query('SELECT google_calendar_generation FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
    if(!active||active.google_calendar_generation!==generation)fail(400,'구글 캘린더 권한을 다시 연결해 주세요.');
    await client.query('INSERT INTO calendars(id,name,owner,slug) VALUES($1,$2,$3,$4)',[calendarId,calendarName,user.id,slug]);
    await client.query("UPDATE calendars SET source_provider='google' WHERE id=$1",[calendarId]);
    await client.query('INSERT INTO members(calendar_id,user_id,role) VALUES($1,$2,$3)',[calendarId,user.id,'owner']);
    for(const event of importRows){
     await client.query('INSERT INTO events(id,calendar_id,title,start,"end",color,notes,category,all_day) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),calendarId,event.title,event.start,event.end,'blue',event.notes,'구글',event.allDay]);
    }
   });
   broadcast(calendarId);
   return json({ok:true,id:calendarId,slug,calendarName,imported:importRows.length,total:items.length},201);
  }
  const calDel=p.match(/^\/api\/calendars\/([\w-]+)$/);
  if(calDel && req.method==='DELETE'){
   const ident=calDel[1];
   const m=await member(ident,user);
   const id=m.id,role=m.role;
   if(role!=='owner')fail(403,'관리자만 캘린더를 삭제할 수 있습니다.');
   await transaction(async client=>{
    const currentMember=(await client.query("SELECT role FROM members WHERE calendar_id=$1 AND user_id=$2 FOR UPDATE",[id,user.id])).rows[0];
    if(!currentMember||currentMember.role!=='owner')fail(403,'관리자만 캘린더를 삭제할 수 있습니다.');
    await client.query('DELETE FROM calendars WHERE id=$1',[id]);
   });
   for(const [cid,c] of clients){
    if(c.calendar===id){
     clients.delete(cid);
     c.res.write('event: access-revoked\ndata: {}\n\n');
     c.res.end();
    }
   }
   return json({ok:true});
  }
 const route=p.match(/^\/api\/calendars\/([\w-]+)\/(events|monthly-items|stream|invites|details|settings|members|access|administrator|notes|month-notes)(?:\/([\w-]+))?$/);
 if(!route)fail(404,'경로를 찾을 수 없습니다.');const [,ident,kind,eventId]=route;const m=await member(ident,user);const id=m.id,role=m.role;
 if(kind==='monthly-items'){
  const validMonth=value=>typeof value==='string'&&/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(value);
  if(req.method==='GET'){
   const month=url.searchParams.get('month');
   if(month!==null&&!validMonth(month))fail(400,'해당 월을 확인해 주세요.');
   if(eventId){const item=await one('SELECT * FROM monthly_items WHERE calendar_id=$1 AND id=$2',id,eventId);if(!item)fail(404,'월간 항목을 찾을 수 없습니다.');return json(item);}
   return json(month===null?await all('SELECT * FROM monthly_items WHERE calendar_id=$1 ORDER BY month,created_at,id',id):await all('SELECT * FROM monthly_items WHERE calendar_id=$1 AND month=$2 ORDER BY created_at,id',id,month));
  }
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method))fail(405,'허용되지 않은 요청입니다.');
  if((req.method==='POST')===Boolean(eventId))fail(400,'잘못된 월간 항목 요청입니다.');
  await writeAccess(id,user);
  const b=await body(req);
  if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'잘못된 월간 항목 요청입니다.');
  if(eventId&&(!Number.isInteger(b.version)||b.version<1))fail(400,'월간 항목 버전을 확인해 주세요.');
  const saved=await transaction(async client=>{
   // Keep membership and calendar permissions stable for the entire write.
   const access=(await client.query("SELECT m.role,c.source_provider FROM members m JOIN calendars c ON c.id=m.calendar_id WHERE m.calendar_id=$1 AND m.user_id=$2 AND c.status='ACTIVE' FOR SHARE OF m,c",[id,user.id])).rows[0];
   const external=(await client.query("SELECT 1 FROM external_calendars WHERE calendar_id=$1 AND (is_read_only OR sync_direction='read_only')",[id])).rows[0];
   if(!access||access.role==='viewer'||access.source_provider==='google'||external)fail(403,'월간 항목을 수정할 권한이 없습니다.');
   let existing;
   if(eventId){
    existing=(await client.query('SELECT * FROM monthly_items WHERE calendar_id=$1 AND id=$2 FOR UPDATE',[id,eventId])).rows[0];
    if(!existing)fail(404,'월간 항목을 찾을 수 없습니다.');
    if(existing.version!==b.version)fail(409,'다른 사람이 월간 항목을 변경했어요. 다시 열어 확인해 주세요.');
   }
   if(req.method==='DELETE'){await client.query('DELETE FROM monthly_items WHERE calendar_id=$1 AND id=$2',[id,eventId]);return {ok:true};}
   if(req.method==='PATCH'){
    if(!existing.is_todo||typeof b.completed!=='boolean')fail(400,'To Do만 완료 체크할 수 있어요.');
    return (await client.query('UPDATE monthly_items SET completed=$1,version=version+1,updated_at=now() WHERE calendar_id=$2 AND id=$3 RETURNING *',[b.completed,id,eventId])).rows[0];
   }
   if(!validMonth(b.month)||!validText(b.title)||typeof b.notes!=='string'||b.notes.length>2000||typeof b.is_todo!=='boolean')fail(400,'제목, 해당 월과 메모를 확인해 주세요.');
   const completed=b.is_todo&&Boolean(existing?.is_todo&&existing.completed);
   if(existing)return (await client.query('UPDATE monthly_items SET month=$1,title=$2,notes=$3,is_todo=$4,completed=$5,version=version+1,updated_at=now() WHERE calendar_id=$6 AND id=$7 RETURNING *',[b.month,b.title.trim(),b.notes,b.is_todo,completed,id,eventId])).rows[0];
   return (await client.query('INSERT INTO monthly_items(id,calendar_id,month,title,notes,is_todo) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),id,b.month,b.title.trim(),b.notes,b.is_todo])).rows[0];
  });
  broadcast(id);return json(saved,req.method==='POST'?201:200);
 }
 if(kind==='notes'&&req.method==='GET')return json(await all('SELECT date,content,version FROM calendar_notes WHERE calendar_id=$1 ORDER BY date',id));
 if(kind==='notes'&&req.method==='PUT'){
 if(!eventId||!isValidLocalDateTime(`${eventId}T00:00`))fail(400,'메모 날짜를 확인해 주세요.');
 const b=await body(req);if(typeof b.content!=='string'||b.content.length>5000||!Number.isInteger(b.version)||b.version<0)fail(400,'메모는 최대 5,000자로 입력해 주세요.');
 const content=b.content.trim();
 const result=await transaction(async client=>{
  await client.query('SELECT id FROM calendars WHERE id=$1 FOR UPDATE',[id]);
  const membership=(await client.query('SELECT role FROM members WHERE calendar_id=$1 AND user_id=$2',[id,user.id])).rows[0];
  if(!membership||membership.role==='viewer')fail(403,'메모를 수정할 권한이 없습니다.');
  const existing=(await client.query('SELECT version FROM calendar_notes WHERE calendar_id=$1 AND date=$2',[id,eventId])).rows[0];
  if((existing?.version||0)!==b.version)fail(409,'다른 사람이 메모를 변경했어요. 취소를 눌러 최신 내용을 확인한 후 다시 수정해 주세요.');
  if(!content&&!existing)return {date:eventId,content:'',version:0};
  const saved=(await client.query('INSERT INTO calendar_notes(calendar_id,date,content,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(calendar_id,date) DO UPDATE SET content=excluded.content,version=calendar_notes.version+1,updated_by=excluded.updated_by,updated_at=now() RETURNING date,content,version',[id,eventId,content,user.id])).rows[0];
  return saved;
 });broadcast(id,'notes');return json(result);
 }
 if(kind==='month-notes'&&req.method==='GET')return json(await all('SELECT month,content,version FROM calendar_month_notes WHERE calendar_id=$1 ORDER BY month',id));
 if(kind==='month-notes'&&req.method==='PUT'){
 if(!eventId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(eventId))fail(400,'해당 월을 확인해 주세요.');
 const b=await body(req);if(typeof b.content!=='string'||b.content.length>5000||!Number.isInteger(b.version)||b.version<0)fail(400,'메모는 최대 5,000자로 입력해 주세요.');
 const content=b.content.trim();
 const result=await transaction(async client=>{
  await client.query('SELECT id FROM calendars WHERE id=$1 FOR UPDATE',[id]);
  const membership=(await client.query('SELECT role FROM members WHERE calendar_id=$1 AND user_id=$2',[id,user.id])).rows[0];
  if(!membership||membership.role==='viewer')fail(403,'메모를 수정할 권한이 없습니다.');
  const existing=(await client.query('SELECT version FROM calendar_month_notes WHERE calendar_id=$1 AND month=$2',[id,eventId])).rows[0];
  if((existing?.version||0)!==b.version)fail(409,'다른 사람이 메모를 변경했어요. 취소를 눌러 최신 내용을 확인한 후 다시 수정해 주세요.');
  if(!content&&!existing)return {month:eventId,content:'',version:0};
  const saved=(await client.query('INSERT INTO calendar_month_notes(calendar_id,month,content,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(calendar_id,month) DO UPDATE SET content=excluded.content,version=calendar_month_notes.version+1,updated_by=excluded.updated_by,updated_at=now() RETURNING month,content,version',[id,eventId,content,user.id])).rows[0];
  return saved;
 });broadcast(id,'month-notes');return json(result);
 }
 if(kind==='access'&&req.method==='GET')return json({ok:true,role});
 if(kind==='administrator'&&req.method==='PUT'){
 if(role!=='owner')fail(403,'관리자만 관리자를 지정할 수 있습니다.');
 const b=await body(req);if(typeof b.user_id!=='string'||b.user_id===user.id)fail(400,'관리자로 지정할 참여자를 선택해 주세요.');
 await transaction(async client=>{
  const target=(await client.query("SELECT m.user_id, m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.calendar_id=$1 AND m.user_id=$2 AND u.status='ACTIVE' FOR UPDATE OF m",[id,b.user_id])).rows[0];
  if(!target)fail(404,'참여자를 찾을 수 없습니다.');
  if(target.role==='owner')fail(400,'이미 관리자인 참여자입니다.');
  await client.query("UPDATE members SET role='owner' WHERE calendar_id=$1 AND user_id=$2",[id,b.user_id]);
 });
 for(const c of clients.values())if(c.calendar===id&&c.user.id===b.user_id)c.role='owner';
 broadcast(id,'presence');broadcast(id,'calendar');broadcast(id,'members');return json({ok:true});
 }
 if(kind==='stream'&&req.method==='DELETE'){
 if(role!=='owner')fail(403,'관리자만 접속 세션을 종료할 수 있습니다.');
 const target=clients.get(eventId);if(!target||target.calendar!==id)fail(404,'이미 종료된 접속 세션입니다.');
 if(target.session===hash(cookies.session))fail(400,'현재 사용 중인 세션은 로그아웃으로 종료해 주세요.');
 await transaction(async client=>{
  const currentMember=(await client.query("SELECT role FROM members WHERE calendar_id=$1 AND user_id=$2 FOR UPDATE",[id,user.id])).rows[0];
  if(!currentMember||currentMember.role!=='owner')fail(403,'관리자만 접속 세션을 종료할 수 있습니다.');
  await client.query('DELETE FROM sessions WHERE token=$1',[target.session]);
 });
 const affected=new Set();
 for(const [cid,c] of clients)if(c.session===target.session){clients.delete(cid);affected.add(c.calendar);c.res.write('event: session-ended\ndata: {}\n\n');c.res.end();}
 for(const calendarId of affected)broadcast(calendarId,'presence');return json({ok:true});
 }
 if(kind==='details'&&req.method==='GET'){
 const calendar=await one('SELECT id,name,color,slug FROM calendars WHERE id=$1',id);
 const isGoogle=(await one("SELECT 1 FROM events WHERE calendar_id=$1 AND category='구글' LIMIT 1",id))!==undefined || Boolean(calendar?.name?.includes('Google') || calendar?.name?.includes('구글'));
 const isICloud=(await one("SELECT 1 FROM external_calendars WHERE calendar_id=$1 UNION SELECT 1 FROM events WHERE calendar_id=$1 AND category='iCloud' LIMIT 1",id).catch(()=>null))!==undefined || Boolean(calendar?.name?.includes('iCloud'));
 const members=await all('SELECT u.id,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.calendar_id=$1 ORDER BY CASE m.role WHEN \'owner\' THEN 0 ELSE 1 END,u.name,u.id',id);
 for(const person of members)person.sessions=[...clients.values()].filter(c=>c.calendar===id&&c.user.id===person.id).length;
 const invites=role==='owner'?await (async()=>{
  const inviteRows=await all('SELECT token AS id,role,expires,created_at,raw_token FROM invites WHERE calendar_id=$1 AND expires>$2 ORDER BY created_at DESC,token',id,Date.now());
  const signups=await all('SELECT s.invite_token, s.user_id, u.name AS user_name, s.joined_at FROM invite_signups s JOIN users u ON u.id=s.user_id WHERE s.calendar_id=$1 ORDER BY s.joined_at ASC',id);
  const signupsByInvite=new Map();
  for(const s of signups){
   if(!signupsByInvite.has(s.invite_token))signupsByInvite.set(s.invite_token,[]);
   signupsByInvite.get(s.invite_token).push({id:s.user_id,name:s.user_name,joined_at:s.joined_at});
  }
  return inviteRows.map(inv=>({
   id:inv.id,
   role:inv.role,
   expires:inv.expires,
   created_at:inv.created_at,
   url:inv.raw_token?`${origin}/invite/${inv.raw_token}`:null,
   signups:signupsByInvite.get(inv.id)||[]
  }));
 })():[];
 return json({calendar:{...calendar,is_google:Boolean(isGoogle),is_icloud:Boolean(isICloud)},role,members,invites});
 }
 if(kind==='settings'&&req.method==='PUT'){
 if(role!=='owner')fail(403,'관리자만 캘린더를 수정할 수 있습니다.');const b=await body(req);
 if(!validText(b.name,50)||!EVENT_COLORS.includes(b.color))fail(400,'캘린더 이름과 색상을 확인해 주세요.');
 await administratorTask(id,user,client=>client.query('UPDATE calendars SET name=$1,color=$2,updated_at=now() WHERE id=$3',[b.name.trim(),b.color,id]));
 broadcast(id,'calendar');return json({ok:true});
 }
 if(kind==='members'&&req.method==='DELETE'){
 if(role!=='owner')fail(403,'관리자만 참여자를 내보낼 수 있습니다.');const b=await body(req);
 if(typeof b.user_id!=='string'||b.user_id===user.id)fail(400,'관리자는 내보낼 수 없습니다.');
 await transaction(async client=>{
  const currentMember=(await client.query("SELECT role FROM members WHERE calendar_id=$1 AND user_id=$2 FOR UPDATE",[id,user.id])).rows[0];
  if(!currentMember||currentMember.role!=='owner')fail(403,'관리자만 참여자를 내보낼 수 있습니다.');
  const target=(await client.query('SELECT role FROM members WHERE calendar_id=$1 AND user_id=$2 FOR UPDATE',[id,b.user_id])).rows[0];
  if(!target)fail(404,'이미 참여가 해제된 사람입니다.');if(target.role==='owner')fail(400,'관리자는 내보낼 수 없습니다.');
  await client.query('DELETE FROM members WHERE calendar_id=$1 AND user_id=$2',[id,b.user_id]);
  await client.query('INSERT INTO removed_members VALUES($1,$2,$3) ON CONFLICT(calendar_id,user_id) DO UPDATE SET removed_at=excluded.removed_at',[id,b.user_id,Date.now()]);
 });
 for(const [cid,c] of clients)if(c.calendar===id&&c.user.id===b.user_id){clients.delete(cid);c.res.write('event: access-revoked\ndata: {}\n\n');c.res.end();}
 broadcast(id,'presence');broadcast(id,'members');return json({ok:true});
 }
 if(kind==='stream'&&req.method==='GET'){
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});const cid=randomUUID();clients.set(cid,{id:cid,calendar:id,user,role,session:hash(cookies.session),res,joined:new Date().toISOString()});res.write('event: change\ndata: {}\n\n');broadcast(id,'presence');let checking=false,lastChecked=Date.now();
 const close=()=>{clearInterval(timer);clients.delete(cid);broadcast(id,'presence');};
 const timer=setInterval(async()=>{if(checking)return;if(Date.now()-lastChecked<60000){res.write(': heartbeat\n\n');return;}checking=true;lastChecked=Date.now();try{
 const active=await one("SELECT s.token FROM sessions s JOIN users u ON u.id=s.user_id JOIN members m ON m.user_id=u.id JOIN calendars c ON c.id=m.calendar_id WHERE s.token=$1 AND s.expires>$2 AND m.calendar_id=$3 AND u.status='ACTIVE' AND c.status='ACTIVE'",hash(cookies.session),Date.now(),id);
 if(!active){res.write('event: access-revoked\ndata: {}\n\n');close();res.end();return;}
 res.write(': heartbeat\n\n');
 }catch{close();res.end();}finally{checking=false;}},15000);
 timer.unref?.();
 res.on('close',close);req.on('close',close);return;
 }
 if(kind==='invites' && req.method==='POST'){if(role!=='owner')fail(403,'캘린더 관리자만 초대할 수 있습니다.');const b=await body(req);const t=token(),inviteRole=b.role==='viewer'?'viewer':'editor',expires=Date.now()+604800000;await administratorTask(id,user,client=>client.query('INSERT INTO invites(token,calendar_id,role,expires,raw_token) VALUES($1,$2,$3,$4,$5)',[hash(t),id,inviteRole,expires,t]));broadcast(id,'members');return json({url:`${origin}/invite/${t}`,token:t,role:inviteRole,expires});}
 if(kind==='invites' && req.method==='DELETE'){if(role!=='owner')fail(403,'관리자만 초대를 취소할 수 있습니다.');await administratorTask(id,user,client=>eventId?client.query('DELETE FROM invites WHERE calendar_id=$1 AND token=$2',[id,eventId]):client.query('DELETE FROM invites WHERE calendar_id=$1',[id]));broadcast(id,'members');return json({ok:true});}
 if(kind==='events' && req.method==='GET')return json(await all('SELECT e.*,j.event_id IS NOT NULL AS sync_pending,j.last_error AS sync_error FROM events e LEFT JOIN calendar_move_jobs j ON j.event_id=e.id WHERE e.calendar_id=$1 ORDER BY e.start',id));
 if(kind==='events' && ['POST','PUT','DELETE'].includes(req.method)){
 await writeAccess(id,user);const b=await body(req);
 let existing;
 if(eventId&&await one('SELECT 1 FROM calendar_move_jobs WHERE event_id=$1',eventId))fail(409,'이 일정의 iCloud 이동을 동기화 중입니다. 잠시 후 다시 시도해 주세요.');
 if(eventId){existing=await one('SELECT * FROM events WHERE id=$1 AND calendar_id=$2',eventId,id);if(!existing)fail(404,'일정을 찾을 수 없습니다.');if(b.version!==existing.version)fail(409,'다른 사람이 일정을 변경했습니다. 최신 일정을 확인한 뒤 다시 저장해 주세요.');}
 if(req.method==='DELETE'){if(!eventId)fail(400,'일정 ID가 필요합니다.');const result=await run('DELETE FROM events WHERE id=$1 AND calendar_id=$2 AND version=$3',eventId,id,b.version);if(!result.rowCount)fail(409,'일정이 변경되었습니다. 다시 확인해 주세요.');syncEngine.pushLocalEventToExternal(eventId,'delete',{calendarId:id}).catch(e=>console.warn('Two-way sync delete failed:',e.message));notifyCalendarActivity({all,run},{calendarId:id,calendarName:m.name,actorUserId:user.id,actorName:user.name,action:'delete',eventTitle:existing?.title||''}).catch(e=>console.warn('Activity push failed:',e.message));}
 else{
 if((req.method==='PUT')!==Boolean(eventId))fail(400,'잘못된 일정 요청입니다.');
 const category=typeof b.category==='string'?b.category.trim():'';
 if(b.all_day!==undefined && typeof b.all_day!=='boolean')fail(400,'하루 종일 옵션을 확인해 주세요.');
 const allDay=b.all_day??existing?.all_day??false;
  const isTodo=b.is_todo!==undefined?Boolean(b.is_todo):(existing?.is_todo??false);
  const completed=b.completed!==undefined?Boolean(b.completed):(existing?.completed??false);
  const isDday=b.is_dday!==undefined?Boolean(b.is_dday):(existing?.is_dday??false);
  const isCancelled=b.is_cancelled!==undefined?Boolean(b.is_cancelled):(existing?.is_cancelled??false);
 const reminderEnabled=b.reminder_enabled!==undefined?Boolean(b.reminder_enabled):(existing?.reminder_enabled??false);
 const reminderMinutes=Number(b.reminder_minutes??existing?.reminder_minutes??10);
 if(!([10,30,1440].includes(reminderMinutes)||(reminderMinutes>=60&&reminderMinutes<=1380&&reminderMinutes%60===0)))fail(400,'알림 시점을 확인해 주세요.');
 if(allDay && (typeof b.start!=='string'||typeof b.end!=='string'||!b.start.endsWith('T00:00')||!b.end.endsWith('T00:00')))fail(400,'하루 종일 일정은 날짜 기준으로 저장해 주세요.');
 if(!validText(b.title)||!isValidLocalDateTime(b.start)||!isValidLocalDateTime(b.end)||b.end<=b.start||!EVENT_COLORS.includes(b.color)||typeof b.notes!=='string'||b.notes.length>2000||category.length>50)fail(400,'제목, 시작·종료 시간과 메모를 확인해 주세요.');
 const count = typeof b.repeat_count !== 'undefined' ? (typeof b.repeat_count === 'number' ? b.repeat_count : Number(b.repeat_count)) : (typeof b.repeat_weeks !== 'undefined' ? (typeof b.repeat_weeks === 'number' ? b.repeat_weeks : Number.NaN) : 1);
 const frequency = b.repeat_frequency || (typeof b.repeat_weeks !== 'undefined' ? (count === 1 ? 'none' : 'weekly') : 'none');
 const calendarType = b.repeat_calendar_type === 'lunar' ? 'lunar' : 'solar';
 if(eventId && (frequency !== 'none' || count !== 1))fail(400,'반복 생성은 새 일정을 만들 때 선택해 주세요.');
 let ranges;
 if(frequency === 'none' || (count === 1 && !b.repeat_frequency)){
  ranges = [{ start: b.start, end: b.end }];
 } else {
  try{ranges=repeatEventRanges(b.start,b.end,{frequency,calendarType,count});}catch(e){fail(400,e.message);}
 }
 const targetId=req.method==='PUT'&&typeof b.calendar_id==='string'?b.calendar_id:id;
 if(targetId!==id){
  await writeAccess(targetId,user);
  const externalIds=(await all('SELECT id FROM external_calendars WHERE calendar_id=ANY($1::text[])',[id,targetId])).map(ec=>ec.id);
  const lockedMove=await syncEngine.withCalendarLocks(externalIds,async()=>{
   await transaction(async client=>{
   const roles=(await client.query("SELECT calendar_id,role FROM members WHERE user_id=$1 AND calendar_id=ANY($2::text[]) FOR UPDATE",[user.id,[id,targetId]])).rows;
   if(roles.length!==2||roles.some(m=>m.role==='viewer'))fail(403,'두 캘린더의 편집 권한이 필요합니다.');
   const locked=(await client.query('SELECT * FROM events WHERE id=$1 AND calendar_id=$2 FOR UPDATE',[eventId,id])).rows[0];
   if(!locked||locked.version!==b.version)fail(409,'일정이 변경되었습니다. 새로고침해 주세요.');
   const mapping=(await client.query('SELECT * FROM external_event_mappings WHERE local_event_id=$1 FOR UPDATE',[eventId])).rows[0];
   await client.query('INSERT INTO calendar_move_jobs(event_id,source_calendar_id,target_calendar_id,source_external_id,remote_url,remote_etag) VALUES($1,$2,$3,$4,$5,$6)',[eventId,id,targetId,mapping?.external_calendar_id||null,mapping?.external_object_url||null,mapping?.etag||null]);
   await client.query('DELETE FROM external_event_mappings WHERE local_event_id=$1',[eventId]);
   await client.query('UPDATE events SET calendar_id=$1,title=$2,start=$3,"end"=$4,color=$5,notes=$6,category=$7,all_day=$8,is_todo=$9,completed=$10,reminder_enabled=$11,reminder_minutes=$12,is_dday=$13,is_cancelled=$14,version=version+1 WHERE id=$15',[targetId,b.title.trim(),b.start,b.end,b.color,b.notes,category,allDay,isTodo,completed,reminderEnabled,reminderMinutes,isDday,isCancelled,eventId]);
   });return true;
  });
  if(!lockedMove)fail(409,'iCloud 동기화가 진행 중입니다. 잠시 후 다시 이동해 주세요.');
  const synced=await calendarMoves.process(eventId);
  broadcast(id);broadcast(targetId);return json({ok:true,moved:true,syncPending:!synced});
 }
 if(eventId){const result=await run('UPDATE events SET title=$1,start=$2,"end"=$3,color=$4,notes=$5,category=$6,all_day=$10,is_todo=$11,completed=$12,reminder_enabled=$13,reminder_minutes=$14,is_dday=$15,is_cancelled=$16,version=version+1 WHERE id=$7 AND calendar_id=$8 AND version=$9',b.title.trim(),b.start,b.end,b.color,b.notes,category,eventId,id,b.version,allDay,isTodo,completed,reminderEnabled,reminderMinutes,isDday,isCancelled);if(!result.rowCount)fail(409,'일정이 변경되었습니다. 다시 확인해 주세요.');syncEngine.pushLocalEventToExternal(eventId,'update',{calendarId:id,eventData:{id:eventId,title:b.title.trim(),start:b.start,end:b.end,all_day:allDay,notes:b.notes,version:existing.version+1}}).catch(e=>console.warn('Two-way sync update failed:',e.message));notifyCalendarActivity({all,run},{calendarId:id,calendarName:m.name,actorUserId:user.id,actorName:user.name,action:'update',eventTitle:b.title.trim()}).catch(e=>console.warn('Activity push failed:',e.message));}
 else {
  await transaction(async client=>{
   for(const range of ranges){
    const newId=randomUUID();
    await client.query('INSERT INTO events(id,calendar_id,title,start,"end",color,notes,category,all_day,is_todo,completed,reminder_enabled,reminder_minutes,is_dday,is_cancelled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[newId,id,b.title.trim(),range.start,range.end,b.color,b.notes,category,allDay,isTodo,completed,reminderEnabled,reminderMinutes,isDday,isCancelled]);
    syncEngine.pushLocalEventToExternal(newId,'create',{calendarId:id,eventData:{id:newId,title:b.title.trim(),start:range.start,end:range.end,all_day:allDay,notes:b.notes}}).catch(e=>console.warn('Two-way sync create failed:',e.message));
   }
  });
  notifyCalendarActivity({all,run},{calendarId:id,calendarName:m.name,actorUserId:user.id,actorName:user.name,action:'create',eventTitle:b.title.trim()}).catch(e=>console.warn('Activity push failed:',e.message));
  broadcast(id);return json({ok:true,created:ranges.length});
 }
 }broadcast(id);return json({ok:true});
 }fail(405,'허용되지 않은 요청입니다.');
 }
 if(!['GET','HEAD'].includes(req.method))fail(405,'허용되지 않은 요청입니다.');
 fail(404,'페이지를 찾을 수 없습니다.');
 }catch(e){console.error('ERROR:',e.status,e.message,e.stack);if(res.headersSent){res.end();return;}json({error:e.status?e.message:'요청 처리 중 오류가 발생했습니다.'},e.status||500);}
}
const server=http.createServer(handleRequest);
export { server, db, handleRequest, syncEngine, calendarMoves, startReminderWorker };
const shouldListen = !process.env.NODE_TEST_CONTEXT && (process.argv[1]?.endsWith('server.mjs') || process.env.pm_id !== undefined || process.env.PM2_HOME);
if (shouldListen) {
  server.listen(port,'127.0.0.1',()=>console.log(`모아 캘린더: ${origin} (포트 ${port})${demo?' (개발용 체험 모드)':''}`));
  calendarMoves.start();
  syncEngine.startBackgroundSync(Number(process.env.CALDAV_SYNC_INTERVAL_MS || 15 * 60 * 1000));
  startReminderWorker({all,run});
}
