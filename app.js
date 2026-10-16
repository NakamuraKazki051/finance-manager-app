const CURRENT_BOOK_KEY = 'finance-manager-app:currentBook';
const THEME_KEY = 'finance-manager-app:theme';
const MAX_AMOUNT = 99999999;
const TYPE_LABEL = { INCOME: '収入', EXPENSE: '支出' };
const TAG_COLORS = ['sky', 'lime', 'green', 'red', 'azure', 'purple', 'yellow', 'orange', 'pink', 'slate'];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// APIは、ページを開いたのと同じオリジンの /api/ にある前提
// (ローカル: http://localhost:8080 / EC2: nginx（80番）が /api/ をバックエンド（8080番）へ中継)
const API_BASE = location.protocol.startsWith('http') ? location.origin : 'http://localhost:8080';

function tagColorClass(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

let books = [];
let currentBookId = null;
let categories = [];
let currentMonth = currentMonthString();
// 表示中の月の取引すべて(絞り込み前)と、絞り込み後に画面に出す取引
let monthTxns = [];
let visibleTxns = [];
let summary = null;
let editingId = null;
let currentSort = 'date';
let searchDebounceTimer = null;
let currentUser = null;
let selectionMode = false;
let selectedTxnIds = new Set();
// 月を素早く切り替えたとき、古い月の応答が後から届いて表示を上書きしないようにする
let renderSeq = 0;

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

function fromApiTxn(t) {
  return {
    id: t.id,
    categoryId: t.categoryId,
    amount: t.amount,
    date: t.date,
    memo: t.memo || '',
    tags: t.tags || [],
    createdAt: t.createdAt,
  };
}

function fromApiCategory(c) {
  return { id: c.id, name: c.name, type: c.type };
}

async function loadBookData(bookId) {
  const cats = await apiGet(`/api/books/${bookId}/categories`);
  currentBookId = bookId;
  localStorage.setItem(CURRENT_BOOK_KEY, bookId);
  categories = cats.map(fromApiCategory);
}

async function refreshCategories() {
  const cats = await apiGet(`/api/books/${currentBookId}/categories`);
  categories = cats.map(fromApiCategory);
}

function loadCurrentBookId() {
  const id = localStorage.getItem(CURRENT_BOOK_KEY);
  return (id && books.some(b => b.id === id)) ? id : books[0].id;
}

// --- 金額・日付の表示 ---

function formatYen(amount) {
  return `¥${Number(amount).toLocaleString('ja-JP')}`;
}

// 残高はマイナスになりうるので、符号を付けて表示する
function formatSignedYen(amount) {
  return amount < 0 ? `-${formatYen(-amount)}` : formatYen(amount);
}

// toISOString()はUTC基準のため、日本時間の0〜9時に前日の日付になってしまう。ローカル日付で YYYY-MM-DD を作る
function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentMonthString() {
  return localDateString().slice(0, 7);
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return localDateString(d).slice(0, 7);
}

function formatMonthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

// カードの日付。曜日を付けて、いつの出費か思い出しやすくする
function formatTxnDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${weekday})`;
}

function formatCreatedAt(isoInstant) {
  const d = new Date(isoInstant);
  if (Number.isNaN(d.getTime())) return '';
  return localDateString(d).replaceAll('-', '/');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function parseTags(str) {
  const list = str.split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(list)];
}

function categoryById(id) {
  return categories.find(c => c.id === id);
}

// --- 描画 ---

function getAllTags() {
  const set = new Set();
  monthTxns.forEach(t => t.tags.forEach(tag => set.add(tag)));
  return [...set].sort();
}

function readAmountFilter(id) {
  const value = document.getElementById(id).value.trim();
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function isFilterActive() {
  return !!(document.getElementById('filterTag').value
    || document.getElementById('searchInput').value.trim()
    || readAmountFilter('minAmount') !== null
    || readAmountFilter('maxAmount') !== null);
}

function buildFilterParams() {
  const params = new URLSearchParams();
  params.set('month', currentMonth);
  params.set('sort', currentSort);
  const tag = document.getElementById('filterTag').value;
  const q = document.getElementById('searchInput').value.trim();
  const min = readAmountFilter('minAmount');
  const max = readAmountFilter('maxAmount');
  if (tag) params.set('tag', tag);
  if (q) params.set('q', q);
  if (min !== null) params.set('minAmount', String(min));
  if (max !== null) params.set('maxAmount', String(max));
  return params;
}

async function render() {
  if (!currentBookId) return;
  const seq = ++renderSeq;
  const base = `/api/books/${currentBookId}`;
  let monthList, monthSummary, filteredList;
  try {
    [monthList, monthSummary] = await Promise.all([
      apiGet(`${base}/transactions?month=${currentMonth}&sort=${currentSort}`),
      apiGet(`${base}/summary?month=${currentMonth}`),
    ]);
    filteredList = isFilterActive()
      ? await apiGet(`${base}/transactions?${buildFilterParams().toString()}`)
      : monthList;
  } catch (err) {
    return;
  }
  if (seq !== renderSeq) return;
  monthTxns = monthList.map(fromApiTxn);
  visibleTxns = filteredList.map(fromApiTxn);
  summary = monthSummary;
  renderTagFilterOptions(document.getElementById('filterTag').value);
  renderMonthBar();
  renderColumns();
  updateFilterBar();
}

function renderMonthBar() {
  document.getElementById('monthLabel').textContent = formatMonthLabel(currentMonth);
  document.getElementById('thisMonthBtn').disabled = currentMonth === currentMonthString();
  const income = summary ? summary.income : 0;
  const expense = summary ? summary.expense : 0;
  const balance = summary ? summary.balance : 0;
  document.getElementById('summaryIncome').textContent = formatYen(income);
  document.getElementById('summaryExpense').textContent = formatYen(expense);
  const balanceEl = document.getElementById('summaryBalance');
  balanceEl.textContent = formatSignedYen(balance);
  balanceEl.classList.toggle('negative', balance < 0);
}

async function changeMonth(month) {
  if (month === currentMonth) return;
  currentMonth = month;
  // 前の月で選んだ取引が見えないまま残って、まとめて削除されないようにする
  selectedTxnIds = new Set();
  updateSelectionBar();
  // 金額は新しい月の集計が届いてから描き直す(前の月の金額を新しい月の名前の横に出さない)
  document.getElementById('monthLabel').textContent = formatMonthLabel(currentMonth);
  await render();
}

// 検索・絞り込みで取引が隠れていることに気づけるよう、件数と解除ボタンを出す
function updateFilterBar() {
  const active = currentBookId !== null && isFilterActive();
  document.getElementById('filterBar').classList.toggle('hidden', !active);
  if (active) {
    const total = visibleTxns.reduce((sum, t) => sum + t.amount, 0);
    document.getElementById('filterSummary').textContent =
      `絞り込み中: この月の${monthTxns.length}件中 ${visibleTxns.length}件を表示(合計 ${formatYen(total)})`;
  }
}

function clearFilters() {
  document.getElementById('filterTag').value = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('minAmount').value = '';
  document.getElementById('maxAmount').value = '';
  render();
}

function renderTagFilterOptions(selectedValue) {
  const select = document.getElementById('filterTag');
  const tags = getAllTags();
  // 今の月に無いタグで絞り込み中でも、選択が勝手に外れないよう残しておく
  if (selectedValue && !tags.includes(selectedValue)) tags.push(selectedValue);
  select.innerHTML = '<option value="">全タグ</option>' +
    tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  select.value = selectedValue || '';
}

function categoryTotal(categoryId) {
  const row = summary && summary.categories.find(c => c.categoryId === categoryId);
  return row ? row.total : 0;
}

function renderColumns() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  // 検索やフィルタで見えなくなった取引は選択から外す(見えていない取引を誤って消さないため)
  if (selectionMode) {
    const renderedIds = new Set(visibleTxns.map(t => t.id));
    selectedTxnIds = new Set([...selectedTxnIds].filter(id => renderedIds.has(id)));
    updateSelectionBar();
  }

  categories.forEach((cat, index) => {
    const section = document.createElement('section');
    section.className = `column ${cat.type === 'INCOME' ? 'income' : 'expense'}`;
    section.dataset.categoryId = cat.id;

    const h2 = document.createElement('h2');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'column-name';
    nameSpan.textContent = cat.name;
    nameSpan.title = 'クリックしてカテゴリ名を編集・ドラッグで並び替え';
    nameSpan.draggable = true;
    const typeBtn = document.createElement('button');
    typeBtn.type = 'button';
    typeBtn.className = `column-type ${cat.type === 'INCOME' ? 'income' : 'expense'}`;
    typeBtn.textContent = TYPE_LABEL[cat.type];
    typeBtn.title = `${TYPE_LABEL[cat.type]}のカテゴリです(クリックで${TYPE_LABEL[otherType(cat.type)]}に変更)`;
    const count = document.createElement('span');
    count.className = 'count';
    const moveLeftBtn = document.createElement('button');
    moveLeftBtn.type = 'button';
    moveLeftBtn.className = 'column-move';
    moveLeftBtn.textContent = '◀';
    moveLeftBtn.setAttribute('aria-label', 'カテゴリを左に移動');
    moveLeftBtn.title = 'カテゴリを左に移動';
    moveLeftBtn.disabled = index === 0;
    const moveRightBtn = document.createElement('button');
    moveRightBtn.type = 'button';
    moveRightBtn.className = 'column-move';
    moveRightBtn.textContent = '▶';
    moveRightBtn.setAttribute('aria-label', 'カテゴリを右に移動');
    moveRightBtn.title = 'カテゴリを右に移動';
    moveRightBtn.disabled = index === categories.length - 1;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'column-delete';
    delBtn.textContent = '×';
    delBtn.setAttribute('aria-label', 'カテゴリを削除');

    h2.appendChild(nameSpan);
    h2.appendChild(count);
    h2.appendChild(moveLeftBtn);
    h2.appendChild(moveRightBtn);
    h2.appendChild(delBtn);

    const totalRow = document.createElement('div');
    totalRow.className = 'column-total';
    const totalAmount = document.createElement('span');
    totalAmount.className = 'column-total-amount';
    totalAmount.textContent = formatYen(categoryTotal(cat.id));
    totalAmount.title = `${formatMonthLabel(currentMonth)}の合計`;
    totalRow.appendChild(typeBtn);
    totalRow.appendChild(totalAmount);

    const list = document.createElement('div');
    list.className = 'card-list';

    section.appendChild(h2);
    section.appendChild(totalRow);
    section.appendChild(list);
    board.appendChild(section);

    const colTxns = visibleTxns.filter(t => t.categoryId === cat.id);
    count.textContent = colTxns.length;

    if (colTxns.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = isFilterActive() ? '条件に合う取引はありません' : 'この月の取引はありません';
      list.appendChild(hint);
    }

    colTxns.forEach(txn => list.appendChild(renderCard(txn, cat)));

    nameSpan.addEventListener('click', () => startEditCategoryName(cat, nameSpan));
    typeBtn.addEventListener('click', () => toggleCategoryType(cat));
    moveLeftBtn.addEventListener('click', () => moveCategoryByOffset(cat, -1));
    moveRightBtn.addEventListener('click', () => moveCategoryByOffset(cat, 1));
    delBtn.addEventListener('click', () => deleteCategory(cat));
    setupColumnDrag(section, nameSpan, cat);
    setupDropZone(section, cat.id);
  });

  board.appendChild(renderAddColumn());
}

function otherType(type) {
  return type === 'INCOME' ? 'EXPENSE' : 'INCOME';
}

function setupColumnDrag(section, handle, cat) {
  handle.addEventListener('dragstart', (e) => {
    section.classList.add('column-dragging');
    e.dataTransfer.setData('application/x-category-id', cat.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  handle.addEventListener('dragend', () => {
    section.classList.remove('column-dragging');
  });
  section.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-category-id')) return;
    e.preventDefault();
    section.classList.add('column-drag-over');
  });
  section.addEventListener('dragleave', (e) => {
    if (!section.contains(e.relatedTarget)) section.classList.remove('column-drag-over');
  });
  section.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.types.includes('application/x-category-id')) return;
    e.preventDefault();
    section.classList.remove('column-drag-over');
    const draggedId = e.dataTransfer.getData('application/x-category-id');
    if (!draggedId || draggedId === cat.id) return;
    await moveCategory(draggedId, cat.id);
  });
}

async function moveCategory(draggedId, targetId) {
  const targetIndex = categories.findIndex(c => c.id === targetId);
  if (targetIndex === -1) return;
  try {
    await apiPatch(`/api/categories/${draggedId}/move`, { displayOrder: targetIndex });
    await refreshCategories();
  } catch (e) { /* エラーはバナー表示済み */ }
  render();
}

async function moveCategoryByOffset(cat, offset) {
  const index = categories.findIndex(c => c.id === cat.id);
  const newIndex = index + offset;
  if (index === -1 || newIndex < 0 || newIndex >= categories.length) return;
  try {
    await apiPatch(`/api/categories/${cat.id}/move`, { displayOrder: newIndex });
    await refreshCategories();
  } catch (e) { /* エラーはバナー表示済み */ }
  render();
}

function startEditCategoryName(cat, nameSpan) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'column-name-input';
  input.value = cat.name;
  input.maxLength = 30;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const val = input.value.trim();
    if (val && val !== cat.name) {
      try {
        const updated = await apiPut(`/api/categories/${cat.id}`, { name: val });
        cat.name = updated.name;
      } catch (e) { /* エラーはバナー表示済み */ }
    }
    renderColumns();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); committed = true; renderColumns(); }
  });
}

async function toggleCategoryType(cat) {
  const next = otherType(cat.type);
  if (!confirm(`「${cat.name}」を${TYPE_LABEL[next]}のカテゴリに変更しますか?\nこのカテゴリの取引は、すべての月で${TYPE_LABEL[next]}として集計されます。`)) return;
  try {
    const updated = await apiPut(`/api/categories/${cat.id}`, { type: next });
    cat.type = updated.type;
  } catch (e) { return; }
  render();
}

async function deleteCategory(cat) {
  if (categories.length <= 1) { alert('最後のカテゴリは削除できません。'); return; }
  const monthCount = monthTxns.filter(t => t.categoryId === cat.id).length;
  const detail = monthCount > 0
    ? `\nこのカテゴリの取引(${formatMonthLabel(currentMonth)}の${monthCount}件を含む、すべての月の分)も削除されます。この操作は取り消せません。`
    : '\nこのカテゴリの取引が他の月にあれば、それも削除されます。この操作は取り消せません。';
  if (!confirm(`カテゴリ「${cat.name}」を削除しますか?${detail}`)) return;
  try {
    await apiDelete(`/api/categories/${cat.id}`);
    await refreshCategories();
  } catch (e) { return; }
  render();
}

function renderAddColumn() {
  const wrap = document.createElement('section');
  wrap.className = 'column add-column';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'add-column-btn';
  btn.textContent = '+ カテゴリを追加';

  const form = document.createElement('form');
  form.className = 'add-column-form hidden';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'カテゴリ名を入力';
  input.maxLength = 30;
  input.setAttribute('aria-label', 'カテゴリ名');
  const typeSelect = document.createElement('select');
  typeSelect.setAttribute('aria-label', '収入か支出か');
  typeSelect.innerHTML = '<option value="EXPENSE">支出のカテゴリ</option><option value="INCOME">収入のカテゴリ</option>';
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
  form.appendChild(typeSelect);
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
    typeSelect.value = 'EXPENSE';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    try {
      const created = await apiPost(`/api/books/${currentBookId}/categories`, { name, type: typeSelect.value });
      categories.push(fromApiCategory(created));
    } catch (err) { return; }
    render();
  });

  wrap.appendChild(btn);
  wrap.appendChild(form);
  return wrap;
}

function renderCard(txn, cat) {
  const card = document.createElement('div');
  card.className = 'txn-card';
  card.classList.toggle('selectable', selectionMode);
  card.classList.toggle('selected', selectionMode && selectedTxnIds.has(txn.id));
  card.draggable = !selectionMode;
  card.dataset.id = txn.id;
  // キーボード(Tab/Enter)でもカードを開けるようにする
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  const income = cat.type === 'INCOME';
  card.innerHTML = `
    <div class="txn-card-head">
      ${selectionMode ? '<input type="checkbox" class="txn-select-check" aria-label="この取引を選択">' : ''}
      <span class="txn-amount ${income ? 'income' : 'expense'}"></span>
      <span class="txn-date"></span>
    </div>
    <div class="txn-memo ${txn.memo ? '' : 'empty'}"></div>
    ${txn.tags.length ? `<div class="txn-meta">${txn.tags.map(t => `<span class="tag ${tagColorClass(t)}"></span>`).join('')}</div>` : ''}
  `;

  card.querySelector('.txn-amount').textContent = `${income ? '+' : '−'}${formatYen(txn.amount)}`;
  card.querySelector('.txn-date').textContent = formatTxnDate(txn.date);
  card.querySelector('.txn-memo').textContent = txn.memo || cat.name;
  const tagEls = card.querySelectorAll('.tag');
  txn.tags.forEach((t, i) => { tagEls[i].textContent = t; });
  card.setAttribute('aria-label', `${txn.date} ${cat.name} ${TYPE_LABEL[cat.type]} ${formatYen(txn.amount)} ${txn.memo}`);

  if (selectionMode) {
    const check = card.querySelector('.txn-select-check');
    check.checked = selectedTxnIds.has(txn.id);
    card.setAttribute('aria-pressed', String(selectedTxnIds.has(txn.id)));
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => setTxnSelected(txn.id, check.checked, card, check));
    const toggleSelected = () => setTxnSelected(txn.id, !selectedTxnIds.has(txn.id), card, check);
    card.addEventListener('click', toggleSelected);
    onCardActivateKey(card, toggleSelected);
    return card;
  }

  card.addEventListener('click', () => openModal(txn));
  onCardActivateKey(card, () => openModal(txn));
  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', txn.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));

  return card;
}

// カード自体にフォーカスがあるときだけ反応させる(中のチェックボックスでのSpaceはそちらの操作)
function onCardActivateKey(card, action) {
  card.addEventListener('keydown', (e) => {
    if (e.target !== card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  });
}

// 取引をドロップすると、そのカテゴリへ付け替える(カテゴリ内の並び順は日付・金額で決まる)
function setupDropZone(section, categoryId) {
  section.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-category-id')) return;
    e.preventDefault();
    section.classList.add('drag-over');
  });
  section.addEventListener('dragleave', (e) => {
    if (!section.contains(e.relatedTarget)) section.classList.remove('drag-over');
  });
  section.addEventListener('drop', async (e) => {
    if (e.dataTransfer.types.includes('application/x-category-id')) return;
    e.preventDefault();
    section.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    const txn = monthTxns.find(t => t.id === id);
    if (!txn || txn.categoryId === categoryId) return;
    try {
      await apiPatch(`/api/transactions/${id}/move`, { categoryId });
    } catch (err) { /* エラーはバナー表示済み */ }
    render();
  });
}

// --- 一括選択・一括削除 ---

function setSelectionMode(enabled) {
  selectionMode = enabled;
  selectedTxnIds = new Set();
  const btn = document.getElementById('selectionModeBtn');
  btn.classList.toggle('active', enabled);
  btn.setAttribute('aria-pressed', String(enabled));
  document.getElementById('selectionBar').classList.toggle('hidden', !enabled);
  updateSelectionBar();
  if (currentBookId) renderColumns();
}

function setTxnSelected(id, selected, card, checkbox) {
  if (selected) selectedTxnIds.add(id); else selectedTxnIds.delete(id);
  card.classList.toggle('selected', selected);
  card.setAttribute('aria-pressed', String(selected));
  checkbox.checked = selected;
  updateSelectionBar();
}

function updateSelectionBar() {
  const n = selectedTxnIds.size;
  document.getElementById('selectionCount').textContent = n > 0
    ? `${n}件選択中`
    : '削除する取引をクリックして選択';
  document.getElementById('bulkDeleteBtn').disabled = n === 0;
  document.getElementById('clearSelectionBtn').disabled = n === 0;
}

async function handleBulkDelete() {
  const ids = [...selectedTxnIds];
  if (!ids.length) return;
  if (!confirm(`選択した${ids.length}件の取引を削除しますか?この操作は取り消せません。`)) return;
  try {
    await apiPost(`/api/books/${currentBookId}/transactions/bulk-delete`, { transactionIds: ids });
  } catch (err) {
    return;
  }
  selectedTxnIds = new Set();
  updateSelectionBar();
  render();
}

// --- 取引の追加・編集 ---

// 新しい取引の日付の初期値。今月を見ているなら今日、ほかの月を見ているならその月の1日
function defaultTxnDate() {
  return currentMonth === currentMonthString() ? localDateString() : `${currentMonth}-01`;
}

function renderCategoryOptions(selectedId) {
  const select = document.getElementById('txnCategory');
  select.innerHTML = '';
  ['EXPENSE', 'INCOME'].forEach(type => {
    const group = document.createElement('optgroup');
    group.label = TYPE_LABEL[type];
    categories.filter(c => c.type === type).forEach(c => {
      const option = document.createElement('option');
      option.value = c.id;
      option.textContent = c.name;
      group.appendChild(option);
    });
    if (group.children.length) select.appendChild(group);
  });
  const fallback = categories.find(c => c.type === 'EXPENSE') || categories[0];
  select.value = selectedId && categoryById(selectedId) ? selectedId : (fallback ? fallback.id : '');
}

function openModal(txn) {
  editingId = txn ? txn.id : null;
  document.getElementById('modalTitle').textContent = txn ? '取引を編集' : '取引を追加';
  const createdEl = document.getElementById('txnCreatedAt');
  if (txn && txn.createdAt) {
    createdEl.textContent = `登録日: ${formatCreatedAt(txn.createdAt)}`;
    createdEl.classList.remove('hidden');
  } else {
    createdEl.textContent = '';
    createdEl.classList.add('hidden');
  }
  document.getElementById('txnAmount').value = txn ? String(txn.amount) : '';
  document.getElementById('txnDate').value = txn ? txn.date : defaultTxnDate();
  renderCategoryOptions(txn ? txn.categoryId : null);
  document.getElementById('txnMemo').value = txn ? txn.memo : '';
  document.getElementById('txnTags').value = txn ? txn.tags.join(', ') : '';
  document.getElementById('txnError').classList.add('hidden');
  document.getElementById('deleteTxnBtn').classList.toggle('hidden', !txn);
  document.getElementById('modalOverlay').classList.remove('hidden');
  document.getElementById('txnAmount').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  editingId = null;
}

function showTxnError(message, fieldId) {
  const errorEl = document.getElementById('txnError');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  if (fieldId) document.getElementById(fieldId).focus();
}

async function handleSubmit(e) {
  e.preventDefault();
  document.getElementById('txnError').classList.add('hidden');
  // 「1,280」のようにカンマ付きで貼り付けられても受け付ける
  const amountText = document.getElementById('txnAmount').value.replaceAll(',', '').trim();
  const amount = Number(amountText);
  if (!amountText || !Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
    showTxnError('金額は1〜99,999,999の整数(円)で入力してください。', 'txnAmount');
    return;
  }
  const date = document.getElementById('txnDate').value;
  if (!date) {
    showTxnError('日付を入力してください。', 'txnDate');
    return;
  }
  const categoryId = document.getElementById('txnCategory').value;
  if (!categoryId) {
    showTxnError('カテゴリを選んでください。', 'txnCategory');
    return;
  }

  const payload = {
    amount,
    date,
    categoryId,
    memo: document.getElementById('txnMemo').value.trim(),
    tags: parseTags(document.getElementById('txnTags').value),
  };

  try {
    if (editingId) {
      await apiPut(`/api/transactions/${editingId}`, payload);
    } else {
      await apiPost(`/api/books/${currentBookId}/transactions`, payload);
    }
  } catch (err) {
    return;
  }

  closeModal();
  // 別の月の日付で登録したら、登録した取引が見えるようにその月へ移る
  const month = date.slice(0, 7);
  if (month !== currentMonth) {
    await changeMonth(month);
  } else {
    render();
  }
}

async function handleDelete() {
  if (!editingId) return;
  if (!confirm('この取引を削除しますか?')) return;
  try {
    await apiDelete(`/api/transactions/${editingId}`);
  } catch (err) {
    return;
  }
  closeModal();
  render();
}

// --- エクスポート・インポート ---

async function exportData() {
  const book = books.find(b => b.id === currentBookId);
  let all;
  try {
    all = await apiGet(`/api/books/${currentBookId}/transactions`);
  } catch (err) {
    return;
  }
  const payload = {
    app: 'finance-manager-app',
    version: 1,
    book: book ? book.name : undefined,
    exportedAt: new Date().toISOString(),
    categories,
    transactions: all.map(t => ({
      categoryId: t.categoryId,
      amount: t.amount,
      date: t.date,
      memo: t.memo || '',
      tags: t.tags || [],
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `finance-manager-backup-${localDateString()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isValidImportTxn(t) {
  return t
    && Number.isInteger(t.amount) && t.amount >= 1 && t.amount <= MAX_AMOUNT
    && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
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
    if (!data || !Array.isArray(data.categories) || !data.categories.length || !Array.isArray(data.transactions)) {
      alert('このファイルは収支管理アプリのバックアップ形式ではないようです。');
      return;
    }
    const invalidCount = data.transactions.filter(t => !isValidImportTxn(t)).length;
    if (invalidCount > 0) {
      alert(`金額または日付が正しくない取引が${invalidCount}件あるため、インポートを中止しました。`);
      return;
    }
    if (!confirm(`インポートすると、この家計簿のカテゴリと取引(${data.transactions.length}件)がすべて置き換わります。よろしいですか?`)) return;

    const importCategories = data.categories.map((c, idx) => ({
      id: c && c.id != null ? String(c.id) : `cat-${idx}`,
      name: c && c.name ? String(c.name) : '無題のカテゴリ',
      type: c && c.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
    }));
    const validCategoryIds = new Set(importCategories.map(c => c.id));
    const importTxns = data.transactions.map(t => ({
      categoryId: validCategoryIds.has(t.categoryId) ? t.categoryId : importCategories[0].id,
      amount: t.amount,
      date: t.date,
      memo: t.memo ? String(t.memo) : '',
      tags: [...new Set((Array.isArray(t.tags) ? t.tags : [])
        .filter(tag => typeof tag === 'string' && tag.trim())
        .map(tag => tag.trim()))],
    }));

    try {
      await apiPut(`/api/books/${currentBookId}/import`, { categories: importCategories, transactions: importTxns });
      await refreshCategories();
    } catch (err) {
      return;
    }
    await render();
    alert('インポートが完了しました。');
  };
  reader.onerror = () => alert('ファイルの読み込みに失敗しました。');
  reader.readAsText(file);
}

// --- 家計簿の切り替え ---

function renderBookSelect() {
  const select = document.getElementById('bookSelect');
  select.innerHTML = books.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('');
  select.value = currentBookId;
  document.getElementById('deleteBookBtn').disabled = books.length <= 1;
}

async function switchBook(id) {
  if (!books.some(b => b.id === id) || id === currentBookId) {
    renderBookSelect();
    return;
  }
  try {
    await loadBookData(id);
  } catch (err) {
    renderBookSelect();
    return;
  }
  setSelectionMode(false);
  document.getElementById('searchInput').value = '';
  document.getElementById('filterTag').value = '';
  document.getElementById('minAmount').value = '';
  document.getElementById('maxAmount').value = '';
  renderBookSelect();
  render();
}

async function addBook() {
  const name = prompt('新しい家計簿の名前を入力してください', '新しい家計簿');
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  let book;
  try {
    // 初期カテゴリはサーバー側で一緒に作られる
    book = await apiPost('/api/books', { name: trimmed });
  } catch (err) {
    return;
  }
  books.push(book);
  await switchBook(book.id);
}

async function renameBook() {
  const book = books.find(b => b.id === currentBookId);
  if (!book) return;
  const name = prompt('家計簿の名前を変更', book.name);
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const updated = await apiPut(`/api/books/${currentBookId}`, { name: trimmed });
    book.name = updated.name;
  } catch (err) {
    return;
  }
  renderBookSelect();
}

async function deleteBook() {
  if (books.length <= 1) { alert('最後の家計簿は削除できません。'); return; }
  const book = books.find(b => b.id === currentBookId);
  if (!book) return;
  if (!confirm(`家計簿「${book.name}」を削除しますか?この家計簿のカテゴリと取引もすべて削除されます。`)) return;
  try {
    await apiDelete(`/api/books/${currentBookId}`);
  } catch (err) {
    return;
  }
  books = books.filter(b => b.id !== currentBookId);
  await switchBook(books[0].id);
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
  document.getElementById('bookSwitcher').classList.toggle('hidden', !visible);
  document.getElementById('headerActions').classList.toggle('hidden', !visible);
  document.getElementById('monthBar').classList.toggle('hidden', !visible);
  document.getElementById('fabAddTxnBtn').classList.toggle('hidden', !visible);
}

function showLoggedOutState() {
  books = [];
  categories = [];
  monthTxns = [];
  visibleTxns = [];
  summary = null;
  currentBookId = null;
  currentMonth = currentMonthString();
  setSelectionMode(false);
  setLoggedInUiVisible(false);
  updateFilterBar();
  const board = document.getElementById('board');
  board.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'empty-hint';
  hint.textContent = 'ログインすると家計簿が表示されます。';
  board.appendChild(hint);
}

async function loadApp() {
  setLoggedInUiVisible(true);
  try {
    books = await apiGet('/api/books');
    if (!books.length) {
      // 「家計簿が無ければ作る」をフロントで判定すると、複数タブや二重ログインで同時に走ったときに
      // 重複して作られるため、判定と作成はサーバー側でまとめて行う
      books = await apiPost('/api/books/ensure-default', {});
    }
    await loadBookData(loadCurrentBookId());
  } catch (err) {
    return;
  }
  renderBookSelect();
  renderMonthBar();
  render();
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

function scheduleRender() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(render, 300);
}

document.getElementById('addTxnBtn').addEventListener('click', () => openModal(null));
document.getElementById('fabAddTxnBtn').addEventListener('click', () => openModal(null));
document.getElementById('prevMonthBtn').addEventListener('click', () => changeMonth(shiftMonth(currentMonth, -1)));
document.getElementById('nextMonthBtn').addEventListener('click', () => changeMonth(shiftMonth(currentMonth, 1)));
document.getElementById('thisMonthBtn').addEventListener('click', () => changeMonth(currentMonthString()));
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
document.getElementById('txnForm').addEventListener('submit', handleSubmit);
document.getElementById('deleteTxnBtn').addEventListener('click', handleDelete);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});
document.getElementById('filterTag').addEventListener('change', render);
document.getElementById('searchInput').addEventListener('input', scheduleRender);
document.getElementById('minAmount').addEventListener('input', scheduleRender);
document.getElementById('maxAmount').addEventListener('input', scheduleRender);
document.getElementById('sortSelect').addEventListener('change', (e) => {
  currentSort = e.target.value;
  render();
});
document.getElementById('selectionModeBtn').addEventListener('click', () => setSelectionMode(!selectionMode));
document.getElementById('exitSelectionBtn').addEventListener('click', () => setSelectionMode(false));
document.getElementById('selectAllVisibleBtn').addEventListener('click', () => {
  visibleTxns.forEach(t => selectedTxnIds.add(t.id));
  renderColumns();
});
document.getElementById('clearSelectionBtn').addEventListener('click', () => {
  selectedTxnIds = new Set();
  renderColumns();
});
document.getElementById('bulkDeleteBtn').addEventListener('click', handleBulkDelete);
document.getElementById('themeToggleBtn').addEventListener('click', cycleTheme);
document.getElementById('bookSelect').addEventListener('change', (e) => switchBook(e.target.value));
document.getElementById('addBookBtn').addEventListener('click', addBook);
document.getElementById('renameBookBtn').addEventListener('click', renameBook);
document.getElementById('deleteBookBtn').addEventListener('click', deleteBook);
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
  if (!typing && !anyModalOpen && currentBookId && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
      <p style="margin: 0 0 10px;">このアプリはバックエンドと同じオリジンで開く必要があります。ファイルを直接開くと、ログインしてもセッションが保持されず、家計簿が表示されません。</p>
      <p style="margin: 0;">バックエンドを起動した状態で <a href="${correctUrl}" style="color: #0c66e4; font-weight: 700;">${correctUrl}</a> を開いてください。</p>
    </div>
  `;
  return true;
}

async function init() {
  if (warnIfOpenedAsFile()) return;
  applyTheme(loadTheme());
  await checkAuth();
  if (currentUser) {
    await loadApp();
  } else {
    showLoggedOutState();
  }
}

init();
