// バックエンド(Rails)の API クライアント。画面と API は同じオリジンの /api/ にある前提
// (ローカル: Rails が 8080 番で両方を配信 / next dev のときは next.config.ts の rewrites で中継 / EC2: nginx が中継)

export type CategoryType = "INCOME" | "EXPENSE";

export type User = { id: string; email: string; createdAt: string };
export type Book = { id: string; name: string };
export type Category = { id: string; bookId: string; name: string; type: CategoryType; displayOrder: number };
export type Transaction = {
  id: string;
  bookId: string;
  categoryId: string;
  amount: number;
  date: string;
  memo: string | null;
  tags: string[];
  createdAt: string;
};
export type CategoryTotal = { categoryId: string; total: number; count: number };
export type Summary = {
  month: string;
  income: number;
  expense: number;
  balance: number;
  count: number;
  categories: CategoryTotal[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Listeners = {
  onError: (message: string) => void;
  onSuccess: () => void;
  onUnauthorized: () => void;
};

// 画面側(FinanceApp)が登録する。エラーバナーの表示と、セッション切れでログアウト状態に戻す処理
let listeners: Listeners = { onError: () => {}, onSuccess: () => {}, onUnauthorized: () => {} };

export function setApiListeners(next: Listeners) {
  listeners = next;
}

async function send(path: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      credentials: "same-origin",
    });
  } catch {
    const message = "バックエンドに接続できません。Docker/サーバーが起動しているか確認してください。";
    listeners.onError(message);
    throw new ApiError(0, message);
  }
}

function fail(res: Response, data: unknown): never {
  const message =
    data && typeof data === "object" && "message" in data && typeof data.message === "string"
      ? data.message
      : `リクエストに失敗しました (${res.status})`;
  // 別の端末でパスワードが変更されたなどでセッションが切れたら、ログアウト状態の画面に戻す
  if (res.status === 401) listeners.onUnauthorized();
  listeners.onError(message);
  throw new ApiError(res.status, message);
}

// 失敗したらエラーバナーを出したうえで ApiError を投げる。呼び出し側は catch して処理を止めるだけでよい
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await send(path, options);

  let data: unknown = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (!res.ok) fail(res, data);
  listeners.onSuccess();
  return data as T;
}

// CSV などのファイルを受け取る。失敗時の扱いは apiFetch と同じ(エラーの本文は JSON で返ってくる)
export async function apiDownload(path: string): Promise<Blob> {
  const res = await send(path, {});
  if (!res.ok) fail(res, await res.json().catch(() => null));
  listeners.onSuccess();
  return res.blob();
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (path: string) => apiFetch<null>(path, { method: "DELETE" }),
};

// ログイン・登録・アカウント設定のフォームは、エラーをバナーではなくフォームの中に出すので別に用意する
export async function formRequest<T>(path: string, method: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "バックエンドに接続できません。" };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, message: (data && data.message) || "リクエストに失敗しました。" };
  }
  return { ok: true, data: data as T };
}

export async function fetchCurrentUser(): Promise<User | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    return res.ok ? ((await res.json()) as User) : null;
  } catch {
    return null;
  }
}
