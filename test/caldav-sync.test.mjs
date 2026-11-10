import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createSyncEngine } from '../caldav-sync.mjs';
import { encryptSecret } from '../google-tokens.mjs';

// Ensure encryption key is set for tests
if (!process.env.OAUTH_TOKEN_ENCRYPTION_KEY) {
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
}

test('Sync Engine handles incremental sync, ETag changes, deletions, and two-way pushes', async () => {
  // In-memory mock database state
  const mockDb = {
    connections: [
      {
        id: 'conn-1',
        user_id: 'user-1',
        provider: 'icloud',
        account_email: 'user@apple.com',
        encrypted_credentials: encryptSecret('secret-app-pwd', 'icloud:user-1'),
        connection_status: 'connected',
        last_sync_at: null,
        last_sync_error: null,
      },
    ],
    externalCalendars: [
      {
        id: 'ec-1',
        connection_id: 'conn-1',
        calendar_id: 'dwm-cal-1',
        external_calendar_id: '/12345/calendars/home/',
        calendar_url: '', // will be set dynamically once mock server is up
        display_name: '개인',
        color: '#ef4444',
        is_enabled: true,
        is_read_only: false,
        sync_direction: 'two_way',
        sync_token: null,
        last_sync_at: null,
      },
    ],
    events: [],
    mappings: [],
  };

  // Mock DB query implementation
  const mockQuery = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.includes('FROM external_calendars ec JOIN calendar_connections cc')) {
      const ec = mockDb.externalCalendars.find(c => c.id === params[0] || c.calendar_id === params[0]);
      if (!ec) return { rows: [] };
      const cc = mockDb.connections.find(c => c.id === ec.connection_id);
      return { rows: [{ ...ec, ...cc }] };
    }

    if (s.includes('FROM external_event_mappings WHERE external_calendar_id = $1')) {
      return { rows: mockDb.mappings.filter(m => m.external_calendar_id === params[0]) };
    }

    if (s.includes('FROM external_event_mappings WHERE local_event_id = $1')) {
      return { rows: mockDb.mappings.filter(m => m.local_event_id === params[0]) };
    }

    if (s.includes('FROM events e LEFT JOIN external_event_mappings m')) {
      const mappedLocalIds = new Set(mockDb.mappings.map(m => m.local_event_id));
      return { rows: mockDb.events.filter(e => e.calendar_id === params[0] && !mappedLocalIds.has(e.id)) };
    }

    if (s.startsWith('SELECT') && s.includes('FROM events WHERE id = $1')) {
      return { rows: mockDb.events.filter(e => e.id === params[0]) };
    }

    if (s.startsWith('INSERT INTO events')) {
      const [id, calendar_id, title, start, end, color, notes, category, all_day] = params;
      assert.ok(['sage','blue','peach','lavender','coral','rose','yellow','teal','orange','cyan','indigo','slate'].includes(color),'external hex colors must be converted before inserting');
      const ev = { id, calendar_id, title, start, end, color, notes, category, all_day, version: 1 };
      mockDb.events.push(ev);
      return { rows: [ev], rowCount: 1 };
    }

    if (s.startsWith('UPDATE events SET title = $1')) {
      const [title, start, end, all_day, notes, id, calendar_id] = params;
      const ev = mockDb.events.find(e => e.id === id && e.calendar_id === calendar_id);
      if (ev) {
        Object.assign(ev, { title, start, end, all_day, notes, version: ev.version + 1 });
      }
      return { rowCount: ev ? 1 : 0 };
    }

    if (s.includes('DELETE FROM events')) {
      const idx = mockDb.events.findIndex(e => e.id === params[0]);
      if (idx !== -1) mockDb.events.splice(idx, 1);
      return { rowCount: 1 };
    }

    if (s.startsWith('INSERT INTO external_event_mappings')) {
      const [id, external_calendar_id, local_event_id, external_event_uid, external_object_url, etag] = params;
      const existing = mockDb.mappings.find(m => m.local_event_id === local_event_id);
      if (existing) {
        existing.etag = etag;
      } else {
        mockDb.mappings.push({ id, external_calendar_id, local_event_id, external_event_uid, external_object_url, etag });
      }
      return { rowCount: 1 };
    }

    if (s.startsWith('UPDATE external_event_mappings SET etag = $1')) {
      const [etag, url, id] = params;
      const m = mockDb.mappings.find(item => item.id === id);
      if (m) {
        m.etag = etag;
        m.external_object_url = url;
      }
      return { rowCount: m ? 1 : 0 };
    }

    if (s.startsWith('DELETE FROM external_event_mappings WHERE id = $1')) {
      const idx = mockDb.mappings.findIndex(m => m.id === params[0]);
      if (idx !== -1) mockDb.mappings.splice(idx, 1);
      return { rowCount: 1 };
    }

    if (s.startsWith('UPDATE external_calendars SET last_sync_at')) {
      return { rowCount: 1 };
    }

    if (s.startsWith('UPDATE calendar_connections SET last_sync_at')) {
      return { rowCount: 1 };
    }

    return { rows: [] };
  };

  const mockTransaction = async (fn) => {
    return fn({ query: mockQuery });
  };

  // Mock CalDAV HTTP Server
  let remoteEvents = [
    {
      href: '/12345/calendars/home/event-1.ics',
      etag: 'etag-v1',
      title: '첫 번째 미팅',
      start: '20261014T010000Z',
      end: '20261014T020000Z',
      uid: 'event-1',
    },
    {
      href: '/12345/calendars/home/event-2.ics',
      etag: 'etag-v1',
      title: '점심 식사',
      start: '20261014T030000Z',
      end: '20261014T040000Z',
      uid: 'event-2',
    },
  ];

  const putRequests = [];
  const deleteRequests = [];

  const server = http.createServer((req, res) => {
    if (req.method === 'REPORT') {
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
      const xmlResponses = remoteEvents.map(e => `
        <d:response>
          <d:href>${e.href}</d:href>
          <d:propstat>
            <d:prop>
              <d:getetag>"${e.etag}"</d:getetag>
              <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//Mac OS X 10.15.7//EN
BEGIN:VEVENT
UID:${e.uid}
SUMMARY:${e.title}
DTSTART:${e.start}
DTEND:${e.end}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR</c:calendar-data>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      `).join('\n');

      res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  ${xmlResponses}
</d:multistatus>`);
      return;
    }

    if (req.method === 'PUT') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        putRequests.push({ url: req.url, body, ifMatch: req.headers['if-match'], ifNoneMatch: req.headers['if-none-match'] });
        res.writeHead(201, { ETag: '"new-remote-etag"' });
        res.end();
      });
      return;
    }

    if (req.method === 'DELETE') {
      deleteRequests.push({ url: req.url, ifMatch: req.headers['if-match'] });
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  mockDb.externalCalendars[0].calendar_url = `http://127.0.0.1:${port}/12345/calendars/home/`;

  const engine = createSyncEngine({
    dbQuery: mockQuery,
    dbTransaction: mockTransaction,
    allowedHosts: ['127.0.0.1', 'localhost'],
  });

  try {
    // 1. First Sync: pulls 2 events
    const sync1 = await engine.syncExternalCalendar('ec-1');
    assert.equal(sync1.importedCount, 2);
    assert.equal(mockDb.events.length, 2);
    assert.equal(mockDb.mappings.length, 2);
    assert.equal(mockDb.events[0].title, '첫 번째 미팅');
    assert.equal(mockDb.events[0].category, 'iCloud');
    assert.equal(mockDb.events[0].color,'coral');

    // 2. Second Sync with unchanged events: 0 imported, 0 updated, 0 deleted
    const sync2 = await engine.syncExternalCalendar('ec-1');
    assert.equal(sync2.importedCount, 0);
    assert.equal(sync2.updatedCount, 0);
    assert.equal(sync2.deletedCount, 0);
    assert.equal(mockDb.events.length, 2);

    // 3. Remote update: change title and etag for event-1
    remoteEvents[0].title = '수정된 첫 번째 미팅';
    remoteEvents[0].etag = 'etag-v2';

    const sync3 = await engine.syncExternalCalendar('ec-1');
    assert.equal(sync3.updatedCount, 1);
    const ev1 = mockDb.events.find(e => e.title === '수정된 첫 번째 미팅');
    assert.ok(ev1);
    assert.equal(ev1.version, 2);

    // 4. Remote deletion: remove event-2 from remoteEvents
    remoteEvents = [remoteEvents[0]]; // only event-1 remains

    const sync4 = await engine.syncExternalCalendar('ec-1');
    assert.equal(sync4.deletedCount, 1);
    assert.equal(mockDb.events.length, 1);
    assert.equal(mockDb.mappings.length, 1);

    // 5. Two-Way Push from DWM to iCloud:
    // Create new event in DWM
    const newLocalEventId = 'local-event-999';
    mockDb.events.push({
      id: newLocalEventId,
      calendar_id: 'dwm-cal-1',
      title: 'DWM에서 생성한 일정',
      start: '2026-10-15T14:00',
      end: '2026-10-15T15:00',
      all_day: false,
      notes: '양방향 동기화 테스트',
      version: 1,
    });

    const pushRes = await engine.pushLocalEventToExternal(newLocalEventId, 'create', {
      calendarId: 'dwm-cal-1',
    });
    assert.ok(pushRes);
    assert.equal(pushRes.action, 'created');
    assert.equal(putRequests.length, 1);
    assert.ok(putRequests[0].body.includes('DWM에서 생성한 일정'));

    // Update event in DWM
    const updatedEv = mockDb.events.find(e => e.id === newLocalEventId);
    updatedEv.title = 'DWM에서 수정한 일정';
    const updateRes = await engine.pushLocalEventToExternal(newLocalEventId, 'update', {
      calendarId: 'dwm-cal-1',
      eventData: updatedEv,
    });
    assert.ok(updateRes);
    assert.equal(updateRes.action, 'updated');
    assert.equal(putRequests.length, 2);
    assert.ok(putRequests[1].body.includes('DWM에서 수정한 일정'));

    // Delete event in DWM
    const deleteRes = await engine.pushLocalEventToExternal(newLocalEventId, 'delete', {
      calendarId: 'dwm-cal-1',
    });
    assert.ok(deleteRes);
    assert.equal(deleteRes.action, 'deleted');
    assert.equal(deleteRequests.length, 1);

  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
