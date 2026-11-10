import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';

const origin='http://localhost:3198';
process.env.APP_URL=origin;
process.env.DEMO_MODE='true';
process.env.NODE_ENV='test';
const connection=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
if(connection){
 const url=new URL(connection);
 if(url.pathname==='/share_schedule_db')url.pathname='/share_schedule_test_db';
 if(!url.pathname.endsWith('_test_db'))throw new Error('Monthly item tests require a database named *_test_db');
 process.env.DATABASE_URL=url.href;
}
const {handleRequest,db}=await import('../server.mjs');
function invoke(path,{cookie,method='GET',data,source=origin}={}){
 const req=Readable.from(data===undefined?[]:[JSON.stringify(data)]);
 Object.assign(req,{method,url:path,headers:{origin:source,...(cookie?{cookie}:{})}});
 const res=new EventEmitter();Object.assign(res,{headers:{},status:200,text:''});
 res.setHeader=(key,value)=>res.headers[key.toLowerCase()]=value;
 res.writeHead=(status,headers={})=>{res.status=status;res.headersSent=true;for(const [key,value]of Object.entries(headers))res.setHeader(key,value);};
 res.write=text=>{res.text+=text;return true;};
 res.end=text=>{if(text)res.write(text);res.emit('finish');};
 return {req,res,start:()=>handleRequest(req,res)};
}
async function request(path,options){
 const io=invoke(path,options);
 await io.start();
 return {status:io.res.status,data:io.res.text?JSON.parse(io.res.text):null,cookie:io.res.headers['set-cookie']?.split(';')[0]};
}

test('monthly items persist separately, enforce sharing permissions and resolve concurrent completion changes',async t=>{
 if(!db){t.skip('No test database configured');return;}
 try{await db.query('SELECT 1');}catch{await db.end();t.skip('Test database unavailable');return;}
 const userIds=[],calendarIds=[];let stream;
 const login=async name=>{
  const result=await request('/auth/demo',{method:'POST',data:{name}});assert.equal(result.status,200);
  const account=await request('/api/me',{cookie:result.cookie});userIds.push(account.data.user.id);
  return {cookie:result.cookie,id:account.data.user.id};
 };
 const createCalendar=async(cookie,name)=>{
  const result=await request('/api/calendars',{cookie,method:'POST',data:{name}});assert.equal(result.status,201);
  calendarIds.push(result.data.id);return result.data.id;
 };
 try{
  const owner=await login('월간 항목 검증'),viewer=await login('월간 읽기 검증'),editor=await login('월간 편집 검증'),outsider=await login('월간 비참여 검증');
  const calendarId=await createCalendar(owner.cookie,'월간 검증 전용'),otherId=await createCalendar(outsider.cookie,'다른 캘린더');
  await db.query('INSERT INTO members(calendar_id,user_id,role) VALUES($1,$2,$3),($1,$4,$5)',[calendarId,viewer.id,'viewer',editor.id,'editor']);
  const base=`/api/calendars/${calendarId}/monthly-items`;
  const payload={title:'<월간> 가족 여행',month:'2026-10',notes:'날짜는 나중에 정해요.',is_todo:false};
  assert.equal((await request(base)).status,401);
  assert.equal((await request(base,{cookie:outsider.cookie})).status,403);
  assert.equal((await request(base,{cookie:owner.cookie,method:'POST',data:payload,source:'https://other.example'})).status,403);
  for(const invalid of [{month:'2026-00'},{month:'2026-13'},{month:'0000-10'},{month:'2026-1'},{month:'2026-10-01'},{title:''},{title:'x'.repeat(101)},{notes:'x'.repeat(2001)},{is_todo:'true'}]){
   assert.equal((await request(base,{cookie:owner.cookie,method:'POST',data:{...payload,...invalid}})).status,400);
  }
  const schedule=(await request(base,{cookie:owner.cookie,method:'POST',data:payload})).data;
  assert.equal(schedule.title,payload.title);assert.equal(schedule.completed,false);
  assert.equal((await request(`${base}/${schedule.id}`,{cookie:owner.cookie,method:'PATCH',data:{version:schedule.version,completed:true}})).status,400);
  assert.deepEqual((await request(`/api/calendars/${calendarId}/events`,{cookie:owner.cookie})).data,[]);
  assert.equal((await request(base,{cookie:viewer.cookie})).data.length,1);
  for(const method of ['POST','PUT','PATCH','DELETE']){
   assert.equal((await request(method==='POST'?base:`${base}/${schedule.id}`,{cookie:viewer.cookie,method,data:{...payload,version:schedule.version,completed:true}})).status,403);
  }
  const created=await request(base,{cookie:editor.cookie,method:'POST',data:{...payload,title:'건강검진 예약',is_todo:true}});
  assert.equal(created.status,201);const todo=created.data;
  assert.equal((await request(`${base}?month=2026-11`,{cookie:owner.cookie})).data.length,0);
  assert.equal((await request(`${base}?month=2026-10`,{cookie:owner.cookie})).data.length,2);
  assert.equal((await request(`${base}?month=2026-99`,{cookie:owner.cookie})).status,400);
  assert.equal((await request(`/api/calendars/${otherId}/monthly-items/${todo.id}`,{cookie:outsider.cookie,method:'DELETE',data:{version:todo.version}})).status,404);
  stream=invoke(`/api/calendars/${calendarId}/stream`,{cookie:viewer.cookie});await stream.start();stream.res.text='';
  const toggles=await Promise.all([owner,editor].map(user=>request(`${base}/${todo.id}`,{cookie:user.cookie,method:'PATCH',data:{version:todo.version,completed:true}})));
  assert.deepEqual(toggles.map(result=>result.status).sort(),[200,409]);
  assert.match(stream.res.text,/event: change/);
  let current=(await request(`${base}/${todo.id}`,{cookie:owner.cookie})).data;
  assert.equal(current.completed,true);assert.equal(current.version,todo.version+1);
  assert.equal((await request(`${base}/${todo.id}`,{cookie:owner.cookie,method:'DELETE',data:{version:todo.version}})).status,409);
  const moved=await request(`${base}/${todo.id}`,{cookie:editor.cookie,method:'PUT',data:{...payload,title:'11월 건강검진',month:'2026-11',is_todo:true,version:current.version}});
  assert.equal(moved.status,200);assert.equal(moved.data.completed,true);
  assert.equal((await request(`${base}?month=2026-10`,{cookie:owner.cookie})).data.length,1);
  assert.equal((await request(`${base}?month=2026-11`,{cookie:owner.cookie})).data.length,1);
  const converted=await request(`${base}/${todo.id}`,{cookie:owner.cookie,method:'PUT',data:{...payload,is_todo:false,version:moved.data.version}});
  assert.equal(converted.status,200);assert.equal(converted.data.completed,false);
  await db.query("UPDATE calendars SET source_provider='google' WHERE id=$1",[calendarId]);
  assert.equal((await request(base,{cookie:owner.cookie,method:'POST',data:payload})).status,403);
  assert.equal((await request(base,{cookie:owner.cookie})).status,200);
  await db.query("UPDATE calendars SET source_provider='moa' WHERE id=$1",[calendarId]);
  assert.equal((await request(`${base}/${todo.id}`,{cookie:owner.cookie,method:'DELETE',data:{version:converted.data.version}})).status,200);
  assert.equal((await request(`${base}/${todo.id}`,{cookie:owner.cookie})).status,404);
  await db.query('DELETE FROM calendars WHERE id=$1',[calendarId]);
  assert.equal(Number((await db.query('SELECT count(*) AS count FROM monthly_items WHERE calendar_id=$1',[calendarId])).rows[0].count),0);
 }finally{
  stream?.req.emit('close');stream?.res.emit('close');
  await db.query('DELETE FROM calendars WHERE id=ANY($1::text[])',[calendarIds]);
  await db.query('DELETE FROM users WHERE id=ANY($1::text[])',[userIds]);
  await db.end();
 }
});
