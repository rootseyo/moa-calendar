import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateSource, english } from '../public/translations.js';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

const origin = 'http://localhost:3198';
process.env.APP_URL = origin;
process.env.DEMO_MODE = 'true';
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('/share_schedule_db')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('/share_schedule_db', '/share_schedule_test_db');
}
process.env.GOOGLE_CLIENT_ID = 'oauth-test-client';
process.env.GOOGLE_CLIENT_SECRET = 'oauth-test-secret';
process.env.OAUTH_TOKEN_ENCRYPTION_KEY = '12'.repeat(32);

const { server, db } = await import('../server.mjs');

function invoke(path, { cookie, method = 'GET', data, source = origin } = {}) {
  const req = new Readable({
    read() {
      this.push(data ? JSON.stringify(data) : null);
      if (data) this.push(null);
    }
  });
  req.method = method;
  req.url = path;
  req.headers = { origin: source, ...(cookie ? { cookie } : {}) };
  const res = new EventEmitter();
  res.headers = {};
  res.status = 200;
  res.text = '';
  res.setHeader = (k, v) => (res.headers[k.toLowerCase()] = v);
  res.writeHead = (status, headers = {}) => {
    res.status = status;
    res.headersSent = true;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  };
  res.write = chunk => {
    res.text += chunk;
    res.emit('chunk', chunk);
    return true;
  };
  res.end = chunk => {
    if (chunk) res.write(chunk);
    res.emit('finish');
  };
  return { req, res, start: () => server.emit('request', req, res) };
}

async function request(path, options) {
  const io = invoke(path, options);
  const done = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`request ${path} timeout`)), 5000);
    io.res.once('finish', () => {
      clearTimeout(t);
      resolve({
        status: io.res.status,
        data: io.res.text ? JSON.parse(io.res.text) : null,
        location: io.res.headers.location,
        cookie: io.res.headers['set-cookie']?.split(';')[0]
      });
    });
  });
  io.start();
  return done;
}

async function login(name) {
  return (await request('/auth/demo', { method: 'POST', data: { name } })).cookie;
}

test('calendar invite UI elements and translations in calendar details', () => {
  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(indexHtml, /id="calendar-details-invites-section"/);
  assert.match(indexHtml, /id="calendar-invites-title"/);
  assert.match(indexHtml, /id="details-invite-role"/);
  assert.match(indexHtml, /id="details-make-invite-btn"/);
  assert.match(indexHtml, /id="details-invite-result"/);
  assert.match(indexHtml, /id="details-invite-url"/);
  assert.match(indexHtml, /id="details-copy-invite-btn"/);
  assert.match(indexHtml, /id="calendar-details-invites"/);

  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(appJs, /details-make-invite-btn/);
  assert.match(appJs, /details-copy-invite-btn/);
  assert.match(appJs, /data-copy-invite-url/);
  assert.match(appJs, /calendar-invite-card/);
  assert.match(appJs, /invite-signup-pill/);

  const styleCss = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(styleCss, /\.calendar-invite-create-box/);
  assert.match(styleCss, /\.calendar-invite-card/);
  assert.match(styleCss, /\.invite-signup-pill/);
  assert.match(styleCss, /\.calendar-invite-signups-box/);

  assert.equal(english['초대 링크 관리'], 'Manage invite links');
  assert.equal(english['＋ 초대 링크 만들기'], '+ Create invite link');
  assert.equal(english['가입한 사람'], 'Joined members');

  const translatedHtml = translateSource(indexHtml);
  assert.match(translatedHtml, /Manage invite links/);
});

let dbAvailable = false;
before(async () => {
  try {
    const client = await Promise.race([
      db.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
    ]);
    client.release();
    dbAvailable = true;
    await db.query('TRUNCATE users, calendars, sessions, invites, invite_signups, events, oauth, admin_actions CASCADE');
  } catch {
    console.log('⚠️ PostgreSQL test DB not reachable, skipping live DB tests.');
  }
});

after(async () => {
  if (dbAvailable) {
    try {
      await db.query('TRUNCATE users, calendars, sessions, invites, invite_signups, events, oauth, admin_actions CASCADE');
      await db.end();
    } catch {}
  }
});

test('create invite link and track members who joined per invite link', async t => {
  if (!dbAvailable) {
    if (t?.skip) t.skip('Database unavailable');
    return;
  }

  // 1. Create owner and calendar
  const ownerCookie = await login('캘린더소유자');
  const calRes = await request('/api/calendars', {
    cookie: ownerCookie,
    method: 'POST',
    data: { name: '초대 테스트 캘린더' }
  });
  assert.equal(calRes.status, 201);
  const calendarId = calRes.data.id;

  // 2. Owner creates an invite link
  const inviteRes1 = await request(`/api/calendars/${calendarId}/invites`, {
    cookie: ownerCookie,
    method: 'POST',
    data: { role: 'editor' }
  });
  assert.equal(inviteRes1.status, 200);
  assert.ok(inviteRes1.data.url);
  const inviteUrlPath = new URL(inviteRes1.data.url).pathname; // e.g. /invite/XYZ

  // 3. Details before anyone joins
  const detailsBefore = await request(`/api/calendars/${calendarId}/details`, {
    cookie: ownerCookie
  });
  assert.equal(detailsBefore.status, 200);
  assert.equal(detailsBefore.data.invites.length, 1);
  assert.equal(detailsBefore.data.invites[0].signups.length, 0);
  assert.ok(detailsBefore.data.invites[0].url);

  // 4. User 1 joins using the invite link
  const user1Cookie = await login('가입자1');
  const joinRes1 = await request(`/api${inviteUrlPath}`, {
    cookie: user1Cookie,
    method: 'POST',
    data: {}
  });
  assert.equal(joinRes1.status, 200);
  assert.equal(joinRes1.data.id, calendarId);

  // 5. User 2 joins using the same invite link
  const user2Cookie = await login('가입자2');
  const joinRes2 = await request(`/api${inviteUrlPath}`, {
    cookie: user2Cookie,
    method: 'POST',
    data: {}
  });
  assert.equal(joinRes2.status, 200);

  // 6. User 1 rejoins using the same invite link (should not duplicate)
  const rejoinRes = await request(`/api${inviteUrlPath}`, {
    cookie: user1Cookie,
    method: 'POST',
    data: {}
  });
  assert.equal(rejoinRes.status, 200);

  // 7. Owner creates a second invite link (role: viewer)
  const inviteRes2 = await request(`/api/calendars/${calendarId}/invites`, {
    cookie: ownerCookie,
    method: 'POST',
    data: { role: 'viewer' }
  });
  assert.equal(inviteRes2.status, 200);
  const inviteUrlPath2 = new URL(inviteRes2.data.url).pathname;

  // 8. User 3 joins using the second invite link
  const user3Cookie = await login('가입자3');
  const joinRes3 = await request(`/api${inviteUrlPath2}`, {
    cookie: user3Cookie,
    method: 'POST',
    data: {}
  });
  assert.equal(joinRes3.status, 200);

  // 9. Check details to verify tracking per invite link
  const detailsAfter = await request(`/api/calendars/${calendarId}/details`, {
    cookie: ownerCookie
  });
  assert.equal(detailsAfter.status, 200);
  assert.equal(detailsAfter.data.invites.length, 2);

  // Find the two invites
  const firstInvite = detailsAfter.data.invites.find(i => i.role === 'editor');
  const secondInvite = detailsAfter.data.invites.find(i => i.role === 'viewer');

  assert.ok(firstInvite);
  assert.ok(secondInvite);

  // First invite should track user1 and user2
  assert.equal(firstInvite.signups.length, 2);
  const names1 = firstInvite.signups.map(s => s.name);
  assert.ok(names1.includes('가입자1'));
  assert.ok(names1.includes('가입자2'));
  assert.ok(firstInvite.signups[0].joined_at);

  // Second invite should track user3
  assert.equal(secondInvite.signups.length, 1);
  assert.equal(secondInvite.signups[0].name, '가입자3');
  assert.ok(secondInvite.signups[0].joined_at);

  // 10. Non-owner cannot create invite link
  const forbiddenRes = await request(`/api/calendars/${calendarId}/invites`, {
    cookie: user1Cookie,
    method: 'POST',
    data: { role: 'viewer' }
  });
  assert.equal(forbiddenRes.status, 403);
});
