import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  validateCalDavHost,
  hexToClosestDwmColor,
  extractTagContent,
  extractAllTags,
  hasXmlTag,
  discoverICloudCalendars,
  fetchCalendarEvents,
  putCalendarEvent,
  deleteCalendarEvent,
} from '../caldav.mjs';

test('SSRF host validation restricts domains and prevents internal redirection', () => {
  assert.equal(validateCalDavHost('https://caldav.icloud.com/').hostname, 'caldav.icloud.com');
  assert.equal(validateCalDavHost('https://p123-caldav.icloud.com/abc').hostname, 'p123-caldav.icloud.com');

  assert.throws(() => validateCalDavHost('https://attacker.com/caldav'));
  assert.throws(() => validateCalDavHost('http://169.254.169.254/latest/meta-data'));
  assert.throws(() => validateCalDavHost('ftp://caldav.icloud.com/'));

  // Custom allowed host for testing
  assert.equal(validateCalDavHost('http://localhost:8080/test', ['localhost']).hostname, 'localhost');
});

test('Color mapping translates Apple iCloud hex colors to nearest DWM palette color', () => {
  assert.equal(hexToClosestDwmColor('#ef4444'), 'coral');
  assert.equal(hexToClosestDwmColor('#2b7fff'), 'blue');
  assert.equal(hexToClosestDwmColor('#368a4c'), 'sage');
  assert.equal(hexToClosestDwmColor('#ea580c'), 'orange');
  assert.equal(hexToClosestDwmColor('#a855f7'), 'lavender');
  assert.equal(hexToClosestDwmColor(null), 'blue');
});

test('XML extraction handles tags with or without namespace prefixes', () => {
  const xml = `
    <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:response>
        <d:href>/user/principal/</d:href>
        <d:propstat>
          <d:prop>
            <d:displayname>내 캘린더</d:displayname>
            <c:calendar-color>#ff3b30</c:calendar-color>
            <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>
      <d:response>
        <d:href>/user/reminders/</d:href>
        <d:propstat>
          <d:prop>
            <d:displayname>미리알림</d:displayname>
            <c:supported-calendar-component-set>
              <c:comp name="VTODO"/>
            </c:supported-calendar-component-set>
            <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>
    </d:multistatus>
  `;

  assert.equal(extractTagContent(xml, 'displayname'), '내 캘린더');
  assert.equal(extractTagContent(xml, 'calendar-color'), '#ff3b30');
  assert.ok(hasXmlTag(xml, 'calendar'));

  const responses = extractAllTags(xml, 'response');
  assert.equal(responses.length, 2);
  assert.equal(extractTagContent(responses[0], 'href'), '/user/principal/');
  assert.equal(extractTagContent(responses[1], 'displayname'), '미리알림');
});

test('CalDAV end-to-end mock server flow: discovery, event fetch, put, delete', async () => {
  const reportBodies=[];
  const mockServer = http.createServer(async (req, res) => {
    if(req.method==='REPORT'){let body='';for await(const chunk of req)body+=chunk;reportBodies.push(body);}
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="CalDAV"' });
      res.end('Unauthorized');
      return;
    }

    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    if (!decoded.includes('user@apple.com:good-password')) {
      res.writeHead(401);
      res.end('Invalid credentials');
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'PROPFIND') {
      if (url.pathname === '/') {
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
        res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal>
          <d:href>/12345/principal/</d:href>
        </d:current-user-principal>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`);
        return;
      }

      if (url.pathname === '/12345/principal/') {
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
        res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/12345/principal/</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-home-set>
          <d:href>/12345/calendars/</d:href>
        </c:calendar-home-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`);
        return;
      }

      if (url.pathname === '/12345/calendars/') {
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
        res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:apple="http://apple.com/ns/ical/">
  <d:response>
    <d:href>/12345/calendars/work/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>업무</d:displayname>
        <apple:calendar-color>#ff3b30</apple:calendar-color>
        <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
        <d:current-user-privilege-set><d:privilege><d:read/><d:write/></d:privilege></d:current-user-privilege-set>
        <cs:getctag>ctag-work-1</cs:getctag>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/12345/calendars/read-only/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>공휴일</d:displayname>
        <apple:calendar-color>#007aff</apple:calendar-color>
        <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
        <d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/12345/calendars/reminders/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>미리알림</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`);
        return;
      }
    }

    if (req.method === 'REPORT' && url.pathname === '/12345/calendars/work/') {
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/12345/calendars/work/event-1.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-1"</d:getetag>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//Mac OS X 10.15.7//EN
BEGIN:VEVENT
UID:event-1
SUMMARY:주간 회의
DTSTART:20261014T010000Z
DTEND:20261014T020000Z
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`);
      return;
    }

    if (req.method === 'PUT') {
      if (req.headers['if-match'] === '"etag-stale"') {
        res.writeHead(412);
        res.end('Precondition failed');
        return;
      }
      res.writeHead(201, { ETag: '"new-etag-2"' });
      res.end();
      return;
    }

    if (req.method === 'DELETE') {
      if (url.pathname.includes('not-found')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const allowedHosts = ['127.0.0.1', 'localhost'];

  try {
    // 1. Discovery
    const discovery = await discoverICloudCalendars('user@apple.com', 'good-password', {
      serverUrl: baseUrl,
      allowedHosts,
    });

    assert.equal(discovery.accountEmail, 'user@apple.com');
    assert.equal(discovery.calendars.length, 2); // Reminders list filtered out!

    const workCal = discovery.calendars.find(c => c.displayName === '업무');
    assert.ok(workCal);
    assert.equal(workCal.isReadOnly, false);
    assert.equal(workCal.dwmColor, 'coral'); // #ff3b30
    assert.equal(workCal.ctag, 'ctag-work-1');

    const readOnlyCal = discovery.calendars.find(c => c.displayName === '공휴일');
    assert.ok(readOnlyCal);
    assert.equal(readOnlyCal.isReadOnly, true);

    // 2. Fetch Events
    const items = await fetchCalendarEvents(workCal.calendarUrl, 'user@apple.com', 'good-password', { allowedHosts });
    assert.equal(items.length, 1);
    assert.equal(items[0].etag, 'etag-1');
    assert.equal(items[0].events.length, 1);
    assert.equal(items[0].events[0].title, '주간 회의');
    assert.equal(items[0].events[0].start, '2026-10-14T10:00');

    await fetchCalendarEvents(workCal.calendarUrl, 'user@apple.com', 'good-password', {allowedHosts,expand:true,timeMin:'2026-10-01T00:00:00+09:00',timeMax:'2026-11-01T00:00:00+09:00'});
    assert.match(reportBodies.at(-1), /<c:expand start="20260930T150000Z" end="20261031T150000Z"\/>/);
    assert.match(reportBodies.at(-1), /<c:time-range start="20260930T150000Z" end="20261031T150000Z"\/>/);
    // 3. Put Event (success & conflict)
    const putRes = await putCalendarEvent(`${workCal.calendarUrl}event-2.ics`, 'ics-content', 'user@apple.com', 'good-password', {
      allowedHosts,
      isNew: true,
    });
    assert.equal(putRes.ok, true);
    assert.equal(putRes.etag, 'new-etag-2');

    // Conflict test with stale ETag
    await assert.rejects(
      async () => putCalendarEvent(`${workCal.calendarUrl}event-2.ics`, 'ics-content', 'user@apple.com', 'good-password', {
        allowedHosts,
        etag: 'etag-stale',
      }),
      err => err.status === 412 && err.isConflict === true
    );

    // 4. Delete Event
    const delRes = await deleteCalendarEvent(`${workCal.calendarUrl}event-2.ics`, 'user@apple.com', 'good-password', { allowedHosts });
    assert.equal(delRes.ok, true);

    const del404 = await deleteCalendarEvent(`${workCal.calendarUrl}not-found.ics`, 'user@apple.com', 'good-password', { allowedHosts });
    assert.equal(del404.ok, true);
    assert.equal(del404.alreadyDeleted, true);

    // 5. Auth failure
    await assert.rejects(
      async () => discoverICloudCalendars('user@apple.com', 'wrong-pass', { serverUrl: baseUrl, allowedHosts }),
      err => err.status === 401
    );

  } finally {
    await new Promise(resolve => mockServer.close(resolve));
  }
});
