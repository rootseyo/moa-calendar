import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getVapidPublicKey,
  getVapidConfig,
  parseLocalEventTimeToEpoch,
  savePushSubscription,
  deletePushSubscription,
  deletePushSubscriptionsForUser,
  sendPushNotification,
  sendPushToUser,
  sendPushToCalendarMembers,
  checkAndDispatchReminders,
  notifyCalendarActivity
} from '../push-notifications.mjs';
import { handleRequest } from '../server.mjs';

test('VAPID public key and config are valid base64url strings', () => {
  const key = getVapidPublicKey();
  assert.equal(typeof key, 'string');
  assert.ok(key.length >= 64, 'VAPID public key should be at least 64 characters');

  const config = getVapidConfig();
  assert.equal(config.publicKey, key);
  assert.ok(config.privateKey, 'Private key must exist');
  assert.ok(config.subject, 'Subject must exist');
});

test('parseLocalEventTimeToEpoch converts KST wall-clock strings to UTC epoch milliseconds', () => {
  const epoch = parseLocalEventTimeToEpoch('2026-10-20T14:30');
  assert.ok(epoch, 'Epoch should not be null');
  const d = new Date(epoch);
  // 14:30 in KST (UTC+9) is 05:30 in UTC
  assert.equal(d.getUTCHours(), 5);
  assert.equal(d.getUTCMinutes(), 30);
  assert.equal(d.getUTCDate(), 20);
  assert.equal(d.getUTCMonth(), 9); // October = 9
  assert.equal(d.getUTCFullYear(), 2026);

  assert.equal(parseLocalEventTimeToEpoch(''), null);
  assert.equal(parseLocalEventTimeToEpoch('invalid-date'), null);
});

test('savePushSubscription and deletePushSubscription execute expected queries', async () => {
  const queries = [];
  const mockRun = async (sql, ...params) => {
    queries.push({ sql, params });
    return { rowCount: 1 };
  };

  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-123',
    keys: {
      p256dh: 'test-p256dh-key',
      auth: 'test-auth-secret'
    }
  };

  const saveRes = await savePushSubscription({ run: mockRun }, 'user-1', sub, 'Mozilla/5.0');
  assert.equal(saveRes.success, true);
  assert.equal(queries.length, 1);
  assert.ok(queries[0].sql.includes('INSERT INTO push_subscriptions'));
  assert.equal(queries[0].params[1], 'user-1');
  assert.equal(queries[0].params[2], sub.endpoint);
  assert.equal(queries[0].params[3], sub.keys.p256dh);
  assert.equal(queries[0].params[4], sub.keys.auth);

  const delRes = await deletePushSubscription({ run: mockRun }, sub.endpoint);
  assert.equal(delRes.success, true);
  assert.equal(queries.length, 2);
  assert.ok(queries[1].sql.includes('DELETE FROM push_subscriptions WHERE endpoint = $1'));
  assert.equal(queries[1].params[0], sub.endpoint);

  await deletePushSubscriptionsForUser({ run: mockRun }, 'user-1');
  assert.equal(queries.length, 3);
  assert.ok(queries[2].sql.includes('DELETE FROM push_subscriptions WHERE user_id = $1'));
});

test('notifyCalendarActivity formats activity messages and sends to members', async () => {
  const queries = [];
  const mockAll = async (sql, ...params) => {
    queries.push({ sql, params });
    return [
      {
        id: 'sub-1',
        user_id: 'user-2',
        endpoint: 'https://example.com/push/user2',
        p256dh: 'dummy-p256',
        auth: 'dummy-auth'
      }
    ];
  };

  const result = await notifyCalendarActivity({ all: mockAll, run: async () => {} }, {
    calendarId: 'cal-1',
    calendarName: '가족 캘린더',
    actorUserId: 'user-1',
    actorName: '철수',
    action: 'create',
    eventTitle: '생일 파티'
  });

  assert.equal(queries.length, 1);
  assert.ok(queries[0].sql.includes('WHERE m.calendar_id = $1 AND ps.user_id != $2'));
  assert.equal(queries[0].params[0], 'cal-1');
  assert.equal(queries[0].params[1], 'user-1');
});

test('checkAndDispatchReminders finds due events and records dispatch log', async () => {
  // Reference time: 2026-10-20 14:20 KST
  const refTime = parseLocalEventTimeToEpoch('2026-10-20T14:20');

  // Event starts at 14:30 KST with 10 minutes reminder -> due time is 14:20 KST!
  const mockEvents = [
    {
      id: 'event-101',
      calendar_id: 'cal-1',
      title: '프로젝트 회의',
      start: '2026-10-20T14:30',
      reminder_enabled: true,
      reminder_minutes: 10
    }
  ];

  const loggedDispatches = [];
  const mockRun = async (sql, ...params) => {
    if (sql.includes('INSERT INTO reminder_dispatch_logs')) {
      loggedDispatches.push(params);
      return { rowCount: 1 }; // First time inserting
    }
    return { rowCount: 1 };
  };

  const mockAll = async (sql, ...params) => {
    if (sql.includes('SELECT id, calendar_id, title')) {
      return mockEvents;
    }
    if (sql.includes('SELECT ps.* FROM push_subscriptions')) {
      return [
        {
          id: 'sub-1',
          user_id: 'user-1',
          endpoint: 'https://example.com/push/sub-1',
          p256dh: 'test-p256',
          auth: 'test-auth'
        }
      ];
    }
    return [];
  };

  const res = await checkAndDispatchReminders({ all: mockAll, run: mockRun }, refTime);
  assert.equal(loggedDispatches.length, 1);
  assert.equal(loggedDispatches[0][0], 'event-101');
  assert.equal(loggedDispatches[0][1], '2026-10-20T14:30_10');
});

test('GET /api/push/vapid-public-key returns the public key via handleRequest', async () => {
  let responseData = '';
  let statusCode = 0;
  const headers = {};

  const req = {
    method: 'GET',
    url: '/api/push/vapid-public-key',
    headers: { origin: 'http://localhost:3000' }
  };

  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    writeHead: (code, h) => { statusCode = code; Object.assign(headers, h); },
    statusCode: 200,
    end: data => {
      responseData = data;
    }
  };

  await handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(responseData);
  assert.ok(json.publicKey);
  assert.equal(typeof json.publicKey, 'string');
});

test('Service Worker file exists and contains push and notificationclick handlers', () => {
  const swCode = readFileSync('./public/sw.js', 'utf8');
  assert.ok(swCode.includes("addEventListener('push'"));
  assert.ok(swCode.includes("addEventListener('notificationclick'"));
  assert.ok(swCode.includes("showNotification"));
});
