import {test} from 'node:test';
import assert from 'node:assert/strict';
import {migrationWindow,normalizeMigrationEvent,planMigration,googlePages} from '../calendar-migration.mjs';
const google={id:'google:primary',provider:'google',color:'blue'};
const base={id:'one',summary:'회의',start:{dateTime:'2026-10-14T23:30:00Z'},end:{dateTime:'2026-10-15T00:30:00Z'},description:'원본 메모'};
test('migration date bounds include the full final day in KST and reject invalid dates',()=>{
 const range=migrationWindow('2026-10-01','2026-10-31');
 assert.equal(range.end,'2026-11-01T00:00');assert.equal(range.timeMax,'2026-11-01T00:00:00+09:00');
 for(const dates of [['2026-02-30','2026-03-01'],['2026-10-02','2026-10-01'],['2026-1-01','2026-10-01']])assert.throws(()=>migrationWindow(...dates));
});
test('migration retains timed dates, all-day exclusive end, notes and repeated occurrence identities',()=>{
 const timed=normalizeMigrationEvent(base,google,'alice');
 assert.equal(timed.start,'2026-10-15T08:30');assert.equal(timed.end,'2026-10-15T09:30');assert.equal(timed.notes,'원본 메모');
 const allDay=normalizeMigrationEvent({...base,start:{date:'2026-10-14'},end:{date:'2026-10-17'}},google,'alice');
 assert.equal(allDay.allDay,true);assert.equal(allDay.end,'2026-10-17T00:00');
 const source={id:'icloud:c',provider:'icloud',color:'sage'};
 const event={uid:'series',title:'반복',start:'2026-10-14T10:00',end:'2026-10-14T11:00',recurrenceId:'20261014T010000Z'};
 const one=normalizeMigrationEvent(event,source,'alice');
 const two=normalizeMigrationEvent({...event,recurrenceId:'20261021T010000Z'},source,'alice');
 assert.notEqual(one.sourceKey,two.sourceKey);
 assert.notEqual(one.sourceKey,normalizeMigrationEvent(event,source,'bob').sourceKey);
 assert.throws(()=>normalizeMigrationEvent({...event,rrule:'FREQ=WEEKLY'},source,'alice'),/반복/);
 assert.equal(normalizeMigrationEvent({status:'CANCELLED'},source,'alice'),null);
});
test('migration deduplicates content across sources and skips previous copies even when content dedup is off',()=>{
 const event=normalizeMigrationEvent(base,google,'alice');
 const duplicate=normalizeMigrationEvent({...base,id:'two'},google,'alice');
 assert.equal(planMigration([event,duplicate]).rows.length,1);
 assert.equal(planMigration([event,duplicate],[],[],false).rows.length,2);
 assert.equal(planMigration([event],[{title:event.title,start:event.start,end:event.end,all_day:false}]).skipped,1);
 assert.equal(planMigration([event],[],[event.sourceKey],false).rows.length,0);
});
test('Google pagination reads all pages including empty pages and refuses truncation on errors',async()=>{
 const tokens=[];
 const fetchFn=async url=>{
  const token=new URL(url).searchParams.get('pageToken');tokens.push(token);
  return new Response(JSON.stringify(token?{items:[{id:'last'}]}:{items:[],nextPageToken:'next'}));
 };
 assert.deepEqual(await googlePages('users/me/calendarList','token',{},fetchFn),[{id:'last'}]);
 assert.deepEqual(tokens,[null,'next']);
 await assert.rejects(googlePages('test','token',{},async()=>new Response('',{status:403})),/Google/);
 await assert.rejects(googlePages('test','token',{},async()=>new Response(JSON.stringify({items:[],nextPageToken:'same'}))),/전체 목록/);
});
