import { randomUUID } from 'node:crypto';

export const ALLOWED_REACTION_EMOJIS = ['👍', '❤️', '🎉', '🔥', '👀', '🙏'];

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function recordCalendarActivity(runFn, { calendarId, eventId = null, actorId = null, actorName = '멤버', action, summary }) {
  if (!calendarId || !action || !summary) return;
  try {
    await runFn(
      'INSERT INTO calendar_activities(id, calendar_id, event_id, actor_id, actor_name, action, summary) VALUES($1, $2, $3, $4, $5, $6, $7)',
      randomUUID(),
      calendarId,
      eventId,
      actorId,
      String(actorName || '멤버').slice(0, 60),
      action,
      String(summary).slice(0, 240)
    );
  } catch (err) {
    console.warn('[Activity Feed] Failed to record activity:', err.message);
  }
}

// Compute common free hourly slots across selected events for each date in a week
export function computeFreeSlots({ events = [], dates = [], startHour = 9, endHour = 21 } = {}) {
  const result = {};
  for (const dateKey of dates) {
    const busyHours = new Set();
    for (const ev of events) {
      if (!ev || ev.is_cancelled) continue;
      const sDate = String(ev.start || '').slice(0, 10);
      const eDate = String(ev.end || '').slice(0, 10);
      if (ev.all_day) {
        if (dateKey >= sDate && dateKey < eDate) {
          for (let h = startHour; h < endHour; h++) busyHours.add(h);
        }
        continue;
      }
      if (dateKey < sDate || dateKey > eDate) continue;
      const sHour = dateKey === sDate ? Number(String(ev.start).slice(11, 13)) : 0;
      const eHourRaw = dateKey === eDate ? Number(String(ev.end).slice(11, 13)) : 24;
      const eMin = dateKey === eDate ? Number(String(ev.end).slice(14, 16)) : 0;
      const eHour = eMin > 0 ? eHourRaw + 1 : eHourRaw;
      for (let h = Math.max(startHour, sHour); h < Math.min(endHour, eHour); h++) {
        busyHours.add(h);
      }
    }
    const freeBlocks = [];
    let blockStart = null;
    for (let h = startHour; h <= endHour; h++) {
      const isFree = h < endHour && !busyHours.has(h);
      if (isFree && blockStart === null) {
        blockStart = h;
      } else if (!isFree && blockStart !== null) {
        freeBlocks.push({
          start: `${String(blockStart).padStart(2, '0')}:00`,
          end: `${String(h).padStart(2, '0')}:00`,
          hours: h - blockStart,
        });
        blockStart = null;
      }
    }
    result[dateKey] = freeBlocks;
  }
  return result;
}

function formatOptionLabel(startTime, endTime) {
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const datePart = String(startTime || '').slice(0, 10);
  const d = new Date(`${datePart}T12:00:00`);
  const dayLabel = Number.isNaN(d.getTime()) ? datePart : `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  const sTime = String(startTime || '').slice(11, 16);
  const eTime = String(endTime || '').slice(11, 16);
  return { dayLabel, timeRange: `${sTime} – ${eTime}` };
}

export function renderPollPageHtml({ poll, options = [], votes = [], voterKey = '', origin = '', isExpired = false, votedSuccess = false } = {}) {
  const baseOrigin = origin ? origin.replace(/\/$/, '') : '';
  const safeToken = poll?.token ? encodeURIComponent(poll.token) : '';
  const ogImage = `${baseOrigin}/og-image.png`;
  const title = poll?.title || '약속 시간 투표';
  const creatorName = poll?.creator_name || '사용자';
  const isClosed = isExpired || poll?.status !== 'OPEN';

  const votesByOption = new Map();
  const myVotes = new Map();
  let myVoterName = '';
  for (const v of votes) {
    if (!votesByOption.has(v.option_id)) votesByOption.set(v.option_id, []);
    votesByOption.get(v.option_id).push(v);
    if (voterKey && v.voter_key === voterKey) {
      myVotes.set(v.option_id, v.availability);
      if (v.voter_name) myVoterName = v.voter_name;
    }
  }

  let maxScore = 0;
  for (const opt of options) {
    const list = votesByOption.get(opt.id) || [];
    const score = list.reduce((sum, v) => sum + (v.availability === 'yes' ? 2 : 1), 0);
    if (score > maxScore) maxScore = score;
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · 약속 시간 투표 · 모아 캘린더</title>
  <meta name="description" content="${esc(creatorName)}님이 보낸 약속 시간 투표에 참여해 보세요. 로그인 없이 가능한 시간만 고르면 끝!">
  <meta name="robots" content="noindex, nofollow">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="모아 캘린더">
  <meta property="og:title" content="🗳️ ${esc(title)} · 약속 시간 투표">
  <meta property="og:description" content="${esc(creatorName)}님이 보낸 후보 ${options.length}개 중 가능한 시간을 선택해 주세요.">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    :root{--green:#38664e;--bg:#f8faf7;--surface:#fff;--border:#e3eae1;--text:#24372f;--muted:#6e7e71}
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:var(--bg);color:var(--text);padding:24px 16px 56px;line-height:1.5}
    .wrap{max-width:560px;margin:0 auto}
    .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px 20px;box-shadow:0 3px 14px rgba(36,55,47,.05);margin-bottom:18px}
    .brand{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--green);margin-bottom:12px}
    .mark{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:var(--green);color:#fff;font-family:Georgia,serif;font-style:italic;font-size:15px;padding-bottom:2px}
    h1{margin:0 0 8px;font-size:21px;letter-spacing:-.4px}
    .meta{font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px 14px}
    .status-pill{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;background:#e6f2e8;color:var(--green)}
    .status-pill.closed{background:#f1f5f9;color:#64748b}
    .notice{padding:12px 14px;border-radius:10px;background:#eaf4ec;color:#1e5631;font-size:13px;font-weight:600;margin-bottom:16px}
    label.name-label{display:block;font-size:13px;font-weight:700;margin-bottom:14px}
    label.name-label input{display:block;width:100%;margin-top:6px;padding:11px 13px;border-radius:10px;border:1px solid #d5e0d4;font-size:15px}
    .option-card{border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;background:#fbfdfa}
    .option-card.leading{border-color:#7fb08d;background:#f2f8f3}
    .option-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
    .option-date{font-size:14px;font-weight:700}
    .option-time{font-size:12.5px;color:#4f6353;font-weight:600}
    .tally{font-size:11.5px;font-weight:700;color:var(--green)}
    .voters{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 10px}
    .voter-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:#e8f2ea;color:#27513a;font-weight:600}
    .voter-chip.maybe{background:#fef3c7;color:#92400e}
    .choices{display:flex;gap:8px}
    .choice{flex:1;position:relative;cursor:pointer}
    .choice input{position:absolute;opacity:0;width:1px;height:1px}
    .choice span{display:flex;align-items:center;justify-content:center;min-height:38px;border-radius:8px;border:1px solid #d6e0d4;background:#fff;font-size:12.5px;font-weight:600;color:#516354}
    .choice input:checked+span{background:var(--green);border-color:var(--green);color:#fff}
    .choice.maybe input:checked+span{background:#d97706;border-color:#d97706;color:#fff}
    .choice.no input:checked+span{background:#64748b;border-color:#64748b;color:#fff}
    .submit-btn{width:100%;min-height:46px;border:0;border-radius:11px;background:var(--green);color:#fff;font-size:14.5px;font-weight:700;cursor:pointer;margin-top:8px}
    .cta{text-align:center;background:linear-gradient(135deg,#edf4ea,#f8fbf6);border:1px solid #d3e1ce;border-radius:16px;padding:20px}
    .cta h2{margin:0 0 6px;font-size:16px}
    .cta p{margin:0 0 14px;font-size:12.5px;color:var(--muted)}
    .cta a{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:8px 18px;border-radius:10px;background:var(--green);color:#fff;font-size:13px;font-weight:700;text-decoration:none}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="card">
      <div class="brand"><span class="mark">m</span><span>모아 캘린더 · 약속 시간 투표</span></div>
      <h1>${esc(title)}</h1>
      <div class="meta">
        <span class="status-pill ${isClosed ? 'closed' : ''}">${poll?.status === 'CONFIRMED' ? '✓ 일정 확정됨' : isClosed ? '투표 마감' : '투표 진행 중'}</span>
        <span>주최: <strong>${esc(creatorName)}</strong></span>
        ${poll?.location ? `<span>📍 ${esc(poll.location)}</span>` : ''}
      </div>
    </header>

    ${votedSuccess ? '<div class="notice" role="status">✓ 투표가 반영되었어요! 아래에서 언제든 수정할 수 있어요.</div>' : ''}

    <div class="card">
      ${isClosed ? `<p style="margin:0 0 14px;font-size:13px;color:var(--muted)">${poll?.status === 'CONFIRMED' ? '이 약속은 이미 일정으로 확정되었습니다.' : '투표가 종료되었습니다.'}</p>` : ''}
      <form method="POST" action="/poll/${esc(safeToken)}/vote">
        ${!isClosed ? `<label class="name-label">내 이름 <input type="text" name="voter_name" maxlength="40" required value="${esc(myVoterName)}" placeholder="예: 민수"></label>` : ''}
        ${options.map(opt => {
          const { dayLabel, timeRange } = formatOptionLabel(opt.start_time, opt.end_time);
          const list = votesByOption.get(opt.id) || [];
          const yesCount = list.filter(v => v.availability === 'yes').length;
          const maybeCount = list.filter(v => v.availability === 'maybe').length;
          const score = yesCount * 2 + maybeCount;
          const isLeading = maxScore > 0 && score === maxScore;
          const myChoice = myVotes.get(opt.id) || 'no';
          return `
            <div class="option-card ${isLeading ? 'leading' : ''}">
              <div class="option-top">
                <div>
                  <div class="option-date">${esc(dayLabel)} ${isLeading ? '⭐' : ''}</div>
                  <div class="option-time">${esc(timeRange)}</div>
                </div>
                <span class="tally">가능 ${yesCount} · 조율 ${maybeCount}</span>
              </div>
              ${list.length ? `<div class="voters">${list.map(v => `<span class="voter-chip ${v.availability === 'maybe' ? 'maybe' : ''}">${esc(v.voter_name)}${v.availability === 'maybe' ? ' (조율)' : ''}</span>`).join('')}</div>` : ''}
              ${!isClosed ? `
                <div class="choices">
                  <label class="choice"><input type="radio" name="opt_${esc(opt.id)}" value="yes" ${myChoice === 'yes' ? 'checked' : ''}><span>✓ 가능</span></label>
                  <label class="choice maybe"><input type="radio" name="opt_${esc(opt.id)}" value="maybe" ${myChoice === 'maybe' ? 'checked' : ''}><span>△ 조율 가능</span></label>
                  <label class="choice no"><input type="radio" name="opt_${esc(opt.id)}" value="no" ${myChoice === 'no' ? 'checked' : ''}><span>✕ 불가</span></label>
                </div>` : ''}
            </div>`;
        }).join('')}
        ${!isClosed ? '<button type="submit" class="submit-btn">투표 저장하기</button>' : ''}
      </form>
    </div>

    <section class="cta">
      <h2>우리 모임 일정, 링크 하나로 모아보세요</h2>
      <p>투표로 정한 약속이 공유 캘린더에 바로 등록되고, 날씨·D-Day까지 함께 확인할 수 있어요.</p>
      <a href="${esc(baseOrigin || '/')}/?try=1&ref=share">모아 캘린더 무료로 체험하기 →</a>
    </section>
  </div>
</body>
</html>`;
}
