// Frontend module for Direct Messages (쪽지함) and Task Board (pick-and-move + pointer drag-and-drop)

import { EVENT_COLORS } from './event-utils.js?v=20261125-theme-v1';

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
    if (Array.isArray(raw) && raw.length) return raw;
  } catch {}
  const seed = [
    { id: 'sb-task-1', status: 'todo', title: '주말 여행 숙소 후보 추리기', description: '바다 전망 숙소 2~3곳 비교하기', color: 'blue', assignee_id: null, assignee_name: '', due_date: '', sort_order: 0 },
    { id: 'sb-task-2', status: 'todo', title: '장보기 체크리스트 작성', description: '바비큐 재료 & 음료 확인', color: 'peach', assignee_id: null, assignee_name: '', due_date: '', sort_order: 10 },
    { id: 'sb-task-3', status: 'in_progress', title: '카드를 픽해서 다른 열로 옮겨보세요!', description: '왼쪽 ⠿ 핸들을 드래그하거나 클릭(픽)한 뒤 원하는 열을 눌러 이동할 수 있어요.', color: 'sage', assignee_id: null, assignee_name: '', due_date: '', sort_order: 0 },
    { id: 'sb-task-4', status: 'done', title: '모아 캘린더 둘러보기', description: '로그인하면 함께 쓰는 보드에 저장돼요.', color: 'lavender', assignee_id: null, assignee_name: '', due_date: '', sort_order: 0 },
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
}) {
  let workspaceMode = 'calendar'; // 'calendar' | 'board'
  let boardCards = [];
  let boardMembers = [];
  let boardReadOnly = false;
  let boardLoading = false;
  let editingCardId = null;

  // Pick-and-move state ("카드를 픽해서 옮기기")
  let pickedCardId = null;
  // Active pointer drag state
  let activeDrag = null;

  // Inbox state
  let inboxBox = 'inbox'; // 'inbox' | 'sent' | 'compose'
  let inboxMessages = [];
  let inboxContacts = [];
  let unreadCount = 0;
  let expandedMessageId = null;

  const $ = s => document.querySelector(s);

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
      boardMembers = [];
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

  function renderCardHtml(card) {
    const isPicked = pickedCardId === card.id;
    const color = EVENT_COLORS.includes(card.color) ? card.color : 'sage';
    const dueLabel = card.due_date ? `<span class="task-card-due">📅 ${esc(card.due_date.slice(5).replace('-', '.'))}</span>` : '';
    const assigneeLabel = card.assignee_name ? `<span class="task-card-assignee" title="${esc(card.assignee_name)}"><span class="task-mini-avatar">${esc(card.assignee_name.slice(0, 1))}</span>${esc(card.assignee_name)}</span>` : '';
    const descHtml = card.description ? `<p class="task-card-desc">${esc(card.description)}</p>` : '';
    const handleLabel = getLocale() === 'en'
      ? `Pick or drag ${card.title}`
      : `${card.title} 카드 픽해서 옮기기`;

    return `<article class="task-card ${esc(color)} ${isPicked ? 'is-picked' : ''}" data-task-id="${esc(card.id)}" data-task-status="${esc(card.status)}">
      <div class="task-card-top">
        ${boardReadOnly ? '' : `<button type="button" class="task-card-handle" data-task-handle="${esc(card.id)}" aria-label="${esc(handleLabel)}" aria-pressed="${isPicked}" title="${getLocale() === 'en' ? 'Drag or click to pick & move' : '드래그하거나 클릭(픽)해서 옮기기'}"><span aria-hidden="true">⠿</span></button>`}
        <button type="button" class="task-card-body-btn" data-task-open="${esc(card.id)}">
          <strong class="task-card-title">${esc(card.title)}</strong>
          ${descHtml}
        </button>
      </div>
      ${(dueLabel || assigneeLabel) ? `<div class="task-card-meta">${dueLabel}${assigneeLabel}</div>` : ''}
      ${!boardReadOnly ? `<span class="task-card-key-hint" aria-hidden="true">${isPicked ? (getLocale() === 'en' ? 'Arrows to move · Space to drop · Esc to cancel' : '방향키로 이동 · Space로 놓기 · Esc 취소') : (getLocale() === 'en' ? 'Click or Space to pick' : '클릭·드래그로 픽해서 이동')}</span>` : ''}
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
          <p class="muted small">${en ? 'Pick or drag any card by its ⠿ handle to move it across columns or reorder.' : '카드의 ⠿ 핸들을 드래그하거나 클릭(픽)해서 원하는 열·순서로 자유롭게 옮기세요.'}</p>
        </div>
        <div class="task-board-header-actions">
          <button type="button" class="secondary" data-board-back-calendar>${en ? '← Calendar View' : '← 달력 보기로'}</button>
          ${boardReadOnly ? '' : `<button type="button" class="primary" id="task-board-new-card-btn">＋ ${en ? 'New Card' : '새 카드'}</button>`}
        </div>
      </div>
      ${pickedCard ? `<div class="task-pick-banner" role="region" aria-label="${en ? 'Picked card' : '픽한 카드 안내'}">
        <span>✋ <strong>${esc(pickedCard.title)}</strong> ${en ? 'picked — click any column or card slot to place it.' : '카드를 픽했어요! 옮길 열이나 위치를 클릭해 놓으세요.'}</span>
        <button type="button" class="secondary small-btn" id="cancel-picked-card-btn">${en ? 'Cancel (Esc)' : '픽 취소 (Esc)'}</button>
      </div>` : ''}
      <p id="task-board-live" role="status" class="sr-only"></p>
      <div class="task-board-columns" id="task-board-columns">
        ${TASK_COLUMNS.map(col => {
          const cards = boardCards
            .filter(c => c.status === col.id)
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          const title = en ? col.en : col.ko;
          return `<section class="task-column" data-col-status="${col.id}" aria-label="${esc(title)}">
            <header class="task-column-header">
              <div class="task-column-title">
                <span class="task-status-dot status-${col.id}" aria-hidden="true"></span>
                <h3>${esc(title)}</h3>
                <span class="task-column-count">${cards.length}</span>
              </div>
              ${boardReadOnly ? '' : `<button type="button" class="icon task-col-add-btn" data-add-col-card="${col.id}" aria-label="${esc(title)} ${en ? 'add card' : '카드 추가'}" title="${en ? 'Add card' : '이 열에 카드 추가'}">＋</button>`}
            </header>
            ${pickedCard && !boardReadOnly ? `<button type="button" class="task-column-drop-here" data-place-picked-col="${col.id}">${en ? `Place "${pickedCard.title}" here` : `여기로 '${pickedCard.title}' 옮기기`}</button>` : ''}
            <div class="task-card-list" data-card-list="${col.id}">
              ${cards.length ? cards.map(renderCardHtml).join('') : `<div class="task-column-empty" data-empty-col="${col.id}">${en ? 'No cards yet' : '아직 카드가 없어요'}</div>`}
            </div>
            ${boardReadOnly ? '' : `<form class="task-quick-card-form" data-quick-card-form="${col.id}" autocomplete="off">
              <input type="text" name="title" maxlength="120" placeholder="＋ ${en ? 'Add a card…' : '빠른 카드 추가…'}" aria-label="${esc(title)} ${en ? 'quick card title' : '빠른 카드 제목'}">
            </form>`}
          </section>`;
        }).join('')}
      </div>
    `;

    bindTaskBoardEvents(container);
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
  async function executeCardMove(cardId, targetStatus, beforeCardId = null, focusHandleAfter = false) {
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
            { duration: 190, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
          );
        }
      }
    }

    if (focusHandleAfter) {
      const h = cardEl.querySelector('.task-card-handle');
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
        const handle = document.querySelector(`.task-card-handle[data-task-handle="${CSS.escape(cardId)}"]`);
        handle?.focus({ preventScroll: true });
      }
    }
  }

  // Pointer drag-and-drop (per modern-web-guidance: pointer capture on handle, layout midpoints, real DOM node lift, Escape cancel)
  function startPointerDrag(e, handleEl, cardEl) {
    if (e.button !== 0 || boardReadOnly) return;
    if (activeDrag) return;
    const cardId = handleEl.dataset.taskHandle;
    const boardEl = $('#task-board-columns');
    if (!cardId || !boardEl) return;

    e.preventDefault();
    const pointerId = e.pointerId;
    try { handleEl.setPointerCapture(pointerId); } catch {}

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

    const onMove = ev => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!movedEnough && Math.hypot(dx, dy) < 6) return;
      if (!movedEnough) {
        movedEnough = true;
        pickedCardId = null;
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
      cleanup();

      if (!wasDrag) {
        // Short click/tap on handle -> toggle Pick Mode ("카드를 픽해서 옮기기")!
        setPickedCard(pickedCardId === cardId ? null : cardId, true);
        return;
      }

      await executeCardMove(cardId, finalStatus, finalBefore, true);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function bindTaskBoardEvents(container) {
    container.querySelector('[data-board-back-calendar]')?.addEventListener('click', () => setWorkspaceMode('calendar'));
    container.querySelector('#task-board-new-card-btn')?.addEventListener('click', () => openTaskCardDialog(null, 'todo'));
    container.querySelector('#cancel-picked-card-btn')?.addEventListener('click', () => setPickedCard(null));

    container.querySelectorAll('[data-add-col-card]').forEach(btn => {
      btn.addEventListener('click', () => openTaskCardDialog(null, btn.dataset.addColCard));
    });

    // Place picked card via column banner button
    container.querySelectorAll('[data-place-picked-col]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!pickedCardId) return;
        const id = pickedCardId;
        pickedCardId = null;
        renderTaskBoard();
        await executeCardMove(id, btn.dataset.placePickedCol, null, true);
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
          await saveTaskCard(null, { title, status, description: '', color: 'sage', due_date: '', assignee_id: '' });
          input.value = '';
        } finally {
          input.disabled = false;
          input.focus();
        }
      });
    });

    // Drag handles: pointer drag + keyboard Grab-Move-Drop
    container.querySelectorAll('[data-task-handle]').forEach(handle => {
      const cardEl = handle.closest('.task-card');
      handle.addEventListener('pointerdown', e => startPointerDrag(e, handle, cardEl));
      handle.addEventListener('keydown', async e => {
        const cardId = handle.dataset.taskHandle;
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
        const card = boardCards.find(c => c.id === cardId);
        if (!card) return;
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
    });

    // Reveal whole card on keyboard focus
    container.addEventListener('focusin', e => {
      const card = e.target.closest?.('.task-card');
      if (card && e.target.matches?.(':focus-visible') && card.getAnimations().length === 0) {
        card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });

    // Clicking a card: if another card is currently Picked, place it right before this card! Otherwise open editor.
    container.querySelectorAll('[data-task-open]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.taskOpen;
        if (pickedCardId) {
          if (pickedCardId === targetId) {
            setPickedCard(null);
            return;
          }
          const targetCard = boardCards.find(c => c.id === targetId);
          if (targetCard) {
            const movingId = pickedCardId;
            pickedCardId = null;
            renderTaskBoard();
            await executeCardMove(movingId, targetCard.status, targetCard.id, true);
          }
          return;
        }
        const card = boardCards.find(c => c.id === targetId);
        if (card) openTaskCardDialog(card, card.status);
      });
    });

    // Clicking an empty column area while a card is picked places it at the end of that column
    container.querySelectorAll('.task-card-list').forEach(list => {
      list.addEventListener('click', async e => {
        if (!pickedCardId) return;
        if (e.target.closest('.task-card')) return;
        const movingId = pickedCardId;
        const status = list.dataset.cardList;
        pickedCardId = null;
        renderTaskBoard();
        await executeCardMove(movingId, status, null, true);
      });
    });
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

    form.elements.title.value = card?.title || '';
    form.elements.status.value = card?.status || defaultStatus;
    form.elements.description.value = card?.description || '';
    form.elements.due_date.value = card?.due_date || '';
    form.elements.color.value = EVENT_COLORS.includes(card?.color) ? card.color : 'sage';

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
          color: payload.color || 'sage',
          due_date: payload.due_date || '',
          assignee_id: null,
          assignee_name: '',
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
      if (isSandboxMode()) {
        boardCards = boardCards.filter(c => c.id !== editingCardId);
        saveSandboxCards(boardCards);
        dlg.close();
        renderTaskBoard();
        toast(tr('카드를 삭제했어요.'));
        return;
      }
      try {
        await api(`/api/calendars/${cal.id}/tasks/${editingCardId}`, 'DELETE', {});
        dlg.close();
        await loadTaskBoard();
        toast(tr('카드를 삭제했어요.'));
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
    if (isSandboxMode() || !getMe()?.user) {
      updateUnreadBadges(0);
      return;
    }
    try {
      const data = await api('/api/messages?box=inbox');
      inboxMessages = inboxBox === 'inbox' ? (data?.messages || []) : inboxMessages;
      updateUnreadBadges(data?.unreadCount || 0);
    } catch {}
  }

  async function openInboxDialog(initialTab = 'inbox') {
    if (isSandboxMode()) {
      toast(tr('쪽지함은 로그인 후 바로 사용할 수 있어요!'));
      return;
    }
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
      const data = await api(`/api/messages?box=${tab}`);
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
      const data = await api('/api/messages/contacts');
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
          api('/api/messages/read', 'POST', { messageId: msgId })
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
          const res = await api(`/api/messages/${msgId}`, 'DELETE', {});
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
        const res = await api('/api/messages/read', 'POST', { messageId: 'all' });
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
        await api('/api/messages', 'POST', payload);
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
    if (workspaceMode === 'board' && !activeDrag) {
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
    getUnreadCount: () => unreadCount,
  };
}
