import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarMoveQueue} from '../calendar-moves.mjs';

test('calendar move retries target failures without repeating a successful source deletion',async()=>{
 const job={event_id:'event',source_calendar_id:'source',target_calendar_id:'target',source_external_id:'ext-source',remote_url:'https://caldav.icloud.com/source/event.ics',remote_etag:'v1',source_deleted:false};
 let exists=true,deletes=0,pushes=0;
 const query=async(sql,values)=>{
  if(sql.startsWith('SELECT * FROM calendar_move_jobs'))return {rows:exists?[{...job}]:[]};
  if(sql.startsWith('SELECT 1 FROM calendar_move_jobs'))return {rows:exists?[{one:1}]:[]};
  if(sql.startsWith('SELECT id FROM external_calendars'))return {rows:[{id:'ext-source'},{id:'ext-target'}]};
  if(sql.startsWith('SELECT cc.*'))return {rows:[{user_id:'user',encrypted_credentials:'encrypted',account_email:'test@example.com',connection_status:'connected'}]};
  if(sql.startsWith('UPDATE calendar_move_jobs SET source_deleted')){job.source_deleted=true;return {rows:[]};}
  if(sql.startsWith('UPDATE calendar_move_jobs SET last_error')){job.last_error=values[1];return {rows:[]};}
  if(sql.startsWith('SELECT ec.id,cc.connection_status'))return {rows:[{id:'ext-target',connection_status:'connected'}]};
  if(sql.startsWith('DELETE FROM calendar_move_jobs')){exists=false;return {rows:[]};}
  throw new Error(sql);
 };
 const queue=createCalendarMoveQueue({query,decrypt:()=> 'password',deleteRemote:async()=>{deletes++;},engine:{withCalendarLocks:async(ids,work)=>work(),pushLocalEventToExternal:async()=>{pushes++;if(pushes===1)throw new Error('temporary outage');return {ok:true};}}});
 assert.equal(await queue.process('event'),false);
 assert.equal(await queue.hasPending('source'),true);
 assert.equal(job.source_deleted,true);assert.equal(deletes,1);
 assert.equal(await queue.process('event'),true);
 assert.equal(await queue.hasPending('source'),false);
 assert.equal(deletes,1);assert.equal(pushes,2);
});

test('busy external calendar leaves the move job intact for retry',async()=>{
 let deletes=0;
 const queue=createCalendarMoveQueue({query:async sql=>({rows:sql.startsWith('SELECT *')?[{event_id:'event',source_calendar_id:'source',target_calendar_id:'target'}]:[{id:'external'}]}),engine:{withCalendarLocks:async()=>false},deleteRemote:async()=>deletes++});
 assert.equal(await queue.process('event'),false);
 assert.equal(deletes,0);
});
