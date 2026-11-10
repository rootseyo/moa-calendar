import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
 shiftLocalDateTime,
 weeklyEventRanges,
 repeatEventRanges,
 isValidLocalDateTime,
 calculateDdayDiff,
 formatDdayLabel,
 sortDdayEvents,
 moveDdayOrder,
 resolveAdjustedEndDateTime
} from '../public/event-utils.js';

test('one hour follows start across midnight, months, and leap day',()=>{
 assert.equal(shiftLocalDateTime('2026-10-12T13:30',0,60),'2026-10-12T14:30');
 assert.equal(shiftLocalDateTime('2026-12-31T23:30',0,60),'2027-01-01T00:30');
 assert.equal(shiftLocalDateTime('2028-02-28T23:45',0,60),'2028-02-29T00:45');
 assert.equal(shiftLocalDateTime('2028-02-29T23:45',0,60),'2028-03-01T00:45');
 assert.equal(isValidLocalDateTime('2026-02-30T09:00'),false);
 assert.equal(isValidLocalDateTime('2026-10-12T25:00'),false);
});
test('weekly ranges preserve local time and overnight and all-day durations',()=>{
 const ranges=weeklyEventRanges('2026-12-28T23:30','2026-12-29T00:30',4);
 assert.equal(ranges.length,4);
 assert.deepEqual(ranges.at(-1),{start:'2027-01-18T23:30',end:'2027-01-19T00:30'});
 const allDay=weeklyEventRanges('2026-10-12T00:00','2026-10-15T00:00',2);
 assert.deepEqual(allDay[1],{start:'2026-10-19T00:00',end:'2026-10-22T00:00'});
 for(const weeks of [0,53,2.5,'4'])assert.throws(()=>weeklyEventRanges('2026-10-12T09:00','2026-10-12T10:00',weeks));
 assert.throws(()=>weeklyEventRanges('9999-12-31T09:00','9999-12-31T10:00',2));
});

test('monthly and yearly repeats support solar and lunar cycles with clamped dates',()=>{
 // 매달 양력 반복 (1월 31일 시작 3회: 1월 31일, 2월 28일, 3월 31일)
 const monthlySolar = repeatEventRanges('2026-01-31T14:00', '2026-01-31T15:00', { frequency: 'monthly', calendarType: 'solar', count: 3 });
 assert.equal(monthlySolar.length, 3);
 assert.deepEqual(monthlySolar[0], { start: '2026-01-31T14:00', end: '2026-01-31T15:00' });
 assert.deepEqual(monthlySolar[1], { start: '2026-02-28T14:00', end: '2026-02-28T15:00' });
 assert.deepEqual(monthlySolar[2], { start: '2026-03-31T14:00', end: '2026-03-31T15:00' });

 // 매달 음력 반복 (2026-10-20은 음력 9월 10일)
 const monthlyLunar = repeatEventRanges('2026-10-20T10:00', '2026-10-20T11:30', { frequency: 'monthly', calendarType: 'lunar', count: 3 });
 assert.equal(monthlyLunar.length, 3);
 assert.equal(monthlyLunar[0].start, '2026-10-20T10:00');
 assert.equal(monthlyLunar[1].start, '2026-11-18T10:00'); // 음력 10월 10일
 assert.equal(monthlyLunar[2].start, '2026-12-18T10:00'); // 음력 11월 10일
 assert.equal(monthlyLunar[1].end, '2026-11-18T11:30'); // duration 보존

 // 매년 양력 반복 (윤년 2월 29일)
 const yearlySolar = repeatEventRanges('2024-02-29T09:00', '2024-02-29T10:00', { frequency: 'yearly', calendarType: 'solar', count: 3 });
 assert.equal(yearlySolar.length, 3);
 assert.equal(yearlySolar[0].start, '2024-02-29T09:00');
 assert.equal(yearlySolar[1].start, '2025-02-28T09:00'); // 평년 28일 보정
 assert.equal(yearlySolar[2].start, '2026-02-28T09:00');

 // 매년 음력 반복 (2026년 추석 9월 25일 = 음력 8월 15일)
 const yearlyLunar = repeatEventRanges('2026-09-25T00:00', '2026-09-26T00:00', { frequency: 'yearly', calendarType: 'lunar', count: 3 });
 assert.equal(yearlyLunar.length, 3);
 assert.equal(yearlyLunar[0].start, '2026-09-25T00:00');
 assert.equal(yearlyLunar[1].start, '2027-09-15T00:00'); // 2027년 추석
 assert.equal(yearlyLunar[2].start, '2028-10-03T00:00'); // 2028년 추석
 assert.equal(yearlyLunar[2].end, '2028-10-04T00:00'); // all-day 24시간 보존

 // 유효성 검사 범위 테스트
 for(const c of [0, 37, '10']) assert.throws(()=>repeatEventRanges('2026-10-20T09:00','2026-10-20T10:00',{ frequency: 'monthly', count: c }));
 for(const c of [0, 11, '5']) assert.throws(()=>repeatEventRanges('2026-10-20T09:00','2026-10-20T10:00',{ frequency: 'yearly', count: c }));
 assert.throws(()=>repeatEventRanges('2026-10-20T10:00','2026-10-20T09:00',{ frequency: 'monthly', count: 2 }));
});

test('dday helpers calculate labels and reorder widgets inside toolbar between month heading and view controls', async () => {
 assert.equal(calculateDdayDiff('2026-10-28T09:00', '2026-10-28'), 0);
 assert.equal(calculateDdayDiff('2026-11-02T14:00', '2026-10-28'), 5);
 assert.equal(calculateDdayDiff('2026-10-25T00:00', '2026-10-28'), -3);

 assert.equal(formatDdayLabel('2026-10-28T09:00', '2026-10-28'), 'D-Day');
 assert.equal(formatDdayLabel('2026-11-02T14:00', '2026-10-28'), 'D-5');
 assert.equal(formatDdayLabel('2026-10-25T00:00', '2026-10-28'), 'D+3');

 const events = [
  { id: 'e3', title: '지나간 일정', start: '2026-10-25T00:00', is_dday: true },
  { id: 'e1', title: '먼저 오는 일정', start: '2026-10-29T00:00', is_dday: true },
  { id: 'e2', title: '나중 일정', start: '2026-11-05T00:00', is_dday: true },
  { id: 'e4', title: '일반 일정', start: '2026-10-28T00:00', is_dday: false }
 ];
 const defaultSorted = sortDdayEvents(events, []);
 assert.deepEqual(defaultSorted.map(e => e.id), ['e3', 'e1', 'e2']);

 const movedRight = moveDdayOrder(events, [], 'e3', 1);
 assert.deepEqual(movedRight, ['e1', 'e3', 'e2']);

 const movedToTarget = moveDdayOrder(events, movedRight, 'e2', 'e1');
 assert.deepEqual(movedToTarget, ['e2', 'e1', 'e3']);

 const [indexHtml, appJs] = await Promise.all([
  fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8')
 ]);
 assert.match(indexHtml, /name="is_dday"/);
 assert.match(appJs, /function renderDdayWidgets\(/);

 const toolbarIdx = appJs.indexOf('<div class="calendar-toolbar">');
 const headingBlockIdx = appJs.indexOf('<div class="calendar-heading-block">', toolbarIdx);
 const monthHeadingIdx = appJs.indexOf('<div class="month-heading">', toolbarIdx);
 const viewControlsIdx = appJs.indexOf('<div class="calendar-view-controls">', toolbarIdx);
 const ddayBarIdx = appJs.indexOf('id="dday-widget-bar"', toolbarIdx);
 assert.ok(headingBlockIdx > toolbarIdx && monthHeadingIdx >= headingBlockIdx && viewControlsIdx > monthHeadingIdx && ddayBarIdx > viewControlsIdx);
});

test('resolveAdjustedEndDateTime only adds 1 hour when end <= start, and leaves end untouched when start < end', () => {
 // start < end: end is kept untouched
 assert.equal(resolveAdjustedEndDateTime('2026-10-28T09:00', '2026-10-28T11:00', false), '2026-10-28T11:00');
 assert.equal(resolveAdjustedEndDateTime('2026-10-28T08:00', '2026-10-28T10:00', false), '2026-10-28T10:00');

 // start === end: +1 hour
 assert.equal(resolveAdjustedEndDateTime('2026-10-28T10:00', '2026-10-28T10:00', false), '2026-10-28T11:00');
 assert.equal(resolveAdjustedEndDateTime('2026-10-28T23:30', '2026-10-28T23:30', false), '2026-10-29T00:30');

 // end < start: +1 hour from start
 assert.equal(resolveAdjustedEndDateTime('2026-10-28T14:00', '2026-10-28T10:00', false), '2026-10-28T15:00');

 // allDay: clamps only if end < start
 assert.equal(resolveAdjustedEndDateTime('2026-10-28', '2026-10-30', true), '2026-10-30');
 assert.equal(resolveAdjustedEndDateTime('2026-10-28', '2026-10-27', true), '2026-10-28');
});

test('event cancellation UI elements, forms, and styles are wired up', async () => {
 const [indexHtml, appJs, styleCss] = await Promise.all([
  fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../public/style.css', import.meta.url), 'utf8')
 ]);
 assert.match(indexHtml, /name="is_cancelled"/);
 assert.match(appJs, /f\.elements\.is_cancelled/);
 assert.match(appJs, /is_cancelled:\s*Boolean\(copiedEvent\.is_cancelled\)/);
 assert.match(styleCss, /\.is-cancelled/);
});
