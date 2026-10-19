"use client";

import type { KeyboardEvent } from "react";
import type { Category, Transaction } from "@/lib/api";
import { formatTxnDate, formatYen } from "@/lib/format";
import { ConfirmToggle, DeleteTxnButton, RecurringMark, TagList, txnLabel } from "./Board";

type Props = {
  categories: Category[];
  transactions: Transaction[];
  filterActive: boolean;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onOpenTransaction: (txn: Transaction) => void;
  onToggleSelected: (id: string) => void;
  onRemoveTag: (txn: Transaction, tag: string) => void;
  onDeleteTransaction: (txn: Transaction) => void;
  onToggleConfirmed: (txn: Transaction) => void;
  onAddTransaction: () => void;
};

// 「カードの並び: 縦」のときの表示。カテゴリの列をやめ、表示中の月の取引を1列に並べる。
// 並び順は「並び替え」(日付の新しい順/金額の大きい順)に従う
export function TransactionList(props: Props) {
  const { categories, transactions } = props;
  const byId = new Map(categories.map((c) => [c.id, c]));

  return (
    <main className="board list-view">
      <ul className="txn-list" aria-label="取引の一覧">
        {transactions.length === 0 && (
          <li className="empty-hint">{props.filterActive ? "条件に合う取引はありません" : "この月の取引はありません"}</li>
        )}
        {transactions.map((txn) => {
          const category = byId.get(txn.categoryId);
          return category ? <ListRow key={txn.id} {...props} txn={txn} category={category} /> : null;
        })}
      </ul>
      {!props.selectionMode && (
        <button type="button" className="add-card-btn list-add" onClick={props.onAddTransaction}>+ 取引を追加</button>
      )}
    </main>
  );
}

function ListRow(props: Props & { txn: Transaction; category: Category }) {
  const { txn, category, selectionMode, selectedIds } = props;
  const income = category.type === "INCOME";
  const selected = selectionMode && selectedIds.has(txn.id);
  const activate = () => (selectionMode ? props.onToggleSelected(txn.id) : props.onOpenTransaction(txn));

  function handleKeyDown(e: KeyboardEvent<HTMLLIElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  }

  const classNames = ["txn-card", "txn-row"];
  if (!txn.confirmed) classNames.push("planned");
  if (selectionMode) classNames.push("selectable");
  if (selected) classNames.push("selected");

  return (
    <li
      className={classNames.join(" ")}
      role="button"
      tabIndex={0}
      aria-pressed={selectionMode ? selected : undefined}
      aria-label={txnLabel(txn, category)}
      onClick={activate}
      onKeyDown={handleKeyDown}
    >
      {selectionMode && (
        <input
          type="checkbox"
          className="txn-select-check"
          aria-label="この取引を選択"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => props.onToggleSelected(txn.id)}
        />
      )}
      <span className="txn-date">{formatTxnDate(txn.date)}</span>
      <span className={`txn-row-category ${income ? "income" : "expense"}`}>{category.name}</span>
      <span className={`txn-amount ${income ? "income" : "expense"}`}>
        {income ? "+" : "−"}
        {formatYen(txn.amount)}
      </span>
      <span className={`txn-memo${txn.memo ? "" : " empty"}`}>
        {txn.recurringId && <RecurringMark />}
        {txn.memo || "メモなし"}
      </span>
      <TagList txn={txn} selectionMode={selectionMode} onRemoveTag={props.onRemoveTag} />
      {!selectionMode && <ConfirmToggle txn={txn} onToggle={props.onToggleConfirmed} />}
      {!selectionMode && <DeleteTxnButton onClick={() => props.onDeleteTransaction(txn)} />}
    </li>
  );
}
