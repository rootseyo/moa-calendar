import { EVENT_COLORS, repeatEventRanges } from './event-utils.js?v=20261125-ux-v1';

export const SANDBOX_CALENDAR_ID = 'sandbox-default';
export const SANDBOX_STORAGE_KEY = 'moa_sandbox_state_v1';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(baseDate, offsetDays) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offsetDays, 12, 0, 0);
  return formatDateKey(d);
}

export function createSandboxCalendar(locale = 'ko') {
  return {
    id: SANDBOX_CALENDAR_ID,
    name: locale === 'en' ? 'Our Shared Calendar (Demo)' : '우리의 공유 캘린더 (체험)',
    slug: 'sandbox',
    role: 'owner',
    color: 'sage',
    read_only: false,
    is_google: false,
    is_icloud: false,
  };
}

export function createDefaultSandboxData(baseDate = new Date(), locale = 'ko') {
  const en = locale === 'en';
  const today = addDays(baseDate, 0);
  const tomorrow = addDays(baseDate, 1);
  const inTwoDays = addDays(baseDate, 2);
  const inFiveDays = addDays(baseDate, 5);
  const inSixDays = addDays(baseDate, 6);
  const inSevenDays = addDays(baseDate, 7);
  const currentMonth = today.slice(0, 7);

  const events = [
    {
      id: 'sandbox-ev-1',
      calendar_id: SANDBOX_CALENDAR_ID,
      title: en ? 'Dinner together' : '함께하는 저녁 약속',
      start: `${today}T19:00`,
      end: `${today}T21:00`,
      all_day: false,
      color: 'sage',
      category: en ? 'Personal' : '약속',
      notes: en ? 'Try editing or dragging this event!' : '이 일정을 클릭해 수정하거나 다른 날짜로 드래그해 보세요!',
      is_todo: false,
      completed: false,
      is_dday: false,
      is_cancelled: false,
      reminder_enabled: false,
      reminder_minutes: 10,
      version: 1,
      user_created: false,
    },
    {
      id: 'sandbox-ev-2',
      calendar_id: SANDBOX_CALENDAR_ID,
      title: en ? 'Project catch-up' : '스터디 · 프로젝트 미팅',
      start: `${tomorrow}T14:00`,
      end: `${tomorrow}T15:30`,
      all_day: false,
      color: 'blue',
      category: en ? 'Work' : '업무',
      notes: en ? 'Share your calendar link to collaborate in real time.' : '초대 링크 하나로 팀원과 실시간으로 일정을 맞출 수 있어요.',
      is_todo: false,
      completed: false,
      is_dday: false,
      is_cancelled: false,
      reminder_enabled: false,
      reminder_minutes: 10,
      version: 1,
      user_created: false,
    },
    {
      id: 'sandbox-ev-3',
      calendar_id: SANDBOX_CALENDAR_ID,
      title: en ? 'Book weekend brunch' : '주말 브런치 예약하기',
      start: `${inTwoDays}T10:00`,
      end: `${inTwoDays}T11:00`,
      all_day: false,
      color: 'peach',
      category: en ? 'To-Do' : '할 일',
      notes: '',
      is_todo: true,
      completed: false,
      is_dday: false,
      is_cancelled: false,
      reminder_enabled: false,
      reminder_minutes: 10,
      version: 1,
      user_created: false,
    },
    {
      id: 'sandbox-ev-4',
      calendar_id: SANDBOX_CALENDAR_ID,
      title: en ? 'Trip to Jeju' : '제주 여행',
      start: `${inFiveDays}T00:00`,
      end: `${inSixDays}T00:00`,
      all_day: true,
      color: 'coral',
      category: en ? 'Travel' : '여행',
      notes: en ? 'Marked as D-Day — see the countdown widget above!' : 'D-Day로 설정된 일정은 달력 위 위젯으로 바로 카운트다운돼요.',
      is_todo: false,
      completed: false,
      is_dday: true,
      is_cancelled: false,
      reminder_enabled: false,
      reminder_minutes: 10,
      version: 1,
      user_created: false,
    },
    {
      id: 'sandbox-ev-5',
      calendar_id: SANDBOX_CALENDAR_ID,
      title: en ? 'Movie night' : '주말 영화 보기',
      start: `${inSevenDays}T20:00`,
      end: `${inSevenDays}T22:00`,
      all_day: false,
      color: 'lavender',
      category: en ? 'Personal' : '개인',
      notes: '',
      is_todo: false,
      completed: false,
      is_dday: false,
      is_cancelled: false,
      reminder_enabled: false,
      reminder_minutes: 10,
      version: 1,
      user_created: false,
    },
  ];

  const monthlyItems = [
    {
      id: 'sandbox-mi-1',
      calendar_id: SANDBOX_CALENDAR_ID,
      calendar_name: en ? 'Our Shared Calendar (Demo)' : '우리의 공유 캘린더 (체험)',
      month: currentMonth,
      title: en ? 'Plan next month trip' : '다음 달 나들이 장소 정하기',
      notes: '',
      is_todo: true,
      completed: false,
      version: 1,
    },
  ];

  return {
    events,
    monthlyItems,
    dateNotes: {},
    monthNotes: {},
  };
}

export function createSandboxStore(storage = null, baseDate = new Date(), locale = 'ko') {
  let state = null;
  if (storage) {
    try {
      const raw = storage.getItem(SANDBOX_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.events)) state = parsed;
      }
    } catch {}
  }
  if (!state) {
    state = createDefaultSandboxData(baseDate, locale);
  }

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  function nextId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getUserCreatedEvents() {
    return state.events.filter(ev => ev.user_created === true);
  }

  function clear() {
    state = createDefaultSandboxData(baseDate, locale);
    if (storage) {
      try {
        storage.removeItem(SANDBOX_STORAGE_KEY);
      } catch {}
    }
  }

  function handleApi(path, method = 'GET', data = {}) {
    const cleanPath = String(path).split('?')[0];

    // Events list
    if (/^\/api\/calendars\/[^/]+\/events$/.test(cleanPath) && method === 'GET') {
      return state.events.map(ev => ({ ...ev }));
    }

    // Create event (supports single & repeat)
    if (/^\/api\/calendars\/[^/]+\/events$/.test(cleanPath) && method === 'POST') {
      const freq = data.repeat_frequency || (Number(data.repeat_weeks) > 1 ? 'weekly' : 'none');
      const count = Number(data.repeat_count || data.repeat_weeks || 1);
      const ranges = freq && freq !== 'none' && count > 1
        ? repeatEventRanges(data.start, data.end, { frequency: freq, calendarType: data.repeat_calendar_type || 'solar', count })
        : [{ start: data.start, end: data.end }];
      const created = [];
      for (const r of ranges) {
        const item = {
          id: nextId('sandbox-ev'),
          calendar_id: SANDBOX_CALENDAR_ID,
          title: String(data.title || '').trim(),
          start: r.start,
          end: r.end,
          all_day: Boolean(data.all_day),
          color: EVENT_COLORS.includes(data.color) ? data.color : 'sage',
          category: String(data.category || '').trim(),
          location: String(data.location || '').trim().slice(0, 200),
          notes: String(data.notes || ''),
          is_todo: Boolean(data.is_todo),
          completed: Boolean(data.completed),
          is_dday: Boolean(data.is_dday),
          is_cancelled: Boolean(data.is_cancelled),
          reminder_enabled: Boolean(data.reminder_enabled),
          reminder_minutes: Number(data.reminder_minutes || 10),
          version: 1,
          user_created: true,
        };
        state.events.push(item);
        created.push(item);
      }
      persist();
      return { ok: true, id: created[0]?.id, created: created.length };
    }

    // Update event
    const eventMatch = cleanPath.match(/^\/api\/calendars\/[^/]+\/events\/([^/]+)$/);
    if (eventMatch && method === 'PUT') {
      const eventId = eventMatch[1];
      const idx = state.events.findIndex(ev => ev.id === eventId);
      if (idx === -1) throw Object.assign(new Error('일정을 찾을 수 없습니다.'), { status: 404 });
      const prev = state.events[idx];
      state.events[idx] = {
        ...prev,
        title: data.title !== undefined ? String(data.title).trim() : prev.title,
        start: data.start ?? prev.start,
        end: data.end ?? prev.end,
        all_day: data.all_day !== undefined ? Boolean(data.all_day) : prev.all_day,
        color: EVENT_COLORS.includes(data.color) ? data.color : prev.color,
        category: data.category !== undefined ? String(data.category).trim() : prev.category,
        location: data.location !== undefined ? String(data.location).trim().slice(0, 200) : (prev.location || ''),
        notes: data.notes !== undefined ? String(data.notes) : prev.notes,
        is_todo: data.is_todo !== undefined ? Boolean(data.is_todo) : prev.is_todo,
        completed: data.completed !== undefined ? Boolean(data.completed) : prev.completed,
        is_dday: data.is_dday !== undefined ? Boolean(data.is_dday) : prev.is_dday,
        is_cancelled: data.is_cancelled !== undefined ? Boolean(data.is_cancelled) : prev.is_cancelled,
        reminder_enabled: data.reminder_enabled !== undefined ? Boolean(data.reminder_enabled) : prev.reminder_enabled,
        reminder_minutes: data.reminder_minutes !== undefined ? Number(data.reminder_minutes) : prev.reminder_minutes,
        version: (prev.version || 1) + 1,
        user_created: true,
      };
      persist();
      return { ok: true, id: eventId };
    }

    // Delete event
    if (eventMatch && method === 'DELETE') {
      const eventId = eventMatch[1];
      state.events = state.events.filter(ev => ev.id !== eventId);
      persist();
      return { ok: true };
    }

    // Monthly items
    if (/^\/api\/calendars\/[^/]+\/monthly-items$/.test(cleanPath) && method === 'GET') {
      return state.monthlyItems.map(item => ({ ...item }));
    }
    if (/^\/api\/calendars\/[^/]+\/monthly-items$/.test(cleanPath) && method === 'POST') {
      const item = {
        id: nextId('sandbox-mi'),
        calendar_id: SANDBOX_CALENDAR_ID,
        calendar_name: createSandboxCalendar(locale).name,
        month: String(data.month || ''),
        title: String(data.title || '').trim(),
        notes: String(data.notes || ''),
        is_todo: Boolean(data.is_todo),
        completed: false,
        version: 1,
      };
      state.monthlyItems.push(item);
      persist();
      return item;
    }
    const monthlyMatch = cleanPath.match(/^\/api\/calendars\/[^/]+\/monthly-items\/([^/]+)$/);
    if (monthlyMatch && (method === 'PUT' || method === 'PATCH')) {
      const idx = state.monthlyItems.findIndex(item => item.id === monthlyMatch[1]);
      if (idx === -1) throw Object.assign(new Error('월간 항목을 찾을 수 없습니다.'), { status: 404 });
      const prev = state.monthlyItems[idx];
      state.monthlyItems[idx] = {
        ...prev,
        ...(data.title !== undefined ? { title: String(data.title).trim() } : {}),
        ...(data.month !== undefined ? { month: String(data.month) } : {}),
        ...(data.notes !== undefined ? { notes: String(data.notes) } : {}),
        ...(data.is_todo !== undefined ? { is_todo: Boolean(data.is_todo) } : {}),
        ...(data.completed !== undefined ? { completed: Boolean(data.completed) } : {}),
        version: (prev.version || 1) + 1,
      };
      persist();
      return { ...state.monthlyItems[idx] };
    }
    if (monthlyMatch && method === 'DELETE') {
      state.monthlyItems = state.monthlyItems.filter(item => item.id !== monthlyMatch[1]);
      persist();
      return { ok: true };
    }

    // Date notes
    if (/^\/api\/calendars\/[^/]+\/notes$/.test(cleanPath) && method === 'GET') {
      return Object.entries(state.dateNotes || {}).map(([date, entry]) =>
        typeof entry === 'string'
          ? { date, content: entry, version: 1 }
          : { date, content: entry.content || '', version: entry.version || 1 }
      );
    }
    const dateNoteMatch = cleanPath.match(/^\/api\/calendars\/[^/]+\/notes\/(\d{4}-\d{2}-\d{2})$/);
    if (dateNoteMatch && method === 'PUT') {
      const date = dateNoteMatch[1];
      const content = String(data.content || '').trim();
      const prev = state.dateNotes[date];
      const nextVersion = (typeof prev === 'object' && prev?.version ? prev.version : 0) + 1;
      if (content) state.dateNotes[date] = { date, content, version: nextVersion };
      else delete state.dateNotes[date];
      persist();
      return { date, content, version: content ? nextVersion : 0 };
    }

    // Month notes
    if (/^\/api\/calendars\/[^/]+\/month-notes$/.test(cleanPath) && method === 'GET') {
      return Object.entries(state.monthNotes || {}).map(([month, entry]) =>
        typeof entry === 'string'
          ? { month, content: entry, version: 1 }
          : { month, content: entry.content || '', version: entry.version || 1 }
      );
    }
    const monthNoteMatch = cleanPath.match(/^\/api\/calendars\/[^/]+\/month-notes\/(\d{4}-\d{2})$/);
    if (monthNoteMatch && method === 'PUT') {
      const month = monthNoteMatch[1];
      const content = String(data.content || '').trim();
      const prev = state.monthNotes[month];
      const nextVersion = (typeof prev === 'object' && prev?.version ? prev.version : 0) + 1;
      if (content) state.monthNotes[month] = { month, content, version: nextVersion };
      else delete state.monthNotes[month];
      persist();
      return { month, content, version: content ? nextVersion : 0 };
    }

    return null;
  }

  return {
    getEvents: () => state.events.map(ev => ({ ...ev })),
    getMonthlyItems: () => state.monthlyItems.map(item => ({ ...item })),
    getUserCreatedEvents,
    clear,
    handleApi,
  };
}
