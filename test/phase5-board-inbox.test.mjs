import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import {
  listMessageContacts,
  listDirectMessages,
  sendDirectMessage,
  markDirectMessageRead,
  deleteDirectMessage,
  listTaskBoardCards,
  createTaskBoardCard,
  updateTaskBoardCard,
  reorderTaskBoardCards,
  deleteTaskBoardCard,
  applyTaskMentions,
  syncTodoEventCard,
  parseMentions,
  safeMessageLink,
  taskKey,
} from '../messages-and-tasks.mjs';
import { translateSource } from '../public/translations.js';

test('Direct Messages (쪽지함) & Task Board full PostgreSQL lifecycle (PGlite migrations 001..035)', async () => {
  const pg = new PGlite();
  try {
    const dbDir = new URL('../db/', import.meta.url);
    const files = readdirSync(dbDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      await pg.exec(readFileSync(new URL(file, dbDir), 'utf8'));
    }

    const one = async (sql, ...params) => (await pg.query(sql, params)).rows[0];
    const all = async (sql, ...params) => (await pg.query(sql, params)).rows;
    const run = async (sql, ...params) => pg.query(sql, params);
    const transaction = async fn => {
      await pg.query('BEGIN');
      try {
        const res = await fn({ query: (s, p = []) => pg.query(s, p) });
        await pg.query('COMMIT');
        return res;
      } catch (err) {
        await pg.query('ROLLBACK');
        throw err;
      }
    };

    // Seed 2 users sharing a calendar + 1 external email user
    await pg.query('INSERT INTO users(id, name) VALUES ($1, $2), ($3, $4), ($5, $6)', [
      'u1', '민수',
      'u2', '지영',
      'email:u3', '현우',
    ]);
    await pg.query('INSERT INTO local_accounts(user_id, email, password_hash, terms_accepted_at) VALUES($1, $2, $3, now())', [
      'email:u3', 'hyunwoo@example.com', 'dummy-hash',
    ]);
    await pg.query('INSERT INTO calendars(id, name, owner, slug) VALUES($1, $2, $3, $4)', [
      'cal-team', '프로젝트 팀', 'u1', 'team-slug',
    ]);
    await pg.query('INSERT INTO members(calendar_id, user_id, role) VALUES ($1, $2, $3), ($1, $4, $5)', [
      'cal-team', 'u1', 'owner', 'u2', 'editor',
    ]);

    // 1. Contacts discovery from shared calendar
    const contacts = await listMessageContacts({ all, userId: 'u1' });
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].id, 'u2');
    assert.equal(contacts[0].name, '지영');
    assert.deepEqual(contacts[0].calendars, ['프로젝트 팀']);

    // 2. Direct Message send (SSE push + self-message block + email recipient lookup)
    const sseEvents = [];
    const fakeClients = new Map([
      ['c1', { user: { id: 'u2', name: '지영' }, res: { write: chunk => sseEvents.push(chunk) } }],
    ]);

    await assert.rejects(
      () => sendDirectMessage({ one, run, sender: { id: 'u1', name: '민수' }, recipientId: 'u1', body: '나에게' }),
      /본인에게는 쪽지를 보낼 수 없습니다/
    );

    const dm1 = await sendDirectMessage({
      one,
      run,
      sender: { id: 'u1', name: '민수' },
      recipientId: 'u2',
      body: '지영님, 오늘 오후 회의 자료 확인 부탁드려요!',
      clients: fakeClients,
    });
    assert.ok(dm1.id);
    assert.equal(sseEvents.length, 1);
    assert.match(sseEvents[0], /^event: inbox\n/);

    // Send by email to u3
    const dm2 = await sendDirectMessage({
      one,
      run,
      sender: { id: 'u1', name: '민수' },
      recipientEmail: 'hyunwoo@example.com',
      body: '현우님 안녕하세요!',
    });
    assert.equal(dm2.recipient_id, 'email:u3');

    // Inbox & unread count for u2
    const u2Inbox = await listDirectMessages({ all, one, userId: 'u2', box: 'inbox' });
    assert.equal(u2Inbox.unreadCount, 1);
    assert.equal(u2Inbox.messages.length, 1);
    assert.equal(u2Inbox.messages[0].peer_name, '민수');

    // Mark read
    const afterRead = await markDirectMessageRead({ run, one, userId: 'u2', messageId: dm1.id });
    assert.equal(afterRead.unreadCount, 0);

    // Soft-delete for recipient keeps sender's sent box intact, then deleting for sender purges row
    await deleteDirectMessage({ one, run, userId: 'u2', messageId: dm1.id });
    assert.equal((await listDirectMessages({ all, one, userId: 'u2', box: 'inbox' })).messages.length, 0);
    assert.equal((await listDirectMessages({ all, one, userId: 'u1', box: 'sent' })).messages.length, 2);
    await deleteDirectMessage({ one, run, userId: 'u1', messageId: dm1.id });
    assert.equal(await one('SELECT id FROM direct_messages WHERE id=$1', dm1.id), undefined);

    // 3. Task Board CRUD + Pick/Drag cross-column reorder
    const cardA = await createTaskBoardCard({
      one,
      calendarId: 'cal-team',
      userId: 'u1',
      payload: { title: '디자인 시안 검토', status: 'todo', color: 'blue', assignee_id: 'u2', due_date: '2026-12-01' },
    });
    const cardB = await createTaskBoardCard({
      one,
      calendarId: 'cal-team',
      userId: 'u1',
      payload: { title: 'API 명세 작성', status: 'todo', color: 'sage' },
    });
    assert.equal(cardA.sort_order, 0);
    assert.equal(cardB.sort_order, 10);

    // Move cardA to in_progress and reorder
    await reorderTaskBoardCards({
      transaction,
      calendarId: 'cal-team',
      userId: 'u2',
      status: 'in_progress',
      orderedIds: [cardA.id],
      movedId: cardA.id,
    });

    const boardState = await listTaskBoardCards({ all, calendarId: 'cal-team' });
    const movedCardA = boardState.cards.find(c => c.id === cardA.id);
    assert.equal(movedCardA.status, 'in_progress');
    assert.equal(movedCardA.assignee_name, '지영');

    const updatedB = await updateTaskBoardCard({
      one,
      calendarId: 'cal-team',
      taskId: cardB.id,
      userId: 'u2',
      payload: { title: 'API 명세 최종본', status: 'done' },
    });
    assert.equal(updatedB.status, 'done');
    assert.equal(updatedB.title, 'API 명세 최종본');

    await deleteTaskBoardCard({ run, calendarId: 'cal-team', taskId: cardB.id });
    const finalBoard = await listTaskBoardCards({ all, calendarId: 'cal-team' });
    assert.equal(finalBoard.cards.length, 1);
  } finally {
    await pg.close();
  }
});

test('Task Board (never labeled Kanban) and Inbox UI, public asset routing, and English bundle syntax are valid', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const boardJs = readFileSync(new URL('../public/board-and-inbox.js', import.meta.url), 'utf8');
  const publicPages = readFileSync(new URL('../public-pages.mjs', import.meta.url), 'utf8');

  assert.match(html, /id="inbox-dialog"[^>]*closedby="any"/);
  assert.match(html, /id="task-card-dialog"[^>]*closedby="any"/);
  assert.match(appJs, /Task Board/);
  assert.match(appJs, /쪽지함/);
  assert.doesNotMatch(html, /칸반|kanban/i);
  assert.doesNotMatch(boardJs, /칸반|kanban/i);
  assert.match(publicPages, /\/board-and-inbox\.js/);

  // Verify English translated bundle still has 100% valid JS module syntax
  const translated = translateSource(appJs);
  execFileSync(process.execPath, ['--input-type=module', '--check'], { input: translated });
});

test('Task keys, @mentions with message links, and calendar To Do → Task Board sync (PGlite)', async () => {
  const pg = new PGlite();
  try {
    const dbDir = new URL('../db/', import.meta.url);
    for (const file of readdirSync(dbDir).filter(f => f.endsWith('.sql')).sort()) {
      await pg.exec(readFileSync(new URL(file, dbDir), 'utf8'));
    }
    const one = async (sql, ...params) => (await pg.query(sql, params)).rows[0];
    const all = async (sql, ...params) => (await pg.query(sql, params)).rows;
    const run = async (sql, ...params) => pg.query(sql, params);
    const transaction = async fn => {
      await pg.query('BEGIN');
      try { const r = await fn({ query: (s, p = []) => pg.query(s, p) }); await pg.query('COMMIT'); return r; }
      catch (e) { await pg.query('ROLLBACK'); throw e; }
    };
    await pg.query('INSERT INTO users(id, name) VALUES ($1,$2),($3,$4),($5,$6)', ['u1', '민수', 'u2', '이로', 'u3', '민수진']);
    await pg.query('INSERT INTO calendars(id, name, owner, slug) VALUES($1,$2,$3,$4)', ['cal', '팀', 'u1', 'team']);
    await pg.query('INSERT INTO members(calendar_id, user_id, role) VALUES ($1,$2,$3),($1,$4,$5),($1,$6,$5)', ['cal', 'u1', 'owner', 'u2', 'editor', 'u3']);
    const sender = { id: 'u1', name: '민수' };

    // Keys are sequential per calendar
    const a = await createTaskBoardCard({ one, calendarId: 'cal', userId: 'u1', payload: { title: '첫 카드' } });
    const b = await createTaskBoardCard({ one, calendarId: 'cal', userId: 'u1', payload: { title: '둘째 카드' } });
    assert.deepEqual([taskKey(a), taskKey(b)], ['T-1', 'T-2']);

    // Mentions: longest name wins, particles allowed, e-mail style text ignored, self skipped
    const members = await all("SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.calendar_id = 'cal'");
    assert.deepEqual(parseMentions('@민수진 확인, @이로에게 전달, a@민수 @민수', members).sort(), ['u1', 'u2', 'u3']);
    assert.deepEqual(parseMentions('a@이로 mail', members), []);

    // Creating a mention sends one message with a deep link; editing the same text does not resend
    let card = await updateTaskBoardCard({ one, calendarId: 'cal', taskId: a.id, userId: 'u1', payload: { title: '배포 확인 @이로 부탁', description: '자세한 건 @민수 본인 메모' } });
    card = await applyTaskMentions({ all, one, run, calendarId: 'cal', card, sender });
    assert.deepEqual(card.mention_ids.slice().sort(), ['u1', 'u2']);
    const inbox = (await listDirectMessages({ all, one, userId: 'u2', box: 'inbox' })).messages;
    assert.equal(inbox.length, 1);
    assert.match(inbox[0].body, /T-1/);
    assert.match(inbox[0].body, /멘션/);
    assert.equal(inbox[0].link, `/?calendar=cal&task=${a.id}`);
    assert.equal((await listDirectMessages({ all, one, userId: 'u1', box: 'inbox' })).messages.length, 0, 'no self mention message');
    card = await updateTaskBoardCard({ one, calendarId: 'cal', taskId: a.id, userId: 'u1', payload: { description: '자세한 건 @민수 본인 메모 (수정)' } });
    card = await applyTaskMentions({ all, one, run, calendarId: 'cal', card: { ...card, mention_ids: ['u1', 'u2'] }, sender });
    assert.equal((await listDirectMessages({ all, one, userId: 'u2', box: 'inbox' })).messages.length, 1, 'already-mentioned user is not re-notified');

    assert.equal(safeMessageLink('//evil.example'), '');
    assert.equal(safeMessageLink('https://evil.example'), '');
    assert.equal(safeMessageLink('/?calendar=x&task=y'), '/?calendar=x&task=y');

    // To Do events create, update, complete and delete their linked card
    const insertEvent = async (id, extra = {}) => {
      await pg.query(
        'INSERT INTO events(id,calendar_id,title,start,"end",color,notes,category,all_day,is_todo,completed,series_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$11)',
        [id, 'cal', extra.title || '병원 예약', '2026-12-05T10:00', '2026-12-05T11:00', 'blue', '메모', '', extra.is_todo ?? true, extra.completed ?? false, extra.series_id || null]
      );
      return one('SELECT * FROM events WHERE id=$1', id);
    };
    let ev = await insertEvent('ev1');
    assert.equal(await syncTodoEventCard({ one, run, event: ev, userId: 'u1' }), true);
    let linked = await one('SELECT * FROM task_board_cards WHERE event_id=$1', 'ev1');
    assert.equal(linked.status, 'todo');
    assert.equal(linked.title, '병원 예약');
    assert.equal(linked.due_date, '2026-12-05');
    assert.equal(linked.task_no, 3);

    await pg.query("UPDATE events SET title='병원 예약 (변경)', completed=true WHERE id='ev1'");
    ev = await one('SELECT * FROM events WHERE id=$1', 'ev1');
    await syncTodoEventCard({ one, run, event: ev, userId: 'u1' });
    linked = await one('SELECT * FROM task_board_cards WHERE event_id=$1', 'ev1');
    assert.equal(linked.status, 'done');
    assert.equal(linked.title, '병원 예약 (변경)');
    assert.equal((await all('SELECT id FROM task_board_cards WHERE event_id=$1', 'ev1')).length, 1, 'no duplicate card');

    // Moving the card back to 진행 중 un-completes the event
    const moved = await updateTaskBoardCard({ one, calendarId: 'cal', taskId: linked.id, userId: 'u2', payload: { status: 'in_progress' } });
    assert.equal(moved.event_synced, true);
    assert.equal((await one('SELECT completed FROM events WHERE id=$1', 'ev1')).completed, false);
    // and dropping it into 완료 via reorder completes it again
    const re = await reorderTaskBoardCards({ transaction, calendarId: 'cal', userId: 'u2', status: 'done', orderedIds: [linked.id], movedId: linked.id });
    assert.equal(re.event_synced, true);
    assert.equal((await one('SELECT completed FROM events WHERE id=$1', 'ev1')).completed, true);

    // Unchecking To Do removes the card; recurring events are never mirrored
    await pg.query("UPDATE events SET is_todo=false WHERE id='ev1'");
    await syncTodoEventCard({ one, run, event: await one('SELECT * FROM events WHERE id=$1', 'ev1'), userId: 'u1' });
    assert.equal(await one('SELECT id FROM task_board_cards WHERE event_id=$1', 'ev1'), undefined);
    const rec = await insertEvent('ev2', { series_id: 'series-1' });
    assert.equal(await syncTodoEventCard({ one, run, event: rec, userId: 'u1' }), false);

    // Deleting the event removes its card
    const ev3 = await insertEvent('ev3', { title: '삭제될 일정' });
    await syncTodoEventCard({ one, run, event: ev3, userId: 'u1' });
    await pg.query("DELETE FROM events WHERE id='ev3'");
    assert.equal(await one('SELECT id FROM task_board_cards WHERE event_id=$1', 'ev3'), undefined);
  } finally {
    await pg.close();
  }
});
