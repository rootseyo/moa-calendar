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
} from '../messages-and-tasks.mjs';
import { translateSource } from '../public/translations.js';

test('Direct Messages (쪽지함) & Task Board full PostgreSQL lifecycle (PGlite migrations 001..034)', async () => {
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
