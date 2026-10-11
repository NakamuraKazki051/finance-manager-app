# task-manager-api

タスク管理アプリ用のSpring Boot REST API（Board / Column / Task）。`mvn package` 時にリポジトリ直下の `index.html`/`app.js`/`style.css` を静的リソースとして同梱し、`http://localhost:8080/` でフロントエンドも一緒に配信する（Cookieベースのセッション認証を `file://` から使うとSameSite制限で壊れるため、同一オリジンで配信している）。

## 技術構成

- Java 17 / Spring Boot 4.1.1
- Spring Web, Spring Data JPA, PostgreSQL（本番/開発用途、Dockerコンテナで起動）
- テスト実行時はH2インメモリDBを使用（`src/test/resources/application.yml`）し、Dockerなしでも `mvn test` が通る

## 起動方法

事前にリポジトリ直下の `docker-compose.yml` でDBコンテナを起動しておく必要があります。

```
docker compose up -d   # リポジトリ直下で実行、taskmanagerデータベースを起動（localhost:5432）
cd backend
mvn package
java -Xmx256m -Xss512k -XX:MaxMetaspaceSize=128m -jar target/task-manager-api-0.1.0.jar
```

- API: http://localhost:8080/api/...
- DB接続先: `jdbc:postgresql://localhost:5432/taskmanager`（ユーザー/パスワード: `taskmanager`、`../docker-compose.yml` 参照）

このマシンはメモリが少ないため、`mvn spring-boot:run` を常駐させず、`mvn package` でビルドしたjarをヒープ制限付きで起動することを推奨します。

## エンドポイント

認証はCookieセッション方式。`/api/users/register` と `/api/auth/login` 以外はログインが必要で、未ログインなら401を返す。パスワードを変更すると、変更した端末以外のセッションは401になる（もう一度ログインが必要）。登録済みかどうかをログインの応答時間から推測されないよう、未登録のメールアドレスでもパスワード照合を行う。他ユーザーのボード・列・タスクへのアクセスは存在しない扱い（404）になる。CORSは `http://localhost:*` / `http://127.0.0.1:*` からのみ許可している。フロントエンドを別のポートで配信する環境（EC2など）では、環境変数 `APP_CORS_ALLOWED_ORIGINS`（カンマ区切り、完全一致のみ。例: `http://203.0.113.10`）で許可するオリジンを追加できる。`*` を含む値は無視する。

入力の上限: メールアドレス255文字、パスワード8〜72文字かつ72バイト以内（全角文字は1文字3バイト）、ボード名・列名30文字、タスクの `title` 100文字・`description` 500文字、カテゴリ1つ30文字、チェックリストの項目200文字。超えた場合や必須項目が無い場合は400を返す（インポートでは列・タスク1件ずつ検証し、1件でも不正なら何も変更しない）。

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/users/register` | ユーザー登録 `{email, password}`（パスワードは8〜72文字・72バイト以内） |
| PUT | `/api/users/me` | メールアドレス・パスワード変更 `{email?, newPassword?, currentPassword}` |
| POST | `/api/auth/login` | ログイン `{email, password}`（セッションIDを再発行） |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | ログイン中のユーザー |
| GET | `/api/boards` | ボード一覧 |
| POST | `/api/boards` | ボード作成 `{name}` |
| POST | `/api/boards/ensure-default` | ボードが1つも無ければ「マイボード」と既定の列（未着手/進行中/完了）を作成し、ボード一覧を返す。同時に呼ばれても1つしか作らない（初回ログイン時にフロントが使用） |
| PUT | `/api/boards/{id}` | ボード名変更 `{name}` |
| DELETE | `/api/boards/{id}` | ボード削除（そのボードの列・タスクも削除。最後の1件は不可） |
| PUT | `/api/boards/{boardId}/import` | ボードの列・タスクをJSONで全置換 `{columns, tasks}` |
| GET | `/api/boards/{boardId}/columns` | 列一覧 |
| POST | `/api/boards/{boardId}/columns` | 列作成 `{name, done}` |
| PUT | `/api/columns/{id}` | 列更新 `{name?, done?}` |
| PATCH | `/api/columns/{id}/move` | 列の並び替え `{displayOrder}` |
| DELETE | `/api/columns/{id}` | 列削除（タスクが残っている列・最後の1列は不可） |
| GET | `/api/boards/{boardId}/tasks?category=&priority=&q=&sort=manual\|due\|priority` | タスク一覧（フィルタ・検索・並び替え。同順位は手動の並び順） |
| POST | `/api/boards/{boardId}/tasks` | タスク作成（`title` 100文字・`description` 500文字まで、`columnId` 必須） |
| GET | `/api/tasks/{id}` | タスク取得 |
| PUT | `/api/tasks/{id}` | タスク更新（チェックリスト・カテゴリ含む全体更新） |
| PATCH | `/api/tasks/{id}/move` | 列移動・並び順変更 `{columnId, displayOrder}` |
| PATCH | `/api/tasks/{id}/complete` | 完了/未完了の切り替え `{completed}` |
| DELETE | `/api/tasks/{id}` | タスク削除 |
| POST | `/api/boards/{boardId}/tasks/bulk-delete` | タスク一括削除 `{taskIds}`（存在しない・別ボードのIDが1件でも含まれると何も削除せず404） |

タスクのリクエスト/レスポンス例:

```json
{
  "title": "デザインカンプ確認",
  "description": "クライアントに提出する最終版を確認する",
  "columnId": "<column-id>",
  "dueDate": "2026-09-19",
  "priority": "MID",
  "categories": ["仕事", "デザイン"],
  "checklist": [
    { "text": "ラフ案を共有", "done": true },
    { "text": "最終確認", "done": false }
  ]
}
```
