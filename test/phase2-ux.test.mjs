import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { parseQuickAddInput, buildMapUrls } from '../public/quick-add.js';
import { formatIcsEvent, formatIcsCalendar } from '../ical.mjs';
import { buildDailyBriefingMessage, checkAndDispatchDailyBriefings } from '../push-notifications.mjs';
import { servePublicPage } from '../public-pages.mjs';

test('parseQuickAddInput parses Korean and English natural-language dates, times, locations, categories and flags', () => {
  const base = new Date('2026-11-24T09:00:00'); // Tuesday

  // 1. Korean relative date + afternoon time + @location + #category
  const r1 = parseQuickAddInput('내일 오후 7시 @강남역 저녁약속 #약속', { baseDate: base });
  assert.equal(r1.title, '저녁약속');
  assert.equal(r1.start, '2026-11-25T19:00');
  assert.equal(r1.end, '2026-11-25T20:00');
  assert.equal(r1.all_day, false);
  assert.equal(r1.location, '강남역');
  assert.equal(r1.category, '약속');

  // 2. Korean half-hour + evening keyword
  const r2 = parseQuickAddInput('오늘 저녁 7시 반 치과 예약', { baseDate: base });
  assert.equal(r2.title, '치과 예약');
  assert.equal(r2.start, '2026-11-24T19:30');
  assert.equal(r2.end, '2026-11-24T20:30');

  // 3. Explicit slash date + time range
  const r3 = parseQuickAddInput('12/25 14:00~16:30 크리스마스 파티 @"성수동 카페"', { baseDate: base });
  assert.equal(r3.title, '크리스마스 파티');
  assert.equal(r3.start, '2026-12-25T14:00');
  assert.equal(r3.end, '2026-12-25T16:30');
  assert.equal(r3.location, '성수동 카페');

  // 4. Korean date + D-Day + all-day
  const r4 = parseQuickAddInput('12월 31일 하루종일 제주 여행 디데이', { baseDate: base });
  assert.equal(r4.title, '제주 여행');
  assert.equal(r4.start, '2026-12-31T00:00');
  assert.equal(r4.end, '2027-01-01T00:00');
  assert.equal(r4.all_day, true);
  assert.equal(r4.is_dday, true);

  // 5. Korean weekday (Friday from Tuesday -> Nov 27)
  const r5 = parseQuickAddInput('금요일 10시 팀 미팅 #업무', { baseDate: base });
  assert.equal(r5.start, '2026-11-27T10:00');
  assert.equal(r5.category, '업무');
  assert.equal(r5.title, '팀 미팅');

  // 6. Next week Monday (from Tuesday Nov 24 -> Nov 30)
  const r6 = parseQuickAddInput('다음주 월요일 아침 8시 30분 조조영화', { baseDate: base });
  assert.equal(r6.start, '2026-11-30T08:30');
  assert.equal(r6.title, '조조영화');

  // 7. English tomorrow + pm + todo
  const r7 = parseQuickAddInput('tomorrow 7:30pm Buy groceries todo #personal', { baseDate: base, locale: 'en' });
  assert.equal(r7.title, 'Buy groceries');
  assert.equal(r7.start, '2026-11-25T19:30');
  assert.equal(r7.end, '2026-11-25T20:30');
  assert.equal(r7.is_todo, true);
  assert.equal(r7.category, 'personal');

  // 8. Date-only defaults to all_day
  const r8 = parseQuickAddInput('2026-12-01 월세 납부 할일', { baseDate: base });
  assert.equal(r8.start, '2026-12-01T00:00');
  assert.equal(r8.end, '2026-12-02T00:00');
  assert.equal(r8.all_day, true);
  assert.equal(r8.is_todo, true);

  // 9. Empty or whitespace returns null
  assert.equal(parseQuickAddInput('   ', { baseDate: base }), null);
});

test('buildMapUrls builds Naver, Kakao, and Google map URLs and ICS exports LOCATION', () => {
  const urls = buildMapUrls('강남역 10번 출구');
  assert.match(urls.naver, /^https:\/\/map\.naver\.com\/p\/search\//);
  assert.match(urls.kakao, /^https:\/\/map\.kakao\.com\/link\/search\//);
  assert.match(urls.google, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.equal(buildMapUrls('  '), null);

  const singleIcs = formatIcsEvent({
    uid: 'loc-1@test',
    title: '점심 약속',
    start: '2026-11-24T12:00',
    end: '2026-11-24T13:00',
    location: '광화문 D타워',
    dtstamp: '20261124T000000Z',
  });
  assert.match(singleIcs, /LOCATION:광화문 D타워\r\n/);

  const multiIcs = formatIcsCalendar({
    name: '테스트',
    dtstamp: '20261124T000000Z',
    events: [{ id: 'e1', title: '회의', start: '2026-11-24T14:00', end: '2026-11-24T15:00', location: '판교역' }],
  });
  assert.match(multiIcs, /LOCATION:판교역\r\n/);
});

test('buildDailyBriefingMessage composes events, weather, and nearest D-Day cleanly', () => {
  const msg = buildDailyBriefingMessage({
    todayEvents: [
      { title: '팀 스탠드업', start: '2026-11-24T10:00', all_day: false },
      { title: '저녁 약속', start: '2026-11-24T19:00', all_day: false },
    ],
    weatherToday: { emoji: '🌧️', rainProbability: 70, tempMin: 8.4, tempMax: 15.6 },
    nearestDday: { title: '제주 여행', diffDays: 3 },
    locationName: '서울',
  });
  assert.equal(msg.title, '☀️ 오늘의 모아 브리핑');
  assert.match(msg.body, /오늘 일정 2건 \(첫 일정 10:00 팀 스탠드업\)/);
  assert.match(msg.body, /🌧️ 서울 비 70% 8°~16°/);
  assert.match(msg.body, /🚩 제주 여행 D-3/);
});

test('Phase 2 DB migrations (028 & 029) and daily briefing atomic claim work against PostgreSQL (PGlite)', async () => {
  const pg = new PGlite();
  try {
    const dbDir = new URL('../db/', import.meta.url);
    const files = readdirSync(dbDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      await pg.exec(readFileSync(new URL(file, dbDir), 'utf8'));
    }

    await pg.query('INSERT INTO users(id, name) VALUES($1, $2)', ['u-brief', '서연']);
    await pg.query('INSERT INTO calendars(id, name, owner, slug) VALUES($1, $2, $3, $4)', ['c-brief', '내 캘린더', 'u-brief', 'brief-cal']);
    await pg.query('INSERT INTO members(calendar_id, user_id, role) VALUES($1, $2, $3)', ['c-brief', 'u-brief', 'owner']);

    // Verify location column on events (migration 028)
    await pg.query(
      'INSERT INTO events(id,calendar_id,title,start,"end",all_day,color,category,notes,location,is_todo,completed,reminder_enabled,reminder_minutes,is_dday,is_cancelled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,10,$13,false)',
      ['ev-loc-1', 'c-brief', '미팅', '2026-11-24T10:00', '2026-11-24T11:00', false, 'blue', '업무', '', '강남역 10번 출구', false, false, false]
    );
    const savedEv = (await pg.query('SELECT location FROM events WHERE id=$1', ['ev-loc-1'])).rows[0];
    assert.equal(savedEv.location, '강남역 10번 출구');

    // Verify daily_briefing_preferences (migration 029) + atomic claim
    await pg.query(
      'INSERT INTO daily_briefing_preferences(user_id, enabled, briefing_time, location_name, latitude, longitude) VALUES($1, true, $2, $3, $4, $5)',
      ['u-brief', '08:00', '서울', 37.5665, 126.978]
    );

    const all = async (sql, ...params) => (await pg.query(sql, params)).rows;
    const run = async (sql, ...params) => {
      const res = await pg.query(sql, params);
      return { rowCount: res.affectedRows ?? res.rows.length };
    };

    // Reference time: 2026-11-24 08:05 KST (= 2026-11-23 23:05 UTC)
    const refTime = Date.parse('2026-11-23T23:05:00Z');
    await checkAndDispatchDailyBriefings({ all, run }, refTime);
    const afterFirst = (await pg.query('SELECT last_sent_date FROM daily_briefing_preferences WHERE user_id=$1', ['u-brief'])).rows[0];
    assert.equal(afterFirst.last_sent_date, '2026-11-24');

    // Second run on the same day must not re-claim or re-dispatch
    const second = await checkAndDispatchDailyBriefings({ all, run }, refTime + 60_000);
    assert.equal(second.dispatched, 0);
  } finally {
    await pg.close();
  }
});

test('Phase 2 UI, Dark Mode, IME-safe Quick Add, and Offline Service Worker are wired cleanly', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const localeJs = readFileSync(new URL('../public/locale.js', import.meta.url), 'utf8');
  const swJs = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

  // Dark mode guidance compliance
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /id="theme-preference-select"/);
  assert.match(css, /color-scheme:light dark/);
  assert.match(css, /:root:has\(> head > meta\[name="color-scheme"\]\[content="dark"\]\)/);
  assert.match(css, /light-dark\(/);
  assert.match(localeJs, /applyColorScheme/);
  assert.match(localeJs, /addEventListener\('storage'/);

  // Quick Add + IME safety + Location maps + Briefing UI
  assert.match(appJs, /id="quick-add-form"/);
  assert.match(appJs, /e\.isComposing\|\|e\.keyCode===229/);
  assert.match(html, /id="event-location-input"/);
  assert.match(html, /id="event-location-maps"/);
  assert.match(html, /id="daily-briefing-toggle"/);
  assert.match(html, /id="daily-briefing-time"/);
  assert.match(html, /id="daily-briefing-test-btn"/);

  // Offline PWA Service Worker
  assert.match(swJs, /STATIC_CACHE/);
  assert.match(swJs, /API_CACHE/);
  assert.match(swJs, /self\.addEventListener\('fetch'/);
  assert.match(appJs, /id="offline-banner"/);

  // Public pages serves /quick-add.js
  const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(c) { this.body = c; } };
  servePublicPage({ method: 'GET' }, res, '/quick-add.js', 'https://dwm.brightnetworks.kr');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/javascript/);
});
