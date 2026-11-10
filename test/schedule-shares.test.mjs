import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnvironment, getWeekRange, getMonthRange, renderSharedScheduleHtml } from '../schedule-shares.mjs';

test('parseEnvironment identifies mobile, desktop, tablets, browsers and in-app webviews', () => {
  const kakaoIphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.6.2';
  assert.equal(parseEnvironment(kakaoIphone), '모바일 · iPhone · 카카오톡');

  const samsungAndroid = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36';
  assert.equal(parseEnvironment(samsungAndroid), '모바일 · Android · 삼성 인터넷');

  const macChrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  assert.equal(parseEnvironment(macChrome), '데스크톱 · macOS · Chrome');

  const winEdge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
  assert.equal(parseEnvironment(winEdge), '데스크톱 · Windows · Edge');

  const ipadSafari = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  assert.equal(parseEnvironment(ipadSafari), '태블릿 · iPad · Safari');

  assert.equal(parseEnvironment(''), '알 수 없는 환경');
});

test('getWeekRange calculates Monday to Sunday correctly for any day of the week', () => {
  const tue = getWeekRange('2026-11-03');
  assert.equal(tue.monStr, '2026-11-02');
  assert.equal(tue.sunStr, '2026-11-08');
  assert.equal(tue.nextMonStr, '2026-11-09');

  const mon = getWeekRange('2026-11-02');
  assert.equal(mon.monStr, '2026-11-02');
  assert.equal(mon.sunStr, '2026-11-08');

  const sun = getWeekRange('2026-11-08');
  assert.equal(sun.monStr, '2026-11-02');
  assert.equal(sun.sunStr, '2026-11-08');
});

test('getMonthRange calculates first, last and next month dates correctly', () => {
  const nov = getMonthRange('2026-11-03');
  assert.equal(nov.firstDay, '2026-11-01');
  assert.equal(nov.lastDay, '2026-11-30');
  assert.equal(nov.nextMonthFirstDay, '2026-12-01');

  const feb = getMonthRange('2024-02-15'); // leap year
  assert.equal(feb.firstDay, '2024-02-01');
  assert.equal(feb.lastDay, '2024-02-29');
});

test('renderSharedScheduleHtml renders active day, week, month schedules and handles expired state', () => {
  // 1. Day view
  const dayHtml = renderSharedScheduleHtml({
    share: {
      title: '김철수님의 오늘 하루 일정',
      period: 'day',
      target_date: '2026-11-03',
      owner_name: '김철수',
      calendar_name: '개인 캘린더',
      expires_at: '2026-11-04T12:00:00Z'
    },
    events: [
      {
        id: 'ev-1',
        title: '디자인 리뷰 회의',
        start: '2026-11-03T14:00',
        end: '2026-11-03T15:30',
        color: 'blue',
        category: '업무',
        notes: '피그마 시안 최종 검토',
        all_day: false
      },
      {
        id: 'ev-2',
        title: '하루 종일 워크샵',
        start: '2026-11-03T00:00',
        end: '2026-11-04T00:00',
        color: 'sage',
        all_day: true
      }
    ],
    origin: 'https://dwm.brightnetworks.kr'
  });

  assert.match(dayHtml, /김철수님의 오늘 하루 일정/);
  assert.match(dayHtml, /디자인 리뷰 회의/);
  assert.match(dayHtml, /피그마 시안 최종 검토/);
  assert.match(dayHtml, /하루 종일/);
  assert.match(dayHtml, /14:00 - 15:30/);
  assert.match(dayHtml, /모아 캘린더 · 읽기 전용 일정 공유/);

  // 2. Week view with empty days
  const weekHtml = renderSharedScheduleHtml({
    share: {
      title: '이번 주 스케줄',
      period: 'week',
      target_date: '2026-11-03',
      owner_name: '이영희'
    },
    events: [],
    origin: 'https://dwm.brightnetworks.kr'
  });
  assert.match(weekHtml, /이번 주 스케줄/);
  assert.match(weekHtml, /일주일 일정/);
  assert.match(weekHtml, /등록된 일정이 없습니다/);

  // 3. Expired state
  const expiredHtml = renderSharedScheduleHtml({
    share: { title: '만료된 일정' },
    isExpired: true,
    origin: 'https://dwm.brightnetworks.kr'
  });
  assert.match(expiredHtml, /공유 기간이 만료되었습니다/);

  // 4. Revoked state
  const revokedHtml = renderSharedScheduleHtml({
    share: { title: '취소된 일정' },
    isRevoked: true,
    origin: 'https://dwm.brightnetworks.kr'
  });
  assert.match(revokedHtml, /공유가 중단된 일정입니다/);

  // 5. XSS protection
  const xssHtml = renderSharedScheduleHtml({
    share: {
      title: '<script>alert(1)</script>',
      period: 'day',
      target_date: '2026-11-03'
    },
    events: [{
      title: '<img src=x onerror=alert(1)>',
      start: '2026-11-03T10:00',
      end: '2026-11-03T11:00',
      color: 'sage'
    }]
  });
  assert.doesNotMatch(xssHtml, /<script>alert\(1\)<\/script>/);
  assert.match(xssHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(xssHtml, /<img src=x onerror=alert\(1\)>/);
});

test('UI elements and styles are properly defined in HTML, CSS and JS', () => {
  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const styleCss = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const serverMjs = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

  // Modal dialog exists
  assert.match(indexHtml, /id="schedule-share-dialog"/);
  assert.match(indexHtml, /id="tab-create-share"/);
  assert.match(indexHtml, /id="tab-manage-shares"/);
  assert.match(indexHtml, /id="share-expires-select"/);
  assert.match(indexHtml, /data-mobile-action="schedule-share"/);

  // Sidebar button in app.js
  assert.match(appJs, /id="open-schedule-share-btn"/);
  assert.match(appJs, /function openScheduleShareDialog\(\)/);
  assert.match(appJs, /async function loadScheduleSharesList\(\)/);
  assert.match(appJs, /async function toggleShareVisitorsPanel\(/);

  // CSS styling
  assert.match(styleCss, /#schedule-share-dialog/);
  assert.match(styleCss, /\.schedule-share-trigger-btn/);
  assert.match(styleCss, /\.share-status-pill/);
  assert.match(styleCss, /\.visitor-item/);

  // Server routing & cookies
  assert.match(serverMjs, /moa_svid=/);
  assert.match(serverMjs, /\/api\/schedule-shares/);
  assert.match(serverMjs, /schedule_share_visitors/);
});
