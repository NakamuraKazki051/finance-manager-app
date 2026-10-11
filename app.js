const CURRENT_BOARD_KEY = 'task-manager-app:currentBoard';
const THEME_KEY = 'task-manager-app:theme';
const NOTIFY_KEY = 'task-manager-app:notify';
const LAST_NOTIFIED_KEY = 'task-manager-app:lastNotifiedDate';
const DEFAULT_COLUMNS = [
  { name: '未着手', done: false },
  { name: '進行中', done: false },
  { name: '完了', done: true },
];
const PRIORITY_LABEL = { high: '高', mid: '中', low: '低' };
const TAG_COLORS = ['sky', 'lime', 'green', 'red', 'azure', 'purple', 'yellow', 'orange', 'pink', 'slate'];

// APIは、ページを開いたのと同じオリジンの /api/ にある前提
// (ローカル: http://localhost:8080 / EC2: nginx（80番）が /api/ をバックエンド（8080番）へ中継)
const API_BASE = location.protocol.startsWith('http') ? location.origin : 'http://localhost:8080';

function tagColorClass(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

let boards = [];
let currentBoardId = null;
let tasks = [];
let visibleTasks = [];
let columns = [];
let editingId = null;
let currentChecklist = [];
let currentSort = 'manual';
let searchDebounceTimer = null;
let currentUser = null;
let selectionMode = false;
let selectedTaskIds = new Set();

// --- APIクライアント ---

async function apiFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...options,
    });
  } catch (e) {
    const err = new Error('バックエンドに接続できません。Docker/サーバーが起動しているか確認してください。');
    showApiError(err.message);
    throw err;
  }

  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch (e) { data = null; }
  }

  if (!res.ok) {
    const message = data && data.message ? data.message : `リクエストに失敗しました (${res.status})`;
    // 別の端末でパスワードが変更された・サーバーが再起動したなどでセッションが切れたら、ログアウト状態の画面に戻す
    if (res.status === 401 && currentUser) {
      currentUser = null;
      closeModal();
      renderAuthStatus();
      showLoggedOutState();
    }
    showApiError(message);
    throw new Error(message);
  }

  clearApiError();
  return data;
}

function apiGet(path) { return apiFetch(path); }
function apiPost(path, body) { return apiFetch(path, { method: 'POST', body: JSON.stringify(body) }); }
function apiPut(path, body) { return apiFetch(path, { method: 'PUT', body: JSON.stringify(body) }); }
function apiPatch(path, body) { return apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) }); }
function apiDelete(path) { return apiFetch(path, { method: 'DELETE' }); }

function showApiError(message) {
  document.getElementById('apiErrorMessage').textContent = message;
  document.getElementById('apiErrorBanner').classList.remove('hidden');
}

function clearApiError() {
  document.getElementById('apiErrorBanner').classList.add('hidden');
}

function fromApiTask(t) {
  return {
    id: t.id,
    status: t.columnId,
    title: t.title,
    description: t.description || '',
    dueDate: t.dueDate || '',
    priority: (t.priority || 'MID').toLowerCase(),
    categories: t.categories || [],
    checklist: (t.checklist || []).map(i => ({ id: i.id, text: i.text, done: i.done })),
    createdAt: t.createdAt,
    order: t.displayOrder,
    completed: !!t.completed,
  };
}

function toApiTaskPayload(data, columnId) {
  return {
    title: data.title,
    description: data.description,
    columnId,
    dueDate: data.dueDate || null,
    priority: data.priority.toUpperCase(),
    categories: data.categories,
    checklist: data.checklist.map(i => ({ text: i.text, done: i.done })),
    completed: !!data.completed,
  };
}

function fromApiColumn(c) {
  return { id: c.id, name: c.name, done: c.done };
}

async function loadBoardData(boardId) {
  const [cols, taskList] = await Promise.all([
    apiGet(`/api/boards/${boardId}/columns`),
    apiGet(`/api/boards/${boardId}/tasks`),
  ]);
  currentBoardId = boardId;
  localStorage.setItem(CURRENT_BOARD_KEY, boardId);
  columns = cols.map(fromApiColumn);
  tasks = taskList.map(fromApiTask);
}

async function refreshTasks() {
  const taskList = await apiGet(`/api/boards/${currentBoardId}/tasks`);
  tasks = taskList.map(fromApiTask);
}

async function refreshColumns() {
  const cols = await apiGet(`/api/boards/${currentBoardId}/columns`);
  columns = cols.map(fromApiColumn);
}

async function createDefaultColumns(boardId) {
  for (const c of DEFAULT_COLUMNS) {
    await apiPost(`/api/boards/${boardId}/columns`, { name: c.name, done: c.done });
  }
}

function loadCurrentBoardId() {
  const id = localStorage.getItem(CURRENT_BOARD_KEY);
  return (id && boards.some(b => b.id === id)) ? id : boards[0].id;
}

function parseCategories(str) {
  const list = str.split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(list)];
}

function isOverdue(task) {
  const column = columns.find(c => c.id === task.status);
  if (!task.dueDate || (column && column.done)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(task.dueDate) < today;
}

function isDueSoon(task) {
  const column = columns.find(c => c.id === task.status);
  if (!task.dueDate || (column && column.done)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(task.dueDate);
  if (due < today) return false;
  const diffDays = Math.round((due - today) / 86400000);
  return diffDays <= 2;
}

function getAllCategories() {
  const set = new Set();
  tasks.forEach(t => (t.categories || []).forEach(c => set.add(c)));
  return [...set].sort();
}

function buildTaskSearchParams() {
  const params = new URLSearchParams();
  const category = document.getElementById('filterCategory').value;
  const priority = document.getElementById('filterPriority').value;
  const q = document.getElementById('searchInput').value.trim();
  if (category) params.set('category', category);
  if (priority) params.set('priority', priority.toUpperCase());
  if (q) params.set('q', q);
  params.set('sort', currentSort);
  return params;
}

async function render() {
  const filterCategory = document.getElementById('filterCategory').value;
  renderCategoryFilterOptions(filterCategory);

  const params = buildTaskSearchParams();
  try {
    const taskList = await apiGet(`/api/boards/${currentBoardId}/tasks?${params.toString()}`);
    visibleTasks = taskList.map(fromApiTask);
  } catch (err) {
    return;
  }
  renderColumns();
  updateFilterBar();
}

function isFilterActive() {
  return !!(document.getElementById('filterCategory').value
    || document.getElementById('filterPriority').value
    || document.getElementById('searchInput').value.trim());
}

// 検索・絞り込みでタスクが隠れていることに気づけるよう、件数と解除ボタンを出す
function updateFilterBar() {
  const active = currentBoardId !== null && isFilterActive();
  document.getElementById('filterBar').classList.toggle('hidden', !active);
  if (active) {
    document.getElementById('filterSummary').textContent =
      `絞り込み中: 全${tasks.length}件中 ${visibleTasks.length}件を表示`;
  }
}

function clearFilters() {
  document.getElementById('filterCategory').value = '';
  document.getElementById('filterPriority').value = '';
  document.getElementById('searchInput').value = '';
  render();
}

function renderColumns() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  // 検索やフィルタで見えなくなったタスクは選択から外す(見えていないタスクを誤って消さないため)
  if (selectionMode) {
    const renderedIds = new Set(visibleTasks.map(t => t.id));
    selectedTaskIds = new Set([...selectedTaskIds].filter(id => renderedIds.has(id)));
    updateSelectionBar();
  }

  columns.forEach((col, index) => {
    const section = document.createElement('section');
    section.className = 'column';
    section.dataset.status = col.id;

    const h2 = document.createElement('h2');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'column-name';
    nameSpan.textContent = col.name;
    nameSpan.title = 'クリックして列名を編集・ドラッグで並び替え';
    nameSpan.draggable = true;
    const count = document.createElement('span');
    count.className = 'count';
    const moveLeftBtn = document.createElement('button');
    moveLeftBtn.type = 'button';
    moveLeftBtn.className = 'column-move';
    moveLeftBtn.textContent = '◀';
    moveLeftBtn.setAttribute('aria-label', '列を左に移動');
    moveLeftBtn.title = '列を左に移動';
    moveLeftBtn.disabled = index === 0;
    const moveRightBtn = document.createElement('button');
    moveRightBtn.type = 'button';
    moveRightBtn.className = 'column-move';
    moveRightBtn.textContent = '▶';
    moveRightBtn.setAttribute('aria-label', '列を右に移動');
    moveRightBtn.title = '列を右に移動';
    moveRightBtn.disabled = index === columns.length - 1;
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'column-done-toggle';
    doneBtn.classList.toggle('active', !!col.done);
    doneBtn.textContent = '✓';
    doneBtn.setAttribute('aria-pressed', String(!!col.done));
    doneBtn.title = col.done
      ? 'この列は完了扱いです(クリックで解除)'
      : 'この列を完了扱いにする(期限超過の表示を消す)';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'column-delete';
    delBtn.textContent = '×';
    delBtn.setAttribute('aria-label', '列を削除');

    h2.appendChild(nameSpan);
    h2.appendChild(count);
    h2.appendChild(moveLeftBtn);
    h2.appendChild(moveRightBtn);
    h2.appendChild(doneBtn);
    h2.appendChild(delBtn);

    const list = document.createElement('div');
    list.className = 'card-list';

    section.appendChild(h2);
    section.appendChild(list);
    board.appendChild(section);

    const colTasks = visibleTasks.filter(t => t.status === col.id);
    count.textContent = colTasks.length;

    if (colTasks.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = isFilterActive() ? '条件に合うタスクはありません' : 'タスクはありません';
      list.appendChild(hint);
    }

    colTasks.forEach(task => list.appendChild(renderCard(task)));

    nameSpan.addEventListener('click', () => startEditColumnName(col, nameSpan));
    moveLeftBtn.addEventListener('click', () => moveColumnByOffset(col, -1));
    moveRightBtn.addEventListener('click', () => moveColumnByOffset(col, 1));
    doneBtn.addEventListener('click', () => toggleColumnDone(col));
    delBtn.addEventListener('click', () => deleteColumn(col.id));
    setupColumnDrag(section, nameSpan, col);
    setupDropZone(section, list, col.id);
  });

  board.appendChild(renderAddColumn());
}

function setupColumnDrag(section, handle, col) {
  handle.addEventListener('dragstart', (e) => {
    section.classList.add('column-dragging');
    e.dataTransfer.setData('application/x-column-id', col.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  handle.addEventListener('dragend', () => {
    section.classList.remove('column-dragging');
  });
  section.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-column-id')) return;
    e.preventDefault();
    section.classList.add('column-drag-over');
  });
  section.addEventListener('dragleave', (e) => {
    if (!section.contains(e.relatedTarget)) section.classList.remove('column-drag-over');
  });
  section.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.types.includes('application/x-column-id')) return;
    e.preventDefault();
    section.classList.remove('column-drag-over');
    const draggedId = e.dataTransfer.getData('application/x-column-id');
    if (!draggedId || draggedId === col.id) return;
    await moveColumn(draggedId, col.id);
  });
}

async function moveColumn(draggedId, targetId) {
  const targetIndex = columns.findIndex(c => c.id === targetId);
  if (targetIndex === -1) return;
  try {
    await apiPatch(`/api/columns/${draggedId}/move`, { displayOrder: targetIndex });
  } catch (e) {
    render();
    return;
  }
  await refreshColumns();
  render();
}

async function moveColumnByOffset(col, offset) {
  const index = columns.findIndex(c => c.id === col.id);
  const newIndex = index + offset;
  if (index === -1 || newIndex < 0 || newIndex >= columns.length) return;
  try {
    await apiPatch(`/api/columns/${col.id}/move`, { displayOrder: newIndex });
  } catch (e) {
    render();
    return;
  }
  await refreshColumns();
  render();
}

function startEditColumnName(col, nameSpan) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'column-name-input';
  input.value = col.name;
  input.maxLength = 30;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const val = input.value.trim();
    if (val && val !== col.name) {
      try {
        const updated = await apiPut(`/api/columns/${col.id}`, { name: val });
        col.name = updated.name;
      } catch (e) { /* エラーはバナー表示済み */ }
    }
    render();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); committed = true; render(); }
  });
}

async function toggleColumnDone(col) {
  try {
    const updated = await apiPut(`/api/columns/${col.id}`, { done: !col.done });
    col.done = updated.done;
  } catch (e) { /* エラーはバナー表示済み */ }
  render();
}

async function deleteColumn(id) {
  if (columns.length <= 1) { alert('最後の列は削除できません。'); return; }
  const hasTasks = tasks.some(t => t.status === id);
  if (hasTasks) { alert('この列にはタスクがあります。先にタスクを他の列へ移動してください。'); return; }
  if (!confirm('この列を削除しますか?')) return;
  try {
    await apiDelete(`/api/columns/${id}`);
  } catch (e) { return; }
  columns = columns.filter(c => c.id !== id);
  render();
}

function renderAddColumn() {
  const wrap = document.createElement('section');
  wrap.className = 'column add-column';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'add-column-btn';
  btn.textContent = '+ 列を追加';

  const form = document.createElement('form');
  form.className = 'add-column-form hidden';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '列名を入力';
  input.maxLength = 30;
  const doneLabel = document.createElement('label');
  doneLabel.className = 'add-column-done';
  const doneCheckbox = document.createElement('input');
  doneCheckbox.type = 'checkbox';
  doneLabel.appendChild(doneCheckbox);
  doneLabel.appendChild(document.createTextNode('完了扱いの列にする'));
  const formActions = document.createElement('div');
  formActions.className = 'add-column-actions';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'submit';
  confirmBtn.className = 'btn-primary';
  confirmBtn.textContent = '追加';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'キャンセル';
  formActions.appendChild(confirmBtn);
  formActions.appendChild(cancelBtn);
  form.appendChild(input);
  form.appendChild(doneLabel);
  form.appendChild(formActions);

  btn.addEventListener('click', () => {
    btn.classList.add('hidden');
    form.classList.remove('hidden');
    input.focus();
  });
  cancelBtn.addEventListener('click', () => {
    form.classList.add('hidden');
    btn.classList.remove('hidden');
    input.value = '';
    doneCheckbox.checked = false;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    try {
      const created = await apiPost(`/api/boards/${currentBoardId}/columns`, { name, done: doneCheckbox.checked });
      columns.push(fromApiColumn(created));
    } catch (err) { return; }
    render();
  });

  wrap.appendChild(btn);
  wrap.appendChild(form);
  return wrap;
}

function renderCategoryFilterOptions(selectedValue) {
  const select = document.getElementById('filterCategory');
  const categories = getAllCategories();
  select.innerHTML = '<option value="">全カテゴリ</option>' +
    categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  select.value = categories.includes(selectedValue) ? selectedValue : '';
}

function renderCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.classList.toggle('completed', !!task.completed);
  card.classList.toggle('selectable', selectionMode);
  card.classList.toggle('selected', selectionMode && selectedTaskIds.has(task.id));
  card.draggable = !selectionMode;
  card.dataset.id = task.id;
  // キーボード(Tab/Enter)でもカードを開けるようにする
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  const overdue = isOverdue(task);
  const dueSoon = !overdue && isDueSoon(task);
  const dueLabel = task.dueDate ? formatDueLabel(task.dueDate) : '';
  const checklist = task.checklist || [];
  const checklistDone = checklist.filter(i => i.done).length;

  card.innerHTML = `
    <div class="task-card-head">
      <input type="checkbox" class="task-complete-check" aria-label="タスクを完了にする">
      <div class="task-card-title"></div>
    </div>
    ${task.description ? '<div class="task-card-desc"></div>' : ''}
    <div class="task-meta">
      <span class="badge ${task.priority}">優先度 ${PRIORITY_LABEL[task.priority]}</span>
      ${task.dueDate ? `<span class="badge due ${overdue ? 'overdue' : ''} ${dueSoon ? 'due-soon' : ''}" title="期限: ${task.dueDate}">📅 ${dueLabel}${overdue ? ' (期限超過)' : ''}</span>` : ''}
      ${checklist.length ? `<span class="badge checklist ${checklistDone === checklist.length ? 'complete' : ''}">✓ ${checklistDone}/${checklist.length}</span>` : ''}
      ${(task.categories || []).map(c => `<span class="tag ${tagColorClass(c)}"></span>`).join('')}
    </div>
  `;

  card.querySelector('.task-card-title').textContent = task.title;
  if (task.description) {
    card.querySelector('.task-card-desc').textContent = task.description;
  }
  const tagEls = card.querySelectorAll('.tag');
  (task.categories || []).forEach((c, i) => { tagEls[i].textContent = c; });

  const completeCheck = card.querySelector('.task-complete-check');
  completeCheck.addEventListener('click', (e) => e.stopPropagation());

  // 選択モード中は先頭のチェックボックスとカードのクリックを「選択」に使う
  if (selectionMode) {
    completeCheck.checked = selectedTaskIds.has(task.id);
    completeCheck.setAttribute('aria-label', 'このタスクを選択');
    card.setAttribute('aria-pressed', String(selectedTaskIds.has(task.id)));
    const toggleSelected = () => setTaskSelected(task.id, !selectedTaskIds.has(task.id), card, completeCheck);
    completeCheck.addEventListener('change', () => setTaskSelected(task.id, completeCheck.checked, card, completeCheck));
    card.addEventListener('click', toggleSelected);
    onCardActivateKey(card, toggleSelected);
    return card;
  }

  completeCheck.checked = !!task.completed;
  completeCheck.addEventListener('change', () => toggleTaskComplete(task, completeCheck));

  card.addEventListener('click', () => openModal(task));
  onCardActivateKey(card, () => openModal(task));
  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    // drop先が無効だった場合、dragover中に移動したDOMが実データとズレたままになるため再描画して同期する
    render();
  });

  return card;
}

// カード自体にフォーカスがあるときだけ反応させる(中の完了チェックボックスでのSpaceはそちらの操作)
function onCardActivateKey(card, action) {
  card.addEventListener('keydown', (e) => {
    if (e.target !== card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  });
}

async function toggleTaskComplete(task, checkbox) {
  const completed = checkbox.checked;
  try {
    await apiPatch(`/api/tasks/${task.id}/complete`, { completed });
  } catch (e) {
    checkbox.checked = !completed;
    return;
  }
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx !== -1) tasks[idx].completed = completed;
  render();
}

// --- 一括選択・一括削除 ---

function setSelectionMode(enabled) {
  selectionMode = enabled;
  selectedTaskIds = new Set();
  const btn = document.getElementById('selectionModeBtn');
  btn.classList.toggle('active', enabled);
  btn.setAttribute('aria-pressed', String(enabled));
  document.getElementById('selectionBar').classList.toggle('hidden', !enabled);
  updateSelectionBar();
  if (currentBoardId) renderColumns();
}

function setTaskSelected(id, selected, card, checkbox) {
  if (selected) selectedTaskIds.add(id); else selectedTaskIds.delete(id);
  card.classList.toggle('selected', selected);
  card.setAttribute('aria-pressed', String(selected));
  checkbox.checked = selected;
  updateSelectionBar();
}

function selectTasks(list) {
  list.forEach(t => selectedTaskIds.add(t.id));
  renderColumns();
}

function updateSelectionBar() {
  const n = selectedTaskIds.size;
  document.getElementById('selectionCount').textContent = n > 0
    ? `${n}件選択中`
    : '削除するタスクをクリックして選択';
  document.getElementById('bulkDeleteBtn').disabled = n === 0;
  document.getElementById('clearSelectionBtn').disabled = n === 0;
}

async function handleBulkDelete() {
  const ids = [...selectedTaskIds];
  if (!ids.length) return;
  if (!confirm(`選択した${ids.length}件のタスクを削除しますか?この操作は取り消せません。`)) return;
  try {
    await apiPost(`/api/boards/${currentBoardId}/tasks/bulk-delete`, { taskIds: ids });
  } catch (err) {
    return;
  }
  const deleted = new Set(ids);
  tasks = tasks.filter(t => !deleted.has(t.id));
  selectedTaskIds = new Set();
  updateSelectionBar();
  render();
}

// カードの期限表示。近い日は「今日」「明日」と書き、今年以外は年も付けて取り違えを防ぐ
function formatDueLabel(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays === 0) return '今日まで';
  if (diffDays === 1) return '明日まで';
  if (diffDays === 2) return 'あさってまで';
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return y === today.getFullYear() ? `${mm}/${dd}` : `${y}/${mm}/${dd}`;
}

function formatCreatedAt(isoInstant) {
  const d = new Date(isoInstant);
  if (Number.isNaN(d.getTime())) return '';
  return localDateString(d).replaceAll('-', '/');
}

// toISOString()はUTC基準のため、日本時間の0〜9時に前日の日付になってしまう。ローカル日付で YYYY-MM-DD を作る
function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function setupDropZone(section, list, statusId) {
  section.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-column-id')) return;
    e.preventDefault();
    section.classList.add('drag-over');
    // 手動並び替え以外のソート表示中は、ドロップ時に末尾へ追加するだけなのでプレビュー移動は行わない
    if (currentSort !== 'manual') return;
    const dragging = document.querySelector('.task-card.dragging');
    if (!dragging) return;
    list.querySelector('.empty-hint')?.remove();
    const after = getDragAfterElement(list, e.clientY);
    if (after == null) {
      list.appendChild(dragging);
    } else {
      list.insertBefore(dragging, after);
    }
  });
  section.addEventListener('dragleave', (e) => {
    if (!section.contains(e.relatedTarget)) section.classList.remove('drag-over');
  });
  section.addEventListener('drop', async (e) => {
    if (e.dataTransfer.types.includes('application/x-column-id')) return;
    e.preventDefault();
    section.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    let displayOrder;
    if (currentSort === 'manual') {
      const cardEls = [...list.querySelectorAll('.task-card')];
      displayOrder = cardEls.findIndex(el => el.dataset.id === id);
      if (displayOrder === -1) displayOrder = cardEls.length;
    } else {
      displayOrder = tasks.filter(t => t.status === statusId && t.id !== id).length;
    }

    try {
      await apiPatch(`/api/tasks/${id}/move`, { columnId: statusId, displayOrder });
    } catch (err) {
      render();
      return;
    }
    try {
      await refreshTasks();
    } catch (err) { /* エラーはバナー表示済み。既存の表示のまま */ }
    render();
  });
}

function getDragAfterElement(container, y) {
  const elements = [...container.querySelectorAll('.task-card:not(.dragging)')];
  return elements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function openModal(task) {
  editingId = task ? task.id : null;
  document.getElementById('modalTitle').textContent = task ? 'タスク編集' : 'タスク追加';
  const createdEl = document.getElementById('taskCreatedAt');
  if (task && task.createdAt) {
    createdEl.textContent = `作成日: ${formatCreatedAt(task.createdAt)}`;
    createdEl.classList.remove('hidden');
  } else {
    createdEl.textContent = '';
    createdEl.classList.add('hidden');
  }
  document.getElementById('taskId').value = task ? task.id : '';
  document.getElementById('taskTitle').value = task ? task.title : '';
  document.getElementById('taskDesc').value = task ? (task.description || '') : '';
  document.getElementById('taskDue').value = task ? (task.dueDate || '') : '';
  document.getElementById('taskPriority').value = task ? task.priority : 'mid';
  const statusSelect = document.getElementById('taskStatus');
  statusSelect.innerHTML = columns.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  statusSelect.value = task ? task.status : columns[0].id;
  document.getElementById('taskCategory').value = task ? (task.categories || []).join(', ') : '';
  document.getElementById('taskCompleted').checked = task ? !!task.completed : false;
  document.getElementById('deleteTaskBtn').classList.toggle('hidden', !task);
  currentChecklist = task ? (task.checklist || []).map(i => ({ ...i })) : [];
  document.getElementById('checklistNewItem').value = '';
  renderChecklist();
  document.getElementById('modalOverlay').classList.remove('hidden');
  document.getElementById('taskTitle').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  editingId = null;
  currentChecklist = [];
}

function renderChecklist() {
  const list = document.getElementById('checklistItems');
  list.innerHTML = '';

  currentChecklist.forEach(item => {
    const li = document.createElement('li');
    li.className = 'checklist-item';
    li.innerHTML = `
      <input type="checkbox" class="checklist-check">
      <span class="checklist-text"></span>
      <button type="button" class="checklist-remove" aria-label="削除">×</button>
    `;
    const checkbox = li.querySelector('.checklist-check');
    checkbox.checked = item.done;
    li.classList.toggle('done', item.done);
    li.querySelector('.checklist-text').textContent = item.text;

    checkbox.addEventListener('change', () => {
      item.done = checkbox.checked;
      li.classList.toggle('done', item.done);
      updateChecklistProgress();
    });
    li.querySelector('.checklist-remove').addEventListener('click', () => {
      currentChecklist = currentChecklist.filter(i => i.id !== item.id);
      renderChecklist();
    });

    list.appendChild(li);
  });

  updateChecklistProgress();
}

function updateChecklistProgress() {
  const progress = document.getElementById('checklistProgress');
  if (!currentChecklist.length) {
    progress.textContent = '';
    return;
  }
  const done = currentChecklist.filter(i => i.done).length;
  progress.textContent = `${done}/${currentChecklist.length}`;
}

function addChecklistItem() {
  const input = document.getElementById('checklistNewItem');
  const text = input.value.trim();
  if (!text) return;
  currentChecklist.push({ id: uid(), text, done: false });
  input.value = '';
  renderChecklist();
  input.focus();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function handleSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) return;

  const data = {
    title,
    description: document.getElementById('taskDesc').value.trim(),
    dueDate: document.getElementById('taskDue').value,
    priority: document.getElementById('taskPriority').value,
    categories: parseCategories(document.getElementById('taskCategory').value),
    checklist: currentChecklist,
    completed: document.getElementById('taskCompleted').checked,
  };
  const selectedStatus = document.getElementById('taskStatus').value || (columns[0] ? columns[0].id : '');

  try {
    if (editingId) {
      const updated = await apiPut(`/api/tasks/${editingId}`, toApiTaskPayload(data, selectedStatus));
      const idx = tasks.findIndex(t => t.id === editingId);
      if (idx !== -1) tasks[idx] = fromApiTask(updated);
    } else {
      const created = await apiPost(`/api/boards/${currentBoardId}/tasks`, toApiTaskPayload(data, selectedStatus));
      tasks.push(fromApiTask(created));
    }
  } catch (err) {
    return;
  }

  closeModal();
  render();
  checkDueNotifications();
}

function exportData() {
  const board = boards.find(b => b.id === currentBoardId);
  const payload = {
    app: 'task-manager-app',
    version: 2,
    board: board ? board.name : undefined,
    exportedAt: new Date().toISOString(),
    columns,
    tasks,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `task-manager-backup-${localDateString()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function handleImportFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (err) {
      alert('ファイルの読み込みに失敗しました。正しいJSONファイルを選択してください。');
      return;
    }
    if (!Array.isArray(data.tasks) || !Array.isArray(data.columns) || !data.columns.length) {
      alert('このファイルはタスク管理アプリのバックアップ形式ではないようです。');
      return;
    }
    if (!confirm('インポートすると現在のボードのタスクと列がすべて置き換わります。よろしいですか?')) return;

    const importColumns = data.columns.map((c, idx) => ({
      id: c && c.id != null ? String(c.id) : `col-${idx}`,
      name: c && c.name ? String(c.name) : '無題の列',
      done: !!(c && c.done),
    }));
    const validColumnIds = new Set(importColumns.map(c => c.id));
    const importTasks = data.tasks.map(t => ({
      columnId: validColumnIds.has(t && t.status) ? t.status : importColumns[0].id,
      title: t && t.title ? String(t.title) : '無題のタスク',
      description: t && t.description ? String(t.description) : '',
      dueDate: t && typeof t.dueDate === 'string' && t.dueDate ? t.dueDate : null,
      priority: PRIORITY_LABEL[t && t.priority] ? String(t.priority).toUpperCase() : 'MID',
      categories: [...new Set((Array.isArray(t && t.categories) ? t.categories : [])
        .filter(c => typeof c === 'string' && c.trim())
        .map(c => c.trim()))],
      checklist: (Array.isArray(t && t.checklist) ? t.checklist : [])
        .filter(i => i && typeof i.text === 'string' && i.text.trim())
        .map(i => ({ text: String(i.text), done: !!i.done })),
      completed: !!(t && t.completed),
    }));

    try {
      await apiPut(`/api/boards/${currentBoardId}/import`, { columns: importColumns, tasks: importTasks });
      await loadBoardData(currentBoardId);
    } catch (err) {
      return;
    }
    render();
    checkDueNotifications();
    alert('インポートが完了しました。');
  };
  reader.onerror = () => alert('ファイルの読み込みに失敗しました。');
  reader.readAsText(file);
}

async function handleDelete() {
  if (!editingId) return;
  if (!confirm('このタスクを削除しますか?')) return;
  try {
    await apiDelete(`/api/tasks/${editingId}`);
  } catch (err) {
    return;
  }
  tasks = tasks.filter(t => t.id !== editingId);
  closeModal();
  render();
}

// --- ボード切り替え ---

function renderBoardSelect() {
  const select = document.getElementById('boardSelect');
  select.innerHTML = boards.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('');
  select.value = currentBoardId;
  document.getElementById('deleteBoardBtn').disabled = boards.length <= 1;
}

async function switchBoard(id) {
  if (!boards.some(b => b.id === id) || id === currentBoardId) {
    renderBoardSelect();
    return;
  }
  try {
    await loadBoardData(id);
  } catch (err) {
    renderBoardSelect();
    return;
  }
  setSelectionMode(false);
  currentSort = 'manual';
  document.getElementById('sortSelect').value = 'manual';
  document.getElementById('searchInput').value = '';
  renderBoardSelect();
  render();
  checkDueNotifications();
}

async function addBoard() {
  const name = prompt('新しいボード名を入力してください', '新しいボード');
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  let board;
  try {
    board = await apiPost('/api/boards', { name: trimmed });
    await createDefaultColumns(board.id);
  } catch (err) {
    return;
  }
  boards.push(board);
  await switchBoard(board.id);
}

async function renameBoard() {
  const board = boards.find(b => b.id === currentBoardId);
  if (!board) return;
  const name = prompt('ボード名を変更', board.name);
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const updated = await apiPut(`/api/boards/${currentBoardId}`, { name: trimmed });
    board.name = updated.name;
  } catch (err) {
    return;
  }
  renderBoardSelect();
}

async function deleteBoard() {
  if (boards.length <= 1) { alert('最後のボードは削除できません。'); return; }
  const board = boards.find(b => b.id === currentBoardId);
  if (!board) return;
  if (!confirm(`ボード「${board.name}」を削除しますか?このボードのタスクと列もすべて削除されます。`)) return;
  try {
    await apiDelete(`/api/boards/${currentBoardId}`);
  } catch (err) {
    return;
  }
  boards = boards.filter(b => b.id !== currentBoardId);
  await switchBoard(boards[0].id);
}

// --- テーマ(ライト/ダーク)手動切り替え ---

function loadTheme() {
  const theme = localStorage.getItem(THEME_KEY);
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

function applyTheme(theme) {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {
    console.error('Failed to save theme to localStorage', e);
  }
  updateThemeBtn(theme);
}

function updateThemeBtn(theme) {
  const btn = document.getElementById('themeToggleBtn');
  const labels = { system: '🖥️ テーマ: 自動', light: '☀️ テーマ: ライト', dark: '🌙 テーマ: ダーク' };
  btn.textContent = labels[theme];
  btn.title = 'クリックでテーマを切り替え(自動→ライト→ダーク)';
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(loadTheme()) + 1) % order.length];
  applyTheme(next);
}

// --- 期限リマインダー(通知) ---

function updateNotifyBtn() {
  const btn = document.getElementById('notifyToggleBtn');
  if (!('Notification' in window)) {
    btn.disabled = true;
    btn.textContent = '🔔 通知非対応';
    return;
  }
  const enabled = localStorage.getItem(NOTIFY_KEY) === 'true' && Notification.permission === 'granted';
  btn.textContent = enabled ? '🔔 期限通知ON' : '🔕 期限通知OFF';
  btn.classList.toggle('active', enabled);
}

function toggleNotify() {
  if (!('Notification' in window)) return;
  const enabled = localStorage.getItem(NOTIFY_KEY) === 'true' && Notification.permission === 'granted';
  if (enabled) {
    localStorage.setItem(NOTIFY_KEY, 'false');
    updateNotifyBtn();
    return;
  }
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      localStorage.setItem(NOTIFY_KEY, 'true');
      updateNotifyBtn();
      checkDueNotifications(true);
    } else {
      alert('通知が許可されませんでした。ブラウザの通知設定を確認してください。');
      updateNotifyBtn();
    }
  });
}

function checkDueNotifications(force) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (localStorage.getItem(NOTIFY_KEY) !== 'true') return;
  const todayStr = localDateString();
  if (!force && localStorage.getItem(LAST_NOTIFIED_KEY) === todayStr) return;
  const dueTasks = tasks.filter(t => {
    const col = columns.find(c => c.id === t.status);
    if (!t.dueDate || (col && col.done)) return false;
    return t.dueDate <= todayStr;
  });
  if (dueTasks.length) {
    try {
      new Notification('タスク管理', { body: `本日期限・期限超過のタスクが${dueTasks.length}件あります。` });
    } catch (e) {
      console.error('Failed to show notification', e);
    }
  }
  try {
    localStorage.setItem(LAST_NOTIFIED_KEY, todayStr);
  } catch (e) {
    console.error('Failed to save notification date to localStorage', e);
  }
}

// --- ログイン/ログアウト ---

async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
    currentUser = res.ok ? await res.json() : null;
  } catch (e) {
    currentUser = null;
  }
  renderAuthStatus();
}

function setLoggedInUiVisible(visible) {
  document.getElementById('boardSwitcher').classList.toggle('hidden', !visible);
  document.getElementById('headerActions').classList.toggle('hidden', !visible);
}

function showLoggedOutState() {
  boards = [];
  tasks = [];
  visibleTasks = [];
  columns = [];
  currentBoardId = null;
  setSelectionMode(false);
  setLoggedInUiVisible(false);
  updateFilterBar();
  const board = document.getElementById('board');
  board.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'empty-hint';
  hint.textContent = 'ログインするとボードが表示されます。';
  board.appendChild(hint);
}

async function loadApp() {
  setLoggedInUiVisible(true);
  try {
    boards = await apiGet('/api/boards');
    if (!boards.length) {
      // 「ボードが無ければ作る」をフロントで判定すると、複数タブや二重ログインで同時に走ったときに
      // マイボードが重複して作られるため、判定と作成はサーバー側でまとめて行う
      boards = await apiPost('/api/boards/ensure-default', {});
    }
    await loadBoardData(loadCurrentBoardId());
  } catch (err) {
    return;
  }
  renderBoardSelect();
  render();
  checkDueNotifications();
}

function renderAuthStatus() {
  const el = document.getElementById('authStatus');
  el.innerHTML = '';
  if (currentUser) {
    const emailSpan = document.createElement('span');
    emailSpan.className = 'auth-email';
    emailSpan.textContent = currentUser.email;
    emailSpan.title = currentUser.email;
    const accountBtn = document.createElement('button');
    accountBtn.type = 'button';
    accountBtn.className = 'btn-secondary';
    accountBtn.textContent = 'アカウント設定';
    accountBtn.addEventListener('click', openAccountModal);
    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'btn-secondary';
    logoutBtn.textContent = 'ログアウト';
    logoutBtn.addEventListener('click', handleLogout);
    el.appendChild(emailSpan);
    el.appendChild(accountBtn);
    el.appendChild(logoutBtn);
  } else {
    const loginBtn = document.createElement('button');
    loginBtn.type = 'button';
    loginBtn.className = 'btn-secondary';
    loginBtn.textContent = 'ログイン';
    loginBtn.addEventListener('click', openAuthModal);
    const registerBtn = document.createElement('button');
    registerBtn.type = 'button';
    registerBtn.className = 'btn-secondary';
    registerBtn.textContent = '新規登録';
    registerBtn.addEventListener('click', openRegisterModal);
    el.appendChild(loginBtn);
    el.appendChild(registerBtn);
  }
}

function openAuthModal() {
  const form = document.getElementById('authForm');
  form.reset();
  resetPasswordVisibility(form);
  document.getElementById('authError').classList.add('hidden');
  document.getElementById('authModalOverlay').classList.remove('hidden');
  document.getElementById('authEmail').focus();
}

function closeAuthModal() {
  document.getElementById('authModalOverlay').classList.add('hidden');
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const passwordConfirm = document.getElementById('authPasswordConfirm').value;
  const errorEl = document.getElementById('authError');
  errorEl.classList.add('hidden');

  if (password !== passwordConfirm) {
    errorEl.textContent = 'パスワードが一致しません。';
    errorEl.classList.remove('hidden');
    return;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    errorEl.textContent = 'バックエンドに接続できません。';
    errorEl.classList.remove('hidden');
    return;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    errorEl.textContent = (data && data.message) || 'ログインに失敗しました。';
    errorEl.classList.remove('hidden');
    return;
  }

  currentUser = await res.json();
  closeAuthModal();
  renderAuthStatus();
  await loadApp();
}

function openRegisterModal() {
  const form = document.getElementById('registerForm');
  form.reset();
  resetPasswordVisibility(form);
  document.getElementById('registerError').classList.add('hidden');
  document.getElementById('registerModalOverlay').classList.remove('hidden');
  document.getElementById('registerEmail').focus();
}

function closeRegisterModal() {
  document.getElementById('registerModalOverlay').classList.add('hidden');
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
  const errorEl = document.getElementById('registerError');
  errorEl.classList.add('hidden');

  if (password !== passwordConfirm) {
    errorEl.textContent = 'パスワードが一致しません。';
    errorEl.classList.remove('hidden');
    return;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/users/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    errorEl.textContent = 'バックエンドに接続できません。';
    errorEl.classList.remove('hidden');
    return;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    errorEl.textContent = (data && data.message) || '登録に失敗しました。';
    errorEl.classList.remove('hidden');
    return;
  }

  let loginRes;
  try {
    loginRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    closeRegisterModal();
    openAuthModal();
    return;
  }
  if (!loginRes.ok) {
    closeRegisterModal();
    openAuthModal();
    return;
  }

  currentUser = await loginRes.json();
  closeRegisterModal();
  renderAuthStatus();
  await loadApp();
}

function openAccountModal() {
  const form = document.getElementById('accountForm');
  form.reset();
  resetPasswordVisibility(form);
  document.getElementById('accountEmail').value = currentUser ? currentUser.email : '';
  document.getElementById('accountError').classList.add('hidden');
  document.getElementById('accountModalOverlay').classList.remove('hidden');
  document.getElementById('accountEmail').focus();
}

function closeAccountModal() {
  document.getElementById('accountModalOverlay').classList.add('hidden');
}

async function handleAccountSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('accountEmail').value.trim();
  const currentPassword = document.getElementById('accountCurrentPassword').value;
  const newPassword = document.getElementById('accountNewPassword').value;
  const errorEl = document.getElementById('accountError');
  errorEl.classList.add('hidden');

  const payload = { email, currentPassword };
  if (newPassword) payload.newPassword = newPassword;

  let res;
  try {
    res = await fetch(`${API_BASE}/api/users/me`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    errorEl.textContent = 'バックエンドに接続できません。';
    errorEl.classList.remove('hidden');
    return;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    errorEl.textContent = (data && data.message) || 'アカウントの更新に失敗しました。';
    errorEl.classList.remove('hidden');
    return;
  }

  currentUser = await res.json();
  closeAccountModal();
  renderAuthStatus();
}

async function handleLogout() {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch (e) { /* ローカル状態のクリアは継続する */ }
  currentUser = null;
  renderAuthStatus();
  showLoggedOutState();
}

function closeMoreMenu() {
  document.getElementById('moreMenu').removeAttribute('open');
}

document.getElementById('addTaskBtn').addEventListener('click', () => openModal(null));
document.getElementById('exportBtn').addEventListener('click', () => {
  closeMoreMenu();
  exportData();
});
document.getElementById('importBtn').addEventListener('click', () => {
  closeMoreMenu();
  document.getElementById('importFile').click();
});
document.addEventListener('click', (e) => {
  const menu = document.getElementById('moreMenu');
  if (menu.open && !menu.contains(e.target)) closeMoreMenu();
});
document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);
document.getElementById('importFile').addEventListener('change', handleImportFile);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('taskForm').addEventListener('submit', handleSubmit);
document.getElementById('deleteTaskBtn').addEventListener('click', handleDelete);
document.getElementById('checklistAddBtn').addEventListener('click', addChecklistItem);
document.getElementById('checklistNewItem').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addChecklistItem();
  }
});
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});
document.getElementById('filterCategory').addEventListener('change', render);
document.getElementById('filterPriority').addEventListener('change', render);
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(render, 300);
});
document.getElementById('sortSelect').addEventListener('change', (e) => {
  currentSort = e.target.value;
  render();
});
document.getElementById('selectionModeBtn').addEventListener('click', () => setSelectionMode(!selectionMode));
document.getElementById('exitSelectionBtn').addEventListener('click', () => setSelectionMode(false));
document.getElementById('selectAllVisibleBtn').addEventListener('click', () => selectTasks(visibleTasks));
document.getElementById('selectCompletedBtn').addEventListener('click', () => selectTasks(visibleTasks.filter(t => t.completed)));
document.getElementById('clearSelectionBtn').addEventListener('click', () => {
  selectedTaskIds = new Set();
  renderColumns();
});
document.getElementById('bulkDeleteBtn').addEventListener('click', handleBulkDelete);
document.getElementById('themeToggleBtn').addEventListener('click', cycleTheme);
document.getElementById('notifyToggleBtn').addEventListener('click', toggleNotify);
document.getElementById('boardSelect').addEventListener('change', (e) => switchBoard(e.target.value));
document.getElementById('addBoardBtn').addEventListener('click', addBoard);
document.getElementById('renameBoardBtn').addEventListener('click', renameBoard);
document.getElementById('deleteBoardBtn').addEventListener('click', deleteBoard);
document.getElementById('apiErrorDismiss').addEventListener('click', clearApiError);
document.querySelectorAll('.password-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '🙈' : '👁';
    btn.setAttribute('aria-label', show ? 'パスワードを非表示' : 'パスワードを表示');
  });
});

function resetPasswordVisibility(form) {
  form.querySelectorAll('.password-toggle').forEach((btn) => {
    document.getElementById(btn.dataset.target).type = 'password';
    btn.textContent = '👁';
    btn.setAttribute('aria-label', 'パスワードを表示');
  });
}
document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
document.getElementById('authCancelBtn').addEventListener('click', closeAuthModal);
document.getElementById('authModalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'authModalOverlay') closeAuthModal();
});
document.getElementById('registerForm').addEventListener('submit', handleRegisterSubmit);
document.getElementById('registerCancelBtn').addEventListener('click', closeRegisterModal);
document.getElementById('registerModalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'registerModalOverlay') closeRegisterModal();
});
document.getElementById('accountForm').addEventListener('submit', handleAccountSubmit);
document.getElementById('accountCancelBtn').addEventListener('click', closeAccountModal);
document.getElementById('accountModalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'accountModalOverlay') closeAccountModal();
});
document.addEventListener('keydown', (e) => {
  const anyModalOpen = [...document.querySelectorAll('.modal-overlay')].some(el => !el.classList.contains('hidden'));
  const menu = document.getElementById('moreMenu');
  if (e.key === 'Escape' && menu.open) {
    closeMoreMenu();
    menu.querySelector('summary').focus();
    return;
  }
  // 文字入力中やモーダル表示中は横取りしない
  const typing = e.target.closest('input, textarea, select, [contenteditable="true"]');
  if (!typing && !anyModalOpen && currentBoardId && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openModal(null);
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('searchInput').focus();
      return;
    }
  }
  if (e.key === 'Escape' && selectionMode && !anyModalOpen) {
    setSelectionMode(false);
  }
  if (e.key === 'Escape' && !document.getElementById('modalOverlay').classList.contains('hidden')) {
    closeModal();
  }
  if (e.key === 'Escape' && !document.getElementById('authModalOverlay').classList.contains('hidden')) {
    closeAuthModal();
  }
  if (e.key === 'Escape' && !document.getElementById('accountModalOverlay').classList.contains('hidden')) {
    closeAccountModal();
  }
  if (e.key === 'Escape' && !document.getElementById('registerModalOverlay').classList.contains('hidden')) {
    closeRegisterModal();
  }
});

function warnIfOpenedAsFile() {
  if (location.protocol !== 'file:') return false;
  const correctUrl = `${API_BASE}/`;
  document.body.innerHTML = `
    <div style="max-width: 560px; margin: 15vh auto; padding: 24px 28px; background: #fff3cd; color: #664d03; border: 1px solid #ffe69c; border-radius: 8px; font-family: sans-serif; line-height: 1.7;">
      <h1 style="font-size: 1.1rem; margin: 0 0 10px;">このページでは正しく動作しません</h1>
      <p style="margin: 0 0 10px;">このアプリはバックエンドと同じオリジンで開く必要があります。ファイルを直接開くと、ログインしてもセッションが保持されず、ボードが表示されません。</p>
      <p style="margin: 0;">バックエンドを起動した状態で <a href="${correctUrl}" style="color: #0c66e4; font-weight: 700;">${correctUrl}</a> を開いてください。</p>
    </div>
  `;
  return true;
}

async function init() {
  if (warnIfOpenedAsFile()) return;
  applyTheme(loadTheme());
  updateNotifyBtn();
  await checkAuth();
  if (currentUser) {
    await loadApp();
  } else {
    showLoggedOutState();
  }
}

init();
