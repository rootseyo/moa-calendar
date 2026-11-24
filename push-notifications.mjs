import webpush from 'web-push';
import { randomUUID } from 'node:crypto';

// In-memory fallback keys for environments where .env is not yet configured
let memoryKeys = null;

export function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || process.env.APP_URL || 'mailto:admin@example.com';

  if (publicKey && privateKey) {
    return { publicKey, privateKey, subject };
  }

  if (!memoryKeys) {
    memoryKeys = webpush.generateVAPIDKeys();
  }
  return {
    publicKey: memoryKeys.publicKey,
    privateKey: memoryKeys.privateKey,
    subject
  };
}

export function getVapidPublicKey() {
  return getVapidConfig().publicKey;
}

export function configureWebPush() {
  const { publicKey, privateKey, subject } = getVapidConfig();
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function savePushSubscription({ run }, userId, subscription, userAgent = '') {
  if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    throw new Error('유효한 푸시 구독 정보가 필요합니다.');
  }

  const id = randomUUID();
  const endpoint = String(subscription.endpoint).slice(0, 1000);
  const p256dh = String(subscription.keys.p256dh);
  const auth = String(subscription.keys.auth);
  const agent = String(userAgent || '').slice(0, 255);

  await run(
    `INSERT INTO push_subscriptions(id, user_id, endpoint, p256dh, auth, user_agent, updated_at)
     VALUES($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent,
       updated_at = now()`,
    id, userId, endpoint, p256dh, auth, agent
  );

  return { success: true };
}

export async function deletePushSubscription({ run }, endpoint) {
  if (!endpoint) return { success: false };
  await run('DELETE FROM push_subscriptions WHERE endpoint = $1', endpoint);
  return { success: true };
}

export async function deletePushSubscriptionsForUser({ run }, userId) {
  await run('DELETE FROM push_subscriptions WHERE user_id = $1', userId);
  return { success: true };
}

export async function sendPushNotification({ run }, subscription, payload) {
  configureWebPush();
  const pushConfig = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth
    }
  };

  const payloadString = typeof payload === 'string' ? payload : JSON.stringify({
    title: payload.title || '모아 캘린더',
    body: payload.body || '새로운 알림이 도착했어요.',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    tag: payload.tag || 'moa-calendar-notification',
    url: payload.url || '/'
  });

  try {
    await webpush.sendNotification(pushConfig, payloadString);
    return { success: true };
  } catch (err) {
    // If subscription is expired or unsubscribed, remove from DB
    if (err.statusCode === 404 || err.statusCode === 410) {
      if (run) {
        await deletePushSubscription({ run }, subscription.endpoint).catch(() => {});
      }
    }
    return { success: false, error: err.message, statusCode: err.statusCode };
  }
}

export async function sendPushToUser({ all, run }, userId, payload) {
  const subscriptions = await all('SELECT * FROM push_subscriptions WHERE user_id = $1', userId);
  if (!subscriptions || subscriptions.length === 0) return { sentCount: 0 };

  const results = await Promise.allSettled(
    subscriptions.map(sub => sendPushNotification({ run }, sub, payload))
  );

  const sentCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  return { sentCount, total: subscriptions.length };
}

export async function sendPushToCalendarMembers({ all, run }, calendarId, excludeUserId, payload) {
  const subscriptions = await all(
    `SELECT ps.* FROM push_subscriptions ps
     JOIN members m ON m.user_id = ps.user_id
     WHERE m.calendar_id = $1 AND ps.user_id != $2`,
    calendarId, excludeUserId
  );

  if (!subscriptions || subscriptions.length === 0) return { sentCount: 0 };

  const results = await Promise.allSettled(
    subscriptions.map(sub => sendPushNotification({ run }, sub, payload))
  );

  const sentCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  return { sentCount, total: subscriptions.length };
}

// Convert YYYY-MM-DDTHH:mm local wall-clock string to Unix epoch milliseconds (assumes KST / UTC+9)
export function parseLocalEventTimeToEpoch(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;
  // Format is "YYYY-MM-DDTHH:mm"
  const m = dateString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]) - 1, day = Number(m[3]);
  const hours = Number(m[4]), minutes = Number(m[5]);
  // Use Asia/Seoul (UTC+9) wall clock:
  return Date.UTC(year, month, day, hours - 9, minutes);
}

export async function checkAndDispatchReminders({ all, run }, referenceTime = Date.now()) {
  // Query events that have reminders enabled
  const upcomingEvents = await all(
    `SELECT id, calendar_id, title, start, reminder_enabled, reminder_minutes
     FROM events
     WHERE reminder_enabled = true`
  );

  if (!upcomingEvents || upcomingEvents.length === 0) return { dispatched: 0 };

  let dispatched = 0;
  for (const ev of upcomingEvents) {
    const startEpoch = parseLocalEventTimeToEpoch(ev.start);
    if (!startEpoch) continue;

    const reminderMinutes = Number(ev.reminder_minutes) || 10;
    const dueEpoch = startEpoch - (reminderMinutes * 60 * 1000);
    const timeDiff = referenceTime - dueEpoch;

    // Dispatch if due time has arrived, and it is within 15 minutes (to avoid sending stale reminders)
    if (timeDiff >= 0 && timeDiff <= 15 * 60 * 1000) {
      const dueKey = `${ev.start}_${reminderMinutes}`;
      try {
        const logResult = await run(
          `INSERT INTO reminder_dispatch_logs(event_id, due_time)
           VALUES($1, $2)
           ON CONFLICT DO NOTHING`,
          ev.id, dueKey
        );

        // If row was inserted (rowCount > 0), this reminder was not yet sent!
        if (logResult && logResult.rowCount > 0) {
          // Send push to all members of this calendar
          const subs = await all(
            `SELECT ps.* FROM push_subscriptions ps
             JOIN members m ON m.user_id = ps.user_id
             WHERE m.calendar_id = $1`,
            ev.calendar_id
          );

          if (subs && subs.length > 0) {
            const reminderText = reminderMinutes >= 1440
              ? '내일 예정된 일정이 있어요.'
              : `${reminderMinutes >= 60 ? Math.floor(reminderMinutes / 60) + '시간' : reminderMinutes + '분'} 전 알림이에요.`;

            await Promise.allSettled(
              subs.map(sub => sendPushNotification({ run }, sub, {
                title: ev.title,
                body: `${reminderText} (${ev.start.slice(11, 16)})`,
                tag: `event-${ev.id}`,
                url: `/?date=${ev.start.slice(0, 10)}`
              }))
            );
            dispatched++;
          }
        }
      } catch (err) {
        console.warn(`[Push Reminders] Error dispatching event ${ev.id}:`, err.message);
      }
    }
  }

  return { dispatched };
}

export async function notifyCalendarActivity({ all, run }, { calendarId, calendarName, actorUserId, actorName, action, eventTitle }) {
  let actionText = '일정을 변경했습니다.';
  if (action === 'create') actionText = '새 일정을 등록했습니다:';
  else if (action === 'update') actionText = '일정을 수정했습니다:';
  else if (action === 'delete') actionText = '일정을 삭제했습니다:';
  else if (action === 'comment') actionText = '일정에 댓글을 남겼습니다:';

  const body = `${actorName || '멤버'}님이 ${actionText} "${eventTitle}"`;
  const title = calendarName ? `[${calendarName}]` : '모아 캘린더';

  return sendPushToCalendarMembers({ all, run }, calendarId, actorUserId, {
    title,
    body,
    tag: `calendar-${calendarId}-activity`,
    url: '/'
  });
}

export function getKstDateAndTime(referenceTime = Date.now()) {
  const kst = new Date(referenceTime + 9 * 3600 * 1000);
  const dateStr = kst.toISOString().slice(0, 10);
  const timeStr = kst.toISOString().slice(11, 16);
  const minutesOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return { dateStr, timeStr, minutesOfDay };
}

export function buildDailyBriefingMessage({ todayEvents = [], weatherToday = null, nearestDday = null, locationName = '서울' } = {}) {
  const parts = [];
  if (todayEvents.length === 0) {
    parts.push('오늘은 등록된 일정이 없어요');
  } else {
    const first = todayEvents[0];
    const firstTime = first.all_day ? '종일' : String(first.start || '').slice(11, 16);
    const firstLabel = firstTime ? `${firstTime} ${first.title}` : first.title;
    parts.push(
      todayEvents.length === 1
        ? `오늘 일정 1건 (${firstLabel})`
        : `오늘 일정 ${todayEvents.length}건 (첫 일정 ${firstLabel})`
    );
  }

  if (weatherToday) {
    const emoji = weatherToday.emoji || '🌤️';
    const rainPart = Number(weatherToday.rainProbability) >= 30 ? ` 비 ${Math.round(weatherToday.rainProbability)}%` : '';
    const tempPart = Number.isFinite(weatherToday.tempMin) && Number.isFinite(weatherToday.tempMax)
      ? ` ${Math.round(weatherToday.tempMin)}°~${Math.round(weatherToday.tempMax)}°`
      : '';
    parts.push(`${emoji} ${locationName}${rainPart}${tempPart}`);
  }

  if (nearestDday && nearestDday.title && typeof nearestDday.diffDays === 'number') {
    const dLabel = nearestDday.diffDays === 0 ? 'D-Day' : `D-${nearestDday.diffDays}`;
    parts.push(`🚩 ${nearestDday.title} ${dLabel}`);
  }

  return {
    title: '☀️ 오늘의 모아 브리핑',
    body: parts.join(' · '),
    tag: 'moa-daily-briefing',
    url: '/',
  };
}

export async function checkAndDispatchDailyBriefings({ all, run, fetchWeather }, referenceTime = Date.now()) {
  const { dateStr: todayKst, minutesOfDay } = getKstDateAndTime(referenceTime);
  let prefs = [];
  try {
    prefs = await all(
      `SELECT user_id, briefing_time, location_name, latitude, longitude, last_sent_date
       FROM daily_briefing_preferences
       WHERE enabled = true AND (last_sent_date IS NULL OR last_sent_date < $1)
       LIMIT 100`,
      todayKst
    );
  } catch {
    return { dispatched: 0 };
  }
  if (!prefs || prefs.length === 0) return { dispatched: 0 };

  let dispatched = 0;
  for (const pref of prefs) {
    const [hh, mm] = String(pref.briefing_time || '08:00').split(':').map(Number);
    const targetMinutes = hh * 60 + mm;
    const diff = minutesOfDay - targetMinutes;
    if (diff < 0 || diff > 15) continue;

    // Atomically claim today's briefing delivery so concurrent workers / restarts never double-send
    const claim = await run(
      `UPDATE daily_briefing_preferences
       SET last_sent_date = $1, updated_at = now()
       WHERE user_id = $2 AND enabled = true AND (last_sent_date IS NULL OR last_sent_date < $1)`,
      todayKst, pref.user_id
    );
    if (!claim || !claim.rowCount) continue;

    try {
      const todayEvents = await all(
        `SELECT e.title, e.start, e.all_day
         FROM events e
         JOIN members m ON m.calendar_id = e.calendar_id
         JOIN calendars c ON c.id = e.calendar_id
         WHERE m.user_id = $1 AND c.status = 'ACTIVE'
           AND (e.is_cancelled IS NOT TRUE)
           AND e.start <= $2 AND e."end" >= $3
         ORDER BY e.all_day DESC, e.start ASC
         LIMIT 20`,
        pref.user_id, `${todayKst}T23:59:59`, `${todayKst}T00:00:00`
      );

      const ddayRows = await all(
        `SELECT e.title, e.start
         FROM events e
         JOIN members m ON m.calendar_id = e.calendar_id
         JOIN calendars c ON c.id = e.calendar_id
         WHERE m.user_id = $1 AND c.status = 'ACTIVE'
           AND (e.is_cancelled IS NOT TRUE)
           AND e.is_dday = true
           AND substr(e.start, 1, 10) >= $2
         ORDER BY e.start ASC
         LIMIT 1`,
        pref.user_id, todayKst
      );
      let nearestDday = null;
      if (ddayRows && ddayRows[0]) {
        const dDate = String(ddayRows[0].start).slice(0, 10);
        const diffDays = Math.round((Date.parse(`${dDate}T00:00:00Z`) - Date.parse(`${todayKst}T00:00:00Z`)) / 86400000);
        if (diffDays >= 0 && diffDays <= 365) {
          nearestDday = { title: ddayRows[0].title, diffDays };
        }
      }

      let weatherToday = null;
      if (typeof fetchWeather === 'function') {
        try {
          weatherToday = await fetchWeather({
            latitude: pref.latitude,
            longitude: pref.longitude,
            date: todayKst,
          });
        } catch {}
      }

      const payload = buildDailyBriefingMessage({
        todayEvents,
        weatherToday,
        nearestDday,
        locationName: pref.location_name || '서울',
      });
      const result = await sendPushToUser({ all, run }, pref.user_id, payload);
      if (result.sentCount > 0) dispatched++;
    } catch (err) {
      console.warn(`[Daily Briefing] Error dispatching for ${pref.user_id}:`, err.message);
    }
  }
  return { dispatched };
}

export function startReminderWorker(dbHelpers, intervalMs = 30000) {
  let isRunning = false;

  const timer = setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await checkAndDispatchReminders(dbHelpers);
      await checkAndDispatchDailyBriefings(dbHelpers);
    } catch (e) {
      console.warn('[Push Worker] Reminder check error:', e.message);
    } finally {
      isRunning = false;
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
