# 収支管理アプリの画面（Next.js）

Next.js 16（App Router）+ React 19 + TypeScript。サーバーで動く機能は使わず、`next build` で静的ファイル（`out/`）に書き出して、ローカルでは Rails、EC2 では nginx から配信します。データはすべてブラウザから同じオリジンの `/api/`（Rails）へ取りに行きます。

| 場所 | 役割 |
|---|---|
| `app/layout.tsx` / `app/page.tsx` | 1画面だけのアプリの入口 |
| `app/globals.css` | スタイル（ライト/ダークのテーマ変数を含む） |
| `components/FinanceApp.tsx` | 画面全体。ログイン状態、家計簿、表示中の月、絞り込み、データの読み込みと操作 |
| `components/Board.tsx` | カンバン（カテゴリの列と取引のカード、ドラッグ&ドロップ） |
| `components/TransactionModal.tsx` | 取引の追加・編集 |
| `components/AuthModals.tsx` | ログイン・新規登録・アカウント設定 |
| `lib/api.ts` | API クライアントと型 |
| `lib/format.ts` | 金額・日付の表示 |

## コマンド

Node.js 24（このPCでは `~/tools/node-v24.22.0-win-x64`）を使います。

```
npm install
npm run build:rails   # 書き出して ../backend/public/ にコピー（Rails で http://localhost:8080/ を開く）
npm run dev           # 画面を書き換えながら確認（http://localhost:3000/、/api/ は localhost:8080 の Rails へ中継）
npm run typecheck     # 型チェック
npm run lint          # ESLint
```

`AGENTS.md` は Next.js が作るファイルです（`next dev` が書き戻すので、消さずにコミットしておく）。
