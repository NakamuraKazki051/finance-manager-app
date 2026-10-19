"use client";

import { useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import type { Category, CategoryType, Summary, Transaction } from "@/lib/api";
import { TrashIcon } from "./Icons";
import { formatMonthLabel, formatTxnDate, formatYen, MAX_AMOUNT, otherType, tagColorClass, TYPE_LABEL } from "@/lib/format";

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
  onRemoveTag: (txn: Transaction, tag: string) => void;
  onDeleteTransaction: (txn: Transaction) => void;
  onToggleConfirmed: (txn: Transaction) => void;
  onToggleSelected: (id: string) => void;
  onMoveTransaction: (txnId: string, categoryId: string) => void;
  onRenameCategory: (category: Category, name: string) => void;
  onToggleCategoryType: (category: Category) => void;
  onSetBudget: (category: Category, budget: number | null) => void;
  onMoveCategory: (categoryId: string, index: number) => void;
  onDeleteCategory: (category: Category) => void;
  onAddCategory: (name: string, type: CategoryType) => Promise<boolean>;
};

export function Board(props: BoardProps) {
  const { categories, transactions, summary } = props;
  return (
    <main className="board">
      {categories.map((category, index) => {
        const totals = summary?.categories.find((c) => c.categoryId === category.id);
        return (
          <CategoryColumn
            key={category.id}
            {...props}
            category={category}
            index={index}
            total={totals?.total ?? 0}
            plannedTotal={totals?.plannedTotal ?? 0}
            columnTransactions={transactions.filter((t) => t.categoryId === category.id)}
          />
        );
      })}
      <AddCategoryColumn onAdd={props.onAddCategory} />
    </main>
  );
}

type ColumnProps = BoardProps & {
  category: Category;
  index: number;
  // total は確定の取引の合計、plannedTotal は予定の取引の合計(どちらもサーバーの集計)
  total: number;
  plannedTotal: number;
  columnTransactions: Transaction[];
};

function CategoryColumn(props: ColumnProps) {
  const { category, index, categories, total, plannedTotal, columnTransactions, month } = props;
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
        <span className="column-total-amounts">
          <span className="column-total-amount" title={`${formatMonthLabel(month)}の合計(確定した取引)`}>{formatYen(total)}</span>
          {plannedTotal > 0 && (
            <span className="column-planned" title={`${formatMonthLabel(month)}の予定の取引の合計(合計には入っていません)`}>
              予定 {formatYen(plannedTotal)}
            </span>
          )}
        </span>
      </div>
      {category.type === "EXPENSE" && (
        <BudgetRow budget={category.budget} spent={total} planned={plannedTotal} month={month}
          onSave={(budget) => props.onSetBudget(category, budget)} />
      )}
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

type BudgetRowProps = { budget: number | null; spent: number; planned: number; month: string; onSave: (budget: number | null) => void };

// 支出カテゴリの月間予算。表示中の月の(確定した)合計と比べて残りを出し、超えたら赤くする。
// 予定の支出があれば、それも払ったときの残りを下に添える
function BudgetRow({ budget, spent, planned, month, onSave }: BudgetRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  function startEditing() {
    setValue(budget === null ? "" : String(budget));
    setError(false);
    setEditing(true);
  }

  // 空欄は「予算なし」。全角数字やカンマ付きでも受け付ける
  function commit() {
    const text = value.normalize("NFKC").replace(/[,¥円\s]/g, "");
    if (text === "") {
      setEditing(false);
      if (budget !== null) onSave(null);
      return;
    }
    const next = Number(text);
    if (!Number.isInteger(next) || next < 1 || next > MAX_AMOUNT) {
      setError(true);
      return;
    }
    setEditing(false);
    if (next !== budget) onSave(next);
  }

  if (editing) {
    return (
      <div className="budget-row">
        <input
          className={`budget-input${error ? " invalid" : ""}`}
          inputMode="numeric"
          placeholder="月の予算（空欄で予算なし）"
          aria-label="月の予算(円)"
          aria-invalid={error}
          title={error ? "1〜99,999,999円の整数で入力してください" : undefined}
          value={value}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
            }
          }}
        />
        {error && <div className="budget-error">1〜99,999,999円の整数で入力してください</div>}
      </div>
    );
  }

  if (budget === null) {
    return (
      <div className="budget-row">
        <button type="button" className="budget-set-btn" onClick={startEditing}>+ 予算を設定</button>
      </div>
    );
  }

  const remaining = budget - spent;
  const over = remaining < 0;
  const ratio = Math.min(spent / budget, 1);
  return (
    <div className={`budget-row${over ? " over" : ""}`}>
      <button type="button" className="budget-summary" title={`${formatMonthLabel(month)}の予算(クリックで変更)`} onClick={startEditing}>
        <span>予算 {formatYen(budget)}</span>
        <span className="budget-remaining">{over ? `${formatYen(-remaining)} 超過` : `残り ${formatYen(remaining)}`}</span>
      </button>
      <div className="budget-bar" role="progressbar" aria-label="予算の使用率" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}>
        <div className="budget-bar-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      {planned > 0 && (
        <div className={`budget-planned${remaining - planned < 0 ? " over" : ""}`}>
          予定を含めると{remaining - planned < 0 ? ` ${formatYen(planned - remaining)} 超過` : `残り ${formatYen(remaining - planned)}`}
        </div>
      )}
    </div>
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
  if (!txn.confirmed) classNames.push("planned");
  if (selectionMode) classNames.push("selectable");
  if (selected) classNames.push("selected");
  if (dragging) classNames.push("dragging");

  return (
    <div
      className={classNames.join(" ")}
      role="button"
      tabIndex={0}
      aria-pressed={selectionMode ? selected : undefined}
      aria-label={txnLabel(txn, category)}
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
      {/* ごみ箱はカードの右上の角に置く */}
      {!selectionMode && <DeleteTxnButton onClick={() => props.onDeleteTransaction(txn)} />}
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
      <TagList txn={txn} selectionMode={selectionMode} onRemoveTag={props.onRemoveTag} />
      {!selectionMode && <ConfirmToggle txn={txn} onToggle={props.onToggleConfirmed} />}
    </div>
  );
}

// 読み上げ用のカードの説明。予定の取引はそのことも伝える
export function txnLabel(txn: Transaction, category: Category) {
  return `${txn.confirmed ? "" : "予定 "}${txn.date} ${category.name} ${TYPE_LABEL[category.type]} ${formatYen(txn.amount)} ${txn.memo ?? ""}`;
}

// 取引の「確定」チェック(F-13)。外すと予定になり、月の収入・支出・残高から外れる。カンバンと一覧の両方で使う
export function ConfirmToggle({ txn, onToggle }: { txn: Transaction; onToggle: (txn: Transaction) => void }) {
  return (
    <label
      className={`confirm-toggle${txn.confirmed ? "" : " planned"}`}
      title={txn.confirmed ? "チェックを外すと予定に戻します" : "チェックすると確定します(月の合計に入ります)"}
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input type="checkbox" checked={txn.confirmed} onChange={() => onToggle(txn)} />
      <span>{txn.confirmed ? "確定" : "予定"}</span>
    </label>
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

// 取引のタグ。1つずつ「×」で外せる(押すと確認のモーダルが出る)。カンバンと一覧の両方で使う
export function TagList({ txn, selectionMode, onRemoveTag }: {
  txn: Transaction;
  selectionMode: boolean;
  onRemoveTag: (txn: Transaction, tag: string) => void;
}) {
  if (txn.tags.length === 0) return null;
  return (
    <ul className="txn-tags" aria-label="タグ">
      {txn.tags.map((tag) => (
        <li key={tag} className="txn-tag-item">
          <span className={`tag ${tagColorClass(tag)}`}>{tag}</span>
          {!selectionMode && (
            <button
              type="button"
              className="tag-remove"
              aria-label={`タグ「${tag}」を削除`}
              title="このタグを削除"
              draggable={false}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveTag(txn, tag);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// 取引カードのごみ箱ボタン。押すと確認のモーダルが出る(カードを開く・ドラッグする操作とは分ける)
export function DeleteTxnButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="txn-delete"
      aria-label="この取引を削除"
      title="この取引を削除"
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <TrashIcon />
    </button>
  );
}
