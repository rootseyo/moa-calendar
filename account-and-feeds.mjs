import { randomBytes } from 'node:crypto';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendPasswordResetEmail({ email, resetUrl, userName = '', fetchImpl = fetch }) {
  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
  const resendFrom = String(process.env.RESEND_FROM || '모아 캘린더 <noreply@brightnetworks.kr>').trim();

  if (resendApiKey) {
    const safeName = escapeHtml(userName || '회원');
    const safeUrl = escapeHtml(resetUrl);
    const subject = '[모아 캘린더] 비밀번호 재설정 안내';
    const text = [
      `${userName || '회원'}님, 안녕하세요.`,
      '',
      '모아 캘린더 비밀번호 재설정 요청이 접수되었습니다.',
      '아래 링크를 눌러 30분 이내에 새 비밀번호를 설정해 주세요.',
      '',
      resetUrl,
      '',
      '본인이 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다.',
    ].join('\n');
    const html = `<!doctype html>
<html lang="ko">
<body style="margin:0;padding:24px;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#1f2937;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 28px;border:1px solid #e5e7eb;">
    <div style="font-size:13px;font-weight:700;letter-spacing:0.06em;color:#4f7a65;margin-bottom:8px;">MOA CALENDAR</div>
    <h1 style="margin:0 0 12px;font-size:20px;line-height:1.4;color:#111827;">비밀번호 재설정 안내</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.65;color:#4b5563;">
      ${safeName}님, 안녕하세요.<br>
      모아 캘린더 계정의 비밀번호 재설정 요청이 접수되었습니다.<br>
      아래 버튼을 눌러 <strong>30분 이내</strong>에 새 비밀번호를 설정해 주세요.
    </p>
    <div style="margin:24px 0;">
      <a href="${safeUrl}" style="display:inline-block;padding:12px 22px;background:#4f7a65;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">비밀번호 재설정하기</a>
    </div>
    <p style="margin:0 0 12px;font-size:12px;line-height:1.6;color:#6b7280;word-break:break-all;">
      버튼이 작동하지 않으면 아래 주소를 브라우저에 복사해 열어주세요:<br>
      <a href="${safeUrl}" style="color:#4f7a65;">${safeUrl}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">본인이 요청하지 않으셨다면 이 메일을 안전하게 무시하셔도 됩니다.</p>
  </div>
</body>
</html>`;

    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [email],
          subject,
          html,
          text,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.warn(`[Password Reset] Resend API error (${res.status}):`, errBody.slice(0, 300));
        return { dispatched: false, provider: 'resend', status: res.status };
      }
      const data = await res.json().catch(() => ({}));
      return { dispatched: true, provider: 'resend', id: data?.id || null };
    } catch (err) {
      console.warn('[Password Reset] Resend dispatch failed:', err.message);
      return { dispatched: false, provider: 'resend' };
    }
  }

  const webhookUrl = String(process.env.PASSWORD_RESET_WEBHOOK_URL || '').trim();
  if (webhookUrl) {
    try {
      const res = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'password_reset',
          email,
          resetUrl,
          expiresInMinutes: 30,
        }),
        signal: AbortSignal.timeout(8000),
      });
      return { dispatched: res.ok, provider: 'webhook', status: res.status };
    } catch (err) {
      console.warn('[Password Reset] Webhook dispatch failed:', err.message);
      return { dispatched: false, provider: 'webhook' };
    }
  }

  return { dispatched: false, provider: 'none' };
}

export async function requestPasswordReset({ one, run, hash, origin, email, fetchImpl = fetch }) {
  const account = await one(
    "SELECT a.user_id, u.name, u.status FROM local_accounts a JOIN users u ON u.id = a.user_id WHERE a.email = $1",
    email
  );
  if (!account || account.status !== 'ACTIVE') {
    return { issued: false };
  }

  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hash(rawToken);
  const expires = Date.now() + 30 * 60_000; // 30 minutes

  await run('DELETE FROM password_reset_tokens WHERE user_id = $1 OR expires < $2', account.user_id, Date.now());
  await run(
    'INSERT INTO password_reset_tokens(token_hash, user_id, expires) VALUES($1, $2, $3)',
    tokenHash,
    account.user_id,
    expires
  );

  const resetUrl = `${origin}/?reset_token=${encodeURIComponent(rawToken)}`;
  const delivery = await sendPasswordResetEmail({
    email,
    resetUrl,
    userName: account.name || '',
    fetchImpl,
  });
  return { issued: true, dispatched: delivery.dispatched, provider: delivery.provider, rawToken, resetUrl };
}

export async function completePasswordReset({ transaction, hash, hashPassword, token, password }) {
  const tokenHash = hash(String(token || '').trim());
  const newHash = await hashPassword(password);

  return transaction(async client => {
    const row = (await client.query(
      'SELECT user_id, expires, used_at FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE',
      [tokenHash]
    )).rows[0];

    if (!row || row.used_at || Number(row.expires) <= Date.now()) {
      const err = new Error('유효하지 않거나 만료된 재설정 링크입니다. 다시 요청해 주세요.');
      err.status = 400;
      throw err;
    }

    await client.query(
      'UPDATE local_accounts SET password_hash = $1 WHERE user_id = $2',
      [newHash, row.user_id]
    );
    await client.query(
      'UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1',
      [tokenHash]
    );
    // Invalidate all existing sessions after password change
    await client.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
    return { userId: row.user_id };
  });
}

export async function deleteUserAccount({ transaction, clients, broadcast, userId }) {
  const affectedCalendars = new Set();

  await transaction(async client => {
    const ownedCalendars = (await client.query(
      'SELECT id FROM calendars WHERE owner = $1 FOR UPDATE',
      [userId]
    )).rows;

    for (const cal of ownedCalendars) {
      // Find another member (prefer editor) to transfer ownership; if none, delete the calendar
      const successor = (await client.query(
        "SELECT user_id FROM members WHERE calendar_id = $1 AND user_id != $2 ORDER BY CASE role WHEN 'editor' THEN 0 ELSE 1 END, user_id LIMIT 1",
        [cal.id, userId]
      )).rows[0];

      if (successor) {
        await client.query('UPDATE calendars SET owner = $1, updated_at = now() WHERE id = $2', [successor.user_id, cal.id]);
        await client.query('DELETE FROM members WHERE calendar_id = $1 AND user_id = $2', [cal.id, userId]);
        await client.query("UPDATE members SET role = 'owner' WHERE calendar_id = $1 AND user_id = $2", [cal.id, successor.user_id]);
        affectedCalendars.add(cal.id);
      } else {
        await client.query('DELETE FROM calendars WHERE id = $1', [cal.id]);
      }
    }

    // Also collect non-owned calendars user was a member of for presence refresh
    const memberships = (await client.query('SELECT calendar_id FROM members WHERE user_id = $1', [userId])).rows;
    for (const m of memberships) affectedCalendars.add(m.calendar_id);

    await client.query('DELETE FROM users WHERE id = $1', [userId]);
  });

  if (clients) {
    for (const [cid, c] of clients.entries()) {
      if (c.user?.id === userId) {
        clients.delete(cid);
        try {
          c.res.write('event: session-ended\ndata: {}\n\n');
          c.res.end();
        } catch {}
      }
    }
  }
  if (broadcast) {
    for (const calId of affectedCalendars) {
      broadcast(calId, 'presence');
      broadcast(calId, 'members');
    }
  }
  return { ok: true, affectedCalendars: [...affectedCalendars] };
}

export function buildFeedUrls(origin, token) {
  const httpUrl = `${origin}/ical/${encodeURIComponent(token)}.ics`;
  const webcalUrl = httpUrl.replace(/^https?:\/\//i, 'webcal://');
  return { url: httpUrl, webcalUrl, token };
}

export async function getCalendarIcalFeed({ one, origin, calendarId }) {
  const row = await one('SELECT token, updated_at FROM calendar_ical_feeds WHERE calendar_id = $1', calendarId).catch(() => null);
  if (!row) return { url: null, webcalUrl: null };
  return { ...buildFeedUrls(origin, row.token), updated_at: row.updated_at };
}

export async function rotateCalendarIcalFeed({ run, origin, calendarId, userId }) {
  const token = randomBytes(24).toString('base64url');
  await run(
    `INSERT INTO calendar_ical_feeds(calendar_id, token, created_by, updated_at)
     VALUES($1, $2, $3, now())
     ON CONFLICT(calendar_id) DO UPDATE SET token = excluded.token, created_by = excluded.created_by, updated_at = now()`,
    calendarId,
    token,
    userId
  );
  return buildFeedUrls(origin, token);
}

export async function revokeCalendarIcalFeed({ run, calendarId }) {
  await run('DELETE FROM calendar_ical_feeds WHERE calendar_id = $1', calendarId);
  return { ok: true };
}

export async function loadCalendarEventsByFeedToken({ one, all, token }) {
  const feed = await one(
    `SELECT f.calendar_id, c.name AS calendar_name
     FROM calendar_ical_feeds f
     JOIN calendars c ON c.id = f.calendar_id
     WHERE f.token = $1 AND c.status = 'ACTIVE'`,
    token
  );
  if (!feed) return null;
  const events = await all(
    `SELECT id, title, start, "end", all_day, category, notes, location
     FROM events
     WHERE calendar_id = $1 AND (is_cancelled IS NOT TRUE)
     ORDER BY start ASC`,
    feed.calendar_id
  );
  return { calendarName: feed.calendar_name, events };
}
