# finance-manager-api

収支管理アプリ用のSpring Boot REST API（Book / Category / Transaction）。`mvn package` 時にリポジトリ直下の `index.html`/`app.js`/`style.css` を静的リソースとして同梱し、`http://localhost:8080/` でフロントエンドも一緒に配信する（Cookieベースのセッション認証を `file://` から使うとSameSite制限で壊れるため、同一オリジンで配信している）。

## 技術構成

- Java 25 / Spring Boot 4.1.1（ビルド・実行には JDK 25 が必要）
- Spring Web, Spring Data JPA, PostgreSQL（本番/開発用途、Dockerコンテナで起動）
- テスト実行時はH2インメモリDBを使用（`src/test/resources/application.yml`）し、Dockerなしでも `mvn test` が通る

## 起動方法

事前にリポジトリ直下の `docker-compose.yml` でDBコンテナを起動しておく必要があります。

```
docker compose up -d   # リポジトリ直下で実行、financemanagerデータベースを起動（localhost:5433。タスク管理アプリのDBと同時に動かせるよう5432番を避けている）
cd backend
mvn package
java -Xmx256m -Xss512k -XX:MaxMetaspaceSize=128m -jar target/finance-manager-api-0.1.0.jar
```

- API: http://localhost:8080/api/...
- DB接続先: `jdbc:postgresql://localhost:5433/financemanager`（ユーザー/パスワード: `financemanager`、`../docker-compose.yml` 参照）

このマシンはメモリが少ないため、`mvn spring-boot:run` を常駐させず、`mvn package` でビルドしたjarをヒープ制限付きで起動することを推奨します。

## データの持ち方

- **家計簿（books）**: ユーザーごとに複数持てる。カテゴリと取引をまとめる単位
- **カテゴリ（categories）**: `type` が `INCOME`（収入）か `EXPENSE`（支出）。画面ではカンバンの1列
- **取引（transactions）**: 金額 `amount`（円の整数、1〜99,999,999）、日付 `date`、メモ、タグ。金額は符号を持たず、収入か支出かはカテゴリの `type` で決まる。小数の誤差を避けるため金額は整数で持ち、月の集計はDBの `SUM` で行う

## エンドポイント

認証はCookieセッション方式。`/api/users/register` と `/api/auth/login` 以外はログインが必要で、未ログインなら401を返す。パスワードを変更すると、変更した端末以外のセッションは401になる（もう一度ログインが必要）。登録済みかどうかをログインの応答時間から推測されないよう、未登録のメールアドレスでもパスワード照合を行う。他ユーザーの家計簿・カテゴリ・取引へのアクセスは存在しない扱い（404）になる。CORSは `http://localhost:*` / `http://127.0.0.1:*` からのみ許可している。フロントエンドを別のポートで配信する環境（EC2など）では、環境変数 `APP_CORS_ALLOWED_ORIGINS`（カンマ区切り、完全一致のみ。例: `http://203.0.113.10`）で許可するオリジンを追加できる。`*` を含む値は無視する。

入力の上限: メールアドレス255文字、パスワード8〜72文字かつ72バイト以内（全角文字は1文字3バイト）、家計簿名・カテゴリ名30文字、取引の金額1〜99,999,999円（整数）・メモ100文字・タグ1つ30文字。月は `YYYY-MM` 形式。超えた場合や必須項目が無い場合は400を返す（インポートではカテゴリ・取引を1件ずつ検証し、1件でも不正なら何も変更しない）。

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/users/register` | ユーザー登録 `{email, password}`（パスワードは8〜72文字・72バイト以内） |
| PUT | `/api/users/me` | メールアドレス・パスワード変更 `{email?, newPassword?, currentPassword}` |
| POST | `/api/auth/login` | ログイン `{email, password}`（セッションIDを再発行） |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | ログイン中のユーザー |
| GET | `/api/books` | 家計簿一覧 |
| POST | `/api/books` | 家計簿作成 `{name}`（初期カテゴリも一緒に作る） |
| POST | `/api/books/ensure-default` | 家計簿が1冊も無ければ「家計簿」と初期カテゴリ（給与/食費/日用品/交通費/住居・光熱費/その他）を作成し、一覧を返す。同時に呼ばれても1冊しか作らない（初回ログイン時にフロントが使用） |
| PUT | `/api/books/{id}` | 家計簿名変更 `{name}` |
| DELETE | `/api/books/{id}` | 家計簿削除（そのカテゴリ・取引も削除。最後の1冊は不可） |
| PUT | `/api/books/{bookId}/import` | 家計簿のカテゴリ・取引をJSONで全置換 `{categories, transactions}` |
| GET | `/api/books/{bookId}/categories` | カテゴリ一覧（表示順） |
| POST | `/api/books/{bookId}/categories` | カテゴリ作成 `{name, type}` |
| PUT | `/api/categories/{id}` | カテゴリ更新 `{name?, type?}`（`type` を変えると、そのカテゴリの取引はすべての月で新しい種別として集計される） |
| PATCH | `/api/categories/{id}/move` | カテゴリの並び替え `{displayOrder}` |
| DELETE | `/api/categories/{id}` | カテゴリ削除（そのカテゴリの取引もすべての月の分を削除。最後の1つは不可） |
| GET | `/api/books/{bookId}/transactions?month=&tag=&q=&minAmount=&maxAmount=&sort=date\|amount` | 取引一覧。`month`（YYYY-MM）を省くと全期間。`q` はメモの部分一致。`sort=date`（既定）は日付の新しい順、`amount` は金額の大きい順 |
| GET | `/api/books/{bookId}/summary?month=YYYY-MM` | 月の収入合計・支出合計・残高（収入−支出）・件数と、カテゴリごとの合計（取引の無いカテゴリも0円で含む） |
| POST | `/api/books/{bookId}/transactions` | 取引登録 `{amount, date, categoryId, memo?, tags?}` |
| GET | `/api/transactions/{id}` | 取引取得 |
| PUT | `/api/transactions/{id}` | 取引更新（全項目） |
| PATCH | `/api/transactions/{id}/move` | カテゴリの付け替え `{categoryId}` |
| DELETE | `/api/transactions/{id}` | 取引削除 |
| POST | `/api/books/{bookId}/transactions/bulk-delete` | 取引一括削除 `{transactionIds}`（存在しない・別の家計簿のIDが1件でも含まれると何も削除せず404） |

取引のリクエスト例:

```json
{
  "amount": 1280,
  "date": "2026-10-16",
  "categoryId": "<category-id>",
  "memo": "ランチ",
  "tags": ["外食"]
}
```

月の集計のレスポンス例:

```json
{
  "month": "2026-10",
  "income": 250000,
  "expense": 5000,
  "balance": 245000,
  "count": 4,
  "categories": [
    { "categoryId": "<給与>", "total": 250000, "count": 1 },
    { "categoryId": "<食費>", "total": 2000, "count": 2 }
  ]
}
```
