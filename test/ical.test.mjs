import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIcs,
  formatIcsEvent,
  escapeIcsText,
  unescapeIcsText,
  foldIcsLine,
  parseIcsDuration,
  parseIcsDate,
} from '../ical.mjs';

test('iCalendar text escaping and unescaping', () => {
  const original = 'Hello, world;\nLine 2 with \\ backslash.';
  const escaped = escapeIcsText(original);
  assert.equal(escaped, 'Hello\\, world\\;\\nLine 2 with \\\\ backslash.');
  const unescaped = unescapeIcsText(escaped);
  assert.equal(unescaped, original);
});

test('iCalendar line folding respects 75 octet limits', () => {
  const longLine = 'SUMMARY:' + 'A'.repeat(100);
  const folded = foldIcsLine(longLine);
  assert.ok(folded.includes('\r\n '));
  const unfolded = folded.replace(/\r\n /g, '');
  assert.equal(unfolded, longLine);
});

test('iCalendar duration parser handles ISO 8601 durations', () => {
  assert.equal(parseIcsDuration('PT1H'), 3600000);
  assert.equal(parseIcsDuration('P1D'), 86400000);
  assert.equal(parseIcsDuration('PT30M'), 1800000);
  assert.equal(parseIcsDuration('P1W'), 7 * 86400000);
});

test('iCalendar date parsing handles UTC, Asia/Seoul TZID, and VALUE=DATE', () => {
  // UTC 01:00 -> KST 10:00 (+9h)
  const utc = parseIcsDate('20261014T010000Z');
  assert.equal(utc.dateTimeStr, '2026-10-14T10:00');
  assert.equal(utc.allDay, false);

  // TZID=Asia/Seoul
  const kst = parseIcsDate('20261014T153000', { TZID: 'Asia/Seoul' });
  assert.equal(kst.dateTimeStr, '2026-10-14T15:30');
  assert.equal(kst.allDay, false);

  // VALUE=DATE (all-day)
  const allDay = parseIcsDate('20261015', { VALUE: 'DATE' });
  assert.equal(allDay.dateTimeStr, '2026-10-15T00:00');
  assert.equal(allDay.allDay, true);
});

test('parseIcs parses multiple events, all-day and timed, with locations and unfolded lines', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apple Inc.//Mac OS X 10.15.7//EN',
    'BEGIN:VEVENT',
    'UID:event-123@icloud.com',
    'DTSTAMP:20261014T000000Z',
    'DTSTART:20261014T010000Z',
    'DTEND:20261014T023000Z',
    'SUMMARY:팀 주간 회의',
    'DESCRIPTION:프로젝트 진행 상황 점검\\n다음 분기 기',
    ' 획 논의',
    'LOCATION:대회의실 B',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:allday-456@icloud.com',
    'DTSTART;VALUE=DATE:20261020',
    'DTEND;VALUE=DATE:20261022',
    'SUMMARY:가족 여행',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:cancelled-789@icloud.com',
    'STATUS:CANCELLED',
    'SUMMARY:취소된 일정',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const events = parseIcs(ics);
  assert.equal(events.length, 3);

  const ev1 = events.find(e => e.uid === 'event-123@icloud.com');
  assert.ok(ev1);
  assert.equal(ev1.title, '팀 주간 회의');
  assert.equal(ev1.start, '2026-10-14T10:00');
  assert.equal(ev1.end, '2026-10-14T11:30');
  assert.equal(ev1.allDay, false);
  assert.ok(ev1.notes.includes('프로젝트 진행 상황 점검\n다음 분기 기획 논의'));
  assert.ok(ev1.notes.includes('[장소] 대회의실 B'));

  const ev2 = events.find(e => e.uid === 'allday-456@icloud.com');
  assert.ok(ev2);
  assert.equal(ev2.title, '가족 여행');
  assert.equal(ev2.start, '2026-10-20T00:00');
  assert.equal(ev2.end, '2026-10-22T00:00');
  assert.equal(ev2.allDay, true);

  const ev3 = events.find(e => e.uid === 'cancelled-789@icloud.com');
  assert.ok(ev3);
  assert.equal(ev3.status, 'CANCELLED');
});

test('formatIcsEvent produces valid VCALENDAR for timed and all-day events', () => {
  // Timed event (KST 10:00~11:00 -> UTC 01:00~02:00)
  const timedIcs = formatIcsEvent({
    uid: 'test-timed-1',
    title: '치과 예약',
    start: '2026-10-14T10:00',
    end: '2026-10-14T11:00',
    allDay: false,
    notes: '정기 검진',
  });

  assert.ok(timedIcs.includes('BEGIN:VCALENDAR'));
  assert.ok(timedIcs.includes('BEGIN:VEVENT'));
  assert.ok(timedIcs.includes('UID:test-timed-1'));
  assert.ok(timedIcs.includes('DTSTART:20261014T010000Z'));
  assert.ok(timedIcs.includes('DTEND:20261014T020000Z'));
  assert.ok(timedIcs.includes('SUMMARY:치과 예약'));
  assert.ok(timedIcs.includes('DESCRIPTION:정기 검진'));
  assert.ok(timedIcs.includes('END:VEVENT'));
  assert.ok(timedIcs.includes('END:VCALENDAR'));

  // Roundtrip parse check
  const [parsedTimed] = parseIcs(timedIcs);
  assert.equal(parsedTimed.uid, 'test-timed-1');
  assert.equal(parsedTimed.title, '치과 예약');
  assert.equal(parsedTimed.start, '2026-10-14T10:00');
  assert.equal(parsedTimed.end, '2026-10-14T11:00');
  assert.equal(parsedTimed.allDay, false);

  // All-day event
  const allDayIcs = formatIcsEvent({
    uid: 'test-allday-1',
    title: '창립기념일',
    start: '2026-10-15T00:00',
    end: '2026-10-16T00:00',
    allDay: true,
  });

  assert.ok(allDayIcs.includes('DTSTART;VALUE=DATE:20261015'));
  assert.ok(allDayIcs.includes('DTEND;VALUE=DATE:20261016'));

  const [parsedAllDay] = parseIcs(allDayIcs);
  assert.equal(parsedAllDay.uid, 'test-allday-1');
  assert.equal(parsedAllDay.title, '창립기념일');
  assert.equal(parsedAllDay.start, '2026-10-15T00:00');
  assert.equal(parsedAllDay.end, '2026-10-16T00:00');
  assert.equal(parsedAllDay.allDay, true);
});
