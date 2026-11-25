// Frontend module for Direct Messages (쪽지함) and Task Board (pick-and-move + pointer drag-and-drop)

import { EVENT_COLORS } from './event-utils.js?v=20261127-board-v6';

export const TASK_COLUMNS = [
  { id: 'todo', ko: '할 일', en: 'To Do' },
  { id: 'in_progress', ko: '진행 중', en: 'In Progress' },
  { id: 'done', ko: '완료', en: 'Done' },
];

const SANDBOX_TASKS_KEY = 'moa_sandbox_task_cards_v1';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function reducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

// ==========================================
// Light-dismiss polyfill helper for <dialog closedby="any">
// ==========================================
export function attachDialogLightDismissFallback(dialog) {
  if (!dialog || dialog.dataset.lightDismissBound === 'true') return;
  dialog.dataset.lightDismissBound = 'true';
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = e => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', e => {
      if (e.target !== dialog) {
        pressedOutside = false;
        return;
      }
      pressedOutside = outside(e);
    });
    dialog.addEventListener('pointerup', e => {
      if (pressedOutside && e.target === dialog && outside(e)) {
        dialog.close();
      }
      pressedOutside = false;
    });
  }
}

// ==========================================
// Sandbox local Task Board store
// ==========================================
function loadSandboxCards() {
  try {
    const raw = JSON.parse(localStorage.getItem(SANDBOX_TASKS_KEY));
    if (Array.isArray(raw) && raw.length) {
      let n = raw.reduce((m, c) => Math.max(m, c.task_no || 0), 0);
      return raw.map(c => (c.task_no ? c : { ...c, task_no: ++n }));
    }
  } catch {}
  const seed = [
    { id: 'sb-task-1', task_no: 1, status: 'todo', title: '주말 여행 숙소 후보 추리기', description: '바다 전망 숙소 2~3곳 비교하기', color: 'blue', assignee_id: null, assignee_name: '', due_date: '', sort_order: 0 },
    { id: 'sb-task-2', task_no: 2, status: 'todo', title: '장보기 체크리스트 작성', description: '바비큐 재료 & 음료 확인', color: 'peach', assignee_id: null, assignee_name: '', due_date: '', sort_order: 10 },
    { id: 'sb-task-3', task_no: 3, status: 'in_progress', title: '카드를 픽해서 다른 열로 옮겨보세요!', description: '카드를 길게 누르거나 끌어서 픽한 뒤, 옮길 상태 열을 클릭하세요. 클릭하면 바로 편집돼요. @지영 처럼 멘션도 해보세요.', color: 'yellow', assignee_id: null, assignee_name: '', due_date: '', sort_order: 0 },
    { id: 'sb-task-4', task_no: 4, status: 'done', title: '모아 캘린더 둘러보기', description: '로그인하면 함께 쓰는 보드에 저장돼요.', color: 'lavender', assignee_id: null, assignee_name: '', due_date: '', sort_order: 0 },
  ];
  try { localStorage.setItem(SANDBOX_TASKS_KEY, JSON.stringify(seed)); } catch {}
  return seed;
}

function saveSandboxCards(cards) {
  try { localStorage.setItem(SANDBOX_TASKS_KEY, JSON.stringify(cards)); } catch {}
}

// ==========================================
// Controller Factory
// ==========================================
// Sandbox (demo) inbox: an in-memory stand-in for /api/messages so visitors can try 쪽지함 before signing up.
function createSandboxInbox() {
  const ago = mins => new Date(Date.now() - mins * 60000).toISOString();
  let seq = 0;
  const inbox = [
    { id: 'sb-msg-1', sender_id: 'sb-u-jiyoung', peer_name: '지영', body: '저녁 7시 강남역 괜찮아? 🙌 늦으면 미리 말해줘!', created_at: ago(12), read_at: null },
    { id: 'sb-msg-2', sender_id: 'sb-u-minsu', peer_name: '민수', body: 'Task Board에 숙소 후보 카드 올려뒀어. 진행 중으로 옮겨줄래?', created_at: ago(95), read_at: null },
    { id: 'sb-msg-3', sender_id: 'sb-u-mom', peer_name: '엄마', body: '주말에 김장하니까 토요일 일정 비워두렴 😊', created_at: ago(60 * 26), read_at: ago(60 * 25) },
  ];
  const sent = [
    { id: 'sb-msg-4', recipient_id: 'sb-u-jiyoung', peer_name: '지영', body: '좋아! 7시에 2번 출구에서 보자', created_at: ago(8), read_at: ago(5) },
  ];
  const contacts = [
    { id: 'sb-u-jiyoung', name: '지영', calendars: ['우리의 공유 캘린더 (체험)'] },
    { id: 'sb-u-minsu', name: '민수', calendars: ['우리의 공유 캘린더 (체험)'] },
    { id: 'sb-u-mom', name: '엄마', calendars: ['우리의 공유 캘린더 (체험)'] },
  ];
  const unread = () => inbox.filter(m => !m.read_at).length;
  return async function sandboxMessagesApi(path, method = 'GET', body = {}) {
    if (method === 'GET' && path.startsWith('/api/messages/contacts')) return { contacts };
    if (method === 'GET' && path.startsWith('/api/messages')) {
      const box = new URL(path, location.origin).searchParams.get('box') === 'sent' ? sent : inbox;
      return { messages: box.map(m => ({ ...m })), unreadCount: unread() };
    }
    if (method === 'POST' && path === '/api/messages/read') {
      inbox.forEach(m => { if (!m.read_at && (body.messageId === 'all' || m.id === body.messageId)) m.read_at = new Date().toISOString(); });
      return { unreadCount: unread() };
    }
    if (method === 'DELETE') {
      const id = path.split('/').pop();
      for (const list of [inbox, sent]) { const i = list.findIndex(m => m.id === id); if (i >= 0) list.splice(i, 1); }
      return { unreadCount: unread() };
    }
    if (method === 'POST' && path === '/api/messages') {
      const to = contacts.find(c => c.id === body.recipientId);
      if (!to) throw new Error('체험 모드에서는 목록의 사람에게만 보낼 수 있어요.');
      if (!String(body.body || '').trim()) throw new Error('쪽지 내용을 입력해 주세요.');
      sent.unshift({ id: `sb-msg-new-${++seq}`, recipient_id: to.id, peer_name: to.name, body: String(body.body).slice(0, 2000), created_at: new Date().toISOString(), read_at: null });
      return { ok: true };
    }
    throw new Error('체험 모드에서 지원하지 않는 요청이에요.');
  };
}

export function createBoardAndInboxController({
  api,
  toast,
  getLocale,
  tr,
  getCurrentCalendar,
  isCalendarReadOnly,
  isSandboxMode,
  getMe,
  exitSandboxToLogin,
  openTaskLink = () => {},
}) {
  let workspaceMode = 'calendar'; // 'calendar' | 'board'
  let boardCards = [];
  let boardMembers = [];
  let boardReadOnly = false;
  let boardLoading = false;
  let editingCardId = null;

  // Pick-and-move state ("카드를 픽해서 옮기기")
  let pickedCardId = null;
  // Card that was just put down (plays a short "drop" animation once)
  let justDroppedId = null;
  // Swallow the click that follows a real pointer drag
  let suppressCardClickUntil = 0;
  // Active pointer drag state
  let activeDrag = null;
  let boardKeysBound = false;
  // Card being edited in place on its sticky note
  let inlineEditingId = null;

  // Inbox state
  let inboxBox = 'inbox'; // 'inbox' | 'sent' | 'compose'
  let inboxMessages = [];
  let inboxContacts = [];
  let unreadCount = 0;
  let expandedMessageId = null;

  const $ = s => document.querySelector(s);
  const en0 = ko => (getLocale() === 'en' ? ({ '지영': 'Jiyoung', '민수': 'Minsu' }[ko] || ko) : ko);
  let sandboxInboxApi = null;
  // Messages go to the real API, or to the in-memory demo inbox in sandbox mode
  const msgApi = (path, method, body) => {
    if (!isSandboxMode()) return api(path, method, body);
    sandboxInboxApi ||= createSandboxInbox();
    return sandboxInboxApi(path, method, body);
  };

  function colLabel(status) {
    const col = TASK_COLUMNS.find(c => c.id === status) || TASK_COLUMNS[0];
    return getLocale() === 'en' ? col.en : col.ko;
  }

  let announceTimer = null;
  function announceBoard(msg) {
    const live = $('#task-board-live');
    if (!live) return;
    live.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      if ($('#task-board-live')) $('#task-board-live').textContent = msg;
    }, 120);
  }

  // Move existing DOM node preserving state/focus per modern-web-guidance
  function moveNodeBefore(container, item, referenceNode) {
    if ('moveBefore' in Element.prototype) {
      container.moveBefore(item, referenceNode || null);
    } else if (referenceNode) {
      referenceNode.before(item);
    } else {
      container.append(item);
    }
  }

  // ==========================================
  // Workspace Mode Switching (Calendar <-> Task Board)
  // ==========================================
  function getWorkspaceMode() {
    return workspaceMode;
  }

  async function setWorkspaceMode(mode) {
    workspaceMode = mode === 'board' ? 'board' : 'calendar';
    syncWorkspaceModeUI();
    if (workspaceMode === 'board') {
      await loadTaskBoard();
    }
  }

  function syncWorkspaceModeUI() {
    const isBoard = workspaceMode === 'board';
    const root = $('#workspace-root');
    if (root) root.dataset.workspaceMode = workspaceMode;

    document.querySelectorAll('[data-workspace-mode]').forEach(btn => {
      const active = btn.dataset.workspaceMode === workspaceMode;
      btn.classList.toggle('active', active);
      btn.classList.toggle('nav-active', btn.classList.contains('sidebar-space-btn') && active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const boardSection = $('#task-board-view');
    const calEl = $('#calendar');
    const quickForm = $('#quick-add-form');
    const calToolbar = $('.calendar-toolbar');
    const calMeta = $('.calendar-meta');
    const calFooter = $('.calendar-footer');

    if (boardSection) boardSection.hidden = !isBoard;
    if (calEl) calEl.hidden = isBoard;
    if (quickForm) quickForm.hidden = isBoard;
    if (calToolbar) calToolbar.hidden = isBoard;
    if (calMeta) calMeta.hidden = isBoard;
    if (calFooter) calFooter.hidden = isBoard;
  }

  // ==========================================
  // Task Board Data & Rendering
  // ==========================================
  async function loadTaskBoard() {
    const cal = getCurrentCalendar();
    const boardSection = $('#task-board-view');
    if (!boardSection) return;

    if (!cal) {
      boardCards = [];
      boardMembers = [];
      renderTaskBoard();
      return;
    }

    if (isSandboxMode()) {
      boardCards = loadSandboxCards();
      boardMembers = [{ id: 'sb-u1', name: en0('지영') }, { id: 'sb-u2', name: en0('민수') }];
      boardReadOnly = false;
      renderTaskBoard();
      return;
    }

    boardLoading = true;
    boardReadOnly = Boolean(isCalendarReadOnly(cal));
    try {
      const data = await api(`/api/calendars/${cal.id}/tasks`);
      boardCards = Array.isArray(data?.cards) ? data.cards : [];
      boardMembers = Array.isArray(data?.members) ? data.members : [];
      if (typeof data?.readOnly === 'boolean') boardReadOnly = data.readOnly;
    } catch (err) {
      toast(err.message);
    } finally {
      boardLoading = false;
      renderTaskBoard();
    }
  }

  // "@name" → highlighted mention chip (only names of calendar members are highlighted)
  function mentionHtml(text) {
    let html = esc(text);
    const names = boardMembers.map(m => m.name).filter(Boolean).sort((a, b) => b.length - a.length);
    for (const name of names) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}_@;])@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'giu');
      html = html.replace(re, (_, lead) => `${lead}<span class="task-mention">@${esc(name)}</span>`);
    }
    return html;
  }

  function taskKeyOf(card) {
    return card?.task_no ? `T-${card.task_no}` : '';
  }

  function renderCardHtml(card) {
    const en = getLocale() === 'en';
    const isPicked = pickedCardId === card.id;
    const justDropped = justDroppedId === card.id;
    const color = EVENT_COLORS.includes(card.color) ? card.color : 'yellow';
    const dueLabel = card.due_date ? `<span class="task-card-due">📅 ${esc(card.due_date.slice(5).replace('-', '.'))}</span>` : '';
    const assigneeLabel = card.assignee_name ? `<span class="task-card-assignee" title="${esc(card.assignee_name)}"><span class="task-mini-avatar">${esc(card.assignee_name.slice(0, 1))}</span>${esc(card.assignee_name)}</span>` : '';
    const descHtml = card.description ? `<p class="task-card-desc">${mentionHtml(card.description)}</p>` : '';
    const key = taskKeyOf(card);
    const calendarTag = card.event_id ? `<span class="task-card-origin" title="${en ? 'Created from a calendar To Do' : '달력 To Do에서 자동 등록됨'}">📅</span>` : '';
    const label = `${key ? key + ' ' : ''}${card.title}`;
    const classes = ['task-card', 'postit', color, isPicked ? 'is-picked' : '', justDropped ? 'is-dropped' : '', boardReadOnly ? 'is-readonly' : ''].filter(Boolean).join(' ');

    return `<article class="${classes}" data-task-id="${esc(card.id)}" data-task-status="${esc(card.status)}" tabindex="0" role="button" aria-pressed="${isPicked}" aria-label="${esc(label)}" title="${en ? 'Click to edit · hold or drag to pick up' : '클릭하면 편집 · 길게 누르거나 끌면 픽'}">
      ${boardReadOnly ? '' : `<button type="button" class="task-card-edit" data-task-edit="${esc(card.id)}" aria-label="${esc(en ? `Detailed edit: ${card.title}` : `${card.title} 자세히 편집`)}" title="${en ? 'Detailed edit' : '자세히 편집'}"><span aria-hidden="true">✎</span></button>`}
      ${key || calendarTag ? `<div class="task-card-top"><span class="task-card-key">${esc(key)}</span>${calendarTag}</div>` : ''}
      <div class="task-card-body">
        <strong class="task-card-title">${mentionHtml(card.title)}</strong>
        ${descHtml}
      </div>
      ${(dueLabel || assigneeLabel) ? `<div class="task-card-meta">${dueLabel}${assigneeLabel}</div>` : ''}
    </article>`;
  }

  function renderTaskBoard() {
    const container = $('#task-board-view');
    if (!container) return;
    const cal = getCurrentCalendar();
    const en = getLocale() === 'en';

    if (!cal) {
      container.innerHTML = `<div class="empty-calendar"><p>${en ? 'Select or create a calendar to use Task Board.' : '캘린더를 선택하면 Task Board를 사용할 수 있어요.'}</p></div>`;
      return;
    }

    const pickedCard = pickedCardId ? boardCards.find(c => c.id === pickedCardId) : null;
    if (pickedCardId && !pickedCard) pickedCardId = null;

    container.innerHTML = `
      <div class="task-board-header">
        <div class="task-board-title-group">
          <div class="task-board-heading-row">
            <h2>Task Board</h2>
            <span class="task-board-cal-pill">${esc(cal.name)}</span>
          </div>
          <p class="muted small">${en ? 'Click a note to edit it. Hold it (or drag) to pick it up, then click a column to move it.' : '카드를 클릭하면 바로 편집해요. 길게 누르거나 끌면 픽 모드가 되고, 옮길 열을 클릭하면 이동해요.'}</p>
        </div>
        <div class="task-board-header-actions">
          <button type="button" class="secondary" data-board-back-calendar>${en ? '← Calendar View' : '← 달력 보기로'}</button>
          ${boardReadOnly ? '' : `<button type="button" class="primary" id="task-board-new-card-btn">＋ ${en ? 'New Card' : '새 카드'}</button>`}
        </div>
      </div>
      <p id="task-board-live" role="status" class="sr-only"></p>
      <div class="task-board-columns ${pickedCard ? 'has-picked' : ''}" id="task-board-columns">
        ${TASK_COLUMNS.map(col => {
          const cards = boardCards
            .filter(c => c.status === col.id)
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          const title = en ? col.en : col.ko;
          const isSourceCol = pickedCard && pickedCard.status === col.id;
          return `<section class="task-column ${pickedCard && !isSourceCol ? 'is-drop-target' : ''}" data-col-status="${col.id}" aria-label="${esc(title)}">
            <header class="task-column-header">
              <div class="task-column-title">
                <span class="task-status-dot status-${col.id}" aria-hidden="true"></span>
                <h3>${esc(title)}</h3>
                <span class="task-column-count">${cards.length}</span>
              </div>
              ${boardReadOnly ? '' : `<button type="button" class="icon task-col-add-btn" data-add-col-card="${col.id}" aria-label="${esc(title)} ${en ? 'add card' : '카드 추가'}" title="${en ? 'Add card' : '이 열에 카드 추가'}">＋</button>`}
            </header>
            <div class="task-card-list" data-card-list="${col.id}">
              ${cards.length ? cards.map(renderCardHtml).join('') : `<div class="task-column-empty" data-empty-col="${col.id}">${en ? 'No cards yet' : '아직 카드가 없어요'}</div>`}
            </div>
            ${pickedCard && !boardReadOnly && !isSourceCol ? `<button type="button" class="task-column-drop-here" data-place-picked-col="${col.id}">${en ? `Move to ${esc(title)}` : `'${esc(title)}'(으)로 옮기기`}</button>` : ''}
            ${boardReadOnly || pickedCard ? '' : `<form class="task-quick-card-form" data-quick-card-form="${col.id}" autocomplete="off">
              <input type="text" name="title" maxlength="120" placeholder="＋ ${en ? 'Add a card…' : '빠른 카드 추가…'}" aria-label="${esc(title)} ${en ? 'quick card title' : '빠른 카드 제목'}">
            </form>`}
          </section>`;
        }).join('')}
      </div>
    `;

    bindTaskBoardEvents(container);
    justDroppedId = null;
  }

  async function persistColumnReorder(targetStatus, orderedIds, movedId) {
    const cal = getCurrentCalendar();
    if (!cal) return;

    // Update local state immediately for snappy UX
    const moved = boardCards.find(c => c.id === movedId);
    if (moved) moved.status = targetStatus;
    orderedIds.forEach((id, idx) => {
      const c = boardCards.find(item => item.id === id);
      if (c) {
        c.status = targetStatus;
        c.sort_order = idx * 10;
      }
    });

    if (isSandboxMode()) {
      saveSandboxCards(boardCards);
      return;
    }

    try {
      await api(`/api/calendars/${cal.id}/tasks/reorder`, 'POST', {
        status: targetStatus,
        orderedIds,
        movedId,
      });
    } catch (err) {
      toast(err.message);
      await loadTaskBoard();
    }
  }

  // Move card in DOM with FLIP animation + persist
  async function executeCardMove(cardId, targetStatus, beforeCardId = null, focusHandleAfter = false, fromRect = null) {
    const boardEl = $('#task-board-columns');
    if (!boardEl) return;
    const cardEl = boardEl.querySelector(`.task-card[data-task-id="${CSS.escape(cardId)}"]`);
    const targetList = boardEl.querySelector(`.task-card-list[data-card-list="${CSS.escape(targetStatus)}"]`);
    if (!cardEl || !targetList) return;

    const refEl = beforeCardId
      ? targetList.querySelector(`.task-card[data-task-id="${CSS.escape(beforeCardId)}"]`)
      : null;

    if (refEl === cardEl) return;

    // Record rects for FLIP
    const allCardEls = [...boardEl.querySelectorAll('.task-card')];
    const beforeRects = new Map(allCardEls.map(el => [el, el.getBoundingClientRect()]));
    if (fromRect) beforeRects.set(cardEl, fromRect);

    // Remove empty placeholder in target list if present
    targetList.querySelector('.task-column-empty')?.remove();
    const sourceStatus = cardEl.dataset.taskStatus;
    const sourceList = boardEl.querySelector(`.task-card-list[data-card-list="${CSS.escape(sourceStatus)}"]`);

    moveNodeBefore(targetList, cardEl, refEl);
    cardEl.dataset.taskStatus = targetStatus;

    // Update counts & restore empty placeholder in source list if now empty
    for (const col of TASK_COLUMNS) {
      const list = boardEl.querySelector(`.task-card-list[data-card-list="${col.id}"]`);
      const countEl = boardEl.querySelector(`.task-column[data-col-status="${col.id}"] .task-column-count`);
      if (!list) continue;
      const remaining = list.querySelectorAll('.task-card').length;
      if (countEl) countEl.textContent = String(remaining);
      if (remaining === 0 && !list.querySelector('.task-column-empty')) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'task-column-empty';
        emptyDiv.dataset.emptyCol = col.id;
        emptyDiv.textContent = getLocale() === 'en' ? 'No cards yet' : '아직 카드가 없어요';
        list.append(emptyDiv);
      }
    }

    cardEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    if (!reducedMotion()) {
      for (const el of allCardEls) {
        const prev = beforeRects.get(el);
        if (!prev) continue;
        const next = el.getBoundingClientRect();
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          el.animate(
            [{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }],
            { duration: el === cardEl ? 280 : 190, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
          );
        }
      }
      // The moved sticky note "lands": settles from lifted to resting pose
      cardEl.classList.remove('is-dropped');
      void cardEl.offsetWidth;
      cardEl.classList.add('is-dropped');
      cardEl.addEventListener('animationend', () => cardEl.classList.remove('is-dropped'), { once: true });
    }

    if (focusHandleAfter) {
      const h = cardEl;
      h?.focus({ preventScroll: true });
    }

    const orderedIds = [...targetList.querySelectorAll('.task-card')].map(el => el.dataset.taskId);
    const cardObj = boardCards.find(c => c.id === cardId);
    const posIndex = orderedIds.indexOf(cardId) + 1;
    announceBoard(
      getLocale() === 'en'
        ? `Moved "${cardObj?.title || ''}" to ${colLabel(targetStatus)}, position ${posIndex} of ${orderedIds.length}`
        : `'${cardObj?.title || ''}' 카드를 ${colLabel(targetStatus)} 열 ${posIndex}번째로 옮겼어요.`
    );

    await persistColumnReorder(targetStatus, orderedIds, cardId);
    if (sourceStatus && sourceStatus !== targetStatus && sourceList) {
      const sourceIds = [...sourceList.querySelectorAll('.task-card')].map(el => el.dataset.taskId);
      if (sourceIds.length) await persistColumnReorder(sourceStatus, sourceIds, null);
    }
  }

  function setPickedCard(cardId, focusHandle = false) {
    if (!cardId && pickedCardId) justDroppedId = pickedCardId;
    pickedCardId = cardId;
    renderTaskBoard();
    if (cardId) {
      const card = boardCards.find(c => c.id === cardId);
      announceBoard(
        getLocale() === 'en'
          ? `Picked "${card?.title || ''}". Use arrow keys or click a column to move, Space to drop, Escape to cancel.`
          : `'${card?.title || ''}' 카드를 픽했어요. 방향키나 클릭으로 원하는 열로 옮기세요.`
      );
      if (focusHandle) {
        const handle = document.querySelector(`.task-card[data-task-id="${CSS.escape(cardId)}"]`);
        handle?.focus({ preventScroll: true });
      }
    }
  }

  async function placePickedCard(targetStatus, beforeCardId = null) {
    if (!pickedCardId) return;
    const movingId = pickedCardId;
    const liftedRect = document.querySelector(`.task-card[data-task-id="${CSS.escape(movingId)}"]`)?.getBoundingClientRect() || null;
    pickedCardId = null;
    renderTaskBoard();
    await executeCardMove(movingId, targetStatus, beforeCardId, true, liftedRect);
  }

  // Pointer drag-and-drop (per modern-web-guidance: pointer capture on handle, layout midpoints, real DOM node lift, Escape cancel)
  function startPointerDrag(e, cardEl) {
    if (e.button !== 0 || boardReadOnly) return;
    if (activeDrag) return;
    const cardId = cardEl.dataset.taskId;
    const boardEl = $('#task-board-columns');
    if (!cardId || !boardEl) return;
    // Touch keeps scrolling the page; touch users pick a card with a long press instead
    if (e.pointerType === 'touch') return;
    const pointerId = e.pointerId;
    const handleEl = cardEl;

    const startX = e.clientX;
    const startY = e.clientY;
    let movedEnough = false;
    let targetStatus = cardEl.dataset.taskStatus;
    let beforeCardId = null;

    activeDrag = { pointerId, cardId, cardEl, handleEl };

    const clearDropIndicators = () => {
      boardEl.querySelectorAll('.task-column').forEach(col => col.removeAttribute('data-drop-col'));
      boardEl.querySelectorAll('.task-card-list').forEach(list => {
        list.removeAttribute('data-drop');
        list.style.removeProperty('--drop-x');
        list.style.removeProperty('--drop-y');
        list.style.removeProperty('--drop-w');
      });
    };

    const updateDropSpot = (clientX, clientY) => {
      clearDropIndicators();
      const hit = document.elementFromPoint(clientX, clientY);
      const colEl = hit?.closest?.('.task-column') || boardEl.querySelector(`.task-column[data-col-status="${CSS.escape(targetStatus)}"]`);
      if (!colEl) return;
      targetStatus = colEl.dataset.colStatus;
      colEl.setAttribute('data-drop-col', 'true');

      const listEl = colEl.querySelector('.task-card-list');
      if (!listEl) return;
      const listRect = listEl.getBoundingClientRect();
      const relY = clientY - listRect.top - listEl.clientTop + listEl.scrollTop;

      const siblings = [...listEl.querySelectorAll('.task-card')].filter(el => el !== cardEl);
      let nextSibling = null;
      for (const sib of siblings) {
        const midpoint = sib.offsetTop + sib.offsetHeight / 2;
        if (relY < midpoint) {
          nextSibling = sib;
          break;
        }
      }
      beforeCardId = nextSibling ? nextSibling.dataset.taskId : null;

      // Skip no-op marker if hovering own current slot
      if (targetStatus === cardEl.dataset.taskStatus) {
        const allInSource = [...listEl.querySelectorAll('.task-card')];
        const myIdx = allInSource.indexOf(cardEl);
        const currentNext = allInSource[myIdx + 1]?.dataset.taskId || null;
        if (beforeCardId === currentNext) return;
      }

      let markerY;
      if (siblings.length === 0) {
        markerY = listRect.top + 14;
      } else if (nextSibling) {
        const nextRect = nextSibling.getBoundingClientRect();
        const prevIdx = siblings.indexOf(nextSibling) - 1;
        if (prevIdx >= 0) {
          const prevRect = siblings[prevIdx].getBoundingClientRect();
          markerY = (prevRect.bottom + nextRect.top) / 2;
        } else {
          markerY = nextRect.top - 5;
        }
      } else {
        const lastRect = siblings[siblings.length - 1].getBoundingClientRect();
        markerY = lastRect.bottom + 5;
      }

      listEl.setAttribute('data-drop', 'true');
      listEl.style.setProperty('--drop-x', `${Math.round(listRect.left + 8)}px`);
      listEl.style.setProperty('--drop-y', `${Math.round(markerY)}px`);
      listEl.style.setProperty('--drop-w', `${Math.round(Math.max(80, listRect.width - 16))}px`);
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKeyDown, true);
      document.documentElement.classList.remove('is-dragging-task');
      clearDropIndicators();
      cardEl.classList.remove('is-dragging');
      cardEl.style.translate = '';
      try { if (handleEl.hasPointerCapture(pointerId)) handleEl.releasePointerCapture(pointerId); } catch {}
      activeDrag = null;
    };

    activeDrag.cancel = () => cleanup();

    const onMove = ev => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!movedEnough && Math.hypot(dx, dy) < 6) return;
      if (!movedEnough) {
        movedEnough = true;
        try { cardEl.setPointerCapture(pointerId); } catch {}
        window.getSelection?.()?.removeAllRanges();
        if (pickedCardId) {
          pickedCardId = null;
          boardEl.classList.remove('has-picked');
          boardEl.querySelectorAll('.task-card.is-picked').forEach(el => el.classList.remove('is-picked'));
        }
        document.documentElement.classList.add('is-dragging-task');
        cardEl.classList.add('is-dragging');
      }
      cardEl.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
      updateDropSpot(ev.clientX, ev.clientY);
    };

    const onCancel = ev => {
      if (ev && ev.pointerId !== undefined && ev.pointerId !== pointerId) return;
      cleanup();
      announceBoard(getLocale() === 'en' ? 'Move cancelled.' : '카드 이동을 취소했어요.');
    };

    const onKeyDown = ev => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        onCancel();
      }
    };

    const onUp = async ev => {
      if (ev.pointerId !== pointerId) return;
      const wasDrag = movedEnough;
      const finalStatus = targetStatus;
      const finalBefore = beforeCardId;
      const dropRect = wasDrag ? cardEl.getBoundingClientRect() : null;
      cleanup();

      // A short click/tap is handled by the card's click listener (pick / put down)
      if (!wasDrag) return;

      suppressCardClickUntil = Date.now() + 350;
      if (pickedCardId) { pickedCardId = null; renderTaskBoard(); }
      await executeCardMove(cardId, finalStatus, finalBefore, true, dropRect);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKeyDown, true);
  }

  // Edit title + memo right on the sticky note. Enter / clicking away saves, Esc cancels.
  function startInlineEdit(cardEl, card) {
    if (inlineEditingId || boardReadOnly) return;
    const body = cardEl.querySelector('.task-card-body');
    if (!body) return;
    const en = getLocale() === 'en';
    inlineEditingId = card.id;
    cardEl.classList.add('is-editing');
    const original = body.innerHTML;
    body.innerHTML = `<div class="task-inline-edit">
      <textarea class="task-inline-title" rows="1" maxlength="120" aria-label="${en ? 'Card title' : '카드 제목'}"></textarea>
      <textarea class="task-inline-desc" rows="3" maxlength="2000" placeholder="${en ? 'Notes… (@name to mention)' : '메모… (@이름으로 멘션)'}" aria-label="${en ? 'Notes' : '메모'}"></textarea>
      <span class="task-inline-hint">${en ? 'Enter to save · Esc to cancel' : 'Enter 저장 · Esc 취소'}</span>
    </div>`;
    const titleEl = body.querySelector('.task-inline-title');
    const descEl = body.querySelector('.task-inline-desc');
    titleEl.value = card.title || '';
    descEl.value = card.description || '';
    bindMentionAutocomplete(titleEl);
    bindMentionAutocomplete(descEl);
    const fit = el => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
    [titleEl, descEl].forEach(el => { fit(el); el.addEventListener('input', () => fit(el)); });
    titleEl.focus();
    titleEl.setSelectionRange(titleEl.value.length, titleEl.value.length);

    let finished = false;
    const finish = async save => {
      if (finished) return;
      finished = true;
      closeMentionMenu();
      inlineEditingId = null;
      const title = titleEl.value.trim();
      const description = descEl.value.trim();
      const changed = title !== (card.title || '') || description !== (card.description || '');
      if (!save || !changed || !title) {
        cardEl.classList.remove('is-editing');
        body.innerHTML = original;
        if (save && !title) toast(en ? 'A card needs a title.' : '카드 제목을 입력해 주세요.');
        return;
      }
      try {
        await saveTaskCard(card.id, { title, description });
      } catch (err) {
        toast(err.message);
        renderTaskBoard();
      }
    };
    cardEl.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!finished && !cardEl.contains(document.activeElement)) finish(true);
      }, 0);
    });
    cardEl.addEventListener('keydown', e => {
      if (e.target !== titleEl && e.target !== descEl) return;
      if (e.isComposing || e.defaultPrevented || mentionMenu) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
        cardEl.focus({ preventScroll: true });
      } else if (e.key === 'Enter' && (e.target === titleEl || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        finish(true);
      }
    });
  }

  // Hold a card still for a moment (mouse or touch) to pick it up without dragging.
  const LONG_PRESS_MS = 380;
  function startLongPress(e, cardEl) {
    if (e.button !== 0 || boardReadOnly || activeDrag || pickedCardId) return;
    const cardId = cardEl.dataset.taskId;
    const sx = e.clientX;
    const sy = e.clientY;
    const pointerId = e.pointerId;
    let fired = false;
    const stop = () => {
      clearTimeout(timer);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
    };
    const onMove = ev => {
      if (ev.pointerId !== pointerId || fired) return;
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) stop();
    };
    const onEnd = ev => {
      if (ev.pointerId !== pointerId) return;
      stop();
      if (fired) suppressCardClickUntil = Date.now() + 350;
    };
    const timer = setTimeout(() => {
      fired = true;
      activeDrag?.cancel?.();
      suppressCardClickUntil = Date.now() + 60000;
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
      setPickedCard(cardId);
    }, LONG_PRESS_MS);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  }

  function bindTaskBoardEvents(container) {
    container.querySelector('[data-board-back-calendar]')?.addEventListener('click', () => setWorkspaceMode('calendar'));
    container.querySelector('#task-board-new-card-btn')?.addEventListener('click', () => openTaskCardDialog(null, 'todo'));

    container.querySelectorAll('[data-add-col-card]').forEach(btn => {
      btn.addEventListener('click', () => openTaskCardDialog(null, btn.dataset.addColCard));
    });

    // Place picked card via column banner button
    container.querySelectorAll('[data-place-picked-col]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        await placePickedCard(btn.dataset.placePickedCol, null);
      });
    });

    // Quick inline card creation form at bottom of each column
    container.querySelectorAll('[data-quick-card-form]').forEach(form => {
      const input = form.elements.title;
      let composing = false;
      input?.addEventListener('compositionstart', () => { composing = true; });
      input?.addEventListener('compositionend', () => { composing = false; });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (composing) return;
        const title = input.value.trim();
        if (!title) return;
        const status = form.dataset.quickCardForm;
        input.disabled = true;
        try {
          await saveTaskCard(null, { title, status, description: '', color: 'yellow', due_date: '', assignee_id: '' });
          input.value = '';
        } finally {
          input.disabled = false;
          input.focus();
        }
      });
    });

    // Whole sticky note: pointer drag (mouse/pen anywhere, touch via ✋ handle)
    if (!boardReadOnly) {
      container.querySelectorAll('.task-card').forEach(cardEl => {
        cardEl.addEventListener('pointerdown', e => { if (e.target.closest('[data-task-edit], .task-inline-edit')) return; startLongPress(e, cardEl); startPointerDrag(e, cardEl); });
        cardEl.addEventListener('contextmenu', e => { if (e.pointerType === 'touch' || pickedCardId) e.preventDefault(); });
      });
    }

    // Keyboard on a focused card: Enter edits, Space picks / drops, arrows move the picked card
    container.querySelectorAll('.task-card').forEach(cardEl => {
      cardEl.addEventListener('keydown', async e => {
        if (e.target !== cardEl) return;
        const cardId = cardEl.dataset.taskId;
        const card = boardCards.find(c => c.id === cardId);
        if (!card) return;
        if (e.key === 'Enter' && pickedCardId !== cardId) {
          e.preventDefault();
          if (boardReadOnly) openTaskCardDialog(card, card.status);
          else startInlineEdit(cardEl, card);
          return;
        }
        if (boardReadOnly) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          setPickedCard(pickedCardId === cardId ? null : cardId, true);
          return;
        }
        if (pickedCardId !== cardId) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setPickedCard(null, true);
          announceBoard(getLocale() === 'en' ? 'Move cancelled.' : '카드 이동을 취소했어요.');
          return;
        }
        const colIdx = TASK_COLUMNS.findIndex(c => c.id === card.status);
        if (e.key === 'ArrowRight' && colIdx < TASK_COLUMNS.length - 1) {
          e.preventDefault();
          await executeCardMove(cardId, TASK_COLUMNS[colIdx + 1].id, null, true);
        } else if (e.key === 'ArrowLeft' && colIdx > 0) {
          e.preventDefault();
          await executeCardMove(cardId, TASK_COLUMNS[colIdx - 1].id, null, true);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const sameCol = boardCards
            .filter(c => c.status === card.status)
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          const idx = sameCol.findIndex(c => c.id === cardId);
          if (e.key === 'ArrowUp' && idx > 0) {
            await executeCardMove(cardId, card.status, sameCol[idx - 1].id, true);
          } else if (e.key === 'ArrowDown' && idx >= 0 && idx < sameCol.length - 1) {
            const afterNext = sameCol[idx + 2]?.id || null;
            await executeCardMove(cardId, card.status, afterNext, true);
          }
        }
      });

      // One click edits the card; while another card is picked, a click drops the picked card here
      cardEl.addEventListener('click', async e => {
        if (e.target.closest('.task-inline-edit')) return;
        const targetId = cardEl.dataset.taskId;
        const targetCard = boardCards.find(c => c.id === targetId);
        if (!targetCard) return;
        if (e.target.closest('[data-task-edit]')) {
          e.stopPropagation();
          if (pickedCardId) setPickedCard(null);
          openTaskCardDialog(targetCard, targetCard.status);
          return;
        }
        if (Date.now() < suppressCardClickUntil) return;
        if (boardReadOnly) {
          openTaskCardDialog(targetCard, targetCard.status);
          return;
        }
        if (!pickedCardId) {
          startInlineEdit(cardEl, targetCard);
          return;
        }
        if (pickedCardId === targetId) {
          setPickedCard(null, true);
          return;
        }
        await placePickedCard(targetCard.status, targetCard.id);
      });
    });

    // Clicking anywhere in a column while a note is picked drops it at the end of that column
    container.querySelectorAll('.task-column').forEach(colEl => {
      colEl.addEventListener('click', async e => {
        if (!pickedCardId) return;
        if (e.target.closest('.task-card, button, input, form')) return;
        await placePickedCard(colEl.dataset.colStatus, null);
      });
    });

    // Board-wide keys (bound once): Escape puts the picked note back down
    if (!boardKeysBound) {
      boardKeysBound = true;
      document.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || !pickedCardId || activeDrag) return;
        if (document.querySelector('dialog[open]')) return;
        e.preventDefault();
        setPickedCard(null, true);
        announceBoard(getLocale() === 'en' ? 'Move cancelled.' : '카드 이동을 취소했어요.');
      });
      container.addEventListener('focusin', e => {
        const card = e.target.closest?.('.task-card');
        if (card && e.target.matches?.(':focus-visible') && card.getAnimations().length === 0) {
          card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
    }
  }

  // ==========================================
  // Task Card Modal Dialog (<dialog id="task-card-dialog">)
  // ==========================================
  function openTaskCardDialog(card = null, defaultStatus = 'todo') {
    const dlg = $('#task-card-dialog');
    const form = $('#task-card-form');
    if (!dlg || !form) return;
    attachDialogLightDismissFallback(dlg);

    editingCardId = card ? card.id : null;
    form.reset();
    const en = getLocale() === 'en';
    $('#task-card-dialog-title').textContent = boardReadOnly
      ? (en ? 'Card Details' : '카드 보기')
      : card
        ? (en ? 'Edit Card' : '카드 수정')
        : (en ? 'New Task Card' : '새 카드 만들기');

    if (card?.task_no) {
      const badge = document.createElement('span');
      badge.className = 'task-key-badge';
      badge.textContent = taskKeyOf(card);
      $('#task-card-dialog-title').append(badge);
    }

    form.elements.title.value = card?.title || '';
    form.elements.status.value = card?.status || defaultStatus;
    form.elements.description.value = card?.description || '';
    form.elements.due_date.value = card?.due_date || '';
    form.elements.color.value = EVENT_COLORS.includes(card?.color) ? card.color : 'yellow';

    const assigneeSelect = $('#task-card-assignee');
    if (assigneeSelect) {
      assigneeSelect.innerHTML = `<option value="">${en ? 'Unassigned' : '담당자 없음'}</option>` +
        boardMembers.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
      assigneeSelect.value = card?.assignee_id || '';
    }

    [...form.elements].forEach(el => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) el.disabled = boardReadOnly;
    });
    const delBtn = $('#delete-task-card-btn');
    const saveBtn = $('#save-task-card-btn');
    if (delBtn) delBtn.hidden = !card || boardReadOnly;
    if (saveBtn) saveBtn.hidden = boardReadOnly;
    const errEl = $('#task-card-error');
    if (errEl) errEl.textContent = '';

    dlg.showModal();
  }

  // "@" autocomplete for calendar members inside the card title / memo
  let mentionMenu = null;
  function closeMentionMenu() {
    mentionMenu?.remove();
    mentionMenu = null;
  }
  function bindMentionAutocomplete(field) {
    if (!field || field.dataset.mentionBound === 'true') return;
    field.dataset.mentionBound = 'true';
    let matches = [];
    let active = 0;
    let range = null;

    const choose = member => {
      if (!range) return;
      const before = field.value.slice(0, range.start);
      const after = field.value.slice(range.end);
      field.value = `${before}@${member.name} ${after}`;
      const caret = (before + '@' + member.name + ' ').length;
      field.setSelectionRange(caret, caret);
      closeMentionMenu();
      field.focus();
    };
    const paint = () => {
      if (!mentionMenu) {
        mentionMenu = document.createElement('div');
        mentionMenu.className = 'mention-menu';
        mentionMenu.setAttribute('role', 'listbox');
        mentionMenu.addEventListener('mousedown', e => e.preventDefault());
        (field.closest('dialog') || document.body).append(mentionMenu);
      }
      mentionMenu.dataset.owner = field.name;
      const r = field.getBoundingClientRect();
      mentionMenu.style.left = `${Math.round(r.left)}px`;
      mentionMenu.style.top = `${Math.round(r.bottom + 4)}px`;
      mentionMenu.innerHTML = matches.map((m, i) => `<button type="button" role="option" aria-selected="${i === active}" data-mention-idx="${i}"><span class="task-mini-avatar" aria-hidden="true">${esc(m.name.slice(0, 1))}</span>${esc(m.name)}</button>`).join('');
      mentionMenu.querySelectorAll('[data-mention-idx]').forEach(btn => btn.addEventListener('click', () => choose(matches[+btn.dataset.mentionIdx])));
    };
    const refresh = () => {
      const caret = field.selectionStart ?? field.value.length;
      const upto = field.value.slice(0, caret);
      const m = upto.match(/(^|[\s(])@([^\s@]{0,20})$/u);
      if (!m || field.disabled) { closeMentionMenu(); return; }
      const q = m[2].toLowerCase();
      matches = boardMembers.filter(x => x.name.toLowerCase().includes(q)).slice(0, 6);
      if (!matches.length) { closeMentionMenu(); return; }
      range = { start: caret - m[2].length - 1, end: caret };
      active = Math.min(active, matches.length - 1);
      paint();
    };
    field.addEventListener('input', () => { active = 0; refresh(); });
    field.addEventListener('click', refresh);
    field.addEventListener('blur', () => setTimeout(() => { if (mentionMenu?.dataset.owner === field.name) closeMentionMenu(); }, 120));
    field.addEventListener('keydown', e => {
      if (!mentionMenu) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
        paint();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(matches[active]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMentionMenu();
      }
    });
  }

  async function saveTaskCard(cardId, payload) {
    const cal = getCurrentCalendar();
    if (!cal) return;

    if (isSandboxMode()) {
      if (cardId) {
        const idx = boardCards.findIndex(c => c.id === cardId);
        if (idx >= 0) boardCards[idx] = { ...boardCards[idx], ...payload };
      } else {
        const colCards = boardCards.filter(c => c.status === payload.status);
        const maxOrder = colCards.reduce((m, c) => Math.max(m, c.sort_order ?? 0), -10);
        boardCards.push({
          id: `sb-task-${Date.now()}`,
          status: payload.status || 'todo',
          title: payload.title,
          description: payload.description || '',
          color: payload.color || 'yellow',
          due_date: payload.due_date || '',
          assignee_id: null,
          assignee_name: '',
          task_no: boardCards.reduce((m, c) => Math.max(m, c.task_no || 0), 0) + 1,
          sort_order: maxOrder + 10,
        });
      }
      saveSandboxCards(boardCards);
      renderTaskBoard();
      return;
    }

    if (cardId) {
      await api(`/api/calendars/${cal.id}/tasks/${cardId}`, 'PUT', payload);
    } else {
      await api(`/api/calendars/${cal.id}/tasks`, 'POST', payload);
    }
    await loadTaskBoard();
  }

  function initTaskCardDialogListeners() {
    const dlg = $('#task-card-dialog');
    const form = $('#task-card-form');
    if (!dlg || !form || dlg.dataset.listenersReady === 'true') return;
    dlg.dataset.listenersReady = 'true';
    attachDialogLightDismissFallback(dlg);
    bindMentionAutocomplete(form.elements.title);
    bindMentionAutocomplete(form.elements.description);
    dlg.addEventListener('close', closeMentionMenu);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (boardReadOnly) return;
      const errEl = $('#task-card-error');
      const saveBtn = $('#save-task-card-btn');
      if (errEl) errEl.textContent = '';
      if (saveBtn) saveBtn.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(form));
        await saveTaskCard(editingCardId, data);
        dlg.close();
        toast(editingCardId ? tr('카드를 수정했어요.') : tr('새 카드를 추가했어요.'));
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });

    $('#delete-task-card-btn')?.addEventListener('click', async () => {
      if (!editingCardId || boardReadOnly) return;
      const cal = getCurrentCalendar();
      if (!cal) return;
      const deleted = boardCards.find(c => c.id === editingCardId);
      const deletedIndex = boardCards.indexOf(deleted);
      // The card that followed it in the same column, so undo can put it back in place
      const colOrder = boardCards.filter(c => c.status === deleted?.status).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const nextId = colOrder[colOrder.indexOf(deleted) + 1]?.id || null;
      const undo = {
        label: tr('실행 취소'),
        onClick: async () => {
          if (!deleted) return;
          if (isSandboxMode()) {
            boardCards.splice(Math.max(0, deletedIndex), 0, deleted);
            saveSandboxCards(boardCards);
            renderTaskBoard();
            toast(tr('카드를 되살렸어요.'));
            return;
          }
          try {
            const before = new Set(boardCards.map(c => c.id));
            await api(`/api/calendars/${cal.id}/tasks`, 'POST', { title: deleted.title, status: deleted.status, description: deleted.description || '', color: deleted.color, due_date: deleted.due_date || '', assignee_id: deleted.assignee_id || '' });
            await loadTaskBoard();
            const restored = boardCards.find(c => !before.has(c.id));
            if (restored && nextId && boardCards.some(c => c.id === nextId)) await executeCardMove(restored.id, deleted.status, nextId);
            toast(tr('카드를 되살렸어요.'));
          } catch (err) {
            toast(err.message);
          }
        },
      };
      if (isSandboxMode()) {
        boardCards = boardCards.filter(c => c.id !== editingCardId);
        saveSandboxCards(boardCards);
        dlg.close();
        renderTaskBoard();
        toast(tr('카드를 삭제했어요.'), { action: undo });
        return;
      }
      try {
        await api(`/api/calendars/${cal.id}/tasks/${editingCardId}`, 'DELETE', {});
        dlg.close();
        await loadTaskBoard();
        toast(tr('카드를 삭제했어요.'), { action: undo });
      } catch (err) {
        toast(err.message);
      }
    });
  }

  // ==========================================
  // Direct Messages / 쪽지함 (<dialog id="inbox-dialog">)
  // ==========================================
  function updateUnreadBadges(count) {
    unreadCount = Number(count) || 0;
    document.querySelectorAll('[data-inbox-unread-badge]').forEach(el => {
      el.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      el.hidden = unreadCount <= 0;
    });
  }

  async function refreshUnreadCount() {
    if (!isSandboxMode() && !getMe()?.user) {
      updateUnreadBadges(0);
      return;
    }
    try {
      const data = await msgApi('/api/messages?box=inbox');
      inboxMessages = inboxBox === 'inbox' ? (data?.messages || []) : inboxMessages;
      updateUnreadBadges(data?.unreadCount || 0);
    } catch {}
  }

  async function openInboxDialog(initialTab = 'inbox') {
    const dlg = $('#inbox-dialog');
    if (!dlg) return;
    attachDialogLightDismissFallback(dlg);
    initInboxDialogListeners();

    inboxBox = ['inbox', 'sent', 'compose'].includes(initialTab) ? initialTab : 'inbox';
    expandedMessageId = null;
    dlg.showModal();
    await loadInboxTab(inboxBox);
  }

  async function loadInboxTab(tab) {
    inboxBox = tab;
    document.querySelectorAll('[data-inbox-tab]').forEach(btn => {
      const active = btn.dataset.inboxTab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    const listPanel = $('#inbox-list-panel');
    const composePanel = $('#inbox-compose-panel');
    const markAllBtn = $('#inbox-mark-all-read-btn');

    if (tab === 'compose') {
      if (listPanel) listPanel.hidden = true;
      if (composePanel) composePanel.hidden = false;
      if (markAllBtn) markAllBtn.hidden = true;
      await loadInboxContacts();
      return;
    }

    if (listPanel) listPanel.hidden = false;
    if (composePanel) composePanel.hidden = true;

    try {
      const data = await msgApi(`/api/messages?box=${tab}`);
      inboxMessages = Array.isArray(data?.messages) ? data.messages : [];
      updateUnreadBadges(data?.unreadCount || 0);
      if (markAllBtn) markAllBtn.hidden = tab !== 'inbox' || unreadCount <= 0;
      renderInboxMessages();
    } catch (err) {
      toast(err.message);
    }
  }

  async function loadInboxContacts(preselectId = '', preselectName = '') {
    try {
      const data = await msgApi('/api/messages/contacts');
      inboxContacts = Array.isArray(data?.contacts) ? data.contacts : [];
    } catch {
      inboxContacts = [];
    }
    const select = $('#inbox-recipient-select');
    const emailWrap = $('#inbox-recipient-email-wrap');
    const en = getLocale() === 'en';

    if (select) {
      const options = inboxContacts.map(c => {
        const calHint = c.calendars?.length ? ` (${c.calendars.join(', ')})` : '';
        return `<option value="${esc(c.id)}">${esc(c.name)}${esc(calHint)}</option>`;
      });
      if (preselectId && !inboxContacts.some(c => c.id === preselectId)) {
        options.unshift(`<option value="${esc(preselectId)}">${esc(preselectName || preselectId)}</option>`);
      }
      options.push(`<option value="__email__">${en ? 'Enter email address directly…' : '이메일 주소로 직접 입력…'}</option>`);
      select.innerHTML = options.join('');
      if (preselectId) {
        select.value = preselectId;
      } else if (inboxContacts.length > 0) {
        select.value = inboxContacts[0].id;
      } else {
        select.value = '__email__';
      }
      if (emailWrap) emailWrap.hidden = select.value !== '__email__';
    }
  }

  function formatMsgTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const loc = getLocale() === 'en' ? 'en-US' : 'ko-KR';
    return d.toLocaleString(loc, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderInboxMessages() {
    const container = $('#inbox-messages-list');
    if (!container) return;
    const en = getLocale() === 'en';
    const isSent = inboxBox === 'sent';

    if (!inboxMessages.length) {
      container.innerHTML = `<div class="inbox-empty"><p>${isSent ? (en ? 'No sent messages yet.' : '아직 보낸 쪽지가 없어요.') : (en ? 'Your inbox is empty.' : '아직 받은 쪽지가 없어요.')}</p></div>`;
      return;
    }

    container.innerHTML = inboxMessages.map(m => {
      const unread = !isSent && !m.read_at;
      const expanded = expandedMessageId === m.id;
      const peerLabel = isSent
        ? `${en ? 'To' : '받는 사람'}: ${m.peer_name}`
        : `${m.peer_name}`;
      return `<article class="inbox-item ${unread ? 'is-unread' : ''} ${expanded ? 'is-expanded' : ''}" data-msg-id="${esc(m.id)}">
        <button type="button" class="inbox-item-summary" data-msg-toggle="${esc(m.id)}" aria-expanded="${expanded}">
          <span class="avatar inbox-avatar">${esc((m.peer_name || '?').slice(0, 1))}</span>
          <div class="inbox-item-main">
            <div class="inbox-item-top">
              <strong>${esc(peerLabel)}</strong>
              ${unread ? `<span class="inbox-unread-dot" aria-label="${en ? 'Unread' : '안 읽음'}">N</span>` : ''}
              ${isSent ? `<small class="inbox-read-receipt">${m.read_at ? (en ? 'Read' : '읽음') : (en ? 'Unread' : '읽지 않음')}</small>` : ''}
              <time class="inbox-time">${esc(formatMsgTime(m.created_at))}</time>
            </div>
            <p class="inbox-preview">${esc(m.body)}</p>
          </div>
        </button>
        ${expanded ? `<div class="inbox-item-detail">
          <div class="inbox-full-body">${esc(m.body)}</div>
          <div class="inbox-item-actions">
            ${m.link ? `<button type="button" class="primary small-btn inbox-link-btn" data-msg-link="${esc(m.id)}">${en ? 'Open on Task Board →' : 'Task Board에서 보기 →'}</button>` : ''}
            ${!isSent ? `<button type="button" class="secondary small-btn" data-msg-reply="${esc(m.sender_id)}" data-msg-reply-name="${esc(m.peer_name)}">${en ? 'Reply' : '답장하기'}</button>` : ''}
            <button type="button" class="text-button danger" data-msg-delete="${esc(m.id)}">${en ? 'Delete' : '삭제'}</button>
          </div>
        </div>` : ''}
      </article>`;
    }).join('');
  }

  function initInboxDialogListeners() {
    const dlg = $('#inbox-dialog');
    if (!dlg || dlg.dataset.listenersReady === 'true') return;
    dlg.dataset.listenersReady = 'true';
    attachDialogLightDismissFallback(dlg);

    dlg.addEventListener('click', async e => {
      const tabBtn = e.target.closest('[data-inbox-tab]');
      if (tabBtn) {
        expandedMessageId = null;
        await loadInboxTab(tabBtn.dataset.inboxTab);
        return;
      }

      const toggleBtn = e.target.closest('[data-msg-toggle]');
      if (toggleBtn) {
        const msgId = toggleBtn.dataset.msgToggle;
        expandedMessageId = expandedMessageId === msgId ? null : msgId;
        const msg = inboxMessages.find(m => m.id === msgId);
        if (msg && inboxBox === 'inbox' && !msg.read_at) {
          msg.read_at = new Date().toISOString();
          msgApi('/api/messages/read', 'POST', { messageId: msgId })
            .then(res => {
              updateUnreadBadges(res?.unreadCount ?? Math.max(0, unreadCount - 1));
              const markAllBtn = $('#inbox-mark-all-read-btn');
              if (markAllBtn) markAllBtn.hidden = unreadCount <= 0;
            })
            .catch(() => {});
        }
        renderInboxMessages();
        return;
      }

      const linkBtn = e.target.closest('[data-msg-link]');
      if (linkBtn) {
        const msg = inboxMessages.find(m => m.id === linkBtn.dataset.msgLink);
        try {
          const u = new URL(msg?.link || '', location.origin);
          const calendarId = u.searchParams.get('calendar');
          const taskId = u.searchParams.get('task');
          if (u.origin === location.origin && calendarId && taskId) {
            dlg.close();
            await openTaskLink(calendarId, taskId);
          }
        } catch {}
        return;
      }

      const replyBtn = e.target.closest('[data-msg-reply]');
      if (replyBtn) {
        const targetId = replyBtn.dataset.msgReply;
        const targetName = replyBtn.dataset.msgReplyName;
        await loadInboxTab('compose');
        await loadInboxContacts(targetId, targetName);
        $('#inbox-body-input')?.focus();
        return;
      }

      const delBtn = e.target.closest('[data-msg-delete]');
      if (delBtn) {
        const msgId = delBtn.dataset.msgDelete;
        try {
          const res = await msgApi(`/api/messages/${msgId}`, 'DELETE', {});
          inboxMessages = inboxMessages.filter(m => m.id !== msgId);
          if (res?.unreadCount !== undefined) updateUnreadBadges(res.unreadCount);
          renderInboxMessages();
          toast(tr('쪽지를 삭제했어요.'));
        } catch (err) {
          toast(err.message);
        }
      }
    });

    $('#inbox-mark-all-read-btn')?.addEventListener('click', async () => {
      try {
        const res = await msgApi('/api/messages/read', 'POST', { messageId: 'all' });
        inboxMessages.forEach(m => { if (!m.read_at) m.read_at = new Date().toISOString(); });
        updateUnreadBadges(res?.unreadCount || 0);
        $('#inbox-mark-all-read-btn').hidden = true;
        renderInboxMessages();
      } catch (err) {
        toast(err.message);
      }
    });

    $('#inbox-recipient-select')?.addEventListener('change', e => {
      const emailWrap = $('#inbox-recipient-email-wrap');
      if (emailWrap) emailWrap.hidden = e.target.value !== '__email__';
    });

    const bodyInput = $('#inbox-body-input');
    const charCount = $('#inbox-char-count');
    bodyInput?.addEventListener('input', () => {
      if (charCount) charCount.textContent = `${bodyInput.value.length.toLocaleString()} / 2,000`;
    });

    const composeForm = $('#inbox-compose-form');
    composeForm?.addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = $('#inbox-compose-error');
      const submitBtn = $('#inbox-send-btn');
      if (errEl) errEl.textContent = '';
      const selVal = $('#inbox-recipient-select')?.value || '';
      const payload = {
        body: bodyInput?.value || '',
      };
      if (selVal === '__email__') {
        payload.recipientEmail = $('#inbox-recipient-email')?.value || '';
      } else {
        payload.recipientId = selVal;
      }

      if (submitBtn) submitBtn.disabled = true;
      try {
        await msgApi('/api/messages', 'POST', payload);
        composeForm.reset();
        if (charCount) charCount.textContent = '0 / 2,000';
        toast(tr('쪽지를 보냈어요!'));
        await loadInboxTab('sent');
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Jump from a message / shared link straight to a card: switch to the board, scroll to it, pulse it.
  async function openTaskFromLink(taskId) {
    await setWorkspaceMode('board');
    const card = boardCards.find(c => c.id === taskId || taskKeyOf(c) === taskId);
    const en = getLocale() === 'en';
    if (!card) {
      toast(en ? 'That card no longer exists.' : '카드를 찾을 수 없어요. 삭제되었을 수 있어요.');
      return;
    }
    const el = document.querySelector(`.task-card[data-task-id="${CSS.escape(card.id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    el.classList.add('is-linked-highlight');
    el.focus({ preventScroll: true });
    setTimeout(() => el.classList.remove('is-linked-highlight'), 3600);
  }

  function handleIncomingInboxEvent(rawData) {
    let data = {};
    try { data = JSON.parse(rawData || '{}'); } catch {}
    updateUnreadBadges(unreadCount + 1);
    const senderName = data.senderName || (getLocale() === 'en' ? 'Someone' : '새');
    toast(getLocale() === 'en' ? `New message from ${senderName} ✉️` : `${senderName}님에게서 새 쪽지가 도착했어요 ✉️`);
    const dlg = $('#inbox-dialog');
    if (dlg?.open && inboxBox === 'inbox') {
      loadInboxTab('inbox').catch(() => {});
    }
  }

  function handleTasksStreamEvent() {
    if (workspaceMode === 'board' && !activeDrag && !inlineEditingId) {
      loadTaskBoard().catch(() => {});
    }
  }

  return {
    getWorkspaceMode,
    setWorkspaceMode,
    syncWorkspaceModeUI,
    loadTaskBoard,
    initTaskCardDialogListeners,
    openInboxDialog,
    refreshUnreadCount,
    updateUnreadBadges,
    handleIncomingInboxEvent,
    handleTasksStreamEvent,
    openTaskFromLink,
    getUnreadCount: () => unreadCount,
  };
}
