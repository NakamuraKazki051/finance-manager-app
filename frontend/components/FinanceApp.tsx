"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  api,
  apiDownload,
  fetchCurrentUser,
  setApiListeners,
  type Book,
  type Category,
  type CategoryType,
  type RecurringRule,
  type Summary,
  type Transaction,
  type User,
} from "@/lib/api";
import {
  currentMonthString,
  formatMonthLabel,
  formatSignedYen,
  formatYen,
  localDateString,
  MAX_AMOUNT,
  otherType,
  shiftMonth,
  tagColorClass,
  TYPE_LABEL,
  type BoardLayout,
} from "@/lib/format";
import { AccountModal, LoginModal, RegisterModal } from "./AuthModals";
import { Board } from "./Board";
import { ConfirmModal } from "./Modal";
import { RecurringModal } from "./RecurringModal";
import { ReportModal } from "./ReportModal";
import { TransactionList } from "./TransactionList";
import { TransactionModal, type TransactionInput } from "./TransactionModal";

const CURRENT_BOOK_KEY = "finance-manager-app:currentBook";

// ブラウザのダウンロードとして保存させる
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
const THEME_KEY = "finance-manager-app:theme";
type Theme = "system" | "light" | "dark";
const THEME_LABEL: Record<Theme, string> = { system: "🖥️ テーマ: 自動", light: "☀️ テーマ: ライト", dark: "🌙 テーマ: ダーク" };

// カードの並び(BoardLayout)の記憶先
const BOARD_LAYOUT_KEY = "finance-manager-app:boardLayout";
const BOARD_LAYOUT_LABEL: Record<BoardLayout, string> = { list: "縦", kanban: "横" };

type AuthModal = "login" | "register" | "account" | null;
// status は予定/確定での絞り込み(F-13)。空はすべて
type Filters = { q: string; tag: string; min: string; max: string; status: "" | "confirmed" | "planned" };
const EMPTY_FILTERS: Filters = { q: "", tag: "", min: "", max: "", status: "" };

// localStorage はプライベートモードなどで使えないことがあるので、失敗しても画面は動くようにする
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 表示設定を覚えられないだけなので無視する */
  }
}

function amountFilter(text: string): number | null {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function isFilterActive(f: Filters): boolean {
  return !!(f.q.trim() || f.tag || f.status || amountFilter(f.min) !== null || amountFilter(f.max) !== null);
}

export default function FinanceApp() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authModal, setAuthModal] = useState<AuthModal>(null);
  const [error, setError] = useState<string | null>(null);

  const [books, setBooks] = useState<Book[]>([]);
  const [bookId, setBookId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [month, setMonth] = useState(currentMonthString);
  const [sort, setSort] = useState<"date" | "amount">("date");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // 文字入力のたびに問い合わせないよう、検索語と金額は少し待ってから反映する
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);

  const [monthTxns, setMonthTxns] = useState<Transaction[]>([]);
  const [visibleTxns, setVisibleTxns] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [editing, setEditing] = useState<Transaction | "new" | null>(null);
  // カードのごみ箱か、編集画面の「削除」を押したときの確認モーダル
  const [txnDeletion, setTxnDeletion] = useState<Transaction | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  // カードのタグの × を押したときの確認モーダル
  const [tagRemoval, setTagRemoval] = useState<{ txn: Transaction; tag: string } | null>(null);
  // 列の「+ 取引を追加」から開いたときは、そのカテゴリを選んだ状態で開く
  const [newCategoryId, setNewCategoryId] = useState<string | null>(null);
  const openNewTransaction = (categoryId: string | null = null) => {
    setNewCategoryId(categoryId);
    setEditing("new");
  };
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const [boardLayout, setBoardLayout] = useState<BoardLayout>("kanban");

  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const showLoggedOut = useCallback(() => {
    setUser(null);
    setBooks([]);
    setBookId(null);
    setCategories([]);
    setMonthTxns([]);
    setVisibleTxns([]);
    setSummary(null);
    setEditing(null);
    setTagRemoval(null);
    setTxnDeletion(null);
    setReportOpen(false);
    setRecurringOpen(false);
    setSelectionMode(false);
    setSelectedIds(new Set());
    // 次にログインした人に、前の人の検索・絞り込み・並び替えを残さない
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setSort("date");
    setMonth(currentMonthString());
  }, []);

  useEffect(() => {
    setApiListeners({
      onError: setError,
      onSuccess: () => setError(null),
      onUnauthorized: showLoggedOut,
    });
  }, [showLoggedOut]);

  // --- テーマ ---
  useEffect(() => {
    const saved = readStorage(THEME_KEY);
    // 保存済みのテーマは画面を開いた直後に1回だけ反映する
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);
  function cycleTheme() {
    const order: Theme[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    writeStorage(THEME_KEY, next);
  }

  // --- カードの並び ---
  useEffect(() => {
    // 保存済みの並びは画面を開いた直後に1回だけ反映する
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (readStorage(BOARD_LAYOUT_KEY) === "list") setBoardLayout("list");
  }, []);
  function changeBoardLayout(next: BoardLayout) {
    setBoardLayout(next);
    writeStorage(BOARD_LAYOUT_KEY, next);
  }

  // --- ログインと家計簿の読み込み ---
  const loadApp = useCallback(async () => {
    try {
      let list = await api.get<Book[]>("/api/books");
      if (!list.length) {
        // 「家計簿が無ければ作る」をフロントで判定すると、複数タブや二重ログインで同時に走ったときに
        // 重複して作られるため、判定と作成はサーバー側でまとめて行う
        list = await api.post<Book[]>("/api/books/ensure-default");
      }
      const saved = readStorage(CURRENT_BOOK_KEY);
      const id = saved && list.some((b) => b.id === saved) ? saved : list[0].id;
      const cats = await api.get<Category[]>(`/api/books/${id}/categories`);
      setBooks(list);
      setCategories(cats);
      setBookId(id);
      writeStorage(CURRENT_BOOK_KEY, id);
    } catch {
      /* エラーはバナー表示済み */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser().then(async (me) => {
      if (cancelled) return;
      setUser(me);
      setAuthChecked(true);
      if (me) await loadApp();
    });
    return () => {
      cancelled = true;
    };
  }, [loadApp]);

  async function handleSignedIn(signedIn: User) {
    setAuthModal(null);
    setUser(signedIn);
    await loadApp();
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      /* ローカル状態のクリアは続ける */
    }
    showLoggedOut();
  }

  const refreshCategories = useCallback(async (id: string) => {
    const cats = await api.get<Category[]>(`/api/books/${id}/categories`);
    setCategories(cats);
  }, []);

  // 家計簿を開いたときと表示する月を変えたときに、月が変わって作っていない固定費(F-12)の取引をサーバーに作らせる
  // (画面を開いたまま月をまたいでも、「今月」や ▶ で移れば新しい月の分ができる)。
  // 二重に作らない判定はサーバー側で行う。作られたら、表示中の取引と集計を取り直す
  useEffect(() => {
    if (!bookId) return;
    let stale = false;
    (async () => {
      try {
        const { created } = await api.post<{ created: number }>(`/api/books/${bookId}/recurring-transactions/generate`);
        if (!stale && created > 0) reload();
      } catch {
        /* エラーはバナー表示済み */
      }
    })();
    return () => {
      stale = true;
    };
  }, [bookId, month, reload]);

  // --- 表示中の月の取引と集計 ---
  useEffect(() => {
    const timer = setTimeout(() => setAppliedFilters(filters), 300);
    return () => clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    if (!bookId) return;
    // 月を素早く切り替えたとき、古い月の応答が後から届いて表示を上書きしないようにする
    let stale = false;
    const base = `/api/books/${bookId}`;
    const active = isFilterActive(appliedFilters);
    (async () => {
      try {
        const [list, monthSummary] = await Promise.all([
          api.get<Transaction[]>(`${base}/transactions?month=${month}&sort=${sort}`),
          api.get<Summary>(`${base}/summary?month=${month}`),
        ]);
        let filtered = list;
        if (active) {
          const params = new URLSearchParams({ month, sort });
          if (appliedFilters.q.trim()) params.set("q", appliedFilters.q.trim());
          if (appliedFilters.tag) params.set("tag", appliedFilters.tag);
          if (appliedFilters.status) params.set("status", appliedFilters.status);
          const min = amountFilter(appliedFilters.min);
          const max = amountFilter(appliedFilters.max);
          if (min !== null) params.set("minAmount", String(min));
          if (max !== null) params.set("maxAmount", String(max));
          filtered = await api.get<Transaction[]>(`${base}/transactions?${params}`);
        }
        if (stale) return;
        setMonthTxns(list);
        setVisibleTxns(filtered);
        setSummary(monthSummary);
        // 検索や絞り込みで見えなくなった取引は選択から外す(見えていない取引を誤って消さないため)
        const visibleIds = new Set(filtered.map((t) => t.id));
        setSelectedIds((prev) => new Set([...prev].filter((id) => visibleIds.has(id))));
      } catch {
        /* エラーはバナー表示済み */
      }
    })();
    return () => {
      stale = true;
    };
  }, [bookId, month, sort, appliedFilters, reloadKey]);

  function changeMonth(next: string) {
    if (next === month) return;
    // 前の月で選んだ取引が見えないまま残って、まとめて削除されないようにする
    setSelectedIds(new Set());
    setSummary(null);
    setMonth(next);
  }

  // --- 家計簿 ---
  // 別の家計簿を開く。前の家計簿の選択や絞り込み(タグなど)は持ち越さない
  function openBook(id: string) {
    setBookId(id);
    writeStorage(CURRENT_BOOK_KEY, id);
    setSelectionMode(false);
    setSelectedIds(new Set());
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  }

  async function switchBook(id: string) {
    if (id === bookId || !books.some((b) => b.id === id)) return;
    try {
      await refreshCategories(id);
    } catch {
      return;
    }
    openBook(id);
  }

  async function addBook() {
    const name = prompt("新しい家計簿の名前を入力してください", "新しい家計簿")?.trim();
    if (!name) return;
    try {
      // 初期カテゴリはサーバー側で一緒に作られる
      const book = await api.post<Book>("/api/books", { name });
      setBooks((prev) => [...prev, book]);
      await refreshCategories(book.id);
      openBook(book.id);
    } catch {
      /* エラーはバナー表示済み */
    }
  }

  async function renameBook() {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    const name = prompt("家計簿の名前を変更", book.name)?.trim();
    if (!name) return;
    try {
      const updated = await api.put<Book>(`/api/books/${book.id}`, { name });
      setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch {
      /* エラーはバナー表示済み */
    }
  }

  async function deleteBook() {
    if (books.length <= 1) {
      alert("最後の家計簿は削除できません。");
      return;
    }
    const book = books.find((b) => b.id === bookId);
    if (!book || !confirm(`家計簿「${book.name}」を削除しますか?この家計簿のカテゴリ・取引・固定費もすべて削除されます。`)) return;
    try {
      await api.delete(`/api/books/${book.id}`);
    } catch {
      return;
    }
    const rest = books.filter((b) => b.id !== book.id);
    setBooks(rest);
    try {
      await refreshCategories(rest[0].id);
    } catch {
      /* エラーはバナー表示済み */
    }
    openBook(rest[0].id);
  }

  // --- カテゴリ ---
  async function renameCategory(category: Category, name: string) {
    try {
      await api.put(`/api/categories/${category.id}`, { name });
      await refreshCategories(category.bookId);
    } catch {
      /* エラーはバナー表示済み */
    }
  }

  // budget が null なら予算を外す
  async function setCategoryBudget(category: Category, budget: number | null) {
    try {
      await api.put(`/api/categories/${category.id}`, { budget });
      await refreshCategories(category.bookId);
    } catch {
      /* エラーはバナー表示済み */
    }
  }

  async function toggleCategoryType(category: Category) {
    const next: CategoryType = otherType(category.type);
    if (!confirm(`「${category.name}」を${TYPE_LABEL[next]}のカテゴリに変更しますか?\nこのカテゴリの取引は、すべての月で${TYPE_LABEL[next]}として集計されます。`)) return;
    try {
      await api.put(`/api/categories/${category.id}`, { type: next });
      await refreshCategories(category.bookId);
    } catch {
      return;
    }
    reload();
  }

  async function moveCategory(categoryId: string, index: number) {
    if (index < 0 || index >= categories.length || !bookId) return;
    try {
      await api.patch(`/api/categories/${categoryId}/move`, { displayOrder: index });
      await refreshCategories(bookId);
    } catch {
      /* エラーはバナー表示済み */
    }
  }

  async function deleteCategory(category: Category) {
    if (categories.length <= 1) {
      alert("最後のカテゴリは削除できません。");
      return;
    }
    const monthCount = monthTxns.filter((t) => t.categoryId === category.id).length;
    const detail =
      monthCount > 0
        ? `\nこのカテゴリの取引(${formatMonthLabel(month)}の${monthCount}件を含む、すべての月の分)も削除されます。この操作は取り消せません。`
        : "\nこのカテゴリの取引が他の月にあれば、それも削除されます。この操作は取り消せません。";
    // このカテゴリの固定費もサーバーで一緒に消える(残すと、消えたカテゴリの取引を作り続けるため)
    if (!confirm(`カテゴリ「${category.name}」を削除しますか?${detail}\nこのカテゴリの固定費(🔁)があれば、それも削除されます。`)) return;
    try {
      await api.delete(`/api/categories/${category.id}`);
      await refreshCategories(category.bookId);
    } catch {
      return;
    }
    reload();
  }

  async function addCategory(name: string, type: CategoryType): Promise<boolean> {
    if (!bookId) return false;
    try {
      await api.post(`/api/books/${bookId}/categories`, { name, type });
      await refreshCategories(bookId);
    } catch {
      return false;
    }
    reload();
    return true;
  }

  // --- 取引 ---

  // 新しい取引の日付の初期値。今月を見ているなら今日、ほかの月を見ているならその月の1日
  const defaultDate = month === currentMonthString() ? localDateString() : `${month}-01`;

  // 取引の更新 API は全項目を受け取るので、タグだけ減らしてそのまま送り直す
  async function removeTag() {
    if (!tagRemoval) return;
    const { txn, tag } = tagRemoval;
    try {
      await api.put(`/api/transactions/${txn.id}`, {
        amount: txn.amount,
        date: txn.date,
        categoryId: txn.categoryId,
        memo: txn.memo ?? "",
        tags: txn.tags.filter((t) => t !== tag),
        confirmed: txn.confirmed,
      });
    } catch {
      return;
    }
    setTagRemoval(null);
    reload();
  }

  async function saveTransaction(input: TransactionInput) {
    if (!bookId) return;
    try {
      if (editing && editing !== "new") {
        await api.put(`/api/transactions/${editing.id}`, input);
      } else {
        await api.post(`/api/books/${bookId}/transactions`, input);
      }
    } catch {
      return;
    }
    setEditing(null);
    // 別の月の日付で登録したら、登録した取引が見えるようにその月へ移る
    const savedMonth = input.date.slice(0, 7);
    if (savedMonth !== month) changeMonth(savedMonth);
    else reload();
  }

  async function deleteTransaction() {
    if (!txnDeletion) return;
    const id = txnDeletion.id;
    try {
      await api.delete(`/api/transactions/${id}`);
    } catch {
      return;
    }
    setTxnDeletion(null);
    // 編集画面から消したときは、その編集画面も閉じる
    setEditing((current) => (current && current !== "new" && current.id === id ? null : current));
    reload();
  }

  async function moveTransaction(txnId: string, categoryId: string) {
    const txn = monthTxns.find((t) => t.id === txnId);
    if (!txn || txn.categoryId === categoryId) return;
    try {
      await api.patch(`/api/transactions/${txnId}/move`, { categoryId });
    } catch {
      /* エラーはバナー表示済み */
    }
    reload();
  }

  // カードの「確定」チェック。予定⇔確定を切り替えると月の合計が変わるので取り直す
  async function toggleConfirmed(txn: Transaction) {
    try {
      await api.patch(`/api/transactions/${txn.id}/confirm`, { confirmed: !txn.confirmed });
    } catch {
      /* エラーはバナー表示済み */
    }
    reload();
  }

  function toggleSelectionMode(enabled: boolean) {
    setSelectionMode(enabled);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    const ids = [...selectedIds];
    if (!ids.length || !bookId) return;
    if (!confirm(`選択した${ids.length}件の取引を削除しますか?この操作は取り消せません。`)) return;
    try {
      await api.post(`/api/books/${bookId}/transactions/bulk-delete`, { transactionIds: ids });
    } catch {
      return;
    }
    setSelectedIds(new Set());
    reload();
  }

  // --- エクスポート・インポート ---
  async function exportData() {
    setMenuOpen(false);
    if (!bookId) return;
    let all: Transaction[];
    let recurring: RecurringRule[];
    try {
      [all, recurring] = await Promise.all([
        api.get<Transaction[]>(`/api/books/${bookId}/transactions`),
        api.get<RecurringRule[]>(`/api/books/${bookId}/recurring-transactions`),
      ]);
    } catch {
      return;
    }
    const payload = {
      app: "finance-manager-app",
      version: 1,
      book: books.find((b) => b.id === bookId)?.name,
      exportedAt: new Date().toISOString(),
      categories: categories.map(({ id, name, type, budget }) => ({ id, name, type, budget })),
      transactions: all.map(({ categoryId, amount, date, memo, tags, confirmed, recurringId }) => ({ categoryId, amount, date, memo: memo ?? "", tags, confirmed, recurringId })),
      // lastGeneratedMonth も残し、取り込んだあとに作り済みの月の取引を二重に作らないようにする
      recurring: recurring.map(({ id, categoryId, amount, day, memo, tags, startMonth, lastGeneratedMonth }) => ({ id, categoryId, amount, day, memo: memo ?? "", tags, startMonth, lastGeneratedMonth })),
    };
    saveFile(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `finance-manager-backup-${localDateString()}.json`);
  }

  // CSV はサーバーで作る(Excel で開けるよう BOM 付き UTF-8)。表示中の月か全期間かを選ぶ
  async function exportCsv(scope: "month" | "all") {
    setMenuOpen(false);
    if (!bookId) return;
    const query = scope === "month" ? `?month=${month}` : "";
    let blob: Blob;
    try {
      blob = await apiDownload(`/api/books/${bookId}/export.csv${query}`);
    } catch {
      return;
    }
    const bookName = books.find((b) => b.id === bookId)?.name ?? "家計簿";
    saveFile(blob, `${bookName}_${scope === "month" ? month : "全期間"}.csv`);
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !bookId) return;
    type ImportCategory = { id?: unknown; name?: unknown; type?: unknown; budget?: unknown };
    type ImportTxn = { categoryId?: unknown; amount?: unknown; date?: unknown; memo?: unknown; tags?: unknown; confirmed?: unknown; recurringId?: unknown };
    type ImportRule = { id?: unknown; categoryId?: unknown; amount?: unknown; day?: unknown; memo?: unknown; tags?: unknown; startMonth?: unknown; lastGeneratedMonth?: unknown };
    let data: { categories?: ImportCategory[]; transactions?: ImportTxn[]; recurring?: ImportRule[] };
    try {
      data = JSON.parse(await file.text());
    } catch {
      alert("ファイルの読み込みに失敗しました。正しいJSONファイルを選択してください。");
      return;
    }
    if (!data || !Array.isArray(data.categories) || !data.categories.length || !Array.isArray(data.transactions)) {
      alert("このファイルは収支管理アプリのバックアップ形式ではないようです。");
      return;
    }
    const invalidCount = data.transactions.filter(
      (t) =>
        !t ||
        !Number.isInteger(t.amount) ||
        (t.amount as number) < 1 ||
        (t.amount as number) > MAX_AMOUNT ||
        typeof t.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(t.date),
    ).length;
    if (invalidCount > 0) {
      alert(`金額または日付が正しくない取引が${invalidCount}件あるため、インポートを中止しました。`);
      return;
    }
    const rules = Array.isArray(data.recurring) ? data.recurring.filter((r): r is ImportRule => !!r && typeof r === "object") : [];
    if (!confirm(`インポートすると、この家計簿のカテゴリ・取引(${data.transactions.length}件)・固定費(${rules.length}件)がすべて置き換わります。よろしいですか?`)) return;

    const importCategories = data.categories.map((c, idx) => ({
      id: c && c.id != null ? String(c.id) : `cat-${idx}`,
      name: c && c.name ? String(c.name) : "無題のカテゴリ",
      type: c && c.type === "INCOME" ? "INCOME" : "EXPENSE",
      // 予算の無い古いバックアップや、範囲外の値は「予算なし」として取り込む
      budget: c && Number.isInteger(c.budget) && (c.budget as number) >= 1 && (c.budget as number) <= MAX_AMOUNT ? c.budget : null,
    }));
    const knownIds = new Set(importCategories.map((c) => c.id));
    const importTxns = data.transactions.map((t) => ({
      categoryId: typeof t.categoryId === "string" && knownIds.has(t.categoryId) ? t.categoryId : importCategories[0].id,
      amount: t.amount,
      date: t.date,
      memo: t.memo ? String(t.memo) : "",
      tags: [...new Set((Array.isArray(t.tags) ? t.tags : []).filter((tag): tag is string => typeof tag === "string" && !!tag.trim()).map((tag) => tag.trim()))],
      // 予定/確定の無い古いバックアップは確定として取り込む
      confirmed: t.confirmed !== false,
      recurringId: typeof t.recurringId === "string" ? t.recurringId : null,
    }));
    // 固定費は、カテゴリが見つからないものだけ外す(金額・日付などの不正はサーバーが 400 で知らせる)
    const importRules = rules
      .filter((r) => typeof r.categoryId === "string" && knownIds.has(r.categoryId))
      .map((r) => ({
        id: r.id != null ? String(r.id) : null,
        categoryId: r.categoryId,
        amount: r.amount,
        day: r.day,
        memo: r.memo ? String(r.memo) : "",
        tags: Array.isArray(r.tags) ? r.tags.filter((tag): tag is string => typeof tag === "string" && !!tag.trim()) : [],
        startMonth: r.startMonth,
        lastGeneratedMonth: r.lastGeneratedMonth ?? null,
      }));
    try {
      await api.put(`/api/books/${bookId}/import`, { categories: importCategories, transactions: importTxns, recurring: importRules });
      // 取り込んだ固定費に、まだ作っていない月があればすぐに作る(家計簿は開いたままなので、開いたときの処理は走らない)
      await api.post(`/api/books/${bookId}/recurring-transactions/generate`);
      await refreshCategories(bookId);
    } catch {
      return;
    }
    reload();
    alert("インポートが完了しました。");
  }

  // --- キーボード操作 ---
  const anyModalOpen = editing !== null || authModal !== null || tagRemoval !== null || txnDeletion !== null || reportOpen || recurringOpen;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (menuRef.current?.open) {
          setMenuOpen(false);
          return;
        }
        if (txnDeletion) setTxnDeletion(null);
        else if (tagRemoval) setTagRemoval(null);
        else if (reportOpen) setReportOpen(false);
        else if (recurringOpen) setRecurringOpen(false);
        else if (editing) setEditing(null);
        else if (authModal) setAuthModal(null);
        else if (selectionMode) toggleSelectionMode(false);
        return;
      }
      // 文字入力中やモーダル表示中は横取りしない
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (anyModalOpen || !bookId || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        openNewTransaction();
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing, authModal, tagRemoval, txnDeletion, reportOpen, recurringOpen, selectionMode, anyModalOpen, bookId]);

  // メニューの外をクリックしたら閉じる
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [menuOpen]);

  const loggedIn = !!user && !!bookId;
  const filterActive = isFilterActive(appliedFilters);
  const tags = [...new Set(monthTxns.flatMap((t) => t.tags))].sort();
  // 今の月に無いタグで絞り込み中でも、選択が勝手に外れないよう残しておく
  if (filters.tag && !tags.includes(filters.tag)) tags.push(filters.tag);
  // 絞り込み結果の合計は、収入と支出を混ぜずに種別ごとに出す(種別はカテゴリが持つ)。
  // 月の収入・支出と同じく、予定の取引は合計に入れず別に出す
  const incomeCategoryIds = new Set(categories.filter((c) => c.type === "INCOME").map((c) => c.id));
  const filteredTotals = { income: 0, expense: 0, plannedIncome: 0, plannedExpense: 0 };
  for (const t of visibleTxns) {
    const income = incomeCategoryIds.has(t.categoryId);
    if (t.confirmed) filteredTotals[income ? "income" : "expense"] += t.amount;
    else filteredTotals[income ? "plannedIncome" : "plannedExpense"] += t.amount;
  }
  const filteredPlanned = [
    filteredTotals.plannedIncome > 0 && `+${formatYen(filteredTotals.plannedIncome)}`,
    filteredTotals.plannedExpense > 0 && `−${formatYen(filteredTotals.plannedExpense)}`,
  ].filter(Boolean).join(" / ");

  return (
    <>
      <header className="app-header">
        <div className="header-title">
          <h1>収支管理</h1>
          {loggedIn && (
            <div className="book-switcher">
              <select aria-label="家計簿を選択" value={bookId ?? ""} onChange={(e) => switchBook(e.target.value)}>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <button type="button" className="icon-btn" title="家計簿を追加" aria-label="家計簿を追加" onClick={addBook}>+</button>
              <button type="button" className="icon-btn" title="家計簿の名前を変更" aria-label="家計簿の名前を変更" onClick={renameBook}>✎</button>
              <button type="button" className="icon-btn" title="家計簿を削除" aria-label="家計簿を削除" onClick={deleteBook} disabled={books.length <= 1}>×</button>
            </div>
          )}
        </div>
        {authChecked && (
          <div className="auth-status">
            {user ? (
              <>
                <span className="auth-email" title={user.email}>{user.email}</span>
                <button type="button" className="btn-secondary" onClick={() => setAuthModal("account")}>アカウント設定</button>
                <button type="button" className="btn-secondary" onClick={handleLogout}>ログアウト</button>
              </>
            ) : (
              <>
                <button type="button" className="btn-secondary" onClick={() => setAuthModal("login")}>ログイン</button>
                <button type="button" className="btn-secondary" onClick={() => setAuthModal("register")}>新規登録</button>
              </>
            )}
          </div>
        )}
        {loggedIn && (
          <div className="header-actions">
            <input ref={searchRef} type="search" className="search-input" placeholder="🔍 メモを検索 ( / )" aria-label="メモを検索"
              value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
            <select aria-label="タグで絞り込み" value={filters.tag}
              onChange={(e) => {
                const next = { ...filters, tag: e.target.value };
                setFilters(next);
                setAppliedFilters(next);
              }}>
              <option value="">全タグ</option>
              {tags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select aria-label="予定か確定かで絞り込み" value={filters.status}
              onChange={(e) => {
                const next = { ...filters, status: e.target.value as Filters["status"] };
                setFilters(next);
                setAppliedFilters(next);
              }}>
              <option value="">予定・確定</option>
              <option value="confirmed">確定のみ</option>
              <option value="planned">予定のみ</option>
            </select>
            <div className="amount-range" role="group" aria-label="金額で絞り込み">
              <input type="number" min={1} max={MAX_AMOUNT} step={1} inputMode="numeric" placeholder="¥ 下限" aria-label="金額の下限"
                value={filters.min} onChange={(e) => setFilters({ ...filters, min: e.target.value })} />
              <span aria-hidden="true">〜</span>
              <input type="number" min={1} max={MAX_AMOUNT} step={1} inputMode="numeric" placeholder="¥ 上限" aria-label="金額の上限"
                value={filters.max} onChange={(e) => setFilters({ ...filters, max: e.target.value })} />
            </div>
            <select aria-label="並び替え" value={sort} onChange={(e) => setSort(e.target.value as "date" | "amount")}>
              <option value="date">並び替え: 日付の新しい順</option>
              <option value="amount">並び替え: 金額の大きい順</option>
            </select>
            <button type="button" className={`btn-secondary${selectionMode ? " active" : ""}`} aria-pressed={selectionMode}
              title="取引を複数選択してまとめて削除します" onClick={() => toggleSelectionMode(!selectionMode)}>☑ 選択</button>
            <button type="button" className="btn-secondary" title="カテゴリ別の内訳と12か月の推移をグラフで見る" onClick={() => setReportOpen(true)}>📊 レポート</button>
            <button type="button" className="btn-secondary" title="家賃・サブスクなど毎月の固定費を登録すると、その月の取引が予定として自動で作られます"
              onClick={() => setRecurringOpen(true)}>🔁 固定費</button>
            {/* 使用頻度の低い設定・データ操作はメニューにまとめ、ヘッダーのボタン数を減らす */}
            <details ref={menuRef} className="menu" open={menuOpen}>
              <summary className="btn-secondary" onClick={(e) => {
                e.preventDefault();
                setMenuOpen((open) => !open);
              }}>⚙ 設定・データ</summary>
              <div className="menu-panel">
                <button type="button" className="btn-secondary" title="クリックでテーマを切り替え(自動→ライト→ダーク)" onClick={cycleTheme}>{THEME_LABEL[theme]}</button>
                {/* どちらが選ばれているか分かるよう、2択のボタンにして選択中の方を強調する */}
                <div className="menu-choice" role="group" aria-label="カードの並び">
                  <span className="menu-choice-label">🗂️ カードの並び</span>
                  {(["list", "kanban"] as const).map((layout) => (
                    <button key={layout} type="button" className={`btn-secondary${boardLayout === layout ? " active" : ""}`}
                      aria-pressed={boardLayout === layout} onClick={() => changeBoardLayout(layout)}>
                      {BOARD_LAYOUT_LABEL[layout]}
                    </button>
                  ))}
                </div>
                <p className="menu-hint">縦: 取引を1列の一覧で表示 / 横: カテゴリごとの列(カンバン)で表示</p>
                <button type="button" className="btn-secondary" onClick={() => exportCsv("month")}>⬇ CSV（表示中の月）</button>
                <button type="button" className="btn-secondary" onClick={() => exportCsv("all")}>⬇ CSV（全期間）</button>
                <button type="button" className="btn-secondary" onClick={exportData}>⬇ エクスポート</button>
                <button type="button" className="btn-secondary" onClick={() => {
                  setMenuOpen(false);
                  importRef.current?.click();
                }}>⬆ インポート</button>
                <p className="menu-hint">ショートカット: <kbd>N</kbd> 取引を追加 / <kbd>/</kbd> 検索 / <kbd>Esc</kbd> 閉じる</p>
              </div>
            </details>
            <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />
            <button type="button" className="btn-primary" title="取引を追加 (N)" onClick={() => openNewTransaction()}>+ 取引を追加</button>
          </div>
        )}
      </header>

      {loggedIn && (
        <section className="month-bar" aria-label="表示する月と月の収支">
          <div className="month-nav">
            <button type="button" className="icon-btn" aria-label="前の月" onClick={() => changeMonth(shiftMonth(month, -1))}>◀</button>
            <h2 className="month-label" aria-live="polite">{formatMonthLabel(month)}</h2>
            <button type="button" className="icon-btn" aria-label="次の月" onClick={() => changeMonth(shiftMonth(month, 1))}>▶</button>
            <button type="button" className="btn-secondary month-today" disabled={month === currentMonthString()}
              onClick={() => changeMonth(currentMonthString())}>今月</button>
          </div>
          {/* 金額は新しい月の集計が届いてから出す(前の月の金額を新しい月の名前の横に出さない) */}
          <dl className="summary">
            {/* 収入・支出・残高は確定した取引だけ。予定の取引があれば、その分を小さく添える */}
            <div className="summary-item income">
              <dt>収入</dt>
              <dd>{summary ? formatYen(summary.income) : "…"}</dd>
              {summary && summary.plannedIncome > 0 && <dd className="summary-planned">予定 +{formatYen(summary.plannedIncome)}</dd>}
            </div>
            <div className="summary-item expense">
              <dt>支出</dt>
              <dd>{summary ? formatYen(summary.expense) : "…"}</dd>
              {summary && summary.plannedExpense > 0 && <dd className="summary-planned">予定 −{formatYen(summary.plannedExpense)}</dd>}
            </div>
            <div className="summary-item balance">
              <dt>残高</dt>
              <dd className={summary && summary.balance < 0 ? "negative" : undefined}>{summary ? formatSignedYen(summary.balance) : "…"}</dd>
              {summary && (summary.plannedIncome > 0 || summary.plannedExpense > 0) && (
                <dd className="summary-planned">予定込み {formatSignedYen(summary.balance + summary.plannedIncome - summary.plannedExpense)}</dd>
              )}
            </div>
          </dl>
        </section>
      )}

      {error && (
        <div className="api-error-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {loggedIn && selectionMode && (
        <div className="selection-bar" role="region" aria-label="取引の一括操作">
          <span className="selection-count" aria-live="polite">
            {selectedIds.size > 0 ? `${selectedIds.size}件選択中` : "削除する取引をクリックして選択"}
          </span>
          <div className="selection-actions">
            <button type="button" className="btn-secondary" onClick={() => setSelectedIds(new Set(visibleTxns.map((t) => t.id)))}>表示中をすべて選択</button>
            <button type="button" className="btn-secondary" disabled={selectedIds.size === 0} onClick={() => setSelectedIds(new Set())}>選択解除</button>
            <button type="button" className="btn-danger" disabled={selectedIds.size === 0} onClick={bulkDelete}>選択した取引を削除</button>
            <button type="button" className="btn-secondary" onClick={() => toggleSelectionMode(false)}>終了</button>
          </div>
        </div>
      )}

      {loggedIn && filterActive && (
        <div className="filter-bar" role="status">
          <span>絞り込み中: この月の{monthTxns.length}件中 {visibleTxns.length}件を表示(収入 {formatYen(filteredTotals.income)} / 支出 {formatYen(filteredTotals.expense)}{filteredPlanned && `、予定 ${filteredPlanned}`})</span>
          <button type="button" className="btn-secondary" onClick={() => {
            setFilters(EMPTY_FILTERS);
            setAppliedFilters(EMPTY_FILTERS);
          }}>条件をクリア</button>
        </div>
      )}

      {loggedIn && boardLayout === "list" ? (
        <TransactionList
          categories={categories}
          transactions={visibleTxns}
          filterActive={filterActive}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onOpenTransaction={setEditing}
          onToggleSelected={toggleSelected}
          onRemoveTag={(txn, tag) => setTagRemoval({ txn, tag })}
          onDeleteTransaction={setTxnDeletion}
          onToggleConfirmed={toggleConfirmed}
          onAddTransaction={() => openNewTransaction()}
        />
      ) : loggedIn ? (
        <Board
          categories={categories}
          transactions={visibleTxns}
          summary={summary}
          month={month}
          filterActive={filterActive}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onOpenTransaction={setEditing}
          onRemoveTag={(txn, tag) => setTagRemoval({ txn, tag })}
          onDeleteTransaction={setTxnDeletion}
          onToggleConfirmed={toggleConfirmed}
          onAddTransaction={openNewTransaction}
          onToggleSelected={toggleSelected}
          onMoveTransaction={moveTransaction}
          onRenameCategory={renameCategory}
          onToggleCategoryType={toggleCategoryType}
          onSetBudget={setCategoryBudget}
          onMoveCategory={moveCategory}
          onDeleteCategory={deleteCategory}
          onAddCategory={addCategory}
        />
      ) : (
        <main className="board">
          {authChecked && !user && <div className="empty-hint">ログインすると家計簿が表示されます。</div>}
        </main>
      )}

      {/* スマホでは画面下に固定し、片手ですぐ記録できるようにする */}
      {loggedIn && (
        <button type="button" className="fab" aria-label="取引を追加" onClick={() => openNewTransaction()}>＋</button>
      )}

      {tagRemoval && (
        <ConfirmModal title="タグを削除" onConfirm={removeTag} onCancel={() => setTagRemoval(null)}>
          <p className="confirm-text">
            この取引からタグ「<span className={`tag ${tagColorClass(tagRemoval.tag)}`}>{tagRemoval.tag}</span>」を外しますか?
          </p>
          <p className="confirm-sub">
            {tagRemoval.txn.date.replaceAll("-", "/")} {formatYen(tagRemoval.txn.amount)} {tagRemoval.txn.memo ?? ""}
            <br />取引そのものと、他の取引のタグは消えません。
          </p>
        </ConfirmModal>
      )}

      {editing && (
        <TransactionModal
          key={editing === "new" ? `new-${newCategoryId ?? ""}` : editing.id}
          transaction={editing === "new" ? null : editing}
          categories={categories}
          defaultDate={defaultDate}
          defaultCategoryId={editing === "new" ? newCategoryId : null}
          onClose={() => setEditing(null)}
          onSave={saveTransaction}
          onDelete={() => editing !== "new" && setTxnDeletion(editing)}
        />
      )}
      {reportOpen && bookId && (
        <ReportModal bookId={bookId} month={month} categories={categories} summary={summary}
          onSelectMonth={changeMonth} onClose={() => setReportOpen(false)} />
      )}
      {recurringOpen && bookId && (
        <RecurringModal bookId={bookId} categories={categories} onChanged={reload} onClose={() => setRecurringOpen(false)} />
      )}
      {txnDeletion && (
        <ConfirmModal title="取引を削除" onConfirm={deleteTransaction} onCancel={() => setTxnDeletion(null)}>
          <p className="confirm-text">この取引を削除しますか?</p>
          <p className="confirm-sub">
            {txnDeletion.date.replaceAll("-", "/")} {categories.find((c) => c.id === txnDeletion.categoryId)?.name ?? ""}{" "}
            {formatYen(txnDeletion.amount)} {txnDeletion.memo ?? ""}
            <br />削除すると元に戻せません。
          </p>
        </ConfirmModal>
      )}
      {authModal === "login" && <LoginModal onClose={() => setAuthModal(null)} onSignedIn={handleSignedIn} />}
      {authModal === "register" && (
        <RegisterModal onClose={() => setAuthModal(null)} onSignedIn={handleSignedIn} onNeedLogin={() => setAuthModal("login")} />
      )}
      {authModal === "account" && user && (
        <AccountModal user={user} onClose={() => setAuthModal(null)} onSaved={(u) => {
          setUser(u);
          setAuthModal(null);
        }} />
      )}
    </>
  );
}
