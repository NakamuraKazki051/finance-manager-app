"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, type Category, type RecurringRule } from "@/lib/api";
import { currentMonthString, formatMonthLabel, formatYen, MAX_AMOUNT, parseTags, shiftMonth, TYPE_LABEL } from "@/lib/format";
import { Modal } from "./Modal";

// 開始月として選べる範囲(今月の前後12か月。バックエンドの START_MONTH_RANGE と合わせる)
const START_MONTH_RANGE = 12;
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

type Props = {
  bookId: string;
  categories: Category[];
  // 固定費を変えると取引が作られたり印が外れたりするので、画面の取引を取り直してもらう
  onChanged: () => void;
  onClose: () => void;
};

type Form = { amount: string; day: number; categoryId: string; memo: string; tags: string; startMonth: string };

// 固定費の繰り返し(F-12)。家賃・サブスクなどを「毎月…日」で登録すると、その月の予定の取引がサーバーで作られる
export function RecurringModal({ bookId, categories, onChanged, onClose }: Props) {
  const [rules, setRules] = useState<RecurringRule[] | null>(null);
  // 編集中の固定費。"new" は新規登録、null はフォームを閉じている
  const [editing, setEditing] = useState<RecurringRule | "new" | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const byId = new Map(categories.map((c) => [c.id, c]));
  const thisMonth = currentMonthString();

  async function load() {
    try {
      setRules(await api.get<RecurringRule[]>(`/api/books/${bookId}/recurring-transactions`));
    } catch {
      /* エラーはバナー表示済み */
    }
  }

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const list = await api.get<RecurringRule[]>(`/api/books/${bookId}/recurring-transactions`);
        if (!stale) setRules(list);
      } catch {
        /* エラーはバナー表示済み */
      }
    })();
    return () => {
      stale = true;
    };
  }, [bookId]);

  function openForm(rule: RecurringRule | "new") {
    const fallback = categories.find((c) => c.type === "EXPENSE") ?? categories[0];
    setForm(
      rule === "new"
        ? { amount: "", day: 27, categoryId: fallback?.id ?? "", memo: "", tags: "", startMonth: thisMonth }
        : { amount: String(rule.amount), day: rule.day, categoryId: rule.categoryId, memo: rule.memo ?? "", tags: rule.tags.join(", "), startMonth: rule.startMonth },
    );
    setError("");
    setEditing(rule);
  }

  function closeForm() {
    setEditing(null);
    setForm(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form || !editing) return;
    const amountText = form.amount.replaceAll(",", "").trim();
    const amount = Number(amountText);
    if (!amountText || !Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
      setError("金額は1〜99,999,999の整数(円)で入力してください。");
      return;
    }
    if (!form.categoryId) {
      setError("カテゴリを選んでください。");
      return;
    }
    const body = { amount, day: form.day, categoryId: form.categoryId, memo: form.memo.trim(), tags: parseTags(form.tags) };
    try {
      if (editing === "new") {
        await api.post(`/api/books/${bookId}/recurring-transactions`, { ...body, startMonth: form.startMonth });
      } else {
        await api.put(`/api/recurring-transactions/${editing.id}`, body);
      }
    } catch {
      return;
    }
    closeForm();
    await load();
    onChanged();
  }

  async function remove(rule: RecurringRule) {
    if (!confirm(`固定費「${ruleName(rule)}」を削除しますか?\nこれまでに作った取引は残ります。来月からは作られなくなります。`)) return;
    try {
      await api.delete(`/api/recurring-transactions/${rule.id}`);
    } catch {
      return;
    }
    if (editing !== "new" && editing?.id === rule.id) closeForm();
    await load();
    onChanged();
  }

  function ruleName(rule: RecurringRule) {
    return rule.memo || byId.get(rule.categoryId)?.name || "固定費";
  }

  return (
    <Modal title="🔁 固定費" onClose={onClose} wide>
      <p className="recurring-intro">
        毎月決まった日の収入・支出を登録すると、その月の取引が「予定」として自動で作られます。引き落としなどを確認したら、カードの「予定」にチェックを入れて確定してください。
      </p>

      {rules === null ? (
        <p className="report-empty">読み込み中…</p>
      ) : rules.length === 0 ? (
        <p className="report-empty">固定費はまだありません。</p>
      ) : (
        <ul className="recurring-list" aria-label="固定費の一覧">
          {rules.map((rule) => {
            const category = byId.get(rule.categoryId);
            const income = category?.type === "INCOME";
            return (
              <li key={rule.id} className="recurring-item">
                <span className="recurring-day">毎月{rule.day}日</span>
                <span className="recurring-name">
                  {ruleName(rule)}
                  {category && <span className="recurring-category">{category.name}</span>}
                </span>
                <span className={`txn-amount ${income ? "income" : "expense"}`}>
                  {income ? "+" : "−"}
                  {formatYen(rule.amount)}
                </span>
                <span className="recurring-actions">
                  <button type="button" className="btn-secondary" onClick={() => openForm(rule)}>編集</button>
                  <button type="button" className="btn-secondary" onClick={() => remove(rule)}>削除</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {form && editing ? (
        <form className="stack-form recurring-form" onSubmit={handleSubmit} noValidate>
          <h3>{editing === "new" ? "固定費を追加" : "固定費を編集"}</h3>
          <div className="form-row">
            <label>
              <span>金額(円)<span className="required">*</span></span>
              <input type="number" min={1} max={MAX_AMOUNT} step={1} inputMode="numeric" placeholder="例: 80000" autoFocus
                value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </label>
            <label>
              <span>毎月の日付<span className="required">*</span></span>
              <select value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>{d}日{d >= 29 ? "（無い月は月末）" : ""}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              <span>カテゴリ<span className="required">*</span></span>
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                {(["EXPENSE", "INCOME"] as const).map((type) => {
                  const options = categories.filter((c) => c.type === type);
                  return options.length ? (
                    <optgroup key={type} label={TYPE_LABEL[type]}>
                      {options.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </label>
            {editing === "new" ? (
              <label>
                <span>開始月</span>
                <input type="month" required value={form.startMonth}
                  min={shiftMonth(thisMonth, -START_MONTH_RANGE)} max={shiftMonth(thisMonth, START_MONTH_RANGE)}
                  onChange={(e) => setForm({ ...form, startMonth: e.target.value || thisMonth })} />
              </label>
            ) : (
              <label>
                <span>開始月</span>
                <input type="text" value={formatMonthLabel(form.startMonth)} disabled />
              </label>
            )}
          </div>
          <label>
            メモ
            <input type="text" maxLength={100} placeholder="例: 家賃" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          </label>
          <label>
            <span>タグ<span className="hint">(カンマ区切り)</span></span>
            <input type="text" placeholder="例: 固定費, サブスク" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </label>
          <p className="recurring-note">
            {editing === "new"
              ? form.startMonth < thisMonth
                ? `${formatMonthLabel(form.startMonth)}から今月までの取引を、まとめて予定として作ります。`
                : form.startMonth === thisMonth
                  ? "今月の取引をすぐに予定として作ります。"
                  : `${formatMonthLabel(form.startMonth)}になったら取引を作ります。`
              : "変更は、これから作る取引にだけ反映されます(作り済みの取引はそのまま)。"}
          </p>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <div className="modal-actions">
            <span />
            <div className="modal-actions-right">
              <button type="button" className="btn-secondary" onClick={closeForm}>キャンセル</button>
              <button type="submit" className="btn-primary">保存</button>
            </div>
          </div>
        </form>
      ) : (
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={() => openForm("new")}>+ 固定費を追加</button>
          <div className="modal-actions-right">
            <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
