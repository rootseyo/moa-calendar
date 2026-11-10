import {deleteCalendarEvent} from './caldav.mjs';
import {decryptSecret} from './google-tokens.mjs';

export function createCalendarMoveQueue({query,engine,broadcast=()=>{},deleteRemote=deleteCalendarEvent,decrypt=decryptSecret}){
 const running=new Set();
 async function hasPending(calendarId){
  return (await query('SELECT 1 FROM calendar_move_jobs WHERE source_calendar_id=$1 OR target_calendar_id=$1 LIMIT 1',[calendarId])).rows.length>0;
 }
 async function process(eventId){
  if(running.has(eventId))return false;
  running.add(eventId);
  try{
   const job=(await query('SELECT * FROM calendar_move_jobs WHERE event_id=$1',[eventId])).rows[0];
   if(!job)return true;
   const ids=(await query('SELECT id FROM external_calendars WHERE calendar_id=ANY($1::text[]) OR id=$2',[[job.source_calendar_id,job.target_calendar_id],job.source_external_id])).rows.map(r=>r.id);
   return await engine.withCalendarLocks(ids,async()=>{
    if(!job.source_deleted&&job.remote_url&&job.source_external_id){
     const source=(await query('SELECT cc.* FROM calendar_connections cc JOIN external_calendars ec ON ec.connection_id=cc.id WHERE ec.id=$1',[job.source_external_id])).rows[0];
     if(!source||source.connection_status!=='connected')throw new Error('원본 iCloud 연결을 확인해 주세요.');
     const password=decrypt(source.encrypted_credentials,`icloud:${source.user_id}`);
     if(!password)throw new Error('원본 iCloud 인증을 확인해 주세요.');
     try{await deleteRemote(job.remote_url,source.account_email,password,{etag:job.remote_etag});}
     catch(error){if(error.status!==404)throw error;}
    }
    if(!job.source_deleted)await query('UPDATE calendar_move_jobs SET source_deleted=true,last_error=NULL WHERE event_id=$1',[eventId]);
    const target=(await query("SELECT ec.id,cc.connection_status FROM external_calendars ec JOIN calendar_connections cc ON cc.id=ec.connection_id WHERE ec.calendar_id=$1 AND ec.is_enabled=true AND ec.sync_direction='two_way' AND ec.is_read_only=false",[job.target_calendar_id])).rows[0];
    if(target){
     if(target.connection_status!=='connected')throw new Error('대상 iCloud 연결을 확인해 주세요.');
     const result=await engine.pushLocalEventToExternal(eventId,'update',{calendarId:job.target_calendar_id});
     if(!result?.ok)throw new Error('대상 iCloud 동기화를 기다리고 있어요.');
    }
    await query('DELETE FROM calendar_move_jobs WHERE event_id=$1',[eventId]);
    broadcast(job.source_calendar_id);broadcast(job.target_calendar_id);
    return true;
   });
  }catch(error){
   await query('UPDATE calendar_move_jobs SET last_error=$2 WHERE event_id=$1',[eventId,error.message]).catch(()=>{});
   return false;
  }finally{running.delete(eventId);}
 }
 async function retry(){
  const jobs=(await query('SELECT event_id FROM calendar_move_jobs ORDER BY created_at')).rows;
  for(const job of jobs)await process(job.event_id);
 }
 function start(){const timer=setInterval(()=>retry().catch(e=>console.warn('Calendar move retry failed:',e.message)),30000);timer.unref();retry().catch(()=>{});return timer;}
 return {hasPending,process,retry,start};
}
