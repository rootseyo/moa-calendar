import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { ALLOWED_REACTION_EMOJIS, computeFreeSlots, renderPollPageHtml, recordCalendarActivity } from '../schedule-polls.mjs';

test('computeFreeSlots identifies common free blocks across overlapping calendar events', () => {
  const free = computeFreeSlots({
    dates: ['2026-11-24', '2026-11-25'],
    startHour: 9,
    endHour: 21,
    events: [
      { start: '2026-11-24T10:00', end: '2026-11-24T12:00', all_day: false, is_cancelled: false },
      { start: '2026-11-24T14:00', end: '2026-11-24T15:30', all_day: false, is_cancelled: false },
      { start: '2026-11-24T18:00', end: '2026-11-24T19:00', all_day: false, is_cancelled: true }, // cancelled ignored
      { start: '2026-11-25T00:00', end: '2026-11-26T00:00', all_day: true, is_cancelled: false },
    ],
  });

  assert.deepEqual(free['2026-11-24'], [
    { start: '09:00', end: '10:00', hours: 1 },
    { start: '12:00', end: '14:00', hours: 2 },
    { start: '16:00', end: '21:00', hours: 5 },
  ]);
  assert.deepEqual(free['2026-11-25'], []);
});

test('renderPollPageHtml renders public voting form, leading option highlight, voter chips, and escapes XSS', () => {
  const html = renderPollPageHtml({
    poll: {
      token: 'poll-tok-1',
      title: '주말 브런치 <script>alert(1)</script>',
      location: '성수동',
      status: 'OPEN',
      creator_name: '민수',
    },
    options: [
      { id: 'opt-1', start_time: '2026-11-28T11:00', end_time: '2026-11-28T13:00' },
      { id: 'opt-2', start_time: '2026-11-29T11:00', end_time: '2026-11-29T13:00' },
    ],
    votes: [
      { option_id: 'opt-1', voter_key: 'vk-1', voter_name: '서연', availability: 'yes' },
      { option_id: 'opt-1', voter_key: 'vk-2', voter_name: '지훈', availability: 'maybe' },
    ],
    voterKey: 'vk-1',
    origin: 'https://dwm.brightnetworks.kr',
    votedSuccess: true,
  });

  assert.match(html, /action="\/poll\/poll-tok-1\/vote"/);
  assert.match(html, /가능 1 · 조율 1/);
  assert.match(html, /서연/);
  assert.match(html, /지훈 \(조율\)/);
  assert.match(html, /투표가 반영되었어요/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(ALLOWED_REACTION_EMOJIS.includes('👍'));
});

test('Phase 3 DB migrations (030 & 031) execute cleanly against full PostgreSQL schema (PGlite)', async () => {
  const pg = new PGlite();
  try {
    const dbDir = new URL('../db/', import.meta.url);
    const files = readdirSync(dbDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      await pg.exec(readFileSync(new URL(file, dbDir), 'utf8'));
    }

    await pg.query('INSERT INTO users(id, name) VALUES($1, $2), ($3, $4)', ['u1', '민수', 'u2', '서연']);
    await pg.query('INSERT INTO calendars(id, name, owner, slug) VALUES($1, $2, $3, $4)', ['c1', '우리 모임', 'u1', 'our-club']);
    await pg.query('INSERT INTO members(calendar_id, user_id, role) VALUES($1, $2, $3), ($1, $4, $5)', ['c1', 'u1', 'owner', 'u2', 'editor']);
    await pg.query(
      'INSERT INTO events(id,calendar_id,title,start,"end",all_day,color,category,notes,location,is_todo,completed,reminder_enabled,reminder_minutes,is_dday,is_cancelled,created_by,updated_by) VALUES($1,$2,$3,$4,$5,false,$6,$7,$8,$9,false,false,false,10,false,false,$10,$10)',
      ['ev1', 'c1', '저녁 모임', '2026-11-28T19:00', '2026-11-28T21:00', 'sage', '약속', '', '강남역', 'u1']
    );

    // 1. RSVP upsert
    await pg.query('INSERT INTO event_rsvps(event_id, user_id, status) VALUES($1, $2, $3)', ['ev1', 'u2', 'going']);
    await pg.query('INSERT INTO event_rsvps(event_id, user_id, status) VALUES($1, $2, $3) ON CONFLICT(event_id, user_id) DO UPDATE SET status=excluded.status', ['ev1', 'u2', 'maybe']);
    const rsvp = (await pg.query('SELECT status FROM event_rsvps WHERE event_id=$1 AND user_id=$2', ['ev1', 'u2'])).rows[0];
    assert.equal(rsvp.status, 'maybe');

    // 2. Comments + soft delete
    await pg.query('INSERT INTO event_comments(id, event_id, calendar_id, user_id, body) VALUES($1,$2,$3,$4,$5)', ['cm1', 'ev1', 'c1', 'u2', '10분 늦을 것 같아요!']);
    const comments = (await pg.query('SELECT body FROM event_comments WHERE event_id=$1 AND deleted_at IS NULL', ['ev1'])).rows;
    assert.equal(comments.length, 1);

    // 3. Emoji reactions
    await pg.query('INSERT INTO event_reactions(event_id, user_id, emoji) VALUES($1,$2,$3)', ['ev1', 'u2', '👍']);
    const reactions = (await pg.query('SELECT emoji FROM event_reactions WHERE event_id=$1', ['ev1'])).rows;
    assert.equal(reactions[0].emoji, '👍');

    // 4. Activity feed helper
    const runFn = (sql, ...params) => pg.query(sql, params);
    await recordCalendarActivity(runFn, { calendarId: 'c1', eventId: 'ev1', actorId: 'u2', actorName: '서연', action: 'comment', summary: "'저녁 모임'에 댓글을 남겼어요." });
    const acts = (await pg.query('SELECT action, actor_name FROM calendar_activities WHERE calendar_id=$1', ['c1'])).rows;
    assert.equal(acts.length, 1);
    assert.equal(acts[0].action, 'comment');

    // 5. Schedule polls + options + votes + confirm
    await pg.query('INSERT INTO schedule_polls(id, calendar_id, creator_id, title, location, token) VALUES($1,$2,$3,$4,$5,$6)', ['p1', 'c1', 'u1', '송년회', '성수동', 'tok-p1']);
    await pg.query('INSERT INTO schedule_poll_options(id, poll_id, start_time, end_time) VALUES($1,$2,$3,$4), ($5,$2,$6,$7)', ['o1', 'p1', '2026-12-18T19:00', '2026-12-18T21:00', 'o2', '2026-12-19T18:00', '2026-12-19T20:00']);
    await pg.query('INSERT INTO schedule_poll_votes(id, poll_id, option_id, voter_key, voter_name, availability) VALUES($1,$2,$3,$4,$5,$6)', ['v1', 'p1', 'o1', 'guest-1', '지민', 'yes']);
    const votes = (await pg.query('SELECT voter_name, availability FROM schedule_poll_votes WHERE poll_id=$1', ['p1'])).rows;
    assert.equal(votes.length, 1);
    assert.equal(votes[0].voter_name, '지민');
  } finally {
    await pg.close();
  }
});

test('Phase 3 UI and routes are wired consistently', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const serverMjs = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

  assert.match(html, /id="event-collab-section"/);
  assert.match(html, /id="event-comment-form"/);
  assert.match(html, /id="poll-dialog"/);
  assert.match(appJs, /id="open-poll-btn"/);
  assert.match(appJs, /id="activity-feed-card"/);
  assert.match(appJs, /id="toggle-free-slots"/);
  assert.match(serverMjs, /eventCollabMatch/);
  assert.match(serverMjs, /pollVoteRoute/);
  assert.match(serverMjs, /pollConfirmMatch/);
});
