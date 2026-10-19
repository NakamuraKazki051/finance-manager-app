"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Category, Transaction } from "@/lib/api";
import { formatCreatedAt, MAX_AMOUNT, parseTags, TYPE_LABEL } from "@/lib/format";
import { Modal } from "./Modal";

export type TransactionInput = {
  amount: number;
  date: string;
  categoryId: string;
  memo: string;
  tags: string[];
  confirmed: boolean;
};

type Props = {
  transaction: Transaction | null;
  categories: Category[];
  defaultDate: string;
  defaultCategoryId?: string | null;
  onClose: () => void;
  onSave: (input: TransactionInput) => void;
  onDelete: () => void;
};

export function TransactionModal({ transaction, categories, defaultDate, defaultCategoryId, onClose, onSave, onDelete }: Props) {
  const fallbackCategory =
    categories.find((c) => c.id === defaultCategoryId) ?? categories.find((c) => c.type === "EXPENSE") ?? categories[0];
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : "");
  const [date, setDate] = useState(transaction ? transaction.date : defaultDate);
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? fallbackCategory?.id ?? "");
  const [memo, setMemo] = useState(transaction?.memo ?? "");
  const [tags, setTags] = useState(transaction ? transaction.tags.join(", ") : "");
  const [planned, setPlanned] = useState(transaction ? !transaction.confirmed : false);
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // 「1,280」のようにカンマ付きで貼り付けられても受け付ける
    const amountText = amount.replaceAll(",", "").trim();
    const value = Number(amountText);
    if (!amountText || !Number.isInteger(value) || value < 1 || value > MAX_AMOUNT) {
      setError("金額は1〜99,999,999の整数(円)で入力してください。");
      amountRef.current?.focus();
      return;
    }
    if (!date) {
      setError("日付を入力してください。");
      dateRef.current?.focus();
      return;
    }
    if (!categoryId) {
      setError("カテゴリを選んでください。");
      return;
    }
    onSave({ amount: value, date, categoryId, memo: memo.trim(), tags: parseTags(tags), confirmed: !planned });
  }

  return (
    <Modal title={transaction ? "取引を編集" : "取引を追加"} onClose={onClose}>
      <form className="stack-form txn-form" onSubmit={handleSubmit} noValidate>
        {transaction && <div className="txn-created">登録日: {formatCreatedAt(transaction.createdAt)}</div>}
        <label>
          <span>金額(円)<span className="required">*</span></span>
          <input
            ref={amountRef}
            className="txn-amount-input"
            type="number"
            min={1}
            max={MAX_AMOUNT}
            step={1}
            inputMode="numeric"
            placeholder="例: 1280"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </label>
        <div className="form-row">
          <label>
            <span>日付<span className="required">*</span></span>
            <input ref={dateRef} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            <span>カテゴリ<span className="required">*</span></span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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
        </div>
        <label>
          メモ
          <input type="text" maxLength={100} placeholder="例: スーパーで食材" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <label>
          <span>タグ<span className="hint">(カンマ区切り)</span></span>
          <input type="text" placeholder="例: 外食, 旅行" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)} />
          <span>予定（まだ確定していない。月の収入・支出・残高には入れず、別に表示する）</span>
        </label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <div className="modal-actions">
          {transaction ? (
            <button type="button" className="btn-danger" onClick={onDelete}>削除</button>
          ) : (
            <span />
          )}
          <div className="modal-actions-right">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary">保存</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
