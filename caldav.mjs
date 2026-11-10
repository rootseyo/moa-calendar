// CalDAV Client for Apple iCloud Calendar integration
import { parseIcs } from './ical.mjs';

export const EVENT_COLORS = [
  'sage', 'blue', 'peach', 'lavender', 'coral', 'rose',
  'yellow', 'teal', 'orange', 'cyan', 'indigo', 'slate',
];

// Actual RGB values matching public/style.css swatches
const DWM_COLOR_RGB = {
  sage: [54, 138, 76],       // #368a4c
  blue: [43, 127, 255],      // #2b7fff
  peach: [249, 115, 22],     // #f97316
  lavender: [168, 85, 247],  // #a855f7
  coral: [239, 68, 68],      // #ef4444
  rose: [236, 72, 153],      // #ec4899
  yellow: [234, 179, 8],     // #eab308
  teal: [20, 184, 166],      // #14b8a6
  orange: [234, 88, 12],     // #ea580c
  cyan: [2, 132, 199],       // #0284c7
  indigo: [99, 102, 241],    // #6366f1
  slate: [100, 116, 139],    // #64748b
};

export function hexToClosestDwmColor(hex) {
  if (!hex || typeof hex !== 'string') return 'blue';
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i);
  if (!match) return 'blue';
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);

  let bestColor = 'blue';
  let bestDist = Infinity;

  for (const [name, [cr, cg, cb]] of Object.entries(DWM_COLOR_RGB)) {
    const dist = Math.pow(r - cr, 2) + Math.pow(g - cg, 2) + Math.pow(b - cb, 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestColor = name;
    }
  }
  return bestColor;
}

// SSRF host validation
export function validateCalDavHost(rawUrl, allowedHosts = []) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('CalDAV URL은 HTTP(S) 프로토콜이어야 합니다.');
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('CalDAV 연결에는 HTTPS가 필요합니다.');
  }
  const host = parsed.hostname.toLowerCase();
  const isICloud = host === 'caldav.icloud.com' || host.endsWith('.icloud.com');
  const isAllowed = isICloud ||
    allowedHosts.includes(host) ||
    (process.env.NODE_ENV !== 'production' && (host === 'localhost' || host === '127.0.0.1'));

  if (!isAllowed) {
    throw new Error(`허용되지 않은 CalDAV 호스트입니다: ${host}`);
  }
  return parsed;
}

// Clean and extract tag contents regardless of XML namespace prefix
export function extractTagContent(xml = '', tagName) {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

export function extractAllTags(xml = '', tagName) {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>`, 'gi');
  const matches = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

export function hasXmlTag(xml = '', tagName) {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagName}(?:\\s+[^>]*)?\\/?>`, 'i');
  return re.test(xml);
}

// Basic auth header generator
function authHeader(email, password) {
  const cleanEmail = email.trim();
  const cleanPass = password.trim();
  return `Basic ${Buffer.from(`${cleanEmail}:${cleanPass}`).toString('base64')}`;
}

// Resolves relative href against base URL
function resolveHref(baseOrigin, href) {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  const origin = baseOrigin.replace(/\/+$/, '');
  const path = href.startsWith('/') ? href : `/${href}`;
  return `${origin}${path}`;
}

// iCloud redirects the public CalDAV endpoint to an account-specific host.
// Fetch's automatic redirect handling drops Authorization on cross-origin
// redirects, so follow them explicitly after validating every destination.
async function fetchCalDav(url, init, allowedHosts = []) {
  let target = url;
  for (let hop = 0; hop < 6; hop++) {
    validateCalDavHost(target, allowedHosts);
    const response = await fetch(target, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    target = new URL(location, target).href;
    // Keep CalDAV methods and request bodies intact across server redirects.
  }
  throw new Error('iCloud CalDAV 리디렉션이 너무 많습니다.');
}

/**
 * Discovers iCloud CalDAV principal, calendar-home-set, and calendars.
 */
export async function discoverICloudCalendars(email, password, options = {}) {
  const entryUrl = options.serverUrl || 'https://caldav.icloud.com';
  const allowedHosts = options.allowedHosts || [];
  validateCalDavHost(entryUrl, allowedHosts);

  const auth = authHeader(email, password);
  const headers = {
    Authorization: auth,
    'User-Agent': 'MoaCalendar/1.0 (CalDAV Sync Client)',
    Depth: '0',
    'Content-Type': 'application/xml; charset=utf-8',
    Accept: 'text/xml, application/xml',
  };

  // Step 1: Discover current-user-principal on entry point
  const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`;

  let res = await fetchCalDav(entryUrl, {
    method: 'PROPFIND',
    headers,
    body: propfindBody,
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 401) {
    throw Object.assign(new Error('Apple 계정 이메일 또는 앱 암호가 올바르지 않습니다.'), { status: 401 });
  }
  if (!res.ok && res.status !== 207) {
    throw Object.assign(new Error(`iCloud CalDAV 서버 응답 오류 (${res.status})`), { status: res.status });
  }

  // The actual host may have been redirected (e.g. pXX-caldav.icloud.com)
  const currentHostUrl = new URL(res.url);
  validateCalDavHost(currentHostUrl.href, allowedHosts);
  const partitionOrigin = currentHostUrl.origin;

  const step1Xml = await res.text();
  const principalHref = extractTagContent(step1Xml, 'current-user-principal');
  const principalPath = principalHref ? extractTagContent(principalHref, 'href') || principalHref : null;

  if (!principalPath) {
    throw new Error('iCloud 사용자 주소(principal)를 찾을 수 없습니다.');
  }

  const principalUrl = resolveHref(partitionOrigin, principalPath);
  validateCalDavHost(principalUrl, allowedHosts);

  // Step 2: Discover calendar-home-set
  const homeSetBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set/>
  </d:prop>
</d:propfind>`;

  res = await fetchCalDav(principalUrl, {
    method: 'PROPFIND',
    headers: { ...headers, Depth: '0' },
    body: homeSetBody,
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 401) {
    throw Object.assign(new Error('Apple 계정 이메일 또는 앱 암호가 올바르지 않습니다.'), { status: 401 });
  }
  if (!res.ok && res.status !== 207) {
    throw Object.assign(new Error(`iCloud 캘린더 홈셋 조회 실패 (${res.status})`), { status: res.status });
  }

  const step2Xml = await res.text();
  const homeSetProp = extractTagContent(step2Xml, 'calendar-home-set');
  const homeSetPath = homeSetProp ? extractTagContent(homeSetProp, 'href') || homeSetProp : null;

  if (!homeSetPath) {
    throw new Error('iCloud 캘린더 홈(calendar-home-set)을 찾을 수 없습니다.');
  }

  const calendarHomeSetUrl = resolveHref(partitionOrigin, homeSetPath);
  validateCalDavHost(calendarHomeSetUrl, allowedHosts);

  // Step 3: List all calendars under calendar-home-set (Depth: 1)
  const listCalendarsBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:apple="http://apple.com/ns/ical/">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <apple:calendar-color/>
    <c:calendar-color/>
    <c:supported-calendar-component-set/>
    <d:current-user-privilege-set/>
    <cs:getctag/>
    <d:sync-token/>
  </d:prop>
</d:propfind>`;

  res = await fetchCalDav(calendarHomeSetUrl, {
    method: 'PROPFIND',
    headers: { ...headers, Depth: '1' },
    body: listCalendarsBody,
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok && res.status !== 207) {
    throw Object.assign(new Error(`iCloud 캘린더 목록 조회 실패 (${res.status})`), { status: res.status });
  }

  const step3Xml = await res.text();
  const responses = extractAllTags(step3Xml, 'response');
  const calendars = [];

  for (const resp of responses) {
    const rawHref = extractTagContent(resp, 'href');
    if (!rawHref) continue;

    const resourceType = extractTagContent(resp, 'resourcetype') || '';
    const isCalendar = hasXmlTag(resourceType, 'calendar');
    if (!isCalendar) continue;

    // Filter out reminder-only collections if supported-calendar-component-set is present
    const supportedComponents = extractTagContent(resp, 'supported-calendar-component-set') || '';
    if (supportedComponents) {
      const hasVEvent = /name=["']VEVENT["']/i.test(supportedComponents) || /<comp\s+name=["']VEVENT["']/i.test(supportedComponents);
      if (!hasVEvent) continue; // Skip reminders-only list
    }

    const displayName = extractTagContent(resp, 'displayname') || 'iCloud 캘린더';
    const colorHex = extractTagContent(resp, 'calendar-color') || '#007aff';
    const dwmColor = hexToClosestDwmColor(colorHex);

    // Check read-write privilege
    const privSet = extractTagContent(resp, 'current-user-privilege-set') || '';
    const hasWrite = hasXmlTag(privSet, 'write') || hasXmlTag(privSet, 'write-content') || hasXmlTag(privSet, 'all');
    const isReadOnly = privSet ? !hasWrite : false;

    const ctag = extractTagContent(resp, 'getctag');
    const syncToken = extractTagContent(resp, 'sync-token');
    const calUrl = resolveHref(partitionOrigin, rawHref);

    calendars.push({
      externalCalendarId: rawHref,
      calendarUrl: calUrl,
      displayName,
      color: colorHex,
      dwmColor,
      isReadOnly,
      ctag,
      syncToken,
    });
  }

  return {
    accountEmail: email.trim(),
    principalUrl,
    calendarHomeSetUrl,
    partitionOrigin,
    calendars,
  };
}

/**
 * Fetches calendar events via CalDAV REPORT calendar-query.
 */
export async function fetchCalendarEvents(calendarUrl, email, password, options = {}) {
  const allowedHosts = options.allowedHosts || [];
  validateCalDavHost(calendarUrl, allowedHosts);

  const auth = authHeader(email, password);
  const timeMinIso = options.timeMin ? new Date(options.timeMin).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z' : null;
  const timeMaxIso = options.timeMax ? new Date(options.timeMax).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z' : null;

  const timeRangeFilter = (timeMinIso && timeMaxIso)
    ? `<c:time-range start="${timeMinIso}" end="${timeMaxIso}"/>`
    : '';

  if(options.expand && (!timeMinIso || !timeMaxIso))throw new Error('반복 일정 조회 기간을 지정해 주세요.');
  const calendarData = options.expand
    ? `<c:calendar-data><c:expand start="${timeMinIso}" end="${timeMaxIso}"/></c:calendar-data>`
    : '<c:calendar-data/>';
  const reportBody = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    ${calendarData}
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        ${timeRangeFilter}
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  const res = await fetchCalDav(calendarUrl, {
    method: 'REPORT',
    headers: {
      Authorization: auth,
      'User-Agent': 'MoaCalendar/1.0 (CalDAV Sync Client)',
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
      Accept: 'text/xml, application/xml',
    },
    body: reportBody,
    signal: AbortSignal.timeout(options.timeoutMs || 25000),
  });

  if (res.status === 401) {
    throw Object.assign(new Error('iCloud 인증 정보가 만료되었거나 올바르지 않습니다.'), { status: 401 });
  }
  if (!res.ok && res.status !== 207) {
    throw Object.assign(new Error(`iCloud 일정 조회 실패 (${res.status})`), { status: res.status });
  }

  const baseOrigin = new URL(res.url).origin;
  const xml = await res.text();
  const responses = extractAllTags(xml, 'response');
  const items = [];

  for (const resp of responses) {
    const rawHref = extractTagContent(resp, 'href');
    if (!rawHref) continue;

    const rawEtag = extractTagContent(resp, 'getetag');
    const etag = rawEtag ? rawEtag.replace(/^["']|["']$/g, '') : null;

    let calData = extractTagContent(resp, 'calendar-data');
    if (calData && calData.startsWith('<![CDATA[') && calData.endsWith(']]>')) {
      calData = calData.slice(9, -3);
    }

    if (!calData) continue;

    const parsedEvents = parseIcs(calData);
    const eventUrl = resolveHref(baseOrigin, rawHref);

    items.push({
      href: rawHref,
      eventUrl,
      etag,
      rawIcs: calData,
      events: parsedEvents,
    });
  }

  return items;
}

/**
 * Puts an event to CalDAV calendar.
 */
export async function putCalendarEvent(eventUrl, icsContent, email, password, options = {}) {
  const allowedHosts = options.allowedHosts || [];
  validateCalDavHost(eventUrl, allowedHosts);

  const auth = authHeader(email, password);
  const headers = {
    Authorization: auth,
    'User-Agent': 'MoaCalendar/1.0 (CalDAV Sync Client)',
    'Content-Type': 'text/calendar; charset=utf-8',
  };

  if (options.etag) {
    headers['If-Match'] = `"${options.etag}"`;
  } else if (options.isNew) {
    headers['If-None-Match'] = '*';
  }

  const res = await fetchCalDav(eventUrl, {
    method: 'PUT',
    headers,
    body: icsContent,
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 412) {
    throw Object.assign(new Error('iCloud 서버의 일정이 이미 변경되었습니다. 최신 일정을 먼저 동기화해 주세요.'), { status: 412, isConflict: true });
  }
  if (res.status === 401) {
    throw Object.assign(new Error('iCloud 인증 정보가 만료되었습니다.'), { status: 401 });
  }
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    throw Object.assign(new Error(`iCloud 일정 저장 실패 (${res.status})`), { status: res.status });
  }

  const newEtag = res.headers.get('etag')?.replace(/^["']|["']$/g, '') || null;
  return { ok: true, etag: newEtag };
}

/**
 * Deletes an event from CalDAV calendar.
 */
export async function deleteCalendarEvent(eventUrl, email, password, options = {}) {
  const allowedHosts = options.allowedHosts || [];
  validateCalDavHost(eventUrl, allowedHosts);

  const auth = authHeader(email, password);
  const headers = {
    Authorization: auth,
    'User-Agent': 'MoaCalendar/1.0 (CalDAV Sync Client)',
  };

  if (options.etag) {
    headers['If-Match'] = `"${options.etag}"`;
  }

  const res = await fetchCalDav(eventUrl, {
    method: 'DELETE',
    headers,
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 404) {
    // Already deleted on remote
    return { ok: true, alreadyDeleted: true };
  }
  if (res.status === 412) {
    throw Object.assign(new Error('iCloud 서버의 일정이 변경되어 삭제할 수 없습니다.'), { status: 412, isConflict: true });
  }
  if (!res.ok && res.status !== 204) {
    throw Object.assign(new Error(`iCloud 일정 삭제 실패 (${res.status})`), { status: res.status });
  }

  return { ok: true };
}
