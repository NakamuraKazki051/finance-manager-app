---
name: finance-manager-dev
description: finance-manager-app（Next.js フロント + Ruby on Rails API + MySQL のカンバン式収支管理アプリ。task-manager-app から派生）で機能追加・不具合修正・機能削除・品質チェックを行い、Issue作成→ブランチ→テスト→PR→マージまで出荷するための手順と規約。このリポジトリでコードを変更するとき、「〜機能があると便利」「〜を直して」「〜をやめたい」「品質チェックして」「イシュー作って」「プルしておいて」「メインにマージ」などと言われたときは、明示的に頼まれていなくても必ずこのスキルを使うこと。
---

# finance-manager-app 開発・出荷ガイド

要件定義は `docs/finance-app-requirements.md`。機能の ID（F-01〜F-13）とフェーズ分けはそちらに従う。

このリポジトリで変更を加えて master に届けるまでの流れと、過去の作業で分かった落とし穴をまとめたもの。ユーザーは日本語で短く依頼してくることが多い（例:「一括削除があると便利かも、そのあとメインにプルもしておいて」）。依頼の意図を汲んで、フロント・バックエンド・テスト・ドキュメント・PRまで一通り仕上げる。

## 構成（どこに何があるか）

| 場所 | 役割 |
|---|---|
| `frontend/` | Next.js 16（App Router）+ React 19 + TypeScript。`output: 'export'` で静的ファイルに書き出す（サーバーの機能は使わない）。`components/FinanceApp.tsx` が画面全体、`lib/api.ts` が API クライアント。**Next.js 16 は学習データと違う点が多いので、書く前に `frontend/node_modules/next/dist/docs/` の該当ページを読む**（`frontend/AGENTS.md`） |
| `backend/` | Rails 8.1 API モード（Ruby 4.0）。`app/controllers/`（`application_controller.rb` にログイン確認・入力チェック・エラー処理）、`app/models/`（User / Book / Category / Entry）、`config/routes.rb`（すべて `/api/` 以下） |
| `backend/test/integration/` | Minitest の結合テスト。`test/test_helper.rb` の `ApiTestHelper`（`register_and_login`、`create_book`、`create_transaction`、別ユーザーは `other_user_session`）を使う |
| `docker-compose.yml` | ローカル用 MySQL 8.4（`finance-manager-mysql`、3306番、root / financemanager） |
| `docs/finance-app-requirements.md` | 要件定義書 |
| `README.md` | 使い方（番号付き手順）と「## 機能」（カテゴリ別の機能一覧） |
| `backend/README.md` / `frontend/README.md` | APIエンドポイント表・データの持ち方 / 画面の構成 |
| `infra/terraform/` | AWS（EC2 + RDS for MySQL + nginx）の Terraform。`up.ps1` / `down.ps1` で使うときだけ作る。`deploy.ps1` は Next.js を書き出し、Rails の Docker イメージ（`backend/Dockerfile`）を作って S3 経由で送る |
| `perf/e2e-perf.js` | E2E パフォーマンステスト（k6）。`infra/terraform/perf.ps1` から流し、終わるとテスト用ユーザー（`e2e-perf-*@example.com`）を DB から消す |

## 実装の規約

既存コードに合わせることが一番大事。迷ったら隣のコードを真似る。

**バックエンド（Rails）**
- 各アクションは最初に `current_user_id!`、続けて `require_book!(book_id, user_id)`（またはカテゴリ・取引から家計簿をたどって確認）を呼ぶ。他ユーザーのデータは 403 ではなく **404** を返す（存在自体を隠すため）。
- **金額は円の整数（`bigint`）で持ち、小数は使わない。** `1.5` や `"100"` は勝手に丸めずに 400 にする（`amount_value`）。符号も持たず、収入か支出かはカテゴリの `kind`（`INCOME` / `EXPENSE`。Rails では `type` 列が単一テーブル継承に使われるので列名は `kind`、API では `type`）で決める。合計は DB の `SUM` で出す。
- 取引のモデルは `Entry`（API では transactions）。日付の列は `transaction_date`。月の絞り込みは `Entry.in_month`。月の境界（月初・月末・うるう年の2月29日）のテストを必ず付ける。
- 入力チェックは `application_controller.rb` のヘルパー（`required_string` / `optional_string` / `amount_value` / `date_value` / `tags_value` / `month_value` / `integer_query`）を使い、上限はフロントの `maxLength` と合わせる。チェックしないと長すぎる値でDBエラーになり 500 が返る。
- エラーは `ApiError.not_found/bad_request/conflict/unauthorized` を raise する。メッセージは日本語で、フロントのエラーバナーにそのまま表示される。
- 複数行を書き換える処理は `Model.transaction do ... end`。カテゴリを消した・動かしたあとは `display_order` を詰め直す。取引には手動の並び順は無い（日付か金額で並べる）。
- カテゴリ・取引は家計簿への外部キーを持たないので、親を消すときは子を明示的に `delete_all` する。忘れるとDBにゴミが残る。
- 一括系・インポートは「1件でも不正なら何も変更しない」。インポートは消す前に全件を検証する。
- 「無ければ作る」処理はフロントで判定しない。サーバー側で `User.lock.find_by` でユーザー行をロックしてから判定・作成する（例: `POST /api/books/ensure-default`）。同時実行のテストは `self.use_transactional_tests = false` のテストクラスで、複数スレッドから同時に呼んで確認する（`book_ensure_default_concurrency_test.rb`）。
- ログインは暗号化した Cookie のセッション。`sign_in` は `reset_session` してから記録する（セッション固定攻撃対策）。パスワードを変えると `credential_fingerprint` が変わり、他の端末のセッションが切れる。
- テストでメソッドを差し替えたら、`ensure` で元のメソッドに戻す（`remove_method` だと元のメソッドまで消えて、後のテストが壊れた）。

**フロントエンド（Next.js）**
- 画面は `"use client"` のコンポーネントだけで作る。静的書き出しなので、Server Actions・Route Handlers・`cookies()`・rewrites（`next dev` 以外）は使えない。
- API 呼び出しは `lib/api.ts` の `api.get/post/put/patch/delete` を使う。失敗時はバナー表示済みなので、呼び出し側は `catch { return; }` で処理を止めるだけでよい。ログイン系のフォームは `formRequest` でフォームの中にエラーを出す。
- ユーザーが入力した文字列は JSX の `{}` で出す（`dangerouslySetInnerHTML` は使わない）。
- 表示中の月の取引と集計は、`FinanceApp` の useEffect がまとめて取り直す。操作のあとは `reload()` を呼ぶ。金額の合計はフロントで足さず、`/summary` の値を表示する。月を素早く切り替えたときに古い応答で上書きしないよう、effect の後片付けで `stale` を立てている。
- 金額の表示は `formatYen` / `formatSignedYen`、日付は `localDateString()`（`toISOString()` はUTCなので日本時間の0〜9時に前日になる）。
- `localStorage` に置くのは端末ごとの表示設定だけ（テーマ・最後に開いた家計簿）。読み書きは `readStorage` / `writeStorage`（使えない環境でも落ちない）。
- UI文言・コメント・エラーメッセージは日本語で書く。

**機能を削除するとき**は、コンポーネント・型・CSS・API・テスト・README・他機能からの参照をすべて grep で洗い出して消す。最後に grep して参照が0件になったことを確認する。

## この環境の注意点

- **Ruby 4.0 は `~/tools/Ruby40-x64`（MSYS2 付き、ユーザー単位のインストール）。** PowerShell では `$env:Path = "C:\Users\kazki\tools\Ruby40-x64\bin;" + $env:Path` を先に付ける。`bin/rails` は `ruby bin/rails ...` で呼ぶ。mysql2 のビルドには MSYS2 の `mingw-w64-ucrt-x86_64-libmariadbclient` を使っている（MSYS2 の bash は `~/tools/Ruby40-x64/msys64/usr/bin/bash.exe -lc`）。
- **Node.js 24 は `~/tools/node-v24.22.0-win-x64`。** PATH に足してから `npm` を使う。Python は入っていない。
- **メモリが約6GBしかない。** Rails のテストは並列にしない（`parallelize(workers: 1)`）。重い処理（`next build`、`docker build`、テスト）は1つずつ流す。空きメモリが少ないと Claude Code がバックグラウンドのサーバーを止めることがある。そのときは勝手に再起動せず、止まったことを伝える。
- **テスト**: MySQL コンテナを起動してから、`backend` で `ruby bin/rails test`（30秒ほど）。
- **動作確認**: `frontend` で `npm run build:rails`（書き出して `backend/public/` にコピー）→ `backend` で `ruby bin/rails server -p 8080 -b 127.0.0.1` を `run_in_background` で起動し、`http://localhost:8080/` を Chrome で開く。ブラウザでのログイン・アカウント登録はできないので、ユーザーにログインしてもらう。ログインが要らない確認は curl で行う（日本語を含む JSON はファイルに書いて `--data-binary @file` で送る。コマンドライン引数に直接書くと UTF-8 で送られず 400 になる）。作ったテストユーザーは終わったら DB から消す。
- **Docker Desktop は自動起動しない。** ユーザーが手動で起動する運用で、本人も納得している。自動起動の設定は勧めない。MySQL コンテナも `restart: "no"` なので、使うときに `docker compose up -d` する。
- **確認が終わったら、毎回すべて止める（ユーザーの指示、確認は不要）。** 8080番のサーバー → `docker compose stop`（MySQL）→ `docker desktop stop` の順に止める。データは名前付きボリューム `finance-manager-app_mysql-data` に残るので、`docker compose down -v` のようにボリュームを消すコマンドは使わない。ユーザーがまだログインして操作するかもしれない途中では止めない。

## テストの考え方

- バックエンドを変えたら、`backend/test/integration/` の対応するテストを足す。正常系だけでなく、他の家計簿・他ユーザーのデータ（404）、不正な入力（400）、一括処理が途中で止まったときに何も変更されないこと、も確認する。
- **不具合修正のテストは、修正を一時的に戻して失敗することを確かめる。** 修正前でも通るテストは不具合を検出できていない。確認が終わったら必ず元に戻し、戻したことを grep で確認する。
- フロントは自動テストがない。`npm run typecheck` と `npm run lint` を通し、変更箇所のコードを読み直し、ブラウザ確認できなかったことを PR と報告に書く。

## 出荷フロー

ユーザーからは、安全な変更なら確認なしにブランチ→PR→マージまで進めてよいと言われている。**master へ直接コミット・プッシュはしない。** データを消す、履歴を書き換える、などの危険な操作だけは事前に確認する。

1. `git checkout -b feature/<名前>`（機能追加）または `fix/<名前>`（修正・削除）を master から切る。
2. 実装、テスト、ドキュメント更新。
   - `README.md`: 使い方の手順と「## 機能」のカテゴリ別一覧を、実装と一致させる。
   - `backend/README.md`: エンドポイント表（APIを変えたとき）。
3. Issue を作る（Issue も頼まれたとき、または品質チェックのように記録を残す価値がある作業のとき）。
   - `gh issue create --label enhancement|bug` を使い、タイトルと本文は日本語。本文は「概要 / 対応内容 / 残タスク（チェックリスト）」の構成にする。
4. コミットする。メッセージは英語で、1行目は命令形、本文に「なぜ変えたか」を書く。末尾には、その時点のシステム指示で指定された Co-Authored-By 行を付ける。
5. `git push -u origin <branch>` のあと、`gh pr create --base master` で PR を作る。本文は日本語で「## Summary」と「## Test plan」（実施済みは `[x]`、未実施は `[ ]` と理由）を書き、Issue があれば `Closes #N`、末尾にシステム指示で指定された署名行を付ける。
6. `gh pr merge <N> --merge --delete-branch` でマージし、`git checkout master && git pull` で手元を最新にする。
7. 関係する Issue のチェックリストや説明が古くなっていたら更新する。

## 品質チェックを頼まれたとき

コードを全部読み、次の観点で見る。見つけたものは深刻な順に並べ、直すものはテスト付きで直す。

- 認可: 所有者チェックの漏れ、ログイン時のセッション再発行、パスワード変更で他のセッションが切れるか。
- データ整合性: 親を削除したときに子が残らないか、`display_order` の詰め直し、トランザクション、金額の合計が画面とAPIで一致するか。
- 入力検証: フロントの制限とバックエンドの上限が一致しているか。500 になる入力がないか（`log/test.log` の `Unexpected error`）。
- フロント: `dangerouslySetInnerHTML` の有無、日付のタイムゾーン、状態の取り残し（家計簿・月の切り替え時やログアウト時）。
- ドキュメント: README の機能一覧・手順、API表が実装と一致しているか。

### Terraform（`infra/terraform/`）の品質チェック

コマンドは `infra/terraform/README.md` の「品質チェック」にまとめてある。AWSに何かを作る・消す操作（`apply` / `up.ps1` / `down.ps1`）は料金がかかるので、ユーザーが頼んだときだけ行う。`plan` や読み取りだけの `aws ... describe` は確認なしで行ってよい。

- 書式・構文: `terraform fmt -check -recursive` と `terraform validate` が通るか。`.terraform.lock.hcl` がコミットされているか。
- ずれ（ドリフト）: 環境があるときに `terraform plan` が `No changes` になるか。コンソールで手で変えたものがないか。
- 公開範囲: EC2のセキュリティグループで開いているのは 80 番だけか（8080 は `expose_backend_port` のときだけ、22 は開けない）。RDS は `publicly_accessible = false` で、3306 番はアプリのEC2のセキュリティグループからだけか。
- 秘密情報: DBのパスワードと `SECRET_KEY_BASE` が Git・`terraform.tfstate`・`user_data`・起動ログ（`/var/log/cloud-init-output.log`）のどこにも出ていないか。`*.tfstate` と `*.tfvars` が `.gitignore` されているか。
- 権限: EC2のIAMロールは Session Manager、DBのパスワードのパラメータ1つ、デプロイ用S3バケットの読み取りだけか（`*` のリソース指定がないか）。S3バケットは公開をブロックしているか。
- 暗号化・設定: EBS・RDS・スナップショットが暗号化されているか。RDS との通信が暗号化されているか（`database.yml` の `ssl_mode: required`）。IMDSv2 必須か。CPUクレジットが `standard` か。
- 費用: 無料枠のサイズ（`t3.micro` / `db.t4g.micro`、ストレージ合計30GB以内）か。NATゲートウェイ・ロードバランサー・Secrets Manager・Performance Insights など有料の部品を使っていないか。`down.ps1` のあとに、EC2・RDS・Elastic IP が残っていないか。スナップショットが増えすぎていないか（2つまで）。
- データ: `down.ps1` がスナップショットを取ってから消し、`up.ps1` がそこから復元するか。直接 `terraform destroy` を案内していないか。
- テンプレート: `user_data.sh.tftpl` で、波かっこ付きの変数（compose 用）が `$${...}` とエスケープされているか。`terraform console` で `templatefile(...)` を展開して確かめる。`*.sh` / `*.tftpl` が LF 改行か（`.gitattributes`）。

## 不具合を見つけたとき

動作確認中・レビュー中・別作業のついでなど、どこで見つけても**その場で直してから報告する**（ユーザーの指示）。「直してよければ言ってください」と聞かない。テスト付きで直し、通常の出荷フローで master まで届け、何が原因で何を変えたかを伝える。ただし、ユーザー自身のデータ（家計簿・取引など）を消す・書き換える作業は、今まで通り先に確認する。

## 報告の仕方

- 日本語で、何を変えたか、何を確認したか、**何を確認できていないか**を分けて書く。
- エラーやテストの失敗は隠さない。実際の出力（例:「Expected: 200 Actual: 500」）を添えて、原因と直し方を伝える。
- PR と Issue の URL を載せる。
