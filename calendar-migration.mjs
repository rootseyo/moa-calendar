import {randomUUID, createHash} from 'node:crypto';
import {isValidLocalDateTime, EVENT_COLORS} from './public/event-utils.js';
import {fetchCalendarEvents, hexToClosestDwmColor} from './caldav.mjs';
import {decryptSecret, hasCalendarScope, GOOGLE_CALENDAR_LIST_SCOPE} from './google-tokens.mjs';
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MAX_EVENTS=30000;
export function migrationWindow(from,to){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||'')||!isValidLocalDateTime(from+'T00:00')||!isValidLocalDateTime(to+'T00:00')||from>to)throw error('가져올 시작일과 종료일을 확인해 주세요.');
 if(to>'9998-12-31')throw error('가져올 종료일은 9998년까지 지정할 수 있습니다.');
 const end=new Date(to+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);
 return {start:from+'T00:00',end:end.toISOString().slice(0,16),timeMin:from+'T00:00:00+09:00',timeMax:end.toISOString().slice(0,10)+'T00:00:00+09:00'};
}
export function normalizeMigrationEvent(event,source,userId){
 if(event.status?.toLowerCase()==='cancelled')return null;
 if(event.rrule)throw error('반복 일정의 개별 날짜를 조회하지 못했습니다. 기간을 줄여 다시 시도해 주세요.',502);
 let start=event.start,end=event.end,allDay=Boolean(event.all_day??event.allDay),identity=event.id||event.uid;
 if(source.provider==='google'){
  identity=event.id;
  if(event.recurrence?.length)throw error('Google 반복 일정을 개별 날짜로 조회하지 못했습니다.',502);
  const local=value=>{
   const date=new Date(value);
   if(!Number.isFinite(date.getTime()))return null;
   return new Date(date.getTime()+9*3600000).toISOString().slice(0,16);
  };
  allDay=Boolean(event.start?.date);
  start=allDay?event.start.date+'T00:00':local(event.start?.dateTime);
  end=allDay?event.end?.date+'T00:00':local(event.end?.dateTime);
 }
 if(!identity||!isValidLocalDateTime(start)||!isValidLocalDateTime(end)||end<=start)throw error('날짜가 올바르지 않은 일정이 있어 가져오기를 중단했습니다.',502);
 const title=String(event.summary??event.title??'').trim().slice(0,100)||'(제목 없음)';
 const description=String(event.description??event.notes??'');
 const notes=(source.provider==='google'&&event.location?description+'\n[장소] '+event.location:description).slice(0,2000);
 const category=String(event.category||({google:'Google',icloud:'iCloud',moa:'모아'}[source.provider])).slice(0,50);
 const color=EVENT_COLORS.includes(event.color)?event.color:source.color||'sage';
 return {title,start,end,allDay,notes,category,color,isTodo:Boolean(event.is_todo),completed:Boolean(event.completed),
  sourceId:source.id,sourceKey:digest([userId,source.id,identity,event.recurrenceId||'']),
  fingerprint:migrationFingerprint({title,start,end,allDay})};
}
export const migrationFingerprint=event=>digest([event.title.trim(),event.start,event.end,Boolean(event.allDay??event.all_day)]);
export function planMigration(events,existing=[],copiedKeys=[],deduplicate=true){
 const keys=new Set(copiedKeys),fingerprints=new Set(existing.map(migrationFingerprint)),rows=[];
 let skipped=0;
 for(const event of events){
  if(keys.has(event.sourceKey)||(deduplicate&&fingerprints.has(event.fingerprint))){skipped++;continue;}
  keys.add(event.sourceKey);fingerprints.add(event.fingerprint);rows.push(event);
 }
 return {rows,skipped};
}
export async function googlePages(path,accessToken,params={},fetchFn=fetch){
 const items=[],seen=new Set();let pageToken;
 do{
  const url=new URL('https://www.googleapis.com/calendar/v3/'+path);
  for(const [key,value]of Object.entries(params))url.searchParams.set(key,String(value));
  if(pageToken)url.searchParams.set('pageToken',pageToken);
  const response=await fetchFn(url.href,{headers:{Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw error(response.status===401||response.status===403?'Google 캘린더 권한을 확인하고 다시 연결해 주세요.':'Google 캘린더 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.',502);
  const data=await response.json();
  if(!Array.isArray(data.items))throw error('Google 캘린더 응답을 확인할 수 없습니다.',502);
  items.push(...data.items);
  if(items.length>MAX_EVENTS)throw error('일정이 너무 많습니다. 가져올 기간이나 캘린더 수를 줄여 주세요.');
  pageToken=data.nextPageToken;
  if(pageToken&&seen.has(pageToken))throw error('Google 캘린더 전체 목록을 조회하지 못했습니다.',502);
  if(pageToken)seen.add(pageToken);
 }while(pageToken);
 return items;
}
export function createCalendarMigration({query,transaction,getGoogleToken,fetchFn=(...args)=>fetch(...args),fetchICloud=fetchCalendarEvents,decrypt=decryptSecret,broadcast=()=>{}}){
 const rows=async(sql,values=[])=>(await query(sql,values)).rows;
 const targetSql=`SELECT c.id,c.name,c.slug,c.color FROM calendars c JOIN members m ON m.calendar_id=c.id
  WHERE m.user_id=$1 AND m.role IN ('owner','editor') AND c.status='ACTIVE'
  AND NOT EXISTS(SELECT 1 FROM external_calendars ec WHERE ec.calendar_id=c.id)`;
 async function listSources(userId){
  await query('DELETE FROM calendar_migration_previews WHERE expires_at<now()');
  const [targets,local,icloud]=await Promise.all([
   rows(targetSql+' ORDER BY c.name',[userId]),
   rows(`SELECT c.id,c.name,c.color FROM calendars c JOIN members m ON m.calendar_id=c.id WHERE m.user_id=$1 AND c.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM external_calendars ec WHERE ec.calendar_id=c.id) ORDER BY c.name`,[userId]),
   rows(`SELECT ec.id,ec.display_name,ec.color FROM external_calendars ec JOIN calendar_connections cc ON cc.id=ec.connection_id WHERE cc.user_id=$1 AND cc.provider='icloud' AND cc.connection_status='connected' ORDER BY ec.display_name`,[userId])
  ]);
  const sources=[...icloud.map(c=>({id:'icloud:'+c.id,provider:'icloud',name:c.display_name,color:hexToClosestDwmColor(c.color)})),...local.map(c=>({id:'moa:'+c.id,provider:'moa',name:c.name,color:c.color}))],errors=[];
  try{
   const accessToken=await getGoogleToken(userId);
   if(accessToken){
    const account=(await rows("SELECT token_scope FROM user_accounts WHERE user_id=$1 AND provider='google'",[userId]))[0];
    const canList=account?.token_scope?.split(/\s+/).includes(GOOGLE_CALENDAR_LIST_SCOPE);
    const google=canList?await googlePages('users/me/calendarList',accessToken,{maxResults:250,showHidden:true,minAccessRole:'reader'},fetchFn):[{id:'primary',summary:'Google 기본 캘린더',backgroundColor:'#4285f4'}];
    if(!canList)errors.push({provider:'google',needsAuthorization:true,message:'Google 기본 캘린더를 가져올 수 있습니다. 전체 캘린더 목록을 보려면 Google 권한을 다시 연결하세요.'});
    sources.unshift(...google.filter(c=>!c.deleted).map(c=>({id:'google:'+(c.primary?'primary':c.id),provider:'google',name:c.summaryOverride||c.summary||c.id,color:hexToClosestDwmColor(c.backgroundColor)})));
   }
  }catch(e){errors.push({provider:'google',message:e.status?e.message:'Google 캘린더 연결 상태를 확인해 주세요.'});}
  return {targets,sources,errors};
 }
 async function validateSources(client,userId,sources,generation){
  if(sources.some(s=>s.provider==='google')){
   const acc=(await client.query(`SELECT u.google_calendar_generation,a.token_scope FROM users u JOIN user_accounts a ON a.user_id=u.id AND a.provider='google' WHERE u.id=$1`,[userId])).rows[0];
   if(!acc||acc.google_calendar_generation!==generation||!hasCalendarScope(acc.token_scope))throw error('Google 캘린더 연결이 변경되었습니다. 미리보기를 다시 확인해 주세요.');
  }
  for(const source of sources){
   const id=source.id.slice(source.provider.length+1);
   const sql=source.provider==='icloud'
    ?`SELECT ec.id FROM external_calendars ec JOIN calendar_connections cc ON cc.id=ec.connection_id WHERE ec.id=$1 AND cc.user_id=$2 AND cc.connection_status='connected'`
    :source.provider==='moa'?`SELECT m.calendar_id FROM members m JOIN calendars c ON c.id=m.calendar_id WHERE m.calendar_id=$1 AND m.user_id=$2 AND c.status='ACTIVE'`:null;
   if(sql&&!(await client.query(sql,[id,userId])).rowCount)throw error('원본 캘린더의 연결 또는 접근 권한이 변경되었습니다.');
  }
 }
 async function lockTarget(client,userId,targetId){
  // All migration commits to this destination serialize before reading duplicate keys.
  const target=(await client.query(`SELECT c.id,c.name,c.slug FROM calendars c JOIN members m ON m.calendar_id=c.id WHERE c.id=$1 AND m.user_id=$2 AND m.role IN ('owner','editor') AND c.status='ACTIVE' FOR UPDATE OF c,m`,[targetId,userId])).rows[0];
  if(!target)throw error('일정을 모을 캘린더에 편집 권한이 없습니다.',403);
  if((await client.query('SELECT id FROM external_calendars WHERE calendar_id=$1',[targetId])).rowCount)throw error('외부 동기화 캘린더는 대상으로 선택할 수 없습니다. 모아 캘린더를 선택해 주세요.');
  return target;
 }
 async function preview(userId,input){
  const window=migrationWindow(input.from,input.to);
  if(typeof input.targetId!=='string'||!Array.isArray(input.sourceIds)||!input.sourceIds.length||input.sourceIds.length>100||new Set(input.sourceIds).size!==input.sourceIds.length)throw error('가져올 캘린더와 대상 캘린더를 선택해 주세요.');
  if(typeof input.deduplicate!=='boolean')throw error('중복 일정 처리 방법을 확인해 주세요.');
  const available=await listSources(userId);
  if(!available.targets.some(t=>t.id===input.targetId))throw error('일정을 모을 캘린더에 편집 권한이 없습니다.',403);
  const sources=input.sourceIds.map(id=>available.sources.find(s=>s.id===id));
  if(sources.some(s=>!s||s.id==='moa:'+input.targetId))throw error('가져올 원본 캘린더를 확인해 주세요.');
  const generation=(await rows('SELECT google_calendar_generation FROM users WHERE id=$1',[userId]))[0]?.google_calendar_generation;
  const accessToken=sources.some(s=>s.provider==='google')?await getGoogleToken(userId):null;
  if(sources.some(s=>s.provider==='google')&&!accessToken)throw error('Google 캘린더 권한을 다시 연결해 주세요.');
  const events=[],counts=[];
  for(const source of sources){
   const id=source.id.slice(source.provider.length+1);let items;
   try{
    if(source.provider==='google')items=await googlePages('calendars/'+encodeURIComponent(id)+'/events',accessToken,{maxResults:2500,singleEvents:true,showDeleted:false,timeMin:window.timeMin,timeMax:window.timeMax},fetchFn);
    else if(source.provider==='icloud'){
     const ec=(await rows(`SELECT ec.calendar_url,cc.account_email,cc.encrypted_credentials FROM external_calendars ec JOIN calendar_connections cc ON cc.id=ec.connection_id WHERE ec.id=$1 AND cc.user_id=$2 AND cc.connection_status='connected'`,[id,userId]))[0];
     if(!ec)throw error('iCloud 캘린더 연결을 확인해 주세요.');
     const secret=decrypt(ec.encrypted_credentials,'icloud:'+userId);
     if(!secret)throw error('iCloud 앱 암호를 다시 연결해 주세요.');
     items=(await fetchICloud(ec.calendar_url,ec.account_email,secret,{timeMin:window.timeMin,timeMax:window.timeMax,expand:true})).flatMap(item=>item.events);
    }else items=await rows(`SELECT e.* FROM events e JOIN members m ON m.calendar_id=e.calendar_id JOIN calendars c ON c.id=e.calendar_id WHERE e.calendar_id=$1 AND m.user_id=$2 AND c.status='ACTIVE' AND e.start<$3 AND e."end">$4`,[id,userId,window.end,window.start]);
    let count=0;
    for(const item of items){
     const event=normalizeMigrationEvent(item,source,userId);
     if(!event||event.start>=window.end||event.end<=window.start)continue;
     events.push(event);count++;
     if(events.length>MAX_EVENTS)throw error('일정이 너무 많습니다. 가져올 기간이나 캘린더 수를 줄여 주세요.');
    }
    counts.push({id:source.id,name:source.name,provider:source.provider,count});
   }catch(e){throw error(source.name+': '+(e.status?e.message:'일정을 조회하지 못했습니다. 연결 상태를 확인해 주세요.'),e.status===403?403:502);}
  }
  return transaction(async client=>{
   await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
   const target=await lockTarget(client,userId,input.targetId);
   await validateSources(client,userId,sources,generation);
   const existing=(await client.query('SELECT title,start,"end",all_day FROM events WHERE calendar_id=$1',[target.id])).rows;
   const keys=(await client.query('SELECT source_key FROM calendar_migration_copies WHERE target_calendar_id=$1',[target.id])).rows.map(r=>r.source_key);
   const plan=planMigration(events,existing,keys,input.deduplicate),previewId=randomUUID();
   await client.query('DELETE FROM calendar_migration_previews WHERE user_id=$1 AND (result IS NULL OR expires_at<now())',[userId]);
   await client.query(`INSERT INTO calendar_migration_previews(id,user_id,target_calendar_id,payload,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')`,[previewId,userId,target.id,JSON.stringify({events,sources,generation,deduplicate:input.deduplicate})]);
   return {previewId,targetName:target.name,total:events.length,imported:plan.rows.length,skipped:plan.skipped,counts};
  });
 }
 async function commit(userId,input){
  if(typeof input.previewId!=='string'||input.shareAcknowledged!==true)throw error('미리보기와 대상 캘린더의 공유 안내를 확인해 주세요.');
  const result=await transaction(async client=>{
   await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
   const job=(await client.query('SELECT * FROM calendar_migration_previews WHERE id=$1 AND user_id=$2 FOR UPDATE',[input.previewId,userId])).rows[0];
   if(!job)throw error('미리보기를 다시 확인해 주세요.');
   if(new Date(job.expires_at).getTime()<=Date.now())throw error('미리보기가 만료되었습니다. 다시 확인해 주세요.');
   const target=await lockTarget(client,userId,job.target_calendar_id);
   if(job.result)return job.result;
   const {events,sources,generation,deduplicate}=job.payload;
   await validateSources(client,userId,sources,generation);
   const existing=(await client.query('SELECT title,start,"end",all_day FROM events WHERE calendar_id=$1',[target.id])).rows;
   const keys=(await client.query('SELECT source_key FROM calendar_migration_copies WHERE target_calendar_id=$1',[target.id])).rows.map(r=>r.source_key);
   const plan=planMigration(events,existing,keys,deduplicate);
   for(const event of plan.rows){
    const id=randomUUID();
    await client.query(`INSERT INTO events(id,calendar_id,title,start,"end",color,notes,category,all_day,is_todo,completed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,target.id,event.title,event.start,event.end,event.color,event.notes,event.category,event.allDay,event.isTodo,event.completed]);
    await client.query('INSERT INTO calendar_migration_copies(target_calendar_id,source_key,local_event_id) VALUES($1,$2,$3)',[target.id,event.sourceKey,id]);
   }
   const result={ok:true,id:target.id,slug:target.slug,targetName:target.name,imported:plan.rows.length,skipped:plan.skipped,total:events.length};
   await client.query('UPDATE calendar_migration_previews SET result=$1 WHERE id=$2',[JSON.stringify(result),job.id]);
   return result;
  });
  broadcast(result.id);return result;
 }
 return {listSources,preview,commit};
}
