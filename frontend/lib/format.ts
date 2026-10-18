import type { CategoryType } from "./api";

export const MAX_AMOUNT = 99_999_999;
export const TYPE_LABEL: Record<CategoryType, string> = { INCOME: "収入", EXPENSE: "支出" };
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const TAG_COLORS = ["sky", "lime", "green", "red", "azure", "purple", "yellow", "orange", "pink", "slate"];

export function otherType(type: CategoryType): CategoryType {
  return type === "INCOME" ? "EXPENSE" : "INCOME";
}

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

// 残高はマイナスになりうるので、符号を付けて表示する
export function formatSignedYen(amount: number): string {
  return amount < 0 ? `-${formatYen(-amount)}` : formatYen(amount);
}

// toISOString() は UTC 基準のため、日本時間の0〜9時に前日の日付になってしまう。ローカル日付で YYYY-MM-DD を作る
export function localDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function currentMonthString(): string {
  return localDateString().slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return localDateString(new Date(y, m - 1 + delta, 1)).slice(0, 7);
}

export function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

// カードの日付。曜日を付けて、いつの出費か思い出しやすくする
export function formatTxnDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

export function formatCreatedAt(isoInstant: string): string {
  const d = new Date(isoInstant);
  return Number.isNaN(d.getTime()) ? "" : localDateString(d).replaceAll("-", "/");
}

export function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
}

export function tagColorClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

// カードのタグを縦(一覧)に並べるか、横に並べるか
export type TagLayout = "vertical" | "horizontal";
