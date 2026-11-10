// iCalendar (RFC 5545) parser and generator for Moa Calendar / iCloud CalDAV

export function escapeIcsText(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function unescapeIcsText(str = '') {
  return String(str)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// Fold lines according to RFC 5545 (max 75 octets per line, continuation starts with space)
export function foldIcsLine(line) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= 75) return line;

  const chunks = [];
  let currentStart = 0;
  let maxLen = 75;

  while (currentStart < buf.length) {
    let take = Math.min(maxLen, buf.length - currentStart);
    // Avoid splitting in the middle of a multi-byte UTF-8 sequence
    while (take > 0 && (buf[currentStart + take] & 0xc0) === 0x80) {
      take--;
    }
    chunks.push(buf.subarray(currentStart, currentStart + take).toString('utf8'));
    currentStart += take;
    maxLen = 74; // Account for the leading space on continuation lines
  }
  return chunks.join('\r\n ');
}

// Parse ISO 8601 duration (e.g. PT1H, P1D, PT30M) to milliseconds
export function parseIcsDuration(durationStr) {
  if (!durationStr || typeof durationStr !== 'string') return 0;
  const match = durationStr.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const weeks = Number(match[2] || 0);
  const days = Number(match[3] || 0);
  const hours = Number(match[4] || 0);
  const minutes = Number(match[5] || 0);
  const seconds = Number(match[6] || 0);
  return sign * ((((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

// Parse an iCal date or datetime string into KST local time "YYYY-MM-DDTHH:mm" and allDay flag
export function parseIcsDate(value, params = {}) {
  const isDate = params.VALUE?.toUpperCase() === 'DATE' || /^\d{8}$/.test(value.trim());
  const str = value.trim();

  if (isDate) {
    const m = str.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return {
      dateTimeStr: `${m[1]}-${m[2]}-${m[3]}T00:00`,
      allDay: true,
      rawDate: `${m[1]}-${m[2]}-${m[3]}`,
    };
  }

  // Timed value: YYYYMMDDTHHmmSS or YYYYMMDDTHHmmSSZ
  const match = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?/i);
  if (!match) return null;

  const [_, y, m, d, hh, mm, ss = '00', isUtc] = match;

  if (isUtc) {
    // UTC -> Convert to KST (+9 hours)
    const ms = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    const kst = new Date(ms + 9 * 3600 * 1000);
    return {
      dateTimeStr: kst.toISOString().slice(0, 16),
      allDay: false,
    };
  }

  const tzid = params.TZID?.replace(/^["']|["']$/g, '');
  if (tzid) {
    const tzLower = tzid.toLowerCase();
    if (tzLower === 'asia/seoul' || tzLower === 'asia/tokyo' || tzLower === 'kst' || tzLower === 'jst') {
      return {
        dateTimeStr: `${y}-${m}-${d}T${hh}:${mm}`,
        allDay: false,
      };
    }
    // Attempt timezone conversion with Intl if available
    try {
      // Find UTC timestamp corresponding to local wall-clock in tzid
      const guessUtc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tzid,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false,
      });
      const parts = formatter.formatToParts(guessUtc);
      const getP = type => Number(parts.find(p => p.type === type)?.value || 0);
      const localMs = Date.UTC(getP('year'), getP('month') - 1, getP('day'), getP('hour') % 24, getP('minute'), getP('second'));
      const offsetMs = guessUtc.getTime() - localMs;
      const actualUtcMs = guessUtc.getTime() + offsetMs;
      const kst = new Date(actualUtcMs + 9 * 3600 * 1000);
      return {
        dateTimeStr: kst.toISOString().slice(0, 16),
        allDay: false,
      };
    } catch {
      // Fallback: treat as local wall-clock time
      return {
        dateTimeStr: `${y}-${m}-${d}T${hh}:${mm}`,
        allDay: false,
      };
    }
  }

  // Floating time: treat as local time
  return {
    dateTimeStr: `${y}-${m}-${d}T${hh}:${mm}`,
    allDay: false,
  };
}

// Shift a YYYY-MM-DD string by N days
function shiftDayString(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// Shift a YYYY-MM-DDTHH:mm string by N minutes
function shiftMinuteString(dateTimeStr, minutes) {
  const [datePart, timePart] = dateTimeStr.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm + minutes));
  return dt.toISOString().slice(0, 16);
}

// Parse raw .ics string into structured VEVENT objects
export function parseIcs(icsText) {
  if (!icsText || typeof icsText !== 'string') return [];

  // 1. Unfold lines
  const unfolded = icsText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const events = [];
  let inVEvent = false;
  let currentProps = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === 'BEGIN:VEVENT') {
      inVEvent = true;
      currentProps = [];
      continue;
    }

    if (line === 'END:VEVENT') {
      if (inVEvent) {
        const ev = processVEventProps(currentProps);
        if (ev) events.push(ev);
      }
      inVEvent = false;
      continue;
    }

    if (inVEvent) {
      currentProps.push(rawLine);
    }
  }

  return events;
}

function processVEventProps(lines) {
  const propMap = new Map();

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const keyPart = line.slice(0, colonIdx);
    const valuePart = line.slice(colonIdx + 1);

    const semicolonIdx = keyPart.indexOf(';');
    let name = keyPart;
    const params = {};

    if (semicolonIdx !== -1) {
      name = keyPart.slice(0, semicolonIdx).toUpperCase();
      const rawParams = keyPart.slice(semicolonIdx + 1);
      const paramMatches = rawParams.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^;]+))/gi);
      for (const m of paramMatches) {
        params[m[1].toUpperCase()] = m[2] !== undefined ? m[2] : m[3];
      }
    } else {
      name = name.toUpperCase();
    }

    if (!propMap.has(name)) propMap.set(name, []);
    propMap.get(name).push({ params, value: valuePart });
  }

  const getProp = name => propMap.get(name)?.[0];

  const uid = getProp('UID')?.value?.trim();
  if (!uid) return null;

  const status = (getProp('STATUS')?.value || 'CONFIRMED').toUpperCase().trim();
  if (status === 'CANCELLED') {
    return { uid, status: 'CANCELLED' };
  }

  const dtstartProp = getProp('DTSTART');
  if (!dtstartProp) return null;

  const startParsed = parseIcsDate(dtstartProp.value, dtstartProp.params);
  if (!startParsed) return null;

  let { dateTimeStr: start, allDay, rawDate: rawStartDate } = startParsed;
  let end = null;

  const dtendProp = getProp('DTEND');
  const durationProp = getProp('DURATION');

  if (dtendProp) {
    const endParsed = parseIcsDate(dtendProp.value, dtendProp.params);
    if (endParsed) end = endParsed.dateTimeStr;
  } else if (durationProp) {
    const ms = parseIcsDuration(durationProp.value);
    if (ms > 0) {
      if (allDay) {
        const days = Math.max(1, Math.round(ms / (24 * 3600 * 1000)));
        end = `${shiftDayString(rawStartDate || start.slice(0, 10), days)}T00:00`;
      } else {
        const mins = Math.max(1, Math.round(ms / (60 * 1000)));
        end = shiftMinuteString(start, mins);
      }
    }
  }

  // Handle missing or invalid end time
  if (!end || end <= start) {
    if (allDay) {
      end = `${shiftDayString(rawStartDate || start.slice(0, 10), 1)}T00:00`;
    } else {
      end = shiftMinuteString(start, 60);
    }
  }

  const rawSummary = getProp('SUMMARY')?.value || '';
  const title = unescapeIcsText(rawSummary).trim().slice(0, 100) || '(제목 없음)';

  const rawDesc = getProp('DESCRIPTION')?.value || '';
  let notes = unescapeIcsText(rawDesc).trim().slice(0, 2000);

  const rawLoc = getProp('LOCATION')?.value || '';
  const location = unescapeIcsText(rawLoc).trim();
  if (location && !notes.includes(location)) {
    notes = notes ? `${notes}\n[장소] ${location}`.slice(0, 2000) : `[장소] ${location}`.slice(0, 2000);
  }

  const rrule = getProp('RRULE')?.value || null;
  const recurrenceId = getProp('RECURRENCE-ID')?.value || null;
  const sequence = Number(getProp('SEQUENCE')?.value || 0);

  return {
    uid,
    title,
    start,
    end,
    allDay,
    notes,
    location,
    status,
    rrule,
    recurrenceId,
    sequence,
  };
}

// Format a DWM event into an RFC 5545 VCALENDAR / VEVENT string
export function formatIcsEvent({
  uid,
  title,
  start,
  end,
  allDay = false,
  notes = '',
  sequence = 0,
  dtstamp,
}) {
  const stamp = dtstamp || new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  let domain = 'moa-calendar.local';
  try { if (process.env.APP_URL) domain = new URL(process.env.APP_URL).hostname || domain; } catch {}
  const cleanUid = uid || `moa-${Date.now()}-${Math.random().toString(36).slice(2)}@${domain}`;
  const cleanTitle = escapeIcsText(title || '(제목 없음)');
  const cleanNotes = escapeIcsText(notes || '');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Moa Calendar//DWM//KO',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${cleanUid}`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${sequence}`,
    'STATUS:CONFIRMED',
    `SUMMARY:${cleanTitle}`,
  ];

  if (cleanNotes) {
    lines.push(`DESCRIPTION:${cleanNotes}`);
  }

  if (allDay) {
    const sDate = start.slice(0, 10).replace(/-/g, '');
    let eDate = end.slice(0, 10).replace(/-/g, '');
    if (eDate <= sDate) {
      eDate = shiftDayString(start.slice(0, 10), 1).replace(/-/g, '');
    }
    lines.push(`DTSTART;VALUE=DATE:${sDate}`);
    lines.push(`DTEND;VALUE=DATE:${eDate}`);
  } else {
    // Convert KST (UTC+9) start & end to UTC Z format
    const startMs = Date.parse(`${start}:00+09:00`);
    const endMs = Date.parse(`${end}:00+09:00`);

    const startUtc = new Date(startMs).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const endUtc = new Date(endMs).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

    lines.push(`DTSTART:${startUtc}`);
    lines.push(`DTEND:${endUtc}`);
  }

  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
