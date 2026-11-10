import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('mobile profile waits for the current user before rendering',()=>{
 const profile=source.slice(source.indexOf('function renderMobileProfile(){'),source.indexOf('function ',source.indexOf('function renderMobileProfile(){')+10));
 const context=vm.createContext({me:{providers:{}},$:()=>{throw new Error('profile elements should not be accessed');}});
 vm.runInContext(profile,context);
 assert.doesNotThrow(()=>context.renderMobileProfile());
});
test('startup restores cached calendar preferences after initializing state',()=>{
 const startup=source.slice(source.indexOf('const $ ='),source.indexOf('async function api('));
 const calendars=[{id:'a',slug:'family'},{id:'b',slug:'work'}];
 for(const scenario of [
  {saved:{},path:'/',expected:[],color:'sage'},
  {saved:{moa_cached_calendars:JSON.stringify(calendars),moa_calendar_colors:'{"a":"blue"}',moa_selected_calendars:'["a","removed"]'},path:'/family',expected:['a'],current:'a',color:'blue'},
  {saved:{moa_cached_calendars:JSON.stringify(calendars)},path:'/',expected:['a','b'],current:'b',color:'sage'},
  {saved:{moa_cached_calendars:JSON.stringify(calendars),moa_calendar_colors:'invalid',moa_selected_calendars:'[]'},path:'/',expected:[],current:'b',color:'sage'},
 ]){
  const context=vm.createContext({document:{querySelector:()=>null},window:{matchMedia:()=>({addEventListener(){}})},localStorage:{getItem:key=>scenario.saved[key]??null},sessionStorage:{getItem:()=> 'b'},location:{pathname:scenario.path},getSavedWeatherLocation:()=>null});
  vm.runInContext(startup,context);
  assert.deepEqual(Array.from(vm.runInContext('selectedCalendarIds',context)),scenario.expected);
  assert.equal(vm.runInContext('current?.id',context),scenario.current);
  assert.equal(context.getCalendarColor({id:'a'}),scenario.color);
 }
});

test('entrypoint and app use the same locale module URL',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const locale=readFileSync(new URL('../public/locale.js',import.meta.url),'utf8');
 const entry=html.match(/src="\/(locale\.js\?v=[^"]+)"/)[1];
 assert.ok(source.includes(`'./${entry}'`));
 const version=entry.split('?v=')[1];
 assert.ok(locale.includes(`/app.js?v=${version}`));
 assert.ok(locale.includes(`/app.en.js?v=${version}`));
});

test('mobile search opens with focus and closes with cleared results',()=>{
 const render=source.slice(source.indexOf('function setMobileSearchOpen('),source.indexOf('function renderEventSearch('));
 let open=false,expanded='false',focused=false,cleared=false;
 const input={value:'회의',focus(){focused=true;},blur(){focused=false;}};
 const controls={'#calendar-search':{classList:{toggle(name,value){assert.equal(name,'is-open');open=value;}}},'#mobile-search-trigger':{setAttribute(name,value){assert.equal(name,'aria-expanded');expanded=value;}},'#event-search':input};
 const context=vm.createContext({$:s=>controls[s],renderEventSearch(){cleared=input.value==='';}});
 vm.runInContext(render,context);
 context.setMobileSearchOpen(true);
 assert.equal(open,true);assert.equal(expanded,'true');assert.equal(focused,true);
 context.setMobileSearchOpen(false);
 assert.equal(open,false);assert.equal(expanded,'false');assert.equal(focused,false);assert.equal(cleared,true);
});
test('right panel agenda shows only event titles and optional todo controls',()=>{
 const render=source.slice(source.indexOf('function renderAgendaItem('),source.indexOf('function renderSelectedDate('));
 const context=vm.createContext({esc:s=>String(s),renderTodoCheck:e=>e.is_todo?'<span data-todo-check="event"></span>':''});
 vm.runInContext(render,context);
 for(const is_todo of [false,true]){
  const html=context.renderAgendaItem({id:'event',title:'회의 일정',category:'업무 분류',notes:'비공개 메모',start:'2026-10-15T09:00',end:'2026-10-15T10:00',is_todo});
  assert.match(html,/<strong>회의 일정<\/strong>/);
  assert.doesNotMatch(html,/업무 분류|비공개 메모|09:00|10:00|agenda-category|agenda-time/);
  assert.equal(html.includes('data-todo-check'),is_todo);
 }
});
test('calendar list renders provider marks inside color buttons for desktop and mobile',()=>{
 const render=source.slice(source.indexOf('function renderCalendarListItems('),source.indexOf('function attachCalendarInteractions('));
 const context=vm.createContext({calendars:[{id:'apple',name:'iCloud - 가족',is_icloud:true},{id:'google',name:'Google',is_google:true},{id:'plain',name:'모아'}],current:null,selectedCalendarIds:new Set(),getCalendarColor:()=> 'blue',esc:s=>String(s)});
 vm.runInContext(render,context);
 for(const mobile of [false,true]){
  const html=context.renderCalendarListItems(mobile);
  assert.match(html,/<button[^>]*data-color-cal-id="apple"[^>]*><svg class="calendar-provider-mark"/);
  assert.match(html,/<button[^>]*data-color-cal-id="google"[^>]*><span class="calendar-provider-mark"[^>]*>G<\/span>/);
  assert.doesNotMatch(html,/icloud-cal-pill|google-cal-pill/);
 }
});
test('event cards omit calendar prefixes while preserving categories and todo controls',()=>{
 const render=source.slice(source.indexOf('function renderEventPill('),source.indexOf('function attachEventInteractions('));
 const context=vm.createContext({selectedEvent:null,selectedCalendarIds:new Set(['a','b']),esc:s=>String(s),formatKoreanTime:()=> '오후1시',renderTodoCheck:()=>'<span data-todo-check="event"></span>'});
 vm.runInContext(render,context);
 const event={id:'event',calendar_name:'PRIVATE CALENDAR PREFIX',title:'약속 제목',category:'분류',color:'blue',is_todo:true,start:'2026-10-14T13:00',end:'2026-10-14T14:00'};
 for(const html of [context.renderEventPill(event,true),context.renderEventPill(event,false),context.renderDayEventCard(event),context.renderDayEventCard(event,true)]){
  assert.doesNotMatch(html,/PRIVATE CALENDAR PREFIX/);
  assert.match(html,/약속 제목/);
  assert.match(html,/data-todo-check/);
 }
 assert.match(context.renderDayEventCard(event),/분류/);
});

test('iCloud refresh selects new calendars and preserves intentionally hidden existing calendars',async()=>{
 const refresh=source.slice(source.indexOf('async function refreshICloudCalendars('),source.indexOf('async function loadCalendarIntegrations('));
 let saved=0;
 const context=vm.createContext({calendars:[{id:'shown'},{id:'hidden'}],selectedCalendarIds:new Set(['shown']),api:async()=>[{id:'shown'},{id:'hidden'},{id:'new'}],saveSelectedCalendars:()=>saved++});
 vm.runInContext(refresh,context);
 await context.refreshICloudCalendars();
 assert.deepEqual([...context.selectedCalendarIds],['shown','new']);
 assert.equal(saved,1);
 await context.refreshICloudCalendars();
 assert.equal(saved,1);
});

test('event editor allows calendar moves and copies read-only Google events into the first editable calendar',()=>{
 const helpers=source.slice(source.indexOf('function calendarIsReadOnly('),source.indexOf('function renderCalendarMetaChips('));
 const editor=source.slice(source.indexOf('function openEvent('),source.indexOf("$('#event-dialog').addEventListener('click'"));
 const fields=['title','start','end','all_day','is_todo','reminder_enabled','reminder_minutes','color','category','notes','calendar_id'].map(name=>({name,tagName:name==='calendar_id'?'SELECT':'INPUT',value:'',disabled:false,checked:false,focus(){}}));
 for(const field of [...fields])fields[field.name]=field;
 const error={textContent:''},submit={hidden:false},form={elements:fields,reset(){},querySelector:s=>s==='[type=submit]'?submit:error};
 const dialog={style:{},showModal(){},scrollTop:0};
 const controls={'#event-form':form,'#event-dialog':dialog,'#event-calendar-select':fields.calendar_id,'#event-calendar-select-label':{},'#event-sync-status':{},'#copy-event':{},'#event-repeat-options':{},'#event-heading':{},'#delete-event':{}};
 const google={id:'google',name:'Google',role:'owner',read_only:true};
 const regular={id:'regular',name:'기본',role:'editor',read_only:false};
 const apple={id:'apple',name:'iCloud',role:'owner',read_only:false};
 const context=vm.createContext({$ : s=>controls[s],current:google,calendars:[google,regular,apple],selected:'2026-10-14',esc:s=>String(s),updateEventDateInputs(){},updateRepeatPreview(){},shiftDate:d=>d,mobileCalendar:{matches:true}});
 vm.runInContext(helpers+editor,context);
 const event={id:'event',calendar_id:'apple',title:'약속',start:'2026-10-14T09:00',end:'2026-10-14T10:00',notes:'보존 메모'};
 context.openEvent(event);
 assert.equal(fields.calendar_id.value,'apple');assert.equal(fields.calendar_id.disabled,false);assert.equal(submit.hidden,false);
 context.openEvent({...event,calendar_id:'google'});
 assert.equal(fields.title.disabled,true);assert.equal(submit.hidden,true);assert.equal(controls['#copy-event'].hidden,false);
 context.openEvent({...event,calendar_id:'google'},null,null,null,true);
 assert.equal(fields.calendar_id.value,'regular');assert.equal(fields.title.disabled,false);assert.equal(fields.notes.value,'보존 메모');assert.equal(context.editing,null);
 context.openEvent(null);
 assert.equal(fields.calendar_id.value,'regular');
});

test('today date badges preserve high-contrast white text and harmonize with Saturday blue series',()=>{
 const styleCss=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 // Saturday and holiday rules must exclude .is-today so date numbers are never rendered in low-contrast text on today
 assert.match(styleCss,/\.day\.is-saturday \.day-number:not\(\.is-today\)/);
 assert.match(styleCss,/\.day:nth-child\(7n\) \.day-number:not\(\.is-today\)/);
 assert.match(styleCss,/\.week-col\.is-saturday \.week-col-header \.day-num:not\(\.is-today\)/);
 assert.match(styleCss,/\.day\.is-holiday \.day-number:not\(\.is-today\)/);
 assert.match(styleCss,/\.week-col\.is-holiday \.week-col-header \.day-num:not\(\.is-today\)/);

 // Saturday today badge has Saturday blue background with white bold text
 assert.match(styleCss,/\.day\.is-saturday \.day-number\.is-today[^}]*background:\s*#2563eb !important/);
 assert.match(styleCss,/\.day\.is-saturday \.day-number\.is-today[^}]*color:\s*#ffffff !important/);
 assert.match(styleCss,/\.day\.is-saturday \.day-number\.is-today[^}]*font-weight:\s*700 !important/);

 // Weekday today badge has green background with white bold text
 assert.match(styleCss,/\.day-number\.is-today,\s*\.week-col-header \.day-num\.is-today[^}]*background:\s*var\(--green\) !important/);
 assert.match(styleCss,/\.day-number\.is-today,\s*\.week-col-header \.day-num\.is-today[^}]*color:\s*#ffffff !important/);
});

test('monthly notes section and orange indicator dot on calendar header',()=>{
 const styleCss=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 assert.match(source,/id="month-note-section"/);
 assert.match(source,/id="month-note-input"/);
 assert.match(source,/monthNoteMarker/);

 const markerFunc=source.slice(source.indexOf('function monthNoteMarker('),source.indexOf('async function loadMonthNotes('));
 const context=vm.createContext({monthNotes:new Map()});
 vm.runInContext(markerFunc,context);

 // When no note exists
 assert.equal(context.monthNoteMarker('2026-10'),'');

 // When note exists but only whitespace
 context.monthNotes.set('2026-10',{content:'   '});
 assert.equal(context.monthNoteMarker('2026-10'),'');

 // When note has content
 context.monthNotes.set('2026-10',{content:'10월 공유 사항'});
 const markerHtml=context.monthNoteMarker('2026-10');
 assert.match(markerHtml,/class="month-note-dot"/);
 assert.match(markerHtml,/aria-label="월 메모 있음"/);

 // Check CSS styling for orange dot and month title
 assert.match(styleCss,/\.month-note-dot\{[^}]*background:\s*#f97316/);
 assert.match(styleCss,/#month-title\{[^}]*cursor:\s*pointer/);
});

test('sidebar month notes placement in sidebar and general notes removed',()=>{
 const styleCss=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 assert.match(source,/id="sidebar-notes"/);
 assert.match(source,/id="month-note-section"/);
 assert.doesNotMatch(source,/id="general-note-section"/);
 assert.doesNotMatch(source,/id="general-note-input"/);
 assert.doesNotMatch(source,/async function loadGeneralNotes\(/);
 assert.doesNotMatch(source,/async function saveGeneralNote\(/);

 // Ensure month-note-section is inside sidebar-notes before profile
 const sidebarNotesIdx=source.indexOf('id="sidebar-notes"');
 const monthNoteIdx=source.indexOf('id="month-note-section"');
 const profileIdx=source.indexOf('class="profile sidebar-profile"');
 assert.ok(sidebarNotesIdx > 0 && monthNoteIdx > sidebarNotesIdx);
 assert.ok(profileIdx > monthNoteIdx);

 // Verify CSS for sidebar notes
 assert.match(styleCss,/\.sidebar-notes\{/);
 assert.doesNotMatch(styleCss,/\.general-note-badge\{/);
 assert.doesNotMatch(styleCss,/#general-note-input/);
});

test('overlapping multi-day events maintain consistent horizontal slot alignment across days in month view',()=>{
 const helpers=source.slice(source.indexOf('function dayEvents('),source.indexOf('const dateLabel='));
 const pillFunc=source.slice(source.indexOf('function renderEventPill('),source.indexOf('function renderDayEventCard('));
 const context=vm.createContext({
  events:[],
  selectedEvent:null,
  esc:s=>String(s),
  formatKoreanTime:()=>'',
  renderTodoCheck:()=>'',
  dateKey:d=>d.toISOString().slice(0,10)
 });
 vm.runInContext(helpers+pillFunc,context);

 const weekKeys=['2026-11-08','2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14'];
 // Event 1: Mon(col 1) ~ Wed(col 3)
 // Event 2: Wed(col 3) ~ Fri(col 5)
 const ev1={id:'ev1',title:'일정 1',start:'2026-11-09T09:00',end:'2026-11-11T18:00',color:'sage'};
 const ev2={id:'ev2',title:'일정 2',start:'2026-11-11T09:00',end:'2026-11-13T18:00',color:'blue'};

 const slots=context.allocateWeekSlots(weekKeys,[ev1,ev2]);

 // Wed (col 3): ev1 in slot 0, ev2 in slot 1
 assert.equal(slots[3][0]?.id,'ev1');
 assert.equal(slots[3][1]?.id,'ev2');

 // Thu (col 4): slot 0 is null (spacer), ev2 stays in slot 1!
 assert.equal(slots[4][0],null);
 assert.equal(slots[4][1]?.id,'ev2');

 // Fri (col 5): slot 0 is null (spacer), ev2 stays in slot 1!
 assert.equal(slots[5][0],null);
 assert.equal(slots[5][1]?.id,'ev2');

 // Verify renderEventPill segments and continuity classes
 const wedPill=context.renderEventPill(ev2,true,'2026-11-11',{col:3});
 const thuPill=context.renderEventPill(ev2,true,'2026-11-12',{col:4});
 const friPill=context.renderEventPill(ev2,true,'2026-11-13',{col:5});

 assert.match(wedPill,/segment-start/);
 assert.match(wedPill,/일정 2/);
 assert.match(thuPill,/segment-middle/);
 assert.match(friPill,/segment-end/);

 // Across week boundary: Sun (col 0) displays title and week-row-start
 const crossWeekEv={id:'ev3',title:'연속 일정',start:'2026-11-07T09:00',end:'2026-11-09T18:00',color:'peach'};
 const sunPill=context.renderEventPill(crossWeekEv,true,'2026-11-08',{col:0});
 assert.match(sunPill,/week-row-start/);
 assert.match(sunPill,/연속 일정/);
});
