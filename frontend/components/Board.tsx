"use client";

import { useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import type { Category, CategoryType, Summary, Transaction } from "@/lib/api";
import { formatMonthLabel, formatTxnDate, formatYen, otherType, tagColorClass, TYPE_LABEL } from "@/lib/format";

const CATEGORY_DRAG_TYPE = "application/x-category-id";
const TXN_DRAG_TYPE = "application/x-transaction-id";

type BoardProps = {
  categories: Category[];
  transactions: Transaction[];
  summary: Summary | null;
  month: string;
  filterActive: boolean;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onOpenTransaction: (txn: Transaction) => void;
  onAddTransaction: (categoryId: string) => void;
  onToggleSelected: (id: string) => void;
  onMoveTransaction: (txnId: string, categoryId: string) => void;
  onRenameCategory: (category: Category, name: string) => void;
  onToggleCategoryType: (category: Category) => void;
  onMoveCategory: (categoryId: string, index: number) => void;
  onDeleteCategory: (category: Category) => void;
  onAddCategory: (name: string, type: CategoryType) => Promise<boolean>;
};

export function Board(props: BoardProps) {
  const { categories, transactions, summary } = props;
  return (
    <main className="board">
      {categories.map((category, index) => (
        <CategoryColumn
          key={category.id}
          {...props}
          category={category}
          index={index}
          total={summary?.categories.find((c) => c.categoryId === category.id)?.total ?? 0}
          columnTransactions={transactions.filter((t) => t.categoryId === category.id)}
        />
      ))}
      <AddCategoryColumn onAdd={props.onAddCategory} />
    </main>
  );
}

type ColumnProps = BoardProps & {
  category: Category;
  index: number;
  total: number;
  columnTransactions: Transaction[];
};

function CategoryColumn(props: ColumnProps) {
  const { category, index, categories, total, columnTransactions, month } = props;
  const [editing, setEditing] = useState(false);
  const [dropTarget, setDropTarget] = useState<"card" | "column" | null>(null);
  const [dragging, setDragging] = useState(false);
  const typeClass = category.type === "INCOME" ? "income" : "expense";

  function handleDragOver(e: DragEvent) {
    const types = e.dataTransfer.types;
    if (types.includes(CATEGORY_DRAG_TYPE)) {
      e.preventDefault();
      setDropTarget("column");
    } else if (types.includes(TXN_DRAG_TYPE)) {
      e.preventDefault();
      setDropTarget("card");
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDropTarget(null);
    const categoryId = e.dataTransfer.getData(CATEGORY_DRAG_TYPE);
    if (categoryId) {
      if (categoryId !== category.id) props.onMoveCategory(categoryId, index);
      return;
    }
    const txnId = e.dataTransfer.getData(TXN_DRAG_TYPE);
    // 取引をドロップすると、そのカテゴリへ付け替える(カテゴリ内の並び順は日付・金額で決まる)
    if (txnId) props.onMoveTransaction(txnId, category.id);
  }

  const classNames = ["column", typeClass];
  if (dropTarget === "card") classNames.push("drag-over");
  if (dropTarget === "column") classNames.push("column-drag-over");
  if (dragging) classNames.push("column-dragging");

  return (
    <section
      className={classNames.join(" ")}
      onDragOver={handleDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
      }}
      onDrop={handleDrop}
    >
      <h2>
        {editing ? (
          <CategoryNameInput
            initial={category.name}
            onDone={(name) => {
              setEditing(false);
              if (name && name !== category.name) props.onRenameCategory(category, name);
            }}
          />
        ) : (
          <span
            className="column-name"
            title="ドラッグで並び替え"
            draggable
            onDragStart={(e) => {
              setDragging(true);
              e.dataTransfer.setData(CATEGORY_DRAG_TYPE, category.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => setDragging(false)}
          >
            {category.name}
          </span>
        )}
        <span className="count">{columnTransactions.length}</span>
        {!editing && (
          <button type="button" className="column-move" aria-label="カテゴリ名を変更" title="カテゴリ名を変更"
            onClick={() => setEditing(true)}>✎</button>
        )}
        <button type="button" className="column-move" aria-label="カテゴリを左に移動" title="カテゴリを左に移動"
          disabled={index === 0} onClick={() => props.onMoveCategory(category.id, index - 1)}>◀</button>
        <button type="button" className="column-move" aria-label="カテゴリを右に移動" title="カテゴリを右に移動"
          disabled={index === categories.length - 1} onClick={() => props.onMoveCategory(category.id, index + 1)}>▶</button>
        <button type="button" className="column-delete" aria-label="カテゴリを削除" onClick={() => props.onDeleteCategory(category)}>×</button>
      </h2>
      <div className="column-total">
        <button
          type="button"
          className={`column-type ${typeClass}`}
          title={`${TYPE_LABEL[category.type]}のカテゴリです(クリックで${TYPE_LABEL[otherType(category.type)]}に変更)`}
          onClick={() => props.onToggleCategoryType(category)}
        >
          {TYPE_LABEL[category.type]}
        </button>
        <span className="column-total-amount" title={`${formatMonthLabel(month)}の合計`}>{formatYen(total)}</span>
      </div>
      <div className="card-list">
        {columnTransactions.length === 0 && (
          <div className="empty-hint">{props.filterActive ? "条件に合う取引はありません" : "この月の取引はありません"}</div>
        )}
        {columnTransactions.map((txn) => (
          <TransactionCard key={txn.id} {...props} txn={txn} />
        ))}
      </div>
      {/* 金額はカードとして記録する。見出しに数字を打ち込んでしまわないよう、列ごとに入口を置く */}
      {!props.selectionMode && (
        <button type="button" className="add-card-btn" onClick={() => props.onAddTransaction(category.id)}>
          + {TYPE_LABEL[category.type]}を追加
        </button>
      )}
    </section>
  );
}

function CategoryNameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const [finished, setFinished] = useState(false);
  const finish = (name: string | null) => {
    if (finished) return;
    setFinished(true);
    onDone(name);
  };
  return (
    <input
      className="column-name-input"
      value={value}
      maxLength={30}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(value.trim());
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }}
    />
  );
}

function TransactionCard(props: ColumnProps & { txn: Transaction }) {
  const { txn, category, selectionMode, selectedIds } = props;
  const [dragging, setDragging] = useState(false);
  const income = category.type === "INCOME";
  const selected = selectionMode && selectedIds.has(txn.id);
  const activate = () => (selectionMode ? props.onToggleSelected(txn.id) : props.onOpenTransaction(txn));

  // カード自体にフォーカスがあるときだけ反応させる(中のチェックボックスでのSpaceはそちらの操作)
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  }

  const classNames = ["txn-card"];
  if (selectionMode) classNames.push("selectable");
  if (selected) classNames.push("selected");
  if (dragging) classNames.push("dragging");

  return (
    <div
      className={classNames.join(" ")}
      role="button"
      tabIndex={0}
      aria-pressed={selectionMode ? selected : undefined}
      aria-label={`${txn.date} ${category.name} ${TYPE_LABEL[category.type]} ${formatYen(txn.amount)} ${txn.memo ?? ""}`}
      draggable={!selectionMode}
      onClick={activate}
      onKeyDown={handleKeyDown}
      onDragStart={(e) => {
        setDragging(true);
        e.dataTransfer.setData(TXN_DRAG_TYPE, txn.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => setDragging(false)}
    >
      <div className="txn-card-head">
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
        <span className={`txn-amount ${income ? "income" : "expense"}`}>
          {income ? "+" : "−"}
          {formatYen(txn.amount)}
        </span>
        <span className="txn-date">{formatTxnDate(txn.date)}</span>
      </div>
      {/* メモが空のときはカテゴリ名を薄く出す */}
      <div className={`txn-memo${txn.memo ? "" : " empty"}`}>{txn.memo || category.name}</div>
      {txn.tags.length > 0 && (
        <div className="txn-meta">
          {txn.tags.map((tag) => (
            <span key={tag} className={`tag ${tagColorClass(tag)}`}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function AddCategoryColumn({ onAdd }: { onAdd: (name: string, type: CategoryType) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<CategoryType>("EXPENSE");

  function reset() {
    setOpen(false);
    setName("");
    setType("EXPENSE");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (await onAdd(trimmed, type)) reset();
  }

  return (
    <section className="column add-column">
      {open ? (
        <form className="add-column-form" onSubmit={handleSubmit}>
          <input type="text" placeholder="カテゴリ名を入力" maxLength={30} aria-label="カテゴリ名" autoFocus
            value={name} onChange={(e) => setName(e.target.value)} />
          <select aria-label="収入か支出か" value={type} onChange={(e) => setType(e.target.value as CategoryType)}>
            <option value="EXPENSE">支出のカテゴリ</option>
            <option value="INCOME">収入のカテゴリ</option>
          </select>
          <div className="add-column-actions">
            <button type="submit" className="btn-primary">追加</button>
            <button type="button" className="btn-secondary" onClick={reset}>キャンセル</button>
          </div>
        </form>
      ) : (
        <button type="button" className="add-column-btn" onClick={() => setOpen(true)}>+ カテゴリを追加</button>
      )}
    </section>
  );
}
