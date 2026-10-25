# finance-manager-api（Rails）

収支管理アプリの REST API。Ruby on Rails（API モード）と MySQL 8 で動きます。画面は `../frontend`（Next.js）で、ローカルではビルドした画面のファイルを `public/` に置き、Rails が `http://localhost:8080/` で画面と API の両方を配信します（ログインの Cookie を同じオリジンで使うため）。

## 技術構成

- Ruby 4.0 / Rails 8.1（API モード）/ Puma
- MySQL 8.4（ローカルは Docker、本番は RDS for MySQL）、ドライバは mysql2
- パスワードは BCrypt、ログインは Cookie セッション（暗号化した Cookie に保存）
- テストは Minitest の結合テスト（`test/integration/`）。テスト用の DB（`financemanager_test`）はテストのたびに作り直される

## 準備（このPCでは済んでいる）

- Ruby 4.0（MSYS2 付き）: `winget install RubyInstallerTeam.RubyWithDevKit.4.0 --scope user`（このPCでは `~/tools/Ruby40-x64`）
- mysql2 のビルドに使う MariaDB のクライアント: `ridk exec pacman -S mingw-w64-ucrt-x86_64-libmariadbclient`
- `bundle install`

## 起動方法

```
docker compose up -d          # リポジトリ直下で実行。MySQL を起動（localhost:3306）
cd frontend
npm run build:rails           # 画面を書き出して backend/public/ にコピー
cd ../backend
ruby bin/rails db:prepare     # DB を作ってマイグレーションを流す（初回・変更時）
ruby bin/rails server -p 8080 # http://localhost:8080/ で画面と API を配信
```

- DB 接続先は環境変数 `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME`（本番のみ）で変えられる。ローカルの既定値は `127.0.0.1:3306`、`root` / `financemanager`（`config/database.yml`）
- 画面だけを書き換えながら確認したいときは、Rails を起動したまま `frontend` で `npm run dev`（http://localhost:3000/ 。`/api/` は Rails へ中継される）

## テスト

```
ruby bin/rails test
```

MySQL コンテナが起動している必要があります。メモリの少ないPCなので並列実行はしていません（`test/test_helper.rb`）。

## データの持ち方

| テーブル | 内容 |
|---|---|
| `users` | メールアドレス（小文字にそろえて一意）、パスワードのハッシュ |
| `books` | 家計簿。ユーザーごとに複数持てる |
| `categories` | カテゴリ。`kind` が `INCOME`（収入）か `EXPENSE`（支出）。`budget` は月間予算（円、未設定は NULL）。画面ではカンバンの1列。Rails では `type` 列が特別扱いなので列名は `kind` で、API では `type` として返す |
| `entries` | 取引。API では transactions と呼ぶ（モデル名を `Transaction` にすると ActiveRecord の `transaction` と紛らわしいため `Entry`）。金額 `amount` は円の整数（1〜99,999,999）で符号は持たず、収入か支出かはカテゴリで決まる。`transaction_date`、`memo`、`tags`（JSON）、`confirmed`（false は予定の取引。既定 true）、`recurring_entry_id`（固定費から作った取引ならその固定費） |
| `recurring_entries` | 固定費（F-12）。毎月 `day_of_month` 日（1〜31、無い月は月末）に、同じカテゴリ・金額・メモ・タグの予定の取引を作る。`start_month` から作り始め、作り終えた最後の月を `last_generated_month` に記録する（作った取引を消しても作り直さない） |

- ID は推測されにくい UUID の文字列
- 月の一覧・集計は `(book_id, transaction_date)` のインデックスで引き、合計は DB の `SUM` で出す（画面の合計と API の集計が1円もずれない）
- 子の行は親への外部キーを持たないので、家計簿・カテゴリを消すときはコントローラーで取引・カテゴリ・固定費を明示的に消す
- 固定費の取引は定期実行ではなく、画面が家計簿を開いたとき・表示する月を変えたとき・インポートしたときの `generate` で今月の分まで作る（EC2 を使うときだけ起動するため）。「今月」は日本時間で決める

## エンドポイント

ログインが必要なものは、未ログインなら 401 を返す。パスワードを変更すると、変更した端末以外のセッションは 401 になる（もう一度ログインが必要）。登録済みかどうかをログインの応答時間から推測されないよう、未登録のメールアドレスでもパスワード照合を行う。他ユーザーの家計簿・カテゴリ・取引へのアクセスは存在しない扱い（404）になる。画面と API は同じオリジンで配信するので CORS は許可していない。

入力の上限: メールアドレス255文字、パスワード8〜72文字かつ72バイト以内（全角文字は1文字3バイト）、家計簿名・カテゴリ名30文字、取引の金額1〜99,999,999円（整数。`1.5` や `"100"` は不可）・メモ100文字・タグ1つ30文字。月は `YYYY-MM` 形式。超えた場合や必須項目が無い場合、JSON が壊れている場合は 400 を返す（インポートではカテゴリ・取引を1件ずつ検証し、1件でも不正なら何も変更しない）。エラーは `{timestamp, status, message}` の形で、`message` は日本語。

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/users/register` | ユーザー登録 `{email, password}` |
| PUT | `/api/users/me` | メールアドレス・パスワード変更 `{email?, newPassword?, currentPassword}` |
| POST | `/api/auth/login` | ログイン `{email, password}`（ログイン前のセッションは使い回さない。同じメールアドレスで5分間に10回を超えると 429） |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | ログイン中のユーザー |
| GET | `/api/books` | 家計簿一覧（作った順） |
| POST | `/api/books` | 家計簿作成 `{name}`（初期カテゴリも一緒に作る） |
| POST | `/api/books/ensure-default` | 家計簿が1冊も無ければ「家計簿」と初期カテゴリ（給与/食費/日用品/交通費/住居・光熱費/その他）を作成し、一覧を返す。ユーザー行をロックするので、同時に呼ばれても1冊しか作らない |
| PUT | `/api/books/:id` | 家計簿名変更 `{name}` |
| DELETE | `/api/books/:id` | 家計簿削除（そのカテゴリ・取引・固定費も削除。最後の1冊は不可） |
| PUT | `/api/books/:book_id/import` | 家計簿のカテゴリ・取引・固定費をJSONで全置換 `{categories: [{id, name, type, budget?}], transactions, recurring?}`。取引の `confirmed` を省いた古いバックアップは確定として取り込む。固定費の `lastGeneratedMonth` を省くと、今月までは作り済みとして取り込む。開始月より前の `lastGeneratedMonth` は 400。さかのぼって作るのは12か月前の月までにする |
| GET | `/api/books/:book_id/export.csv?month=YYYY-MM` | 取引のCSV（BOM付きUTF-8・CRLF、日付の古い順）。列は日付・種別・カテゴリ・金額・メモ・タグ・状態（確定/予定）。`month` を省くと全期間。`=` `+` `-` `@` で始まる値は先頭に `'` を付けて数式として実行されないようにする |
| GET | `/api/books/:book_id/categories` | カテゴリ一覧（表示順） |
| POST | `/api/books/:book_id/categories` | カテゴリ作成 `{name, type, budget?}` |
| PUT | `/api/categories/:id` | カテゴリ更新 `{name?, type?, budget?}`（`budget` は1〜99,999,999円の整数、`null` で予算を外す。`type` を変えると、そのカテゴリの取引はすべての月で新しい種別として集計される） |
| PATCH | `/api/categories/:id/move` | カテゴリの並び替え `{displayOrder}` |
| DELETE | `/api/categories/:id` | カテゴリ削除（そのカテゴリの取引もすべての月の分を削除し、固定費も削除。最後の1つは不可） |
| GET | `/api/books/:book_id/recurring-transactions` | 固定費一覧（毎月の日付の早い順） |
| POST | `/api/books/:book_id/recurring-transactions` | 固定費登録 `{categoryId, amount, day, memo?, tags?, startMonth?}`。`startMonth`（YYYY-MM、今月の前後12か月以内）を省くと今月から。開始月から今月までの予定の取引をすぐに作る |
| POST | `/api/books/:book_id/recurring-transactions/generate` | 今月までで、まだ作っていない月の予定の取引を作る `{created}`。固定費の行をロックするので、同時に呼ばれても二重に作らない |
| PUT | `/api/recurring-transactions/:id` | 固定費更新 `{categoryId, amount, day, memo?, tags?}`（これから作る取引にだけ反映） |
| DELETE | `/api/recurring-transactions/:id` | 固定費削除（作り済みの取引は残し、`recurringId` を外す） |
| GET | `/api/books/:book_id/transactions?month=&tag=&q=&minAmount=&maxAmount=&status=confirmed\|planned&sort=date\|amount` | 取引一覧。`month`（YYYY-MM）を省くと全期間。`status` で確定・予定の取引だけに絞る。`q` はメモの部分一致。`sort=date`（既定）は日付の新しい順、`amount` は金額の大きい順 |
| GET | `/api/books/:book_id/summary?month=YYYY-MM` | 月の収入合計・支出合計・残高（収入−支出）・件数と、カテゴリごとの合計（取引の無いカテゴリも0円で含む）。合計・残高は確定の取引だけで出し、予定の取引は `plannedIncome` / `plannedExpense` とカテゴリごとの `plannedTotal` に別に出す。件数は予定も含む |
| GET | `/api/books/:book_id/summary/monthly?from=YYYY-MM&to=YYYY-MM` | 月ごとの収入合計・支出合計・残高（取引の無い月も0円で含め、古い月から）。期間は24か月まで。確定の取引だけを数える。種別は取引の時点ではなく、カテゴリの今の種別で集計する |
| POST | `/api/books/:book_id/transactions` | 取引登録 `{amount, date, categoryId, memo?, tags?, confirmed?}`（`confirmed` を省くと確定） |
| GET | `/api/transactions/:id` | 取引取得 |
| PUT | `/api/transactions/:id` | 取引更新（全項目。`confirmed` を省くと今の予定/確定のまま） |
| PATCH | `/api/transactions/:id/move` | カテゴリの付け替え `{categoryId}` |
| PATCH | `/api/transactions/:id/confirm` | 予定と確定の切り替え `{confirmed}`（true / false） |
| DELETE | `/api/transactions/:id` | 取引削除 |
| POST | `/api/books/:book_id/transactions/bulk-delete` | 取引一括削除 `{transactionIds}`（存在しない・別の家計簿のIDが1件でも含まれると何も削除せず404） |
| GET | `/up` | 起動確認（200） |

取引のリクエスト例:

```json
{ "amount": 1280, "date": "2026-10-16", "categoryId": "<category-id>", "memo": "ランチ", "tags": ["外食"] }
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

## 本番（EC2）

`Dockerfile` でイメージを作り、`infra/terraform/deploy.ps1` が S3 経由で EC2 に送ります。EC2 は今のところ HTTP（80番）だけなので、`config/environments/production.rb` で SSL の強制を外しています。HTTPS を導入したら `force_ssl` を戻してください。
