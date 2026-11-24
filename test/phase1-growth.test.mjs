import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { formatIcsCalendar } from '../ical.mjs';
import { renderSharedScheduleHtml } from '../schedule-shares.mjs';
import { servePublicPage } from '../public-pages.mjs';
import { SANDBOX_CALENDAR_ID, createSandboxCalendar, createSandboxStore } from '../public/sandbox.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

test('formatIcsCalendar exports multiple timed and all-day events as valid RFC 5545 VCALENDAR', () => {
  const ics = formatIcsCalendar({
    name: '김철수의 주간 일정',
    dtstamp: '20261123T090000Z',
    events: [
      {
        id: 'ev-timed',
        title: '팀 회의, 1차; 검토',
        start: '2026-11-24T14:00',
        end: '2026-11-24T15:30',
        all_day: false,
        category: '업무',
        notes: '1층 회의실\n자료 지참',
      },
      {
        id: 'ev-allday',
        title: '제주 여행',
        start: '2026-11-28T00:00',
        end: '2026-11-30T00:00',
        all_day: true,
        category: '여행',
        notes: '',
      },
    ],
  });

  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /METHOD:PUBLISH\r\n/);
  assert.match(ics, /X-WR-CALNAME:김철수의 주간 일정\r\n/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.equal((ics.match(/END:VEVENT/g) || []).length, 2);
  // KST 14:00 -> UTC 05:00
  assert.match(ics, /DTSTART:20261124T050000Z\r\n/);
  assert.match(ics, /DTEND:20261124T063000Z\r\n/);
  assert.match(ics, /SUMMARY:팀 회의\\, 1차\\; 검토\r\n/);
  assert.match(ics, /DESCRIPTION:1층 회의실\\n자료 지참\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261128\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261130\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test('renderSharedScheduleHtml renders OG image/Twitter metadata, .ics export links, and viral CTA card', () => {
  const html = renderSharedScheduleHtml({
    share: {
      token: 'abc123XYZ',
      title: '이번 주 일정 공유',
      period: 'week',
      target_date: '2026-11-24',
      owner_name: '민수',
      calendar_name: '우리 가족',
    },
    events: [
      {
        id: 'ev-100',
        title: '가족 식사',
        start: '2026-11-24T19:00',
        end: '2026-11-24T21:00',
        color: 'sage',
        all_day: false,
      },
    ],
    origin: 'https://dwm.brightnetworks.kr',
  });

  assert.match(html, /property="og:image" content="https:\/\/dwm\.brightnetworks\.kr\/og-image\.png"/);
  assert.match(html, /property="og:url" content="https:\/\/dwm\.brightnetworks\.kr\/s\/abc123XYZ"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /href="\/s\/abc123XYZ\/calendar\.ics"/);
  assert.match(html, /href="\/s\/abc123XYZ\/calendar\.ics\?event=ev-100"/);
  assert.match(html, /href="https:\/\/dwm\.brightnetworks\.kr\/\?import_share=abc123XYZ&amp;ref=share"/);
  assert.match(html, /href="https:\/\/dwm\.brightnetworks\.kr\/\?try=1&amp;ref=share"/);
  assert.match(html, /나도 10초 만에 내 일정 링크 만들기/);
});

test('servePublicPage supports dynamic invite OG metadata and serves /sandbox.js', () => {
  const req = { method: 'GET' };
  const res = {
    headers: {},
    statusCode: 200,
    setHeader(k, v) { this.headers[k] = v; },
    end(content) { this.body = content; },
  };
  const handled = servePublicPage(req, res, '/invite/tok-123', 'https://dwm.brightnetworks.kr', {
    title: "민수님이 '우리 가족' 캘린더에 초대했어요 · 모아 캘린더",
    description: "링크 하나로 '우리 가족' 공유 캘린더에 바로 참여해 보세요.",
    pageUrl: 'https://dwm.brightnetworks.kr/invite/tok-123',
  });
  assert.equal(handled, true);
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.match(res.body, /<title>민수님이 &#39;우리 가족&#39; 캘린더에 초대했어요 · 모아 캘린더<\/title>/);
  assert.match(res.body, /property="og:title" content="민수님이 &#39;우리 가족&#39; 캘린더에 초대했어요 · 모아 캘린더"/);
  assert.match(res.body, /property="og:url" content="https:\/\/dwm\.brightnetworks\.kr\/invite\/tok-123"/);
  assert.match(res.body, /property="og:image" content="https:\/\/dwm\.brightnetworks\.kr\/og-image\.png"/);

  const sandboxRes = {
    headers: {},
    statusCode: 200,
    setHeader(k, v) { this.headers[k] = v; },
    end(content) { this.body = content; },
  };
  servePublicPage({ method: 'GET' }, sandboxRes, '/sandbox.js', 'https://dwm.brightnetworks.kr');
  assert.equal(sandboxRes.statusCode, 200);
  assert.match(sandboxRes.headers['Content-Type'], /text\/javascript/);
});

test('sandbox store supports local CRUD, tracks only user-created events for migration, and clears cleanly', () => {
  const storage = createMemoryStorage();
  const baseDate = new Date('2026-11-24T12:00:00');
  const cal = createSandboxCalendar('ko');
  assert.equal(cal.id, SANDBOX_CALENDAR_ID);

  const store = createSandboxStore(storage, baseDate, 'ko');
  const initialEvents = store.handleApi(`/api/calendars/${cal.id}/events`, 'GET');
  assert.equal(initialEvents.length, 5);
  assert.ok(initialEvents.some(ev => ev.is_dday));
  assert.ok(initialEvents.some(ev => ev.is_todo));
  assert.equal(store.getUserCreatedEvents().length, 0);

  // Create a user event
  const created = store.handleApi(`/api/calendars/${cal.id}/events`, 'POST', {
    title: '체험 중 만든 일정',
    start: '2026-11-25T10:00',
    end: '2026-11-25T11:00',
    all_day: false,
    color: 'teal',
    category: '개인',
    notes: '로그인 시 자동 이관 테스트',
  });
  assert.equal(created.ok, true);
  assert.equal(created.created, 1);

  // Reload store from persisted storage to confirm persistence
  const reloaded = createSandboxStore(storage, baseDate, 'ko');
  const userCreated = reloaded.getUserCreatedEvents();
  assert.equal(userCreated.length, 1);
  assert.equal(userCreated[0].title, '체험 중 만든 일정');

  // Create repeating events in sandbox mode (verifies repeatEventRanges options object)
  const repeated = reloaded.handleApi(`/api/calendars/${cal.id}/events`, 'POST', {
    title: '매주 러닝',
    start: '2026-11-26T07:00',
    end: '2026-11-26T08:00',
    all_day: false,
    color: 'blue',
    repeat_frequency: 'weekly',
    repeat_count: 3,
    repeat_calendar_type: 'solar',
  });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.created, 3);
  assert.equal(reloaded.getUserCreatedEvents().length, 4);

  // Update date note and month note with app.js expected shape
  const savedDateNote = reloaded.handleApi(`/api/calendars/${cal.id}/notes/2026-11-24`, 'PUT', { content: '오늘의 메모' });
  assert.equal(savedDateNote.date, '2026-11-24');
  assert.equal(savedDateNote.content, '오늘의 메모');
  assert.equal(savedDateNote.version, 1);
  const loadedNotes = reloaded.handleApi(`/api/calendars/${cal.id}/notes`, 'GET');
  assert.equal(loadedNotes[0].date, '2026-11-24');

  const savedMonthNote = reloaded.handleApi(`/api/calendars/${cal.id}/month-notes/2026-11`, 'PUT', { content: '11월 목표' });
  assert.equal(savedMonthNote.month, '2026-11');
  assert.equal(savedMonthNote.version, 1);

  // Clear after migration
  reloaded.clear();
  assert.equal(reloaded.getUserCreatedEvents().length, 0);
});

test('POST /api/analytics/event validates funnel event names and forwards to ANALYTICS_ENDPOINT', async () => {
  const received = [];
  const mockAnalytics = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(raw || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
  });

  await new Promise(resolve => mockAnalytics.listen(0, '127.0.0.1', resolve));
  const mockPort = mockAnalytics.address().port;
  const prevAnalytics = process.env.ANALYTICS_ENDPOINT;
  const prevAppUrl = process.env.APP_URL;
  process.env.ANALYTICS_ENDPOINT = `http://127.0.0.1:${mockPort}/api/analytics/collect`;
  process.env.APP_URL = 'http://localhost:3000';

  try {
    const { handleRequest } = await import('../server.mjs');
    const appServer = http.createServer(handleRequest);
    await new Promise(resolve => appServer.listen(0, '127.0.0.1', resolve));
    const appPort = appServer.address().port;

    const postEvent = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${appPort}/api/analytics/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
        body: JSON.stringify(payload),
      });
      return { status: res.status, data: await res.json() };
    };

    try {
      const bad = await postEvent({ event: 'unknown_event' });
      assert.equal(bad.status, 400);
      assert.equal(received.length, 0);

      const good = await postEvent({
        event: 'sandbox_start',
        source: 'share',
        visitorId: 'vis-123',
        sessionId: 'sess-456',
        screenWidth: 390,
      });
      assert.equal(good.status, 200);
      assert.equal(good.data.ok, true);
      assert.equal(good.data.forwarded, true);
      assert.equal(received.length, 1);
      assert.equal(received[0].body.siteId, 'moa-calendar');
      assert.equal(received[0].body.path, '/_event/sandbox_start?source=share');
      assert.equal(received[0].body.visitorId, 'vis-123');
    } finally {
      appServer.close();
    }
  } finally {
    mockAnalytics.close();
    if (prevAnalytics === undefined) delete process.env.ANALYTICS_ENDPOINT;
    else process.env.ANALYTICS_ENDPOINT = prevAnalytics;
    if (prevAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevAppUrl;
  }
});

test('Phase 1 UI, translations, and server routes are wired consistently', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const translations = readFileSync(new URL('../public/translations.js', import.meta.url), 'utf8');
  const serverMjs = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

  // Native share buttons & KakaoTalk notice
  assert.match(html, /id="native-share-calendar"/);
  assert.match(html, /id="native-share-invite"/);
  assert.match(html, /id="native-share-created-btn"/);
  assert.match(html, /id="details-share-invite-btn"/);
  assert.match(appJs, /navigator\.share/);
  assert.match(appJs, /kakaotalk:\/\/web\/openExternal/);

  // Sandbox & onboarding templates
  assert.match(appJs, /id="start-sandbox-btn"/);
  assert.match(appJs, /id="sandbox-banner"/);
  assert.match(appJs, /id="onboarding-templates"/);
  assert.match(appJs, /migrateSandboxEventsIfAny/);
  assert.match(appJs, /importPendingSharedScheduleIfAny/);
  assert.match(css, /\.sandbox-banner\{/);
  assert.match(css, /\.onboarding-templates\{/);
  assert.match(css, /\.inapp-browser-notice\{/);

  // Funnel tracking calls
  for (const ev of ['sandbox_start', 'signup_complete', 'first_event_created', 'invite_created', 'invite_accepted', 'share_link_created', 'share_cta_clicked', 'template_calendar_created', 'share_import_completed']) {
    assert.match(appJs, new RegExp(`trackFunnel\\('${ev}'`));
  }

  // Server routes & default calendar auto-creation
  assert.match(serverMjs, /ensureDefaultCalendar/);
  assert.match(serverMjs, /calendar\\\.ics/);
  assert.match(serverMjs, /shareImportMatch/);
  assert.match(serverMjs, /\/api\/analytics\/event/);

  // English translations
  assert.match(translations, /"✨ 로그인 없이 먼저 둘러보기": "✨ Try without signing up"/);
  assert.match(translations, /"누구와 함께 쓰는 캘린더인가요\?": "Who are you sharing with\?"/);
});

test('Phase 1 SQL queries execute cleanly against full PostgreSQL schema (PGlite)', async () => {
  const pg = new PGlite();
  try {
    const dbDir = new URL('../db/', import.meta.url);
    const files = readdirSync(dbDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = readFileSync(new URL(file, dbDir), 'utf8');
      await pg.exec(sql);
    }

    // 1. User signup + default calendar auto-creation SQL
    await pg.query('INSERT INTO users(id, name) VALUES($1, $2)', ['u-owner', '김민수']);
    await pg.query('INSERT INTO calendars(id, name, owner, slug) VALUES($1, $2, $3, $4)', ['c-1', '우리 가족', 'u-owner', 'our-family']);
    await pg.query('INSERT INTO members(calendar_id, user_id, role) VALUES($1, $2, $3)', ['c-1', 'u-owner', 'owner']);

    // 2. Dynamic /invite/:token OG SQL lookup
    await pg.query(
      'INSERT INTO invites(token, calendar_id, role, expires, raw_token) VALUES($1, $2, $3, $4, $5)',
      ['hashed-tok', 'c-1', 'editor', Date.now() + 600000, 'raw-tok']
    );
    const invRow = (await pg.query(`
      SELECT c.name AS calendar_name, u.name AS owner_name, i.role
      FROM invites i
      JOIN calendars c ON c.id = i.calendar_id
      JOIN users u ON u.id = c.owner
      WHERE i.token = $1 AND i.expires > $2 AND c.status = 'ACTIVE'
    `, ['hashed-tok', Date.now()])).rows[0];
    assert.equal(invRow.calendar_name, '우리 가족');
    assert.equal(invRow.owner_name, '김민수');
    assert.equal(invRow.role, 'editor');

    // 3. Schedule share events + import into recipient's editable calendar
    await pg.query(
      'INSERT INTO events(id,calendar_id,title,start,"end",all_day,color,category,notes,is_todo,completed,reminder_enabled,reminder_minutes,is_dday,is_cancelled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,10,$12,false)',
      ['ev-1', 'c-1', '가족 저녁', '2026-11-24T19:00', '2026-11-24T21:00', false, 'sage', '가족', '강남역', false, false, false]
    );
    await pg.query(
      'INSERT INTO schedule_shares(id, token, user_id, calendar_id, title, period, target_date) VALUES($1,$2,$3,$4,$5,$6,$7)',
      ['sh-1', 'share-tok', 'u-owner', 'c-1', '민수의 이번 주 일정', 'week', '2026-11-24']
    );

    await pg.query('INSERT INTO users(id, name) VALUES($1, $2)', ['u-guest', '이서연']);
    await pg.query('INSERT INTO calendars(id, name, owner, slug) VALUES($1, $2, $3, $4)', ['c-guest', '내 캘린더', 'u-guest', 'guest-cal']);
    await pg.query('INSERT INTO members(calendar_id, user_id, role) VALUES($1, $2, $3)', ['c-guest', 'u-guest', 'owner']);

    const editableCal = (await pg.query(`
      SELECT c.id, c.name
      FROM calendars c
      JOIN members m ON m.calendar_id = c.id
      LEFT JOIN calendar_order o ON o.calendar_id = c.id AND o.user_id = m.user_id
      WHERE m.user_id = $1 AND c.status = 'ACTIVE' AND m.role IN ('owner', 'editor')
        AND (c.source_provider IS NULL OR c.source_provider != 'google')
        AND NOT EXISTS (SELECT 1 FROM external_calendars ec WHERE ec.calendar_id = c.id AND (ec.is_read_only OR ec.sync_direction = 'read_only'))
      ORDER BY o.sort_order NULLS LAST, c.created_at, c.id
      LIMIT 1
    `, ['u-guest'])).rows[0];
    assert.equal(editableCal.id, 'c-guest');

    // Verify INSERT statement from POST /api/schedule-shares/:token/import
    await pg.query(
      'INSERT INTO events(id,calendar_id,title,start,"end",all_day,color,category,notes,is_todo,completed,reminder_enabled,reminder_minutes,is_dday,is_cancelled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,10,$12,false)',
      ['ev-copy-1', editableCal.id, '가족 저녁', '2026-11-24T19:00', '2026-11-24T21:00', false, 'sage', '가족', '강남역', false, false, false]
    );
    const copied = (await pg.query('SELECT title, start, "end" FROM events WHERE calendar_id=$1', ['c-guest'])).rows;
    assert.equal(copied.length, 1);
    assert.equal(copied[0].title, '가족 저녁');
  } finally {
    await pg.close();
  }
});
