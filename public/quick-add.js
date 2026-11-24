// Natural-language 1-line Quick Add parser (Korean & English) + Map URL builder

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function shiftDateKey(dateKey, offsetDays) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d + offsetDays, 12, 0, 0);
  return toDateKey(dt);
}

function addMinutes(dateKey, hour, minute, addMin) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d, hour, minute + addMin, 0);
  return `${toDateKey(dt)}T${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

function nextWeekdayDate(baseDate, targetWeekday, forceNextWeek = false) {
  const curDay = baseDate.getDay();
  let diff = targetWeekday - curDay;
  if (forceNextWeek) {
    diff = (7 - curDay) + targetWeekday;
  } else if (diff <= 0) {
    diff += 7;
  }
  return shiftDateKey(toDateKey(baseDate), diff);
}

function normalizeHour(hour, meridiem) {
  let h = Number(hour);
  if (!Number.isFinite(h) || h < 0 || h > 24) return null;
  if (meridiem) {
    const m = meridiem.toLowerCase();
    if (['오후', '저녁', '밤', 'pm', 'p.m.'].includes(m)) {
      if (h < 12) h += 12;
    } else if (['오전', '아침', '새벽', 'am', 'a.m.'].includes(m)) {
      if (h === 12) h = 0;
    }
  }
  if (h === 24) h = 0;
  return h;
}

const KO_WEEKDAYS = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
const EN_WEEKDAYS = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

export function buildMapUrls(location) {
  const q = String(location || '').trim();
  if (!q) return null;
  const encoded = encodeURIComponent(q);
  return {
    naver: `https://map.naver.com/p/search/${encoded}`,
    kakao: `https://map.kakao.com/link/search/${encoded}`,
    google: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  };
}

export function parseQuickAddInput(rawInput, { baseDate = new Date(), defaultDate = null, locale = 'ko' } = {}) {
  let text = String(rawInput || '').trim();
  if (!text) return null;

  const baseKey = toDateKey(baseDate);
  let targetDate = defaultDate && /^\d{4}-\d{2}-\d{2}$/.test(defaultDate) ? defaultDate : baseKey;
  let explicitDateFound = false;
  let allDayRequested = false;
  let isTodo = false;
  let isDday = false;
  let category = '';
  let location = '';

  // 1. Extract hashtag category (#업무, #work)
  text = text.replace(/(?:^|\s)#([^\s#@]{1,30})/g, (_, tag) => {
    if (!category) category = tag.trim();
    return ' ';
  });

  // 2. Extract @location (@강남역, @"스타벅스 강남점")
  text = text.replace(/(?:^|\s)@"([^"]{1,80})"/g, (_, loc) => {
    if (!location) location = loc.trim();
    return ' ';
  });
  text = text.replace(/(?:^|\s)@([^\s#]{1,60})/g, (_, loc) => {
    if (!location) location = loc.trim();
    return ' ';
  });

  // 3. Extract Todo / D-Day / All-day flags
  if (/(?:^|\s)(?:할\s*일|투두|todo)(?=\s|$)/i.test(text)) {
    isTodo = true;
    text = text.replace(/(?:^|\s)(?:할\s*일|투두|todo)(?=\s|$)/gi, ' ');
  }
  if (/(?:^|\s)(?:디데이|d-?day)(?=\s|$)/i.test(text)) {
    isDday = true;
    text = text.replace(/(?:^|\s)(?:디데이|d-?day)(?=\s|$)/gi, ' ');
  }
  if (/(?:^|\s)(?:하루\s*종일|종일|all[\s-]?day)(?=\s|$)/i.test(text)) {
    allDayRequested = true;
    text = text.replace(/(?:^|\s)(?:하루\s*종일|종일|all[\s-]?day)(?=\s|$)/gi, ' ');
  }

  // 4. Parse explicit ISO / slash / Korean dates
  const isoMatch = text.match(/(?:^|\s)(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?=\s|$)/);
  if (isoMatch) {
    const y = Number(isoMatch[1]), m = Number(isoMatch[2]), d = Number(isoMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      targetDate = `${y}-${pad2(m)}-${pad2(d)}`;
      explicitDateFound = true;
      text = text.replace(isoMatch[0], ' ');
    }
  }

  if (!explicitDateFound) {
    const koDateMatch = text.match(/(?:^|\s)(\d{1,2})월\s*(\d{1,2})일(?=\s|$)/);
    if (koDateMatch) {
      const m = Number(koDateMatch[1]), d = Number(koDateMatch[2]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        let y = baseDate.getFullYear();
        const candidate = `${y}-${pad2(m)}-${pad2(d)}`;
        if (candidate < baseKey && m < baseDate.getMonth() + 1) y += 1;
        targetDate = `${y}-${pad2(m)}-${pad2(d)}`;
        explicitDateFound = true;
        text = text.replace(koDateMatch[0], ' ');
      }
    }
  }

  if (!explicitDateFound) {
    const slashMatch = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/);
    if (slashMatch) {
      const m = Number(slashMatch[1]), d = Number(slashMatch[2]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        let y = baseDate.getFullYear();
        const candidate = `${y}-${pad2(m)}-${pad2(d)}`;
        if (candidate < baseKey && m < baseDate.getMonth() + 1) y += 1;
        targetDate = `${y}-${pad2(m)}-${pad2(d)}`;
        explicitDateFound = true;
        text = text.replace(slashMatch[0], ' ');
      }
    }
  }

  // 5. Parse relative Korean/English date keywords
  if (!explicitDateFound) {
    const relMap = [
      { re: /(?:^|\s)(?:오늘|today)(?=\s|$)/i, offset: 0 },
      { re: /(?:^|\s)(?:내일|tomorrow)(?=\s|$)/i, offset: 1 },
      { re: /(?:^|\s)모레(?=\s|$)/, offset: 2 },
      { re: /(?:^|\s)글피(?=\s|$)/, offset: 3 },
    ];
    for (const item of relMap) {
      if (item.re.test(text)) {
        targetDate = shiftDateKey(baseKey, item.offset);
        explicitDateFound = true;
        text = text.replace(item.re, ' ');
        break;
      }
    }
  }

  // 6. Parse Korean/English weekday expressions
  if (!explicitDateFound) {
    const koWeekMatch = text.match(/(?:^|\s)(다음\s*주|이번\s*주)?\s*([일월화수목금토])요일(?=\s|$)/);
    if (koWeekMatch) {
      const forceNext = Boolean(koWeekMatch[1] && koWeekMatch[1].startsWith('다음'));
      const dayNum = KO_WEEKDAYS[koWeekMatch[2]];
      targetDate = nextWeekdayDate(baseDate, dayNum, forceNext);
      explicitDateFound = true;
      text = text.replace(koWeekMatch[0], ' ');
    }
  }

  if (!explicitDateFound) {
    const enWeekMatch = text.match(/(?:^|\s)(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)(?=\s|$)/i);
    if (enWeekMatch) {
      const forceNext = Boolean(enWeekMatch[1]);
      const dayNum = EN_WEEKDAYS[enWeekMatch[2].toLowerCase()];
      targetDate = nextWeekdayDate(baseDate, dayNum, forceNext);
      explicitDateFound = true;
      text = text.replace(enWeekMatch[0], ' ');
    }
  }

  // 7. Parse time range or single time
  let startTime = null; // { hour, minute }
  let endTime = null;

  // 7a. Range: "14:00~16:00", "14:00-15:30", "오후 2시~4시", "2시-4시"
  const rangeMatch = text.match(/(?:^|\s)(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)?\s*(am|pm)?\s*(?:~|-|–)\s*(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)?\s*(am|pm)?(?=\s|$)/i);
  if (rangeMatch) {
    const hasExplicitMarker = Boolean(rangeMatch[1] || rangeMatch[3] || rangeMatch[5] || rangeMatch[6] || rangeMatch[8] || rangeMatch[10] || rangeMatch[0].includes('시') || rangeMatch[0].includes(':'));
    if (hasExplicitMarker) {
      const m1 = rangeMatch[1] || rangeMatch[5] || '';
      const m2 = rangeMatch[6] || rangeMatch[10] || m1;
      const h1 = normalizeHour(rangeMatch[2], m1);
      const min1 = Number(rangeMatch[3] || rangeMatch[4] || 0);
      const h2 = normalizeHour(rangeMatch[7], m2);
      const min2 = Number(rangeMatch[8] || rangeMatch[9] || 0);
      if (h1 !== null && h2 !== null && min1 >= 0 && min1 < 60 && min2 >= 0 && min2 < 60) {
        startTime = { hour: h1, minute: min1 };
        endTime = { hour: h2, minute: min2 };
        text = text.replace(rangeMatch[0], ' ');
      }
    }
  }

  // 7b. Single Korean time: "오후 7시 30분", "저녁 7시", "아침 8시 반", "14시 30분"
  if (!startTime) {
    const koTimeMatch = text.match(/(?:^|\s)(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})시(?:\s*(?:(\d{1,2})분|(반)))?(?=\s|$)/);
    if (koTimeMatch) {
      const h = normalizeHour(koTimeMatch[2], koTimeMatch[1] || '');
      const min = koTimeMatch[4] ? 30 : Number(koTimeMatch[3] || 0);
      if (h !== null && min >= 0 && min < 60) {
        startTime = { hour: h, minute: min };
        text = text.replace(koTimeMatch[0], ' ');
      }
    }
  }

  // 7c. Single 24h or AM/PM time: "14:30", "7pm", "7:30 pm"
  if (!startTime) {
    const colonOrAmpm = text.match(/(?:^|\s)(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s|$)|(?:^|\s)(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2}):(\d{2})(?=\s|$)/i);
    if (colonOrAmpm) {
      const meridiem = colonOrAmpm[1] || colonOrAmpm[4] || colonOrAmpm[5] || '';
      const hRaw = colonOrAmpm[2] ?? colonOrAmpm[6];
      const minRaw = colonOrAmpm[3] ?? colonOrAmpm[7] ?? 0;
      const h = normalizeHour(hRaw, meridiem);
      const min = Number(minRaw);
      if (h !== null && min >= 0 && min < 60) {
        startTime = { hour: h, minute: min };
        text = text.replace(colonOrAmpm[0], ' ');
      }
    }
  }

  const title = text.replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!title) return null;

  const isAllDay = allDayRequested || !startTime;
  let start, end;
  if (isAllDay) {
    start = `${targetDate}T00:00`;
    end = `${shiftDateKey(targetDate, 1)}T00:00`;
  } else {
    start = `${targetDate}T${pad2(startTime.hour)}:${pad2(startTime.minute)}`;
    if (endTime) {
      const candidateEnd = `${targetDate}T${pad2(endTime.hour)}:${pad2(endTime.minute)}`;
      end = candidateEnd > start ? candidateEnd : addMinutes(targetDate, startTime.hour, startTime.minute, 60);
    } else {
      end = addMinutes(targetDate, startTime.hour, startTime.minute, 60);
    }
  }

  return {
    title,
    start,
    end,
    all_day: isAllDay,
    color: 'sage',
    category,
    location,
    notes: '',
    is_todo: isTodo,
    is_dday: isDday,
    is_cancelled: false,
    reminder_enabled: false,
    reminder_minutes: 10,
    locale,
  };
}
