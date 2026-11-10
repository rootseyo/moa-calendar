import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const handler=app.slice(app.indexOf("$('#delete-calendar-btn').onclick=async()=>{"),app.indexOf('function openGoogleImportDialog()'));
for(const remaining of [[{id:'other',slug:'other'}],[]])test(`deleting a calendar keeps Settings visible with ${remaining.length} remaining calendars`,async()=>{
 const elements=new Map(),calls=[];
 const context={
  $:selector=>{if(!elements.has(selector))elements.set(selector,{});return elements.get(selector);},
  managedCalendar:{id:'deleted',name:'테스트',role:'owner'},current:{id:'deleted'},locale:'ko',confirm:()=>true,
  deletingCalendarId:null,calendars:[],selectedCalendarIds:new Set(['deleted']),calendarStreams:new Map([['deleted',{close(){calls.push('closed');}}]]),
  api:async(path,method)=>{if(method==='DELETE'){assert.equal(context.deletingCalendarId,'deleted');return {};}return remaining;},
  history:{replaceState(_state,_unused,path){calls.push(path);}},
  selectCalendar:async(ident,updateUrl)=>{calls.push(['select',ident,updateUrl]);},
  openSettingsPage:(section,updateUrl)=>calls.push(['settings',section,updateUrl]),
  sessionStorage:{removeItem(){}},events:[],sessions:[],dateNotes:new Map(),
  saveSelectedCalendars(){},renderShell(){},renderCalendar(){},syncCalendarStreams(){},toast(){},translateMessage:x=>x
 };
 vm.runInNewContext(handler,context);
 await context.$('#delete-calendar-btn').onclick();
 assert.ok(calls.includes('/settings/calendars'));
 assert.deepEqual(calls.find(call=>Array.isArray(call)&&call[0]==='settings'),['settings','calendars',false]);
 if(remaining.length)assert.deepEqual(calls.find(call=>Array.isArray(call)&&call[0]==='select'),['select','other',false]);
 assert.equal(context.deletingCalendarId,null);assert.equal(context.$('#delete-calendar-btn').disabled,false);
 assert.equal(context.calendarStreams.has('deleted'),false);
});
