import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
const origin='http://localhost:3197';
const dir=await mkdtemp(join(tmpdir(),'moa-test-'));
process.env.APP_URL=origin;
process.env.DEMO_MODE='true';
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('/share_schedule_db')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('/share_schedule_db', '/share_schedule_test_db');
}
process.env.GOOGLE_CLIENT_ID='oauth-test-client';
process.env.GOOGLE_CLIENT_SECRET='oauth-test-secret';
process.env.OAUTH_TOKEN_ENCRYPTION_KEY='12'.repeat(32);
if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test_db')) throw new Error('Integration tests require a database named *_test_db');
const {GOOGLE_CALENDAR_LIST_SCOPE,GOOGLE_CALENDAR_SCOPE,decryptToken,encryptToken,encryptSecret}=await import('../google-tokens.mjs');
const {server,db}=await import('../server.mjs');

function invoke(path,{cookie,method='GET',data,source=origin}={}){
 const req=new Readable({read(){this.push(data?JSON.stringify(data):null);if(data)this.push(null);}});
 req.method=method;req.url=path;req.headers={origin:source,...(cookie?{cookie}:{} )};
 const res=new EventEmitter();res.headers={};res.status=200;res.text='';
 res.setHeader=(k,v)=>res.headers[k.toLowerCase()]=v;
 res.writeHead=(status,headers={})=>{res.status=status;res.headersSent=true;for(const [k,v]of Object.entries(headers))res.setHeader(k,v);};
 res.write=chunk=>{res.text+=chunk;res.emit('chunk',chunk);return true;};
 res.end=chunk=>{if(chunk)res.write(chunk);res.emit('finish');};
 return {req,res,start:()=>server.emit('request',req,res)};
}

function waitForChunk(res, timeout = 3000) {
 return new Promise((resolve, reject) => {
  if (res.text) return resolve(res.text);
  const t = setTimeout(() => reject(new Error('waitForChunk timeout')), timeout);
  res.once('chunk', chunk => { clearTimeout(t); resolve(chunk); });
 });
}

async function request(path,options){
 const io=invoke(path,options);
 const done=new Promise((resolve, reject)=>{
  const t = setTimeout(() => reject(new Error(`request ${path} timeout`)), 5000);
  io.res.once('finish',()=>{
   clearTimeout(t);
   resolve({status:io.res.status,data:io.res.text?JSON.parse(io.res.text):null,location:io.res.headers.location,cookie:io.res.headers['set-cookie']?.split(';')[0]});
  });
 });
 io.start();
 return done;
}

async function login(name){return (await request('/auth/demo',{method:'POST',data:{name}})).cookie;}

let dbAvailable=false;
before(async()=>{
 try {
  const client = await Promise.race([
   db.connect(),
   new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
  ]);
  client.release();
  dbAvailable = true;
 } catch {
  console.log('⚠️ PostgreSQL test DB not reachable, skipping live DB integration tests.');
  return;
 }
 await db.query(await readFile(new URL('../db/004_add_all_day.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('../db/005_expand_event_colors.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('../db/011_google_calendar_authorization.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('../db/012_icloud_caldav.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('../db/013_calendar_migration.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('../db/014_calendar_order_moves.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('../db/025_calendar_invite_tracking.sql',import.meta.url),'utf8'));
 await db.query('TRUNCATE users, calendars, sessions, invites, invite_signups, events, oauth, admin_actions CASCADE');
});

test('weekly generation creates the requested count and preserves time, colors, and all-day durations',async(t)=>{
 if(!dbAvailable){if(t?.skip)t.skip('Database unavailable');return;}
 const user=await login('매주반복사용자');
 const c=await request('/api/calendars',{cookie:user,method:'POST',data:{name:'매주 반복 테스트'}});
 const base=`/api/calendars/${c.data.id}/events`;
 const event={title:'매주 모임',start:'2026-12-28T23:30',end:'2026-12-29T00:30',all_day:false,color:'rose',category:'약속',notes:'반복 메모',repeat_weeks:4};
 const created=await request(base,{cookie:user,method:'POST',data:event});
 assert.equal(created.status,200);assert.equal(created.data.created,4);
 let list=(await request(base,{cookie:user})).data;
 assert.equal(list.length,4);assert.equal(new Set(list.map(e=>e.id)).size,4);
 assert.equal(list[3].start,'2027-01-18T23:30');assert.equal(list[3].end,'2027-01-19T00:30');
 assert.ok(list.every(e=>e.color==='rose'&&e.category==='약속'&&e.notes==='반복 메모'&&!e.all_day));
 assert.equal((await request(`${base}/${list[0].id}`,{cookie:user,method:'PUT',data:{...event,version:list[0].version}})).status,400);
 for(const repeat_weeks of [0,53,2.5,'4'])assert.equal((await request(base,{cookie:user,method:'POST',data:{...event,repeat_weeks}})).status,400);
 assert.equal((await request(base,{cookie:user,method:'POST',data:{...event,start:'2026-02-30T09:00',end:'2026-03-01T10:00'}})).status,400);
 assert.equal((await request(base,{cookie:user})).data.length,4);
 const allDay={...event,title:'매주 휴가',start:'2026-10-12T00:00',end:'2026-10-15T00:00',all_day:true,color:'teal',repeat_weeks:2};
 assert.equal((await request(base,{cookie:user,method:'POST',data:allDay})).data.created,2);
 list=(await request(base,{cookie:user})).data.filter(e=>e.title==='매주 휴가');
 assert.equal(list[1].start,'2026-10-19T00:00');assert.equal(list[1].end,'2026-10-22T00:00');
 assert.ok(list.every(e=>e.all_day&&e.color==='teal'));
 for(const color of ['sage','blue','peach','lavender','coral','rose','yellow','teal'])assert.equal((await request(base,{cookie:user,method:'POST',data:{...event,color,repeat_weeks:1}})).status,200);
 assert.equal((await request(base,{cookie:user,method:'POST',data:{...event,color:'invalid'}})).status,400);
});

test('all-day events persist exclusive date ranges, preserve the flag on older updates, and validate input',async(t)=>{
 if(!dbAvailable){if(t?.skip)t.skip('Database unavailable');return;}
 const user=await login('하루종일사용자');
 const c=await request('/api/calendars',{cookie:user,method:'POST',data:{name:'하루 종일 테스트'}});
 const base=`/api/calendars/${c.data.id}/events`;
 const event={title:'휴가',start:'2026-10-12T00:00',end:'2026-10-15T00:00',all_day:true,color:'sage',category:'개인',notes:''};
 assert.equal((await request(base,{cookie:user,method:'POST',data:event})).status,200);
 let saved=(await request(base,{cookie:user})).data[0];
 assert.equal(saved.all_day,true);
 assert.equal(saved.start,event.start);
 assert.equal(saved.end,event.end);
 const {all_day,...legacy}=event;
 assert.equal((await request(`${base}/${saved.id}`,{cookie:user,method:'PUT',data:{...legacy,title:'휴가 수정',version:saved.version}})).status,200);
 saved=(await request(base,{cookie:user})).data[0];
 assert.equal(saved.all_day,true);
 assert.equal((await request(base,{cookie:user,method:'POST',data:{...event,start:'2026-10-12T09:00'}})).status,400);
 assert.equal((await request(base,{cookie:user,method:'POST',data:{...event,end:event.start}})).status,400);
 assert.equal((await request(base,{cookie:user,method:'POST',data:{...event,all_day:'true'}})).status,400);
 assert.equal((await request(base,{cookie:user,method:'POST',data:{...event,start:123}})).status,400);
 assert.equal((await request(`${base}/${saved.id}`,{cookie:user,method:'PUT',data:{...event,start:'2026-10-12T09:00',end:'2026-10-12T10:00',all_day:false,version:saved.version}})).status,200);
 saved=(await request(base,{cookie:user})).data[0];
 assert.equal(saved.all_day,false);
});

after(async()=>{
 if(dbAvailable){
  try{
   await db.query('TRUNCATE users, calendars, sessions, invites, invite_signups, events, oauth, admin_actions CASCADE');
   await db.end();
  }catch{}
 }
 await rm(dir,{recursive:true,force:true});
});

test('login, invitation permissions, realtime presence, conflict detection and revocation',async(t)=>{
 if(!dbAvailable){if(t?.skip)t.skip('Database unavailable');return;}
 assert.equal((await request('/api/calendars')).status,401);
 const owner=await login('소유자'),viewer=await login('보기 멤버'),outsider=await login('외부인');
 const c=await request('/api/calendars',{cookie:owner,method:'POST',data:{name:'함께하는 일정'}});assert.equal(c.status,201);const base=`/api/calendars/${c.data.id}`;
 assert.equal((await request(base+'/events',{cookie:outsider})).status,403);
 assert.equal((await request('/api/calendars',{cookie:owner,method:'POST',data:{name:'위조'},source:'https://evil.example'})).status,403);
 const inv=await request(base+'/invites',{cookie:owner,method:'POST',data:{role:'viewer'}});const invitePath='/api'+new URL(inv.data.url).pathname;
 assert.equal((await request(invitePath,{cookie:viewer,method:'POST',data:{}})).status,200);
 assert.equal((await request(base+'/invites',{cookie:viewer,method:'POST',data:{}})).status,403);
 const event={title:'함께 점심',start:'2026-10-12T12:00',end:'2026-10-12T13:00',color:'sage',notes:'테스트'};
 assert.equal((await request(base+'/events',{cookie:viewer,method:'POST',data:event})).status,403);
 const stream=invoke(base+'/stream',{cookie:owner});
 stream.start();
 await waitForChunk(stream.res);
 assert.equal(stream.res.status,200);
 assert.match(stream.res.text,/event: presence/);
 assert.match(stream.res.text,/소유자/);
 stream.res.text='';
 assert.equal((await request(base+'/events',{cookie:owner,method:'POST',data:event})).status,200);
 await waitForChunk(stream.res);
 assert.match(stream.res.text,/event: change/);
 stream.req.emit('close');
 stream.res.emit('close');
 const saved=(await request(base+'/events',{cookie:viewer})).data[0];assert.equal(saved.title,event.title);
 assert.equal((await request(base+'/events/'+saved.id,{cookie:owner,method:'PUT',data:{...event,title:'변경됨',version:1}})).status,200);
 assert.equal((await request(base+'/events/'+saved.id,{cookie:owner,method:'PUT',data:{...event,version:1}})).status,409);
 assert.equal((await request(base+'/events/'+saved.id,{cookie:viewer,method:'DELETE',data:{version:2}})).status,403);
 assert.equal((await request(base+'/events/'+saved.id,{cookie:owner,method:'DELETE',data:{version:2}})).status,200);
 assert.equal((await request(base+'/events',{cookie:owner})).data.length,0);
 await request(base+'/invites',{cookie:owner,method:'DELETE',data:{}});assert.equal((await request(invitePath,{cookie:outsider,method:'POST',data:{}})).status,404);
 await request('/auth/logout',{cookie:owner,method:'POST',data:{}});assert.equal((await request('/api/calendars',{cookie:owner})).status,401);
});

test('custom slug calendar creation, slug route resolution, duplicate check, and SPA fallback',async(t)=>{
 if(!dbAvailable){if(t?.skip)t.skip('Database unavailable');return;}
 const user=await login('슬러그사용자');
 const res=await request('/api/calendars',{cookie:user,method:'POST',data:{name:'우리가족',slug:'our-family'}});
 assert.equal(res.status,201);
 assert.equal(res.data.slug,'our-family');

 // Duplicate slug should fail with 409
 const dup=await request('/api/calendars',{cookie:user,method:'POST',data:{name:'중복캘린더',slug:'our-family'}});
 assert.equal(dup.status,409);

 // Invalid slug should fail with 400
 const inv=await request('/api/calendars',{cookie:user,method:'POST',data:{name:'잘못된슬러그',slug:'A!'}});
 assert.equal(inv.status,400);

 // Query events via custom slug
 const evRes=await request('/api/calendars/our-family/events',{cookie:user});
 assert.equal(evRes.status,200);

 // SPA HTML fallback: GET /our-family returns 200 with HTML
 const spaRes=invoke('/our-family');
 const htmlDone=new Promise(resolve=>spaRes.res.once('finish',()=>resolve(spaRes.res)));
 spaRes.start();
 const page=await htmlDone;
 assert.equal(page.status,200);
 assert.match(page.text,/<div id="app">/);

 // Test creating event with category
 const evWithCat=await request('/api/calendars/our-family/events',{cookie:user,method:'POST',data:{title:'카테고리 테스트',start:'2026-10-12T14:00',end:'2026-10-12T15:00',color:'blue',category:'업무',notes:'카테고리 메모'}});
 assert.equal(evWithCat.status,200);
 const fetchedList=(await request('/api/calendars/our-family/events',{cookie:user})).data;
 const createdEv=fetchedList.find(e=>e.title==='카테고리 테스트');
 assert.ok(createdEv);
 assert.equal(createdEv.category,'업무');
});



test('Google sign-in, separate scope consent, import sharing, encrypted storage and disconnect',async(t)=>{
 if(!dbAvailable){if(t?.skip)t.skip('Database unavailable');return;}
 const originalFetch=globalThis.fetch;
 let grantedScope='openid',subject='verification-user',revokeFails=false;
 let calendarCalls=0,refreshCalls=0,releaseToken=null;
 const reply=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 globalThis.fetch=async(url,options)=>{
  const address=String(url);
  if(address==='https://oauth2.googleapis.com/token'){
   const fields=new URLSearchParams(options.body);
   if(fields.get('grant_type')==='refresh_token')refreshCalls++;
   return reply({access_token:'mock-access',refresh_token:'mock-refresh',scope:grantedScope,expires_in:3600});
  }
  if(address==='https://openidconnect.googleapis.com/v1/userinfo')return reply({sub:subject});
  if(address==='https://oauth2.googleapis.com/revoke'){
   if(revokeFails)throw new Error('Simulated revoke outage');return reply({});
  }
  if(address.startsWith('https://www.googleapis.com/calendar/v3/')){
   calendarCalls++;
   return reply({items:[{summary:'OAuth Demo Meeting',description:'Sample event',start:{dateTime:'2026-10-20T10:00:00+09:00'},end:{dateTime:'2026-10-20T11:00:00+09:00'}}]});
  }
  throw new Error('Unexpected test HTTP destination');
 };
 const start=async(cookie,link=false)=>{
  const result=await request(`/auth/google?next=%2Fen%2F${link?'&link=true':''}`,{cookie});
  const auth=new URL(result.location);
  assert.equal(auth.searchParams.get('scope'),link?`openid ${GOOGLE_CALENDAR_SCOPE} ${GOOGLE_CALENDAR_LIST_SCOPE}`:'openid');
  return {state:auth.searchParams.get('state'),cookie:result.cookie};
 };
 const finish=(flow,cookie)=>request(`/auth/google/callback?state=${flow.state}&code=mock-code`,{cookie:[cookie,flow.cookie].filter(Boolean).join('; ')});
 try{
  const basic=await finish(await start());const cookie=basic.cookie;
  assert.equal((await request('/api/me',{cookie})).data.user.hasGoogleCalendar,false);
  let acc=(await db.query("SELECT * FROM user_accounts WHERE provider='google' AND provider_id=$1",[subject])).rows[0];
  assert.equal(acc.access_token,null);
  const declined=await finish(await start(cookie,true),cookie);
  assert.match(declined.location,/calendar_permission_denied/);
  assert.equal((await request('/api/me',{cookie})).data.user.hasGoogleCalendar,false);
  grantedScope=`openid ${GOOGLE_CALENDAR_SCOPE}`;
  const accepted=await finish(await start(cookie,true),cookie);
  assert.match(accepted.location,/linked=google/);
  acc=(await db.query("SELECT * FROM user_accounts WHERE provider='google' AND provider_id=$1",[subject])).rows[0];
  assert.equal(acc.user_id,'google:verification-user');
  assert.notEqual(acc.access_token,'mock-access');
  assert.equal(decryptToken(acc.access_token,acc.user_id),'mock-access');
  assert.equal((await request('/api/me',{cookie})).data.user.hasGoogleCalendar,true);
  grantedScope='openid';
  await finish(await start(),null);
  assert.equal((await request('/api/me',{cookie})).data.user.hasGoogleCalendar,true,'sign-in must preserve Calendar authorization');
  const path='/api/google-calendar/import';
  const importData={range:'3',calendarName:'Google import',shareAcknowledged:true};
  assert.equal((await request(path,{cookie,method:'POST',data:{range:'3',calendarName:'Google import'}})).status,400);
  assert.equal(calendarCalls,0);
  const imported=await request(path,{cookie,method:'POST',data:importData});
  assert.equal(imported.status,201);assert.equal(imported.data.imported,1);assert.equal(calendarCalls,1);
  assert.ok((await request('/api/calendars',{cookie})).data.some(c=>c.id===imported.data.id&&c.name==='Google import'&&c.role==='owner'));
  assert.equal((await request(`/api/calendars/${imported.data.id}/events`,{cookie})).data[0].notes,'Sample event');
  // Refresh succeeds with encrypted storage before testing disconnect races.
  grantedScope=`openid ${GOOGLE_CALENDAR_SCOPE}`;
  await db.query("UPDATE user_accounts SET token_expires=0 WHERE provider='google' AND provider_id=$1",[subject]);
  assert.equal((await request(path,{cookie,method:'POST',data:importData})).status,201);
  assert.equal(refreshCalls,1);
  // A different logged-in browser session cannot complete another account connection.
  grantedScope=`openid ${GOOGLE_CALENDAR_SCOPE}`;
  const foreignCookie=await login('different-user'),pending=await start(cookie,true);
  assert.match((await finish(pending,foreignCookie)).location,/link_session_changed/);
  // Disconnect still deletes local credentials when Google cannot be reached.
  revokeFails=true;
  const disconnected=await request('/api/me/google-calendar',{cookie,method:'DELETE',data:{}});
  assert.equal(disconnected.status,200);assert.equal(disconnected.data.remoteRevoked,false);
  acc=(await db.query("SELECT * FROM user_accounts WHERE provider='google' AND provider_id=$1",[subject])).rows[0];
  assert.equal(acc.access_token,null);assert.equal(acc.refresh_token,null);
  assert.equal((await request('/api/me',{cookie})).data.user.hasGoogleCalendar,false);
  assert.equal((await request(`/api/calendars/${imported.data.id}/events`,{cookie})).data.length,1);
  const detailsBefore=await request(`/api/calendars/${imported.data.id}/details`,{cookie});
  assert.equal(detailsBefore.status,200);
  assert.equal(detailsBefore.data.calendar.is_google,true);
  const foreignUserCookie=await login('다른사용자');
  assert.equal((await request(`/api/calendars/${imported.data.id}`,{cookie:foreignUserCookie,method:'DELETE'})).status,403);
  const delRes=await request(`/api/calendars/${imported.data.id}`,{cookie,method:'DELETE'});
  assert.equal(delRes.status,200);
  assert.ok(!(await request('/api/calendars',{cookie})).data.some(c=>c.id===imported.data.id));
  assert.equal((await request(`/api/calendars/${imported.data.id}/events`,{cookie})).status,403);
  assert.equal((await request(path,{cookie,method:'POST',data:importData})).status,400);
  // A refresh which was already in flight cannot restore disconnected tokens or import events.
  revokeFails=false;
  await finish(await start(cookie,true),cookie);
  await db.query("UPDATE user_accounts SET token_expires=0 WHERE provider='google' AND provider_id=$1",[subject]);
  let reached;const reachedPromise=new Promise(resolve=>reached=resolve);
  const tokenFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
   if(String(url)==='https://oauth2.googleapis.com/token'){reached();await new Promise(resolve=>releaseToken=resolve);}
   return tokenFetch(url,options);
  };
  const importInFlight=request(path,{cookie,method:'POST',data:importData});
  await reachedPromise;
  await request('/api/me/google-calendar',{cookie,method:'DELETE',data:{}});
  releaseToken();
  assert.equal((await importInFlight).status,400);
  assert.equal(refreshCalls,2);
  assert.equal((await request('/api/me',{cookie})).data.user.hasGoogleCalendar,false);
  globalThis.fetch=tokenFetch;
  // An OAuth callback already exchanging its code cannot reconnect after a disconnect.
  const staleFlow=await start(cookie,true);
  let reachedCallback;const callbackReached=new Promise(resolve=>reachedCallback=resolve);
  globalThis.fetch=async(url,options)=>{
   if(String(url)==='https://oauth2.googleapis.com/token'){reachedCallback();await new Promise(resolve=>releaseToken=resolve);}
   return tokenFetch(url,options);
  };
  const callbackInFlight=finish(staleFlow,cookie);
  await callbackReached;
  await request('/api/me/google-calendar',{cookie,method:'DELETE',data:{}});
  releaseToken();
  assert.match((await callbackInFlight).location,/link_session_changed/);
  assert.equal((await request('/api/me',{cookie})).data.user.hasGoogleCalendar,false);
 }finally{globalThis.fetch=originalFetch;}
});

test('calendar migration previews without writes, copies into an existing calendar atomically and is idempotent',async(t)=>{
 if(!dbAvailable){t.skip('Database unavailable');return;}
 const cookie=await login('일정모으기 사용자'),outsider=await login('다른 사용자');
 const create=async name=>(await request('/api/calendars',{cookie,method:'POST',data:{name}})).data;
 const source=await create('원본 하나'),second=await create('원본 둘'),target=await create('기존 모아');
 const event={title:'중복 일정',start:'2026-10-14T10:00',end:'2026-10-14T11:00',color:'blue',notes:'원본 설명',category:'가족',all_day:false};
 const add=async(cal,value)=>{assert.equal((await request(`/api/calendars/${cal.id}/events`,{cookie,method:'POST',data:value})).status,200);};
 await add(source,event);await add(second,event);await add(target,event);
 await add(source,{...event,title:'가져올 일정',color:'rose',is_todo:true,completed:true});
 await add(second,{...event,title:'여러 날 휴가',start:'2026-10-20T00:00',end:'2026-10-23T00:00',all_day:true});
 const base='/api/me/calendar-migration';
 const sources=(await request(base+'/sources',{cookie})).data;
 assert.ok(sources.targets.some(c=>c.id===target.id));assert.ok(sources.sources.some(s=>s.id==='moa:'+source.id));
 const input={targetId:target.id,sourceIds:['moa:'+source.id,'moa:'+second.id],from:'2026-10-01',to:'2026-10-31',deduplicate:true};
 const preview=await request(base+'/preview',{cookie,method:'POST',data:input});
 assert.equal(preview.status,200);assert.equal(preview.data.total,4);assert.equal(preview.data.imported,2);assert.equal(preview.data.skipped,2);
 assert.equal((await request(`/api/calendars/${target.id}/events`,{cookie})).data.length,1);
 const commit={previewId:preview.data.previewId,shareAcknowledged:true};
 assert.equal((await request(base+'/commit',{cookie,method:'POST',data:{...commit,shareAcknowledged:false}})).status,400);
 assert.equal((await request(base+'/commit',{cookie:outsider,method:'POST',data:commit})).status,400);
 const result=await request(base+'/commit',{cookie,method:'POST',data:commit});
 assert.equal(result.status,200);assert.equal(result.data.imported,2);
 assert.deepEqual((await request(base+'/commit',{cookie,method:'POST',data:commit})).data,result.data);
 const events=(await request(`/api/calendars/${target.id}/events`,{cookie})).data;
 assert.equal(events.length,3);assert.equal(events.find(e=>e.title==='여러 날 휴가').end,'2026-10-23T00:00');
 const todo=events.find(e=>e.title==='가져올 일정');assert.equal(todo.notes,event.notes);assert.equal(todo.color,'rose');assert.equal(todo.is_todo,true);assert.equal(todo.completed,true);
 assert.equal((await request(`/api/calendars/${source.id}/events`,{cookie})).data.length,2);
 const repeated=await request(base+'/preview',{cookie,method:'POST',data:input});
 assert.equal(repeated.data.imported,0);assert.equal(repeated.data.skipped,4);
 assert.equal((await request(base+'/preview',{cookie,method:'POST',data:{...input,sourceIds:['moa:'+target.id]}})).status,400);
 assert.equal((await request(base+'/preview',{cookie:outsider,method:'POST',data:input})).status,403);
 assert.equal((await request(base+'/preview',{cookie,method:'POST',data:{...input,from:'2026-02-30'}})).status,400);
 await db.query("UPDATE calendar_migration_previews SET expires_at=now()-interval '1 second' WHERE id=$1",[repeated.data.previewId]);
 assert.equal((await request(base+'/commit',{cookie,method:'POST',data:{...commit,previewId:repeated.data.previewId}})).status,400);
 // Losing destination write access after a preview prevents any copy.
 const revoked=await request(base+'/preview',{cookie,method:'POST',data:input});
 const userId=(await request('/api/me',{cookie})).data.user.id;
 await db.query("UPDATE members SET role='viewer' WHERE calendar_id=$1 AND user_id=$2",[target.id,userId]);
 assert.equal((await request(base+'/commit',{cookie,method:'POST',data:{...commit,previewId:revoked.data.previewId}})).status,403);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM events WHERE calendar_id=$1',[target.id])).rows[0].n,3);
});

test('migration reads all Google calendar pages and expanded iCloud instances without writing to either provider',async(t)=>{
 if(!dbAvailable){t.skip('Database unavailable');return;}
 const cookie=await login('외부 병합 사용자');
 const user=(await request('/api/me',{cookie})).data.user;
 const target=(await request('/api/calendars',{cookie,method:'POST',data:{name:'모든 외부 일정'}})).data;
 await db.query(`INSERT INTO user_accounts(provider,provider_id,user_id,access_token,token_scope,token_expires) VALUES('google',$1,$2,$3,$4,$5)`,['migration-google',user.id,encryptToken('test-access',user.id),`${GOOGLE_CALENDAR_SCOPE} ${GOOGLE_CALENDAR_LIST_SCOPE}`,Date.now()+3600000]);
 await db.query(`INSERT INTO calendar_connections(id,user_id,provider,account_email,encrypted_credentials) VALUES('migration-icloud',$1,'icloud','test@example.com',$2)`,[user.id,encryptSecret('fake-app-password','icloud:'+user.id)]);
 await db.query(`INSERT INTO external_calendars(id,connection_id,external_calendar_id,calendar_url,display_name,is_enabled,is_read_only) VALUES('migration-apple','migration-icloud','apple','https://caldav.icloud.com/test/','Apple 읽기 전용',false,true)`);
 const originalFetch=globalThis.fetch,calls=[];
 const reply=data=>new Response(JSON.stringify(data));
 globalThis.fetch=async(address,options)=>{
  const url=new URL(address);calls.push({url,method:options.method||'GET'});
  if(url.pathname.endsWith('/users/me/calendarList'))return reply(url.searchParams.get('pageToken')?{items:[{id:'team@example.com',summary:'Google 팀'}]}:{items:[{id:'owner@example.com',summary:'Google 기본',primary:true}],nextPageToken:'next-calendar'});
  if(url.pathname.includes('/events')){
   assert.equal(url.searchParams.get('singleEvents'),'true');assert.ok(url.searchParams.has('timeMax'));
   return reply({items:url.pathname.includes('/primary/')?[{id:'g-one',summary:'공통 회의',start:{dateTime:'2026-10-14T10:00:00+09:00'},end:{dateTime:'2026-10-14T11:00:00+09:00'}}]:[{id:'g-two',summary:'Google 휴가',start:{date:'2026-10-20'},end:{date:'2026-10-22'}}]});
  }
  if(url.hostname==='caldav.icloud.com'){
   assert.equal(options.method,'REPORT');assert.match(options.body,/<c:expand /);
   const events=[['20261014','20261014'],['20261021','20261021']].map(([date,recurrence])=>`BEGIN:VEVENT\r\nUID:series\r\nRECURRENCE-ID:${recurrence}T010000Z\r\nSUMMARY:공통 회의\r\nDTSTART:${date}T010000Z\r\nDTEND:${date}T020000Z\r\nEND:VEVENT`).join('\r\n');
   const res=new Response(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/test/event.ics</d:href><d:propstat><d:prop><c:calendar-data>BEGIN:VCALENDAR\r\n${events}\r\nEND:VCALENDAR</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`,{status:207});
   Object.defineProperty(res,'url',{value:address});return res;
  }
  throw new Error('Unexpected migration destination');
 };
 try{
  const sources=(await request('/api/me/calendar-migration/sources',{cookie})).data.sources;
  assert.ok(sources.some(s=>s.id==='google:primary'));assert.ok(sources.some(s=>s.id==='google:team@example.com'));assert.ok(sources.some(s=>s.id==='icloud:migration-apple'));
  const preview=await request('/api/me/calendar-migration/preview',{cookie,method:'POST',data:{targetId:target.id,sourceIds:['google:primary','google:team@example.com','icloud:migration-apple'],from:'2026-10-01',to:'2026-10-31',deduplicate:true}});
  assert.equal(preview.status,200);assert.equal(preview.data.total,4);assert.equal(preview.data.imported,3);assert.equal(preview.data.skipped,1);
  const result=await request('/api/me/calendar-migration/commit',{cookie,method:'POST',data:{previewId:preview.data.previewId,shareAcknowledged:true}});
  assert.equal(result.status,200);assert.equal(result.data.imported,3);
  assert.equal((await request(`/api/calendars/${target.id}/events`,{cookie})).data.length,3);
  assert.ok(calls.every(c=>['GET','REPORT'].includes(c.method)));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM external_event_mappings WHERE local_event_id IN(SELECT id FROM events WHERE calendar_id=$1)',[target.id])).rows[0].n,0);
 }finally{globalThis.fetch=originalFetch;}
});

test('calendar order is persistent, user-specific and rejects stale or foreign lists',async t=>{
 if(!dbAvailable){t.skip('Database unavailable');return;}
 const cookie=await login('캘린더순서검증');
 const first=(await request('/api/calendars',{cookie,method:'POST',data:{name:'순서첫째'}})).data;
 const second=(await request('/api/calendars',{cookie,method:'POST',data:{name:'순서둘째'}})).data;
 const other=await login('다른순서사용자');
 const foreign=(await request('/api/calendars',{cookie:other,method:'POST',data:{name:'다른목록'}})).data;
 assert.equal((await request('/api/calendars/order',{cookie,method:'PUT',data:{calendarIds:[second.id,first.id]}})).status,200);
 assert.deepEqual((await request('/api/calendars',{cookie})).data.map(c=>c.id),[second.id,first.id]);
 assert.deepEqual((await request('/api/calendars',{cookie:other})).data.map(c=>c.id),[foreign.id]);
 assert.equal((await request('/api/calendars/order',{cookie,method:'PUT',data:{calendarIds:[second.id,foreign.id]}})).status,409);
 assert.equal((await request('/api/calendars/order',{cookie,method:'PUT',data:{calendarIds:[first.id,first.id]}})).status,400);
});

test('moving events preserves identity and fields and enforces destination permissions and versions',async t=>{
 if(!dbAvailable){t.skip('Database unavailable');return;}
 const cookie=await login('일정이동검증');
 const source=(await request('/api/calendars',{cookie,method:'POST',data:{name:'이동원본'}})).data;
 const target=(await request('/api/calendars',{cookie,method:'POST',data:{name:'이동대상'}})).data;
 const outsider=await login('이동비참여자');
 const foreign=(await request('/api/calendars',{cookie:outsider,method:'POST',data:{name:'비참여대상'}})).data;
 const payload={title:'이동 약속',start:'2026-10-14T09:00',end:'2026-10-14T10:00',color:'rose',notes:'보존 메모',category:'분류',is_todo:true,completed:true};
 await request(`/api/calendars/${source.id}/events`,{cookie,method:'POST',data:payload});
 const event=(await request(`/api/calendars/${source.id}/events`,{cookie})).data[0];
 assert.equal((await request(`/api/calendars/${source.id}/events/${event.id}`,{cookie,method:'PUT',data:{...payload,version:event.version,calendar_id:foreign.id}})).status,403);
 assert.equal((await request(`/api/calendars/${source.id}/events/${event.id}`,{cookie,method:'PUT',data:{...payload,version:99,calendar_id:target.id}})).status,409);
 const moved=await request(`/api/calendars/${source.id}/events/${event.id}`,{cookie,method:'PUT',data:{...payload,version:event.version,calendar_id:target.id}});
 assert.equal(moved.status,200);assert.equal(moved.data.moved,true);assert.equal(moved.data.syncPending,false);
 assert.equal((await request(`/api/calendars/${source.id}/events`,{cookie})).data.length,0);
 const saved=(await request(`/api/calendars/${target.id}/events`,{cookie})).data[0];
 assert.equal(saved.id,event.id);assert.equal(saved.version,event.version+1);
 assert.equal(saved.notes,payload.notes);assert.equal(saved.completed,true);assert.equal(saved.is_todo,true);
 await db.query("UPDATE calendars SET source_provider='google' WHERE id=$1",[target.id]);
 assert.equal((await request(`/api/calendars/${target.id}/events/${event.id}`,{cookie,method:'PUT',data:{...payload,version:saved.version,calendar_id:source.id}})).status,403);
 assert.equal((await request(`/api/calendars/${target.id}/events`,{cookie,method:'POST',data:payload})).status,403);
 const calendars=(await request('/api/calendars',{cookie})).data;
 assert.equal(calendars.find(c=>c.id===target.id).read_only,true);
 assert.equal((await request(`/api/calendars/${source.id}/events`,{cookie,method:'POST',data:payload})).status,200);
 assert.equal((await request(`/api/calendars/${target.id}/events`,{cookie})).data.length,1);
});

test('two-way iCloud moves durably retry destination sync and never re-delete the source',async t=>{
 if(!dbAvailable){t.skip('Database unavailable');return;}
 const {calendarMoves,syncEngine}=await import('../server.mjs');
 const cookie=await login('iCloud이동검증');
 const user=(await request('/api/me',{cookie})).data.user;
 const source=(await request('/api/calendars',{cookie,method:'POST',data:{name:'Apple원본'}})).data;
 const target=(await request('/api/calendars',{cookie,method:'POST',data:{name:'Apple대상'}})).data;
 const payload={title:'Apple 이동 약속',start:'2026-10-14T09:00',end:'2026-10-14T10:00',color:'blue',notes:'iCloud 메모',category:'약속'};
 await request(`/api/calendars/${source.id}/events`,{cookie,method:'POST',data:payload});
 const event=(await request(`/api/calendars/${source.id}/events`,{cookie})).data[0];
 await db.query("INSERT INTO calendar_connections(id,user_id,provider,account_email,encrypted_credentials) VALUES('move-connection',$1,'icloud','move@example.com',$2)",[user.id,encryptSecret('mock-password',`icloud:${user.id}`)]);
 await db.query("INSERT INTO external_calendars(id,connection_id,calendar_id,external_calendar_id,calendar_url,display_name,sync_direction) VALUES('move-source','move-connection',$1,'source','https://caldav.icloud.com/source/','source','two_way'),('move-target','move-connection',$2,'target','https://caldav.icloud.com/target/','target','two_way')",[source.id,target.id]);
 await db.query("INSERT INTO external_event_mappings(id,external_calendar_id,local_event_id,external_event_uid,external_object_url,etag) VALUES('move-mapping','move-source',$1,'original-uid','https://caldav.icloud.com/source/original.ics','original-etag')",[event.id]);
 const originalFetch=globalThis.fetch;
 const calls=[];let putAttempts=0;
 globalThis.fetch=async(address,options)=>{
  assert.equal(new URL(address).hostname,'caldav.icloud.com');calls.push(options.method);
  if(options.method==='DELETE'){assert.equal(new Headers(options.headers).get('If-Match'),'"original-etag"');return new Response(null,{status:204});}
  if(options.method==='PUT'){
   putAttempts++;assert.ok(address.includes('/target/'));assert.match(options.body,/Apple/);
   return new Response(null,{status:putAttempts===1?503:201,headers:{ETag:'new-etag'}});
  }
  throw new Error('Unexpected external operation '+options.method);
 };
 try{
  const moved=await request(`/api/calendars/${source.id}/events/${event.id}`,{cookie,method:'PUT',data:{...payload,version:event.version,calendar_id:target.id}});
  assert.equal(moved.status,200);assert.equal(moved.data.syncPending,true);
  const pending=(await request(`/api/calendars/${target.id}/events`,{cookie})).data[0];
  assert.equal(pending.sync_pending,true);assert.ok(pending.sync_error);
  assert.equal((await syncEngine.syncExternalCalendar('move-source')).skipped,true);
  assert.equal((await request(`/api/calendars/${target.id}/events/${event.id}`,{cookie,method:'PUT',data:{...payload,version:pending.version}})).status,409);
  await calendarMoves.retry();
  assert.deepEqual(calls,['DELETE','PUT','PUT']);
  const saved=(await request(`/api/calendars/${target.id}/events`,{cookie})).data[0];
  assert.equal(saved.sync_pending,false);assert.equal(saved.id,event.id);
  const mapping=(await db.query('SELECT * FROM external_event_mappings WHERE local_event_id=$1',[event.id])).rows[0];
  assert.equal(mapping.external_calendar_id,'move-target');assert.equal(mapping.etag,'new-etag');
  assert.equal((await request(`/api/calendars/${source.id}/events`,{cookie})).data.length,0);
 }finally{globalThis.fetch=originalFetch;}
});
