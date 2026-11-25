import { randomUUID } from 'node:crypto';
import { EVENT_COLORS } from './public/event-utils.js';
import { normalizeEmail, validEmail } from './local-auth.mjs';

export const TASK_BOARD_STATUSES = ['todo', 'in_progress', 'done'];

// Only same-origin in-app paths are allowed as message links.
export function safeMessageLink(link) {
  const s = typeof link === 'string' ? link.trim() : '';
  return /^\/[^/\\\s][^\s]{0,300}$|^\/$/.test(s) ? s : '';
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// ==========================================
// 1. Direct Messages (쪽지함)
// ==========================================

export async function getUnreadMessageCount({ one, userId }) {
  const row = await one(
    'SELECT COUNT(*)::int AS cnt FROM direct_messages WHERE recipient_id = $1 AND read_at IS NULL AND recipient_deleted_at IS NULL',
    userId
  );
  return row?.cnt || 0;
}

export async function listMessageContacts({ all, userId }) {
  // Fellow active members across active shared calendars + previous message correspondents
  const sharedRows = await all(
    `SELECT u.id, u.name, c.name AS calendar_name
     FROM members me_m
     JOIN calendars c ON c.id = me_m.calendar_id AND c.status = 'ACTIVE'
     JOIN members other_m ON other_m.calendar_id = c.id AND other_m.user_id <> $1
     JOIN users u ON u.id = other_m.user_id AND u.status = 'ACTIVE'
     WHERE me_m.user_id = $1
     ORDER BY u.name ASC, c.name ASC`,
    userId
  );

  const byId = new Map();
  for (const r of sharedRows) {
    if (!byId.has(r.id)) {
      byId.set(r.id, { id: r.id, name: r.name, calendars: [] });
    }
    const entry = byId.get(r.id);
    if (r.calendar_name && !entry.calendars.includes(r.calendar_name)) {
      entry.calendars.push(r.calendar_name);
    }
  }

  const pastCorrespondents = await all(
    `SELECT DISTINCT u.id, u.name
     FROM (
       SELECT sender_id AS peer_id FROM direct_messages WHERE recipient_id = $1 AND recipient_deleted_at IS NULL
       UNION
       SELECT recipient_id AS peer_id FROM direct_messages WHERE sender_id = $1 AND sender_deleted_at IS NULL
     ) peers
     JOIN users u ON u.id = peers.peer_id AND u.status = 'ACTIVE'
     WHERE u.id <> $1
     ORDER BY u.name ASC`,
    userId
  );
  for (const p of pastCorrespondents) {
    if (!byId.has(p.id)) {
      byId.set(p.id, { id: p.id, name: p.name, calendars: [] });
    }
  }

  return [...byId.values()];
}

export async function listDirectMessages({ all, one, userId, box = 'inbox' }) {
  const normalizedBox = box === 'sent' ? 'sent' : 'inbox';
  const rows = normalizedBox === 'sent'
    ? await all(
        `SELECT m.id, m.sender_id, m.recipient_id, m.body, m.link, m.read_at, m.created_at,
                u.name AS peer_name
         FROM direct_messages m
         JOIN users u ON u.id = m.recipient_id
         WHERE m.sender_id = $1 AND m.sender_deleted_at IS NULL
         ORDER BY m.created_at DESC
         LIMIT 100`,
        userId
      )
    : await all(
        `SELECT m.id, m.sender_id, m.recipient_id, m.body, m.link, m.read_at, m.created_at,
                u.name AS peer_name
         FROM direct_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.recipient_id = $1 AND m.recipient_deleted_at IS NULL
         ORDER BY m.created_at DESC
         LIMIT 100`,
        userId
      );

  const unreadCount = await getUnreadMessageCount({ one, userId });
  return { box: normalizedBox, unreadCount, messages: rows };
}

export async function sendDirectMessage({
  one,
  run,
  sender,
  recipientId,
  recipientEmail,
  body,
  clients,
  sendPush,
  link = '',
}) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text || text.length > 2000) {
    throw httpError(400, '쪽지 내용은 1~2,000자 이내로 입력해 주세요.');
  }

  let target = null;
  const trimmedId = typeof recipientId === 'string' ? recipientId.trim() : '';
  const trimmedEmail = typeof recipientEmail === 'string' ? normalizeEmail(recipientEmail) : '';

  if (trimmedId) {
    target = await one("SELECT id, name FROM users WHERE id = $1 AND status = 'ACTIVE'", trimmedId);
  } else if (trimmedEmail) {
    if (!validEmail(trimmedEmail)) {
      throw httpError(400, '받는 사람의 이메일 형식을 확인해 주세요.');
    }
    target = await one(
      "SELECT u.id, u.name FROM local_accounts a JOIN users u ON u.id = a.user_id WHERE a.email = $1 AND u.status = 'ACTIVE'",
      trimmedEmail
    );
  }

  if (!target) {
    throw httpError(404, '받는 사용자를 찾을 수 없습니다.');
  }
  if (target.id === sender.id) {
    throw httpError(400, '본인에게는 쪽지를 보낼 수 없습니다.');
  }

  const id = randomUUID();
  const created = await one(
    `INSERT INTO direct_messages (id, sender_id, recipient_id, body, link)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, sender_id, recipient_id, body, link, read_at, created_at`,
    id,
    sender.id,
    target.id,
    text,
    safeMessageLink(link)
  );

  // Real-time SSE notification to all open streams of the recipient
  if (clients) {
    const payload = JSON.stringify({
      id: created.id,
      senderId: sender.id,
      senderName: sender.name,
      preview: text.slice(0, 80),
      createdAt: created.created_at,
    });
    for (const c of clients.values()) {
      if (c.user?.id === target.id) {
        try {
          c.res.write(`event: inbox\ndata: ${payload}\n\n`);
        } catch {}
      }
    }
  }

  // Optional Web Push notification
  if (typeof sendPush === 'function') {
    Promise.resolve(
      sendPush(target.id, {
        title: `${sender.name}님의 새 쪽지`,
        body: text.slice(0, 90),
        tag: `moa-dm-${created.id}`,
        url: safeMessageLink(link) || '/',
      })
    ).catch(() => {});
  }

  return { ...created, peer_name: target.name };
}

export async function markDirectMessageRead({ run, one, userId, messageId }) {
  if (messageId === 'all') {
    await run(
      'UPDATE direct_messages SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL AND recipient_deleted_at IS NULL',
      userId
    );
  } else {
    if (typeof messageId !== 'string' || !messageId.trim()) {
      throw httpError(400, '쪽지 ID를 확인해 주세요.');
    }
    await run(
      'UPDATE direct_messages SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND recipient_id = $2 AND recipient_deleted_at IS NULL',
      messageId.trim(),
      userId
    );
  }
  const unreadCount = await getUnreadMessageCount({ one, userId });
  return { ok: true, unreadCount };
}

export async function deleteDirectMessage({ one, run, userId, messageId }) {
  const row = await one(
    'SELECT id, sender_id, recipient_id, sender_deleted_at, recipient_deleted_at FROM direct_messages WHERE id = $1',
    messageId
  );
  if (!row || (row.sender_id !== userId && row.recipient_id !== userId)) {
    throw httpError(404, '쪽지를 찾을 수 없습니다.');
  }

  let senderDeleted = Boolean(row.sender_deleted_at);
  let recipientDeleted = Boolean(row.recipient_deleted_at);

  if (row.sender_id === userId) {
    await run('UPDATE direct_messages SET sender_deleted_at = COALESCE(sender_deleted_at, now()) WHERE id = $1', messageId);
    senderDeleted = true;
  }
  if (row.recipient_id === userId) {
    await run('UPDATE direct_messages SET recipient_deleted_at = COALESCE(recipient_deleted_at, now()), read_at = COALESCE(read_at, now()) WHERE id = $1', messageId);
    recipientDeleted = true;
  }

  if (senderDeleted && recipientDeleted) {
    await run('DELETE FROM direct_messages WHERE id = $1', messageId);
  }
  const unreadCount = await getUnreadMessageCount({ one, userId });
  return { ok: true, unreadCount };
}

// ==========================================
// 2. Task Board Cards
// ==========================================

function validateDueDate(val) {
  if (val === undefined || val === null || val === '') return '';
  const s = String(val).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) {
    throw httpError(400, '마감일 날짜 형식을 확인해 주세요.');
  }
  return s;
}

export async function listTaskBoardCards({ all, calendarId }) {
  const cards = await all(
    `SELECT t.*,
            au.name AS assignee_name,
            cu.name AS creator_name
     FROM task_board_cards t
     LEFT JOIN users au ON au.id = t.assignee_id
     LEFT JOIN users cu ON cu.id = t.created_by
     WHERE t.calendar_id = $1
     ORDER BY CASE t.status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
              t.sort_order ASC,
              t.created_at ASC,
              t.id ASC`,
    calendarId
  );

  const members = await all(
    `SELECT u.id, u.name, m.role
     FROM members m
     JOIN users u ON u.id = m.user_id AND u.status = 'ACTIVE'
     WHERE m.calendar_id = $1
     ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.name ASC`,
    calendarId
  );

  return { cards, members };
}

export async function createTaskBoardCard({ one, calendarId, userId, payload }) {
  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
  if (!title || title.length > 120) {
    throw httpError(400, '카드 제목은 1~120자 이내로 입력해 주세요.');
  }
  const status = TASK_BOARD_STATUSES.includes(payload?.status) ? payload.status : 'todo';
  const description = typeof payload?.description === 'string' ? payload.description.trim() : '';
  if (description.length > 2000) {
    throw httpError(400, '설명은 최대 2,000자까지 입력할 수 있습니다.');
  }
  const color = EVENT_COLORS.includes(payload?.color) ? payload.color : 'sage';
  const dueDate = validateDueDate(payload?.due_date);

  let assigneeId = null;
  if (payload?.assignee_id && typeof payload.assignee_id === 'string') {
    const validMember = await one(
      'SELECT user_id FROM members WHERE calendar_id = $1 AND user_id = $2',
      calendarId,
      payload.assignee_id.trim()
    );
    if (validMember) assigneeId = validMember.user_id;
  }

  const maxRow = await one(
    'SELECT COALESCE(MAX(sort_order), -10)::int AS max_order FROM task_board_cards WHERE calendar_id = $1 AND status = $2',
    calendarId,
    status
  );
  const nextOrder = (maxRow?.max_order ?? -10) + 10;

  const id = randomUUID();
  const created = await one(
    `INSERT INTO task_board_cards
       (id, calendar_id, status, title, description, color, assignee_id, due_date, sort_order, created_by, updated_by, task_no)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10,
             (SELECT COALESCE(MAX(task_no), 0) + 1 FROM task_board_cards WHERE calendar_id = $2))
     RETURNING *`,
    id,
    calendarId,
    status,
    title,
    description,
    color,
    assigneeId,
    dueDate,
    nextOrder,
    userId
  );

  return created;
}

export async function updateTaskBoardCard({ one, calendarId, taskId, userId, payload }) {
  const existing = await one(
    'SELECT * FROM task_board_cards WHERE id = $1 AND calendar_id = $2',
    taskId,
    calendarId
  );
  if (!existing) {
    throw httpError(404, '카드를 찾을 수 없습니다.');
  }

  const title = payload?.title !== undefined ? String(payload.title || '').trim() : existing.title;
  if (!title || title.length > 120) {
    throw httpError(400, '카드 제목은 1~120자 이내로 입력해 주세요.');
  }
  const status = payload?.status !== undefined
    ? (TASK_BOARD_STATUSES.includes(payload.status) ? payload.status : null)
    : existing.status;
  if (!status) {
    throw httpError(400, '올바른 보드 상태가 아닙니다.');
  }
  const description = payload?.description !== undefined ? String(payload.description || '').trim() : existing.description;
  if (description.length > 2000) {
    throw httpError(400, '설명은 최대 2,000자까지 입력할 수 있습니다.');
  }
  const color = payload?.color !== undefined
    ? (EVENT_COLORS.includes(payload.color) ? payload.color : existing.color)
    : existing.color;
  const dueDate = payload?.due_date !== undefined ? validateDueDate(payload.due_date) : existing.due_date;

  let assigneeId = existing.assignee_id;
  if (payload?.assignee_id !== undefined) {
    if (!payload.assignee_id) {
      assigneeId = null;
    } else {
      const validMember = await one(
        'SELECT user_id FROM members WHERE calendar_id = $1 AND user_id = $2',
        calendarId,
        String(payload.assignee_id).trim()
      );
      assigneeId = validMember ? validMember.user_id : null;
    }
  }

  let sortOrder = existing.sort_order;
  if (status !== existing.status && payload?.sort_order === undefined) {
    const maxRow = await one(
      'SELECT COALESCE(MAX(sort_order), -10)::int AS max_order FROM task_board_cards WHERE calendar_id = $1 AND status = $2',
      calendarId,
      status
    );
    sortOrder = (maxRow?.max_order ?? -10) + 10;
  } else if (Number.isInteger(payload?.sort_order)) {
    sortOrder = payload.sort_order;
  }

  const updated = await one(
    `UPDATE task_board_cards
     SET title = $1,
         description = $2,
         status = $3,
         color = $4,
         assignee_id = $5,
         due_date = $6,
         sort_order = $7,
         updated_by = $8,
         updated_at = now()
     WHERE id = $9 AND calendar_id = $10
     RETURNING *`,
    title,
    description,
    status,
    color,
    assigneeId,
    dueDate,
    sortOrder,
    userId,
    taskId,
    calendarId
  );
  const eventSynced = await syncLinkedEventCompletion({ one, card: updated, previousStatus: existing.status });
  return { ...updated, event_synced: eventSynced };
}

// A card created from a calendar To Do keeps that event's completed flag in step with the board.
async function syncLinkedEventCompletion({ one, card, previousStatus }) {
  if (!card?.event_id || card.status === previousStatus) return false;
  const row = await one(
    'UPDATE events SET completed = $1, version = version + 1, updated_by = $2 WHERE id = $3 AND is_todo = true AND completed <> $1 RETURNING id',
    card.status === 'done',
    card.updated_by,
    card.event_id
  );
  return Boolean(row);
}

export async function reorderTaskBoardCards({ transaction, calendarId, userId, status, orderedIds, movedId }) {
  if (!TASK_BOARD_STATUSES.includes(status)) {
    throw httpError(400, '올바른 보드 상태가 아닙니다.');
  }
  if (!Array.isArray(orderedIds) || orderedIds.length > 500 || !orderedIds.every(id => typeof id === 'string' && id.length > 0)) {
    throw httpError(400, '카드 순서 목록을 확인해 주세요.');
  }

  let eventSynced = false;
  return transaction(async client => {
    if (movedId && typeof movedId === 'string') {
      const check = (await client.query(
        'SELECT id, event_id, status FROM task_board_cards WHERE id = $1 AND calendar_id = $2 FOR UPDATE',
        [movedId, calendarId]
      )).rows[0];
      if (!check) throw httpError(404, '이동할 카드를 찾을 수 없습니다.');
      await client.query(
        'UPDATE task_board_cards SET status = $1, updated_by = $2, updated_at = now() WHERE id = $3 AND calendar_id = $4',
        [status, userId, movedId, calendarId]
      );
      if (check.event_id && check.status !== status) {
        const r = await client.query(
          'UPDATE events SET completed = $1, version = version + 1, updated_by = $2 WHERE id = $3 AND is_todo = true AND completed <> $1',
          [status === 'done', userId, check.event_id]
        );
        eventSynced = r.rowCount > 0;
      }
    }

    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        'UPDATE task_board_cards SET status = $1, sort_order = $2 WHERE id = $3 AND calendar_id = $4',
        [status, i * 10, orderedIds[i], calendarId]
      );
    }
    return { ok: true, event_synced: eventSynced };
  });
}

export async function deleteTaskBoardCard({ run, calendarId, taskId }) {
  const res = await run('DELETE FROM task_board_cards WHERE id = $1 AND calendar_id = $2', taskId, calendarId);
  if (!res.rowCount) {
    throw httpError(404, '삭제할 카드를 찾을 수 없습니다.');
  }
  return { ok: true };
}

// ==========================================
// 3. Task keys, @mentions, calendar To Do sync
// ==========================================

export function taskKey(card) {
  return card?.task_no ? `T-${card.task_no}` : '';
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Finds "@name" mentions of calendar members. Longest names are matched first so
// "@민수진" is never read as "@민수" + "진"; trailing Korean particles ("@민수에게") still match.
export function parseMentions(text, members) {
  let rest = String(text || '');
  const found = [];
  const sorted = [...members].filter(m => m?.name).sort((a, b) => b.name.length - a.name.length);
  for (const m of sorted) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_@])@${escapeRegExp(m.name)}`, 'iu');
    let hit = false;
    while (re.test(rest)) {
      rest = rest.replace(re, (_, lead) => `${lead}\u0000`);
      hit = true;
    }
    if (hit && !found.includes(m.id)) found.push(m.id);
  }
  return found;
}

export async function applyTaskMentions({ all, one, run, calendarId, card, sender, clients, sendPush }) {
  if (!card) return card;
  const members = await all(
    `SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id AND u.status = 'ACTIVE' WHERE m.calendar_id = $1`,
    calendarId
  );
  const mentionIds = parseMentions(`${card.title}\n${card.description || ''}`, members);
  const previous = Array.isArray(card.mention_ids) ? card.mention_ids : [];
  const fresh = mentionIds.filter(id => id !== sender.id && !previous.includes(id));
  if (mentionIds.length !== previous.length || mentionIds.some(id => !previous.includes(id))) {
    await run('UPDATE task_board_cards SET mention_ids = $1::jsonb WHERE id = $2', JSON.stringify(mentionIds), card.id);
    card = { ...card, mention_ids: mentionIds };
  }
  if (!fresh.length) return card;

  const cal = await one('SELECT name FROM calendars WHERE id = $1', calendarId);
  const key = taskKey(card);
  const excerpt = (card.description || card.title).replace(/\s+/g, ' ').slice(0, 160);
  const link = `/?calendar=${encodeURIComponent(calendarId)}&task=${encodeURIComponent(card.id)}`;
  for (const recipientId of fresh) {
    const body = `📌 ${sender.name}님이 Task Board${cal?.name ? ` (${cal.name})` : ''}의 ${key} "${card.title}"에서 회원님을 멘션했어요.\n\n${excerpt}`;
    try {
      await sendDirectMessage({ one, run, sender, recipientId, body, clients, sendPush, link });
    } catch (err) {
      console.warn('Task mention message failed:', err.message);
    }
  }
  return card;
}

// Mirrors a calendar To Do event onto the Task Board (one card per non-recurring event).
// Returns true when the board changed.
export async function syncTodoEventCard({ one, run, event, userId }) {
  if (!event?.id) return false;
  const linked = await one('SELECT * FROM task_board_cards WHERE event_id = $1', event.id);
  if (!event.is_todo || event.series_id) {
    if (linked) {
      await run('DELETE FROM task_board_cards WHERE id = $1', linked.id);
      return true;
    }
    return false;
  }
  const dueDate = String(event.start || '').slice(0, 10);
  const color = EVENT_COLORS.includes(event.color) ? event.color : 'sage';
  const title = String(event.title || '').trim().slice(0, 120);
  const description = String(event.notes || '').trim().slice(0, 2000);

  if (linked) {
    const status = event.completed ? 'done' : (linked.status === 'in_progress' ? 'in_progress' : 'todo');
    let sortOrder = linked.sort_order;
    if (status !== linked.status) {
      const maxRow = await one(
        'SELECT COALESCE(MAX(sort_order), -10)::int AS max_order FROM task_board_cards WHERE calendar_id = $1 AND status = $2',
        linked.calendar_id,
        status
      );
      sortOrder = (maxRow?.max_order ?? -10) + 10;
    }
    await run(
      `UPDATE task_board_cards
          SET title = $1, description = $2, color = $3, due_date = $4, status = $5, sort_order = $6,
              updated_by = $7, updated_at = now()
        WHERE id = $8`,
      title, description, color, dueDate, status, sortOrder, userId, linked.id
    );
    return true;
  }

  const status = event.completed ? 'done' : 'todo';
  const maxRow = await one(
    'SELECT COALESCE(MAX(sort_order), -10)::int AS max_order FROM task_board_cards WHERE calendar_id = $1 AND status = $2',
    event.calendar_id,
    status
  );
  await run(
    `INSERT INTO task_board_cards
       (id, calendar_id, status, title, description, color, due_date, sort_order, created_by, updated_by, event_id, task_no)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10,
             (SELECT COALESCE(MAX(task_no), 0) + 1 FROM task_board_cards WHERE calendar_id = $2))`,
    randomUUID(), event.calendar_id, status, title, description, color, dueDate,
    (maxRow?.max_order ?? -10) + 10, userId, event.id
  );
  return true;
}
