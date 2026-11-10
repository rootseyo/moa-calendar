import { randomBytes, randomUUID } from 'node:crypto';

export function parseEnvironment(ua = '') {
  if (!ua || typeof ua !== 'string') return '알 수 없는 환경';
  let device = '데스크톱', os = '', browser = '', inApp = '';

  if (/iPhone/i.test(ua)) { device = '모바일'; os = 'iPhone'; }
  else if (/iPad/i.test(ua)) { device = '태블릿'; os = 'iPad'; }
  else if (/Android/i.test(ua)) { device = /Mobile/i.test(ua) ? '모바일' : '태블릿'; os = 'Android'; }
  else if (/Macintosh|Mac OS X/i.test(ua)) { device = '데스크톱'; os = 'macOS'; }
  else if (/Windows NT/i.test(ua)) { device = '데스크톱'; os = 'Windows'; }
  else if (/Linux/i.test(ua)) { device = '데스크톱'; os = 'Linux'; }

  if (/KAKAOTALK/i.test(ua)) inApp = '카카오톡';
  else if (/Instagram/i.test(ua)) inApp = '인스타그램';
  else if (/NAVER/i.test(ua)) inApp = '네이버앱';
  else if (/Line/i.test(ua)) inApp = '라인';

  if (inApp) browser = inApp;
  else if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/SamsungBrowser/i.test(ua)) browser = '삼성 인터넷';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else browser = '웹 브라우저';

  return [device, os, browser].filter(Boolean).join(' · ');
}

export function getWeekRange(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const nextMon = new Date(mon);
  nextMon.setDate(mon.getDate() + 7);
  const toKey = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  return {
    monStr: toKey(mon),
    sunStr: toKey(sun),
    nextMonStr: toKey(nextMon)
  };
}

export function getMonthRange(dateStr) {
  const [yStr, mStr] = dateStr.split('-');
  const y = Number(yStr), m = Number(mStr);
  const firstDay = `${yStr}-${mStr}-01`;
  const lastDate = new Date(y, m, 0).getDate();
  const lastDay = `${yStr}-${mStr}-${String(lastDate).padStart(2, '0')}`;
  const nextMonthDate = new Date(y, m, 1);
  const nextMonthFirstDay = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;
  return {
    firstDay,
    lastDay,
    nextMonthFirstDay
  };
}

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const EVENT_COLOR_STYLES = {
  sage: 'background: #eaf4ec; color: #1e5e2e; border-left: 4px solid #38664e;',
  blue: 'background: #ebf3fe; color: #165296; border-left: 4px solid #2563eb;',
  peach: 'background: #fff2e5; color: #9c4815; border-left: 4px solid #ea580c;',
  lavender: 'background: #f6eefd; color: #6b2897; border-left: 4px solid #9333ea;',
  coral: 'background: #feeeee; color: #991b1b; border-left: 4px solid #dc2626;',
  rose: 'background: #fdf2f8; color: #9d174d; border-left: 4px solid #db2777;',
  yellow: 'background: #fefce8; color: #854d0e; border-left: 4px solid #ca8a04;',
  teal: 'background: #e6fffa; color: #115e59; border-left: 4px solid #0d9488;',
  orange: 'background: #fff7ed; color: #9a3412; border-left: 4px solid #ea580c;',
  cyan: 'background: #f0f9ff; color: #075985; border-left: 4px solid #0284c7;',
  indigo: 'background: #eef2ff; color: #3730a3; border-left: 4px solid #4f46e5;',
  slate: 'background: #f8fafc; color: #334155; border-left: 4px solid #64748b;'
};

export function renderSharedScheduleHtml({ share, events = [], isExpired = false, isRevoked = false, origin = '' }) {
  const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

  if (isRevoked || isExpired) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>공유가 만료된 일정입니다 · 모아 캘린더</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    :root { --green: #38664e; --border: #e5eae3; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; background: #f8faf7; color: #283b33; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #fff; border: 1px solid var(--border); border-radius: 16px; padding: 36px 28px; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 4px 20px rgba(40,59,51,0.06); }
    .icon { font-size: 42px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 10px; color: #1e3328; }
    p { font-size: 14px; line-height: 1.6; color: #6b7a6d; margin: 0 0 24px; }
    .btn { display: inline-block; background: var(--green); color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-size: 14px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h1>${isRevoked ? '공유가 중단된 일정입니다' : '공유 기간이 만료되었습니다'}</h1>
    <p>${isRevoked ? '공유자가 일정 공유를 중단했습니다.<br>새로운 일정이 필요하시면 공유자에게 요청해 주세요.' : '공유 링크의 유효 기간이 지났습니다.<br>새로운 링크가 필요하시면 공유자에게 요청해 주세요.'}</p>
    <a href="${origin || '/'}" class="btn">모아 캘린더 홈으로 이동</a>
  </div>
</body>
</html>`;
  }

  const targetDateStr = share.target_date instanceof Date
    ? share.target_date.toISOString().slice(0, 10)
    : String(share.target_date).slice(0, 10);

  let periodBadge = '하루 일정';
  let periodRangeText = '';

  if (share.period === 'day') {
    periodBadge = '하루 일정';
    const d = new Date(`${targetDateStr}T12:00:00`);
    periodRangeText = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS_KO[d.getDay()]})`;
  } else if (share.period === 'week') {
    periodBadge = '일주일 일정';
    const { monStr, sunStr } = getWeekRange(targetDateStr);
    const m = new Date(`${monStr}T12:00:00`);
    const s = new Date(`${sunStr}T12:00:00`);
    periodRangeText = `${m.getFullYear()}.${m.getMonth() + 1}.${m.getDate()}(월) ~ ${s.getMonth() + 1}.${s.getDate()}(일)`;
  } else if (share.period === 'month') {
    periodBadge = '이번 달 일정';
    const [y, m] = targetDateStr.split('-');
    periodRangeText = `${y}년 ${Number(m)}월 한 달`;
  }

  // Group events by date (YYYY-MM-DD)
  const eventsByDate = new Map();

  if (share.period === 'day') {
    eventsByDate.set(targetDateStr, []);
  } else if (share.period === 'week') {
    const { monStr } = getWeekRange(targetDateStr);
    const curr = new Date(`${monStr}T12:00:00`);
    for (let i = 0; i < 7; i++) {
      const k = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`;
      eventsByDate.set(k, []);
      curr.setDate(curr.getDate() + 1);
    }
  }

  for (const ev of events) {
    const dateKey = ev.start.slice(0, 10);
    if (!eventsByDate.has(dateKey)) {
      eventsByDate.set(dateKey, []);
    }
    eventsByDate.get(dateKey).push(ev);
  }

  // Format date header
  function formatDateHeader(dateKey) {
    const d = new Date(`${dateKey}T12:00:00`);
    const today = new Date().toISOString().slice(0, 10);
    const isToday = dateKey === today;
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS_KO[d.getDay()]})${isToday ? ' · 오늘' : ''}`;
  }

  function formatEventTime(ev) {
    if (ev.all_day) return '하루 종일';
    const sTime = ev.start.slice(11, 16);
    const eTime = ev.end.slice(11, 16);
    return `${sTime} - ${eTime}`;
  }

  let expirationNotice = '';
  if (share.expires_at) {
    const exp = new Date(share.expires_at);
    const expStr = `${exp.getFullYear()}.${exp.getMonth() + 1}.${exp.getDate()} ${String(exp.getHours()).padStart(2, '0')}:${String(exp.getMinutes()).padStart(2, '0')}`;
    expirationNotice = `<span class="meta-tag exp">⏳ 만료: ${expStr}</span>`;
  } else {
    expirationNotice = `<span class="meta-tag exp never">상시 공유</span>`;
  }

  const sortedDates = Array.from(eventsByDate.keys()).sort();

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(share.title)} · 모아 캘린더</title>
  <meta name="description" content="${esc(share.title)} 읽기 전용 일정 공유">
  <meta property="og:title" content="${esc(share.title)}">
  <meta property="og:description" content="${esc(periodRangeText)} 일정 (${events.length}개의 일정)">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    :root {
      --green: #38664e;
      --bg: #f8faf7;
      --border: #e4eae1;
      --text: #283b33;
      --muted: #73816f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px 16px 60px;
    }
    .container {
      max-width: 620px;
      margin: 0 auto;
    }
    header.share-header {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(40,59,51,0.04);
    }
    .brand-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 700;
      color: var(--green);
      margin-bottom: 12px;
    }
    .brand-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: var(--green);
      color: #fff;
      font-family: Georgia, serif;
      font-style: italic;
      font-size: 15px;
      padding-bottom: 2px;
    }
    h1.title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin: 0 0 10px;
      color: #1a2c22;
      overflow-wrap: anywhere;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }
    .meta-tag {
      display: inline-flex;
      align-items: center;
      padding: 4px 9px;
      border-radius: 8px;
      font-weight: 600;
    }
    .meta-tag.period {
      background: #eaf3e8;
      color: var(--green);
    }
    .meta-tag.range {
      background: #f1f4ed;
      color: #4f634b;
    }
    .meta-tag.exp {
      background: #fef3c7;
      color: #92400e;
    }
    .meta-tag.exp.never {
      background: #f1f5f9;
      color: #475569;
    }
    .owner-info {
      font-size: 12px;
      color: var(--muted);
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #f0f4ee;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .date-group {
      margin-bottom: 18px;
    }
    .date-header {
      font-size: 14px;
      font-weight: 700;
      color: #465844;
      padding: 8px 4px 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .event-card {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 8px;
      box-shadow: 0 1px 4px rgba(40,59,51,0.03);
    }
    .event-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }
    .time-badge {
      font-size: 11px;
      font-weight: 600;
      color: #61735e;
      background: #edf2ea;
      padding: 3px 7px;
      border-radius: 6px;
    }
    .category-chip {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 5px;
      background: rgba(0,0,0,0.05);
      color: #445441;
      margin-left: 6px;
    }
    .event-title {
      font-size: 14px;
      font-weight: 600;
      color: #213329;
      overflow-wrap: anywhere;
    }
    .event-notes {
      font-size: 12px;
      color: #556653;
      margin-top: 6px;
      line-height: 1.5;
      white-space: pre-line;
      background: #f7faf5;
      padding: 8px 10px;
      border-radius: 6px;
    }
    .todo-indicator {
      display: inline-block;
      font-size: 11px;
      color: var(--green);
      font-weight: 600;
      margin-right: 5px;
    }
    .empty-day {
      padding: 12px;
      text-align: center;
      font-size: 12px;
      color: #a0ac9e;
      background: #fafcf9;
      border: 1px dashed var(--border);
      border-radius: 10px;
    }
    .empty-all {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 40px 20px;
      text-align: center;
      color: var(--muted);
    }
    .empty-all .icon { font-size: 36px; margin-bottom: 12px; }
    footer.share-footer {
      text-align: center;
      margin-top: 36px;
      font-size: 12px;
      color: #929e8f;
    }
    footer.share-footer a {
      color: var(--green);
      font-weight: 600;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="share-header">
      <div class="brand-bar"><span class="brand-mark">m</span><span>모아 캘린더 · 읽기 전용 일정 공유</span></div>
      <h1 class="title">${esc(share.title)}</h1>
      <div class="meta-row">
        <span class="meta-tag period">${esc(periodBadge)}</span>
        <span class="meta-tag range">${esc(periodRangeText)}</span>
        ${expirationNotice}
      </div>
      <div class="owner-info">
        <span>공유자: <strong>${esc(share.owner_name || '사용자')}</strong>${share.calendar_name ? ` · ${esc(share.calendar_name)}` : ''}</span>
        <span>총 ${events.length}개의 일정</span>
      </div>
    </header>

    <main class="events-main">
      ${events.length === 0 ? `
        <div class="empty-all">
          <div class="icon">📅</div>
          <p>공유된 기간에 등록된 일정이 없습니다.</p>
        </div>
      ` : sortedDates.map(dateKey => {
        const dayEvents = eventsByDate.get(dateKey) || [];
        if (dayEvents.length === 0 && share.period === 'month') return ''; // Don't list empty days in month view
        return `
          <section class="date-group">
            <div class="date-header">
              <span>${esc(formatDateHeader(dateKey))}</span>
              ${dayEvents.length > 0 ? `<small style="font-weight:normal;color:#7e8d7b">${dayEvents.length}개</small>` : ''}
            </div>
            ${dayEvents.length === 0 ? `
              <div class="empty-day">예정된 일정이 없습니다.</div>
            ` : dayEvents.map(ev => {
              const colorStyle = EVENT_COLOR_STYLES[ev.color] || EVENT_COLOR_STYLES.sage;
              return `
                <article class="event-card" style="${colorStyle}">
                  <div class="event-top">
                    <span class="time-badge">${esc(formatEventTime(ev))}</span>
                    ${ev.category ? `<span class="category-chip">${esc(ev.category)}</span>` : ''}
                  </div>
                  <div class="event-title">
                    ${ev.is_todo ? `<span class="todo-indicator">${ev.completed ? '✓' : '○'}</span>` : ''}
                    ${esc(ev.title)}
                  </div>
                  ${ev.notes ? `<div class="event-notes">${esc(ev.notes)}</div>` : ''}
                </article>
              `;
            }).join('')}
          </section>
        `;
      }).join('')}
    </main>

    <footer class="share-footer">
      <p>실시간으로 함께 쓰는 가벼운 캘린더, <a href="${origin || '/'}" target="_blank" rel="noopener">모아 캘린더 ↗</a></p>
    </footer>
  </div>
</body>
</html>`;
}
