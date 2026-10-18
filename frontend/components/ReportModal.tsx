"use client";

import { useEffect, useState } from "react";
import { api, type Category, type CategoryType, type MonthlySummary, type MonthTotal, type Summary } from "@/lib/api";
import { formatMonthLabel, formatSignedYen, formatYen, shiftMonth, TYPE_LABEL } from "@/lib/format";
import { Modal } from "./Modal";

const TREND_MONTHS = 12;

type Props = {
  bookId: string;
  month: string;
  categories: Category[];
  summary: Summary | null;
  onSelectMonth: (month: string) => void;
  onClose: () => void;
};

// F-11 の集計レポート。表示中の月のカテゴリ別の内訳と、その月までの12か月の推移を出す。
// 金額はすべてサーバーの集計(/summary と /summary/monthly)の値をそのまま使う
export function ReportModal({ bookId, month, categories, summary, onSelectMonth, onClose }: Props) {
  const [trend, setTrend] = useState<MonthlySummary | null>(null);
  const [type, setType] = useState<CategoryType>("EXPENSE");

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const from = shiftMonth(month, -(TREND_MONTHS - 1));
        const data = await api.get<MonthlySummary>(`/api/books/${bookId}/summary/monthly?from=${from}&to=${month}`);
        if (!stale) setTrend(data);
      } catch {
        /* エラーはバナー表示済み */
      }
    })();
    return () => {
      stale = true;
    };
  }, [bookId, month]);

  return (
    <Modal title="📊 レポート" onClose={onClose} wide>
      <section className="report-section" aria-labelledby="report-breakdown">
        <div className="report-heading">
          <h3 id="report-breakdown">{formatMonthLabel(month)}の内訳</h3>
          <div className="report-tabs" role="group" aria-label="収入か支出か">
            {(["EXPENSE", "INCOME"] as const).map((t) => (
              <button key={t} type="button" className={`btn-secondary${type === t ? " active" : ""}`} aria-pressed={type === t}
                onClick={() => setType(t)}>
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        <Breakdown type={type} categories={categories} summary={summary} />
      </section>

      <section className="report-section" aria-labelledby="report-trend">
        <div className="report-heading">
          <h3 id="report-trend">{TREND_MONTHS}か月の推移</h3>
          <span className="report-legend">
            <span className="legend income">収入</span>
            <span className="legend expense">支出</span>
          </span>
        </div>
        {trend ? (
          <TrendChart
            months={trend.months}
            current={month}
            onSelect={(m) => {
              onSelectMonth(m);
              onClose();
            }}
          />
        ) : (
          <p className="report-empty">読み込み中…</p>
        )}
      </section>

      <div className="modal-actions">
        <div className="modal-actions-right">
          <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </Modal>
  );
}

// カテゴリ別の合計を、大きい順の横棒で出す。割合は表示中の種別の合計に対するもの
function Breakdown({ type, categories, summary }: { type: CategoryType; categories: Category[]; summary: Summary | null }) {
  if (!summary) return <p className="report-empty">読み込み中…</p>;
  const totals = new Map(summary.categories.map((c) => [c.categoryId, c.total]));
  const rows = categories
    .filter((c) => c.type === type)
    .map((c) => ({ category: c, total: totals.get(c.id) ?? 0 }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  const sum = type === "INCOME" ? summary.income : summary.expense;
  if (rows.length === 0) return <p className="report-empty">この月の{TYPE_LABEL[type]}はありません</p>;

  const max = rows[0].total;
  return (
    <ul className="breakdown">
      {rows.map(({ category, total }) => {
        const percent = sum > 0 ? Math.round((total / sum) * 1000) / 10 : 0;
        return (
          <li key={category.id} className="breakdown-row">
            <span className="breakdown-name">{category.name}</span>
            <span className="breakdown-bar" aria-hidden="true">
              <span className={`breakdown-fill ${type === "INCOME" ? "income" : "expense"}`} style={{ width: `${(total / max) * 100}%` }} />
            </span>
            <span className="breakdown-amount">{formatYen(total)}</span>
            <span className="breakdown-percent">{percent}%</span>
          </li>
        );
      })}
      <li className="breakdown-row breakdown-total">
        <span className="breakdown-name">合計</span>
        <span />
        <span className="breakdown-amount">{formatYen(sum)}</span>
        <span className="breakdown-percent">100%</span>
      </li>
    </ul>
  );
}

// 月ごとの収入・支出の棒グラフと、その下に残高。月を押すとその月の表示に切り替える
function TrendChart({ months, current, onSelect }: { months: MonthTotal[]; current: string; onSelect: (month: string) => void }) {
  const width = 720;
  const height = 200;
  const top = 12;
  const bottom = 24;
  const left = 8;
  const slot = (width - left * 2) / months.length;
  const barWidth = Math.min(18, slot / 3);
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  const plot = height - top - bottom;
  const barHeight = (amount: number) => (amount / max) * plot;

  return (
    <div className="trend">
      <svg viewBox={`0 0 ${width} ${height}`} className="trend-chart" role="img"
        aria-label={`${formatMonthLabel(months[0].month)}から${formatMonthLabel(months[months.length - 1].month)}までの収入と支出`}>
        <line x1={left} x2={width - left} y1={top + plot} y2={top + plot} className="trend-axis" />
        {months.map((m, i) => {
          const x = left + slot * i;
          const center = x + slot / 2;
          const label = `${Number(m.month.slice(5))}月`;
          return (
            <g key={m.month} className={`trend-month${m.month === current ? " current" : ""}`} role="button" tabIndex={0}
              aria-label={`${formatMonthLabel(m.month)} 収入${formatYen(m.income)} 支出${formatYen(m.expense)}。押すとこの月を表示`}
              onClick={() => onSelect(m.month)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(m.month);
                }
              }}>
              <title>{`${formatMonthLabel(m.month)}\n収入 ${formatYen(m.income)}\n支出 ${formatYen(m.expense)}\n残高 ${formatSignedYen(m.balance)}`}</title>
              <rect x={x} y={top} width={slot} height={plot + bottom} className="trend-hit" />
              <rect x={center - barWidth - 1} y={top + plot - barHeight(m.income)} width={barWidth} height={barHeight(m.income)} className="trend-bar income" />
              <rect x={center + 1} y={top + plot - barHeight(m.expense)} width={barWidth} height={barHeight(m.expense)} className="trend-bar expense" />
              <text x={center} y={height - 6} textAnchor="middle" className="trend-label">{label}</text>
            </g>
          );
        })}
      </svg>
      <div className="trend-table-wrap">
        <table className="trend-table">
          <thead>
            <tr>
              <th scope="row">月</th>
              {months.map((m) => <th key={m.month} scope="col" className={m.month === current ? "current" : undefined}>{`${Number(m.month.slice(5))}月`}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">残高</th>
              {months.map((m) => (
                <td key={m.month} className={`${m.balance < 0 ? "negative" : ""}${m.month === current ? " current" : ""}`}>
                  {formatSignedYen(m.balance)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
