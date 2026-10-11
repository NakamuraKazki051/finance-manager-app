---
name: task-manager-dev
description: task-manager-app（素のHTML/JS フロント + Spring Boot/PostgreSQL バックエンドのカンバン式タスク管理アプリ）で機能追加・不具合修正・機能削除・品質チェックを行い、Issue作成→ブランチ→テスト→PR→マージまで出荷するための手順と規約。このリポジトリでコードを変更するとき、「〜機能があると便利」「〜を直して」「〜をやめたい」「品質チェックして」「イシュー作って」「プルしておいて」「メインにマージ」などと言われたときは、明示的に頼まれていなくても必ずこのスキルを使うこと。
---

# task-manager-app 開発・出荷ガイド

このリポジトリで変更を加えて master に届けるまでの流れと、過去の作業で分かった落とし穴をまとめたもの。ユーザーは日本語で短く依頼してくることが多い（例:「一括削除があると便利かも、そのあとメインにプルもしておいて」）。依頼の意図を汲んで、フロント・バックエンド・テスト・ドキュメント・PRまで一通り仕上げる。

## 構成（どこに何があるか）

| 場所 | 役割 |
|---|---|
| `index.html` / `style.css` / `app.js` | フロントエンド。ビルド不要。`mvn package` 時にバックエンドの静的リソースとして同梱され `http://localhost:8080/` で配信される |
| `backend/src/main/java/com/taskmanager/api/` | `auth` / `user` / `board` / `column` / `task` / `common` のパッケージ構成。各パッケージに Controller・Dtos（record）・Repository・Entity |
| `backend/src/test/java/...` | MockMvc の統合テスト（H2インメモリDB、Docker不要）。`TestAuth.registerAndLogin` でログイン済みセッションを作る |
| `README.md` | 使い方（番号付き手順）と「## 機能」（カテゴリ別の機能一覧） |
| `backend/README.md` | APIエンドポイント表 |

## 実装の規約

既存コードに合わせることが一番大事。迷ったら同じパッケージの隣のコードを真似る。

**バックエンド**
- すべてのエンドポイントは最初に `currentUser.require(httpRequest)`、続けて `requireBoardOwnership(boardId, userId)` を呼ぶ。他ユーザーのデータは 403 ではなく **404** を返す（存在自体を隠すため）。
- 複数行を書き換える処理は `@Transactional`。タスクや列を消した・動かしたあとは `displayOrder` を詰め直す（`renumberColumn` など）。
- 列・タスクはボードへの外部キーを持たないので、親を消すときは子を明示的に `deleteByBoardId` する。忘れるとDBにゴミが残る。
- リクエストDTOには、フロントの `maxlength` と同じ `@Size` と、必須項目の `@NotBlank` / `@NotEmpty` を付ける。付けないと、長すぎる値や欠けた値でDBエラーになって 500 が返る。
- エラーは `ApiException.notFound/badRequest/conflict/unauthorized` を投げる。メッセージは日本語で、フロントのエラーバナーにそのまま表示される。
- 一括系のAPIは「1件でも不正なら何も変更しない」ようにする（例: `POST /api/boards/{boardId}/tasks/bulk-delete`）。
- 「無ければ作る」処理はフロントで判定しない。複数タブや二重送信で同時に走ると重複して作られる（実際に「マイボード」が3つできた）。サーバー側で `userRepository.findByIdForUpdate` でユーザー行をロックしてから判定・作成する（例: `POST /api/boards/ensure-default`）。同時実行のテストは `@Transactional` を付けないテストクラスで、複数スレッドから同時に呼んで確認する。

**フロントエンド（`app.js`）**
- API呼び出しは `apiGet/apiPost/apiPut/apiPatch/apiDelete` を使う。失敗時はバナー表示済みなので、呼び出し側は `catch (err) { return; }` で処理を止めるだけでよい。
- ユーザーが入力した文字列は `textContent` で入れる。`innerHTML` に入れるなら `escapeHtml` を通す。
- `render()` はサーバーから再取得して描画する。`renderColumns()` は手元の `visibleTasks` だけで描き直すので、表示の切り替えにはこちらを使う。
- `localStorage` に置くのは端末ごとの表示設定だけ（テーマ・通知・最後に開いたボードなど）。タスクのデータはすべてAPI経由で保存する。
- 日付は `localDateString()` を使う。`toISOString()` はUTCなので、日本時間の0〜9時に前日の日付になる。
- UI文言・コメント・エラーメッセージは日本語で書く。

**機能を削除するとき**は、HTML・JS（定数、状態変数、イベント登録）・CSS・README・他機能からの参照をすべて grep で洗い出して消す。最後に grep して参照が0件になったことを確認する。

## この環境の注意点

- **Python・Node は入っていない。** `python` は Windows ストアのスタブ、`node` は存在しない。ファイル編集は Edit/Write ツールで行う。多くのファイルは CRLF 改行なので、sed の一括置換は避ける。
- **Java は 25。** PC標準の `java`（`JAVA_HOME`）は 17 のままなので、ビルド・テスト・起動では必ず `~/tools/jdk-25.0.4.1+1` を使う（Bash なら `export JAVA_HOME="/c/Users/kazki/tools/jdk-25.0.4.1+1"`、jar の起動は `"$JAVA_HOME/bin/java"`）。17 のままだと `release version 25 not supported` で失敗する。
- **メモリが約6GBしかない。** Maven はシステムに入っておらず、`~/tools/apache-maven-3.9.16` にある。テストは次のコマンドで実行する（`-o` はオフライン実行）:
  ```bash
  cd backend && export JAVA_HOME="/c/Users/kazki/tools/jdk-25.0.4.1+1" && \
    MAVEN_OPTS="-Xmx384m" ~/tools/apache-maven-3.9.16/bin/mvn -q -o test \
    -DargLine="-Xmx256m -Xss512k -XX:MaxMetaspaceSize=128m"
  ```
  数分かかるので `run_in_background` で流し、その間に別の作業を進める。結果は `backend/target/surefire-reports/*.xml` の `tests=` と `failures=` / `errors=` で確認する。ログはスクラッチパッドに出し、リポジトリの外に置き忘れない。
- **サーバーの起動と動作確認。** `mvn -q -o package -DskipTests` で jar を作り、`"$JAVA_HOME/bin/java" -Xmx256m -Xss512k -XX:MaxMetaspaceSize=128m -jar target/task-manager-api-0.1.0.jar`（JDK 25）を `run_in_background` で起動する。Windows では起動中の jar はロックされるので、作り直す前に 8080 番を使っているプロセスのコマンドラインを確かめてから止める。セッションはメモリ上にあるため、**再起動するとユーザーはログアウトされる**。ブラウザでのログイン・アカウント登録はできないので、ユーザーにログインしてもらう。ログインが要らない確認は curl で行い、作ったテストユーザーは終わったら DB から消す。
- **Docker Desktop は自動起動しない。** ユーザーが手動で起動する運用で、本人も納得している。自動起動の設定は勧めない。Docker が止まっているとアプリを起動できずブラウザ確認ができないので、その場合は「未確認」とはっきり報告する。
- **確認が終わったら、毎回すべて止める（ユーザーの指示、確認は不要）。** 8080番のサーバー → `docker compose stop`（DBコンテナ）→ `docker desktop stop`（Docker Desktop本体）の順に止める。データは名前付きボリューム `task-manager-app_db-data` に残るので、`docker compose down -v` のようにボリュームを消すコマンドは使わない。ユーザーがまだログインして操作するかもしれない途中では止めない。

## テストの考え方

- バックエンドを変えたら、対応する `*ControllerTest` にテストを足す。正常系だけでなく、他ボード・他ユーザーのデータ（404）、不正な入力（400）、一括処理が途中で止まったときに何も変更されないこと、も確認する。
- **不具合修正のテストは、修正を一時的に戻して失敗することを確かめる。** 修正前でも通るテストは不具合を検出できていない。確認が終わったら必ず元に戻し、戻したことを grep で確認する。
- フロントは自動テストがない。変更箇所のコードを読み直し、ブラウザ確認できなかったことを PR と報告に書く。

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

- 認可: 所有者チェックの漏れ、CORS（Cookie付きの通信を許可する範囲）、ログイン時のセッションID再発行。
- データ整合性: 親を削除したときに子が残らないか、`displayOrder` の詰め直し、トランザクション。
- 入力検証: フロントの制限とバックエンドの `@Size` / `@NotBlank` が一致しているか。500 になる入力がないか。
- フロント: XSS（`innerHTML`）、日付のタイムゾーン、状態の取り残し（ボード切り替え時やログアウト時）。
- ドキュメント: README の機能一覧・手順、API表が実装と一致しているか。

## 不具合を見つけたとき

動作確認中・レビュー中・別作業のついでなど、どこで見つけても**その場で直してから報告する**（ユーザーの指示）。「直してよければ言ってください」と聞かない。テスト付きで直し、通常の出荷フローで master まで届け、何が原因で何を変えたかを伝える。ただし、ユーザー自身のデータ（ボード・タスクなど）を消す・書き換える作業は、今まで通り先に確認する。

## 報告の仕方

- 日本語で、何を変えたか、何を確認したか、**何を確認できていないか**を分けて書く。
- エラーやテストの失敗は隠さない。実際の出力（例:「Status expected:<403> but was:<200>」）を添えて、原因と直し方を伝える。
- PR と Issue の URL を載せる。
