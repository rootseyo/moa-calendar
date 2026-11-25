import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { repeatEventRanges } from '../public/event-utils.js';
import { hashPassword, verifyPassword } from '../local-auth.mjs';
import {
  sendPasswordResetEmail,
  requestPasswordReset,
  completePasswordReset,
  deleteUserAccount,
  getCalendarIcalFeed,
  rotateCalendarIcalFeed,
  revokeCalendarIcalFeed,
  loadCalendarEventsByFeedToken,
} from '../account-and-feeds.mjs';
import { formatIcsCalendar } from '../ical.mjs';
import { translateSource } from '../public/translations.js';
import { execFileSync } from 'node:child_process';

const hash = x => createHash('sha256').update(x).digest('hex');

test('repeatEventRanges supports weekdays (Mon-Fri), biweekly, and monthly_last patterns', () => {
  // 1. Weekdays starting Friday 2026-11-27 -> Fri, Mon, Tue, Wed, Thu (skips Sat 28 & Sun 29)
  const weekdays = repeatEventRanges('2026-11-27T09:00', '2026-11-27T09:30', { frequency: 'weekdays', count: 5 });
  assert.deepEqual(
    weekdays.map(r => r.start),
    ['2026-11-27T09:00', '2026-11-30T09:00', '2026-12-01T09:00', '2026-12-02T09:00', '2026-12-03T09:00']
  );

  // 2. Biweekly (every 14 days)
  const biweekly = repeatEventRanges('2026-11-24T14:00', '2026-11-24T15:00', { frequency: 'biweekly', count: 3 });
  assert.deepEqual(
    biweekly.map(r => r.start),
    ['2026-11-24T14:00', '2026-12-08T14:00', '2026-12-22T14:00']
  );

  // 3. Monthly last day across 31-day, 28-day, 29-day (leap year 2028) months
  const lastDays = repeatEventRanges('2028-01-15T18:00', '2028-01-15T19:00', { frequency: 'monthly_last', count: 4 });
  assert.deepEqual(
    lastDays.map(r => r.start),
    ['2028-01-31T18:00', '2028-02-29T18:00', '2028-03-31T18:00', '2028-04-30T18:00']
  );
});

test('Phase 4 full PostgreSQL lifecycle (PGlite): migrations 001..033, password reset, account deletion, WebCal .ics feed, and series_id', async () => {
  const pg = new PGlite();
  try {
    const dbDir = new URL('../db/', import.meta.url);
    const files = readdirSync(dbDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      await pg.exec(readFileSync(new URL(file, dbDir), 'utf8'));
    }

    const one = async (sql, ...params) => (await pg.query(sql, params)).rows[0];
    const all = async (sql, ...params) => (await pg.query(sql, params)).rows;
    const run = async (sql, ...params) => pg.query(sql, params);
    const transaction = async fn => {
      await pg.query('BEGIN');
      try { const res = await fn({ query: (s, p = []) => pg.query(s, p) }); await pg.query('COMMIT'); return res; }
      catch (err) { await pg.query('ROLLBACK'); throw err; }
    };

    // 1. Email user + password reset flow
    const oldHash = await hashPassword('OldPassword1234!');
    await pg.query('INSERT INTO users(id, name) VALUES($1, $2)', ['email:u1', '민수']);
    await pg.query('INSERT INTO local_accounts(user_id, email, password_hash, terms_accepted_at) VALUES($1, $2, $3, now())', ['email:u1', 'minsu@example.com', oldHash]);
    await pg.query('INSERT INTO sessions(token, user_id, expires) VALUES($1, $2, $3)', ['sess-1', 'email:u1', Date.now() + 3600_000]);

    const reqRes = await requestPasswordReset({ one, run, hash, origin: 'https://dwm.brightnetworks.kr', email: 'minsu@example.com' });
    assert.equal(reqRes.issued, true);
    assert.ok(reqRes.rawToken);

    await completePasswordReset({ transaction, hash, hashPassword, token: reqRes.rawToken, password: 'NewPassword5678!' });
    const updatedAcc = await one('SELECT password_hash FROM local_accounts WHERE user_id=$1', 'email:u1');
    assert.equal(await verifyPassword('NewPassword5678!', updatedAcc.password_hash), true);
    assert.equal(await verifyPassword('OldPassword1234!', updatedAcc.password_hash), false);
    // Sessions must be revoked after password reset
    assert.equal((await all('SELECT token FROM sessions WHERE user_id=$1', 'email:u1')).length, 0);
    // Reusing the same token must fail
    await assert.rejects(() => completePasswordReset({ transaction, hash, hashPassword, token: reqRes.rawToken, password: 'AnotherPassword9!' }));

    // 2. WebCal (.ics) subscription feed lifecycle
    await pg.query('INSERT INTO calendars(id, name, owner, slug) VALUES($1, $2, $3, $4)', ['cal-1', '우리 가족', 'email:u1', 'family-1']);
    await pg.query('INSERT INTO members(calendar_id, user_id, role) VALUES($1, $2, $3)', ['cal-1', 'email:u1', 'owner']);
    await pg.query(
      'INSERT INTO events(id,calendar_id,title,start,"end",all_day,color,category,notes,location,is_todo,completed,reminder_enabled,reminder_minutes,is_dday,is_cancelled,series_id,recurrence_rule) VALUES($1,$2,$3,$4,$5,false,$6,$7,$8,$9,false,false,false,10,false,false,$10,$11::jsonb)',
      ['ev-s1', 'cal-1', '매주 회의', '2026-11-24T10:00', '2026-11-24T11:00', 'blue', '업무', '', '본사', 'series-1', JSON.stringify({ frequency: 'weekly', count: 2 })]
    );

    const beforeFeed = await getCalendarIcalFeed({ one, origin: 'https://dwm.brightnetworks.kr', calendarId: 'cal-1' });
    assert.equal(beforeFeed.url, null);

    const feed = await rotateCalendarIcalFeed({ run, origin: 'https://dwm.brightnetworks.kr', calendarId: 'cal-1', userId: 'email:u1' });
    assert.match(feed.url, /^https:\/\/dwm\.brightnetworks\.kr\/ical\/.+\.ics$/);
    assert.match(feed.webcalUrl, /^webcal:\/\/dwm\.brightnetworks\.kr\/ical\/.+\.ics$/);

    const feedData = await loadCalendarEventsByFeedToken({ one, all, token: feed.token });
    assert.equal(feedData.calendarName, '우리 가족');
    assert.equal(feedData.events.length, 1);
    const ics = formatIcsCalendar({ name: feedData.calendarName, events: feedData.events });
    assert.match(ics, /SUMMARY:매주 회의/);
    assert.match(ics, /LOCATION:본사/);

    await revokeCalendarIcalFeed({ run, calendarId: 'cal-1' });
    assert.equal(await loadCalendarEventsByFeedToken({ one, all, token: feed.token }), null);

    // 3. Account deletion transfers shared calendar ownership to editor & deletes solo calendar
    await pg.query('INSERT INTO users(id, name) VALUES($1, $2)', ['email:u2', '서연']);
    await pg.query('INSERT INTO members(calendar_id, user_id, role) VALUES($1, $2, $3)', ['cal-1', 'email:u2', 'editor']);
    await pg.query('INSERT INTO calendars(id, name, owner, slug) VALUES($1, $2, $3, $4)', ['cal-solo', '개인 일기', 'email:u1', 'solo-1']);
    await pg.query('INSERT INTO members(calendar_id, user_id, role) VALUES($1, $2, $3)', ['cal-solo', 'email:u1', 'owner']);

    await deleteUserAccount({ transaction, userId: 'email:u1' });
    assert.equal(await one('SELECT id FROM users WHERE id=$1', 'email:u1'), undefined);
    assert.equal(await one('SELECT id FROM calendars WHERE id=$1', 'cal-solo'), undefined);
    const transferred = await one('SELECT owner FROM calendars WHERE id=$1', 'cal-1');
    assert.equal(transferred.owner, 'email:u2');
    const newOwnerRole = await one('SELECT role FROM members WHERE calendar_id=$1 AND user_id=$2', 'cal-1', 'email:u2');
    assert.equal(newOwnerRole.role, 'owner');
  } finally {
    await pg.close();
  }
});

test('Phase 4 UI, translations, and routes are wired consistently', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const serverMjs = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

  assert.match(html, /value="weekdays"/);
  assert.match(html, /value="biweekly"/);
  assert.match(html, /value="monthly_last"/);
  assert.match(html, /id="event-series-scope"/);
  assert.match(html, /id="delete-account-btn"/);
  assert.match(html, /id="calendar-ical-feed-section"/);
  assert.match(appJs, /handleDeleteAccount/);
  assert.match(appJs, /loadCalendarIcalFeedUI/);
  assert.match(serverMjs, /\/auth\/email\/forgot/);
  assert.match(serverMjs, /\/auth\/email\/reset/);
  assert.match(serverMjs, /icalFeedRoute/);
});

test('sendPasswordResetEmail dispatches HTML + text email via Resend API when RESEND_API_KEY is set', async () => {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.RESEND_FROM;
  process.env.RESEND_API_KEY = 're_test_12345';
  process.env.RESEND_FROM = 'Moa Calendar <noreply@brightnetworks.kr>';
  const calls = [];
  try {
    const res = await sendPasswordResetEmail({
      email: 'minsu@example.com',
      resetUrl: 'https://dwm.brightnetworks.kr/?reset_token=abc123',
      userName: '민수<script>',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 'email_999' }), { status: 200 });
      },
    });
    assert.equal(res.dispatched, true);
    assert.equal(res.provider, 'resend');
    assert.equal(res.id, 'email_999');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test_12345');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.from, 'Moa Calendar <noreply@brightnetworks.kr>');
    assert.deepEqual(body.to, ['minsu@example.com']);
    assert.match(body.subject, /비밀번호 재설정/);
    assert.match(body.html, /https:\/\/dwm\.brightnetworks\.kr\/\?reset_token=abc123/);
    assert.doesNotMatch(body.html, /<script>/);
    assert.match(body.text, /https:\/\/dwm\.brightnetworks\.kr\/\?reset_token=abc123/);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = prevFrom;
  }
});

test('translated English bundle (app.en.js) has valid JS module syntax', () => {
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const translated = translateSource(appJs);
  execFileSync(process.execPath, ['--input-type=module', '--check'], { input: translated });
});
