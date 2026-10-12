# EC2環境（Terraform）

AWSの無料枠の範囲で、タスク管理アプリを動かすEC2を1台と、RDS（PostgreSQL）を1台作ります。

## 作られるもの

| リソース | 内容 |
|---|---|
| EC2 | `t3.micro`（無料枠の対象）、Amazon Linux 2023、ディスク20GB（gp3・暗号化） |
| RDS | PostgreSQL 16、`db.t4g.micro`（無料枠の対象）、シングルAZ、ストレージ20GB（暗号化）、自動バックアップ1日分 |
| Elastic IP | 固定のIPアドレス。サーバーを止めて起動し直してもURLが変わらない |
| セキュリティグループ（EC2） | 80番（nginx）だけ開ける。8080番は `expose_backend_port = true` のときだけ。SSH（22番）は開けない |
| セキュリティグループ（RDS） | 5432番を **アプリのEC2からだけ** 許可する。RDSはインターネットから接続できない（`publicly_accessible = false`） |
| Parameter Store | DBのパスワード（SecureString。標準パラメータなので無料） |
| S3バケット | デプロイするファイル（`app.jar` とフロントエンド）の受け渡し場所。非公開・暗号化。環境と一緒に消える |
| IAMロール | Session Manager の権限、DBのパスワードのパラメータ1つを読む権限、S3バケットのファイルを読む権限だけ |

## 構成

```
ブラウザ ──80──▶ nginx ──/api/──▶ Spring Boot（8080, Java 25）──5432──▶ RDS（PostgreSQL）
                  └─ それ以外 ─▶ フロントエンドのファイル
```

| ポート | 役割 | 中身 |
|---|---|---|
| 80 | nginx | `/opt/task-manager/frontend/`（`index.html` / `style.css` / `app.js`）を配信し、`/api/` をバックエンドへ中継する |
| 8080 | バックエンドAPI | Spring Boot（`/opt/task-manager/app.jar`、`eclipse-temurin:25-jre`） |

フロントエンドとAPIが同じオリジン（`http://<IP>`）になるので、CORSの設定は要りません。

DBのパスワードは、`terraform apply` の間だけ作られ、RDSと Parameter Store に直接渡されます（ephemeral + write-only）。Terraform の state にもGitにも残りません。作り直したいときは `db_password_version` を1つ増やして apply し、EC2の `/opt/task-manager/.env` も新しい値に書き換えます。

サーバーの初回起動時に `user_data.sh.tftpl` が次の準備をします。

- 2GBのスワップを作る（メモリ1GBで Spring Boot を動かすため）
- Docker と Docker Compose を入れる
- Parameter Store からDBのパスワードを読み、`/opt/task-manager/.env`（rootだけが読める）に保存する
- `/opt/task-manager/` に `docker-compose.yml` と nginx の設定を置き、nginx（`web`）を起動する
  - nginx は、デプロイするまで「準備中」のページを表示し、`/api/` には 502 を返す

アプリ本体（フロントエンドのファイルと `app.jar`）は、このあと `deploy.ps1` が置き、バックエンドを起動します。

## 無料枠に収めるための工夫と、注意点

- NATゲートウェイ・ロードバランサー・Secrets Manager など、有料になりやすい部品は使いません
- RDSは無料枠の対象のサイズ（`db.t4g.micro`、シングルAZ、20GB）にし、Performance Insights と拡張モニタリングは使いません
- **使うときだけ作り、使い終わったら消す運用です**（下の「使い方」）。消している間は、EC2・RDS・Elastic IP の料金はかかりません。かかるのは、DBのスナップショットの保存料金だけです（数MB程度なので、ほぼ0円）
- `terraform destroy` を直接実行すると、スナップショットを取らずにRDSのデータが消えます。消すときは必ず `down.ps1` を使ってください
- CPUクレジットを `standard` にしています。CPUを使い切っても遅くなるだけで、追加料金はかかりません
- **パブリックIPv4アドレス（Elastic IP）は無料枠の対象外です**（1時間あたり約0.005ドル、月に約3.6ドル）。無料プランのクレジットから引かれます
  - EC2を停止している間も、Elastic IP の料金はかかります。止めるのではなく `down.ps1` で消してください
- 通信はHTTP（暗号化なし）です。HTTPSにするには独自ドメインが必要なので、必要になったら追加します

## 使い方

前提：`aws login` でログインしていること。PowerShell 7（`pwsh`）で実行します。Terraform は `~/tools/terraform/terraform.exe` にあります。

```powershell
cd infra/terraform
./up.ps1       # 使うとき：環境を作り、アプリもデプロイする（15〜20分）。終わるとURLが表示される
./deploy.ps1   # コードを変えたとき：ビルドして、今ある環境にデプロイし直す（3〜5分）
./down.ps1     # 使い終わったら：DBをスナップショットに保存してから、環境を全部消す（10分ほど）
```

| スクリプト | やること |
|---|---|
| `up.ps1` | 最新のDBスナップショットがあれば、そこから RDS を復元して環境を作る（なければ空のDB）。80番が応答するまで待ち、`deploy.ps1` を実行してURLを表示する。`-SkipDeploy` を付けると作るだけ |
| `deploy.ps1` | JDK 25 と Maven（このPCの `~/tools`）で `app.jar` をビルドし、`app.jar` とフロントエンド（`index.html` / `style.css` / `app.js`）を非公開のS3バケットに置く。EC2 が Session Manager 経由でそれを取り込み、バックエンドを起動し直す。ログインなしの `/api/boards` が 401 を返したら完了。`-SkipBuild` を付けるとビルドを省く |
| `perf.ps1` | 今ある環境に E2E パフォーマンステストを流す（下の「E2E パフォーマンステスト」） |
| `down.ps1` | RDSのスナップショットを取り、完成を待ってから `terraform destroy` で全部消す。スナップショットに失敗したら何も消さずに止まる。スナップショットは新しいものから2つだけ残す |

- **作り直すたびにIPアドレス（URL）が変わります。** `up.ps1` の最後に表示されるURLを使ってください
- DBのパスワードも作り直すたびに新しくなります（自動で設定されるので、操作は要りません）
- 中身を確認するだけなら `& $tf plan` が使えます（何も作らない）

アクセスを自分の回線だけに絞りたい場合は、`terraform.tfvars.example` を `terraform.tfvars` という名前でコピーして編集します。

## サーバーに入る

SSHの鍵は使いません。`up.ps1` のあとに `& $tf output connect_command` で表示されるコマンドを実行します。

```powershell
aws ssm start-session --target <インスタンスID> --region ap-northeast-1
```

このコマンドを使うには、PCに [Session Manager プラグイン](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) を入れる必要があります。ブラウザから入るなら、EC2コンソールの「接続」→「セッションマネージャー」でも入れます。

## E2E パフォーマンステスト

ブラウザと同じ道筋（nginx → Spring Boot → RDS）で、何人かが同時に使ったときの速さを測ります。負荷をかけるツールは [k6](https://grafana.com/docs/k6/latest/)（`~/tools/k6-v2.3.0-windows-amd64/k6.exe`）、シナリオは `perf/e2e-perf.js` です。

```powershell
./up.ps1                          # 環境がなければ作る
./perf.ps1                        # 10人で2分（前後に増やす30秒・減らす15秒）
./perf.ps1 -Vus 20 -Duration 5m   # 人数と時間を変える（最大50人）
./down.ps1                        # 終わったら消す
```

1人ぶんの流れ（これを繰り返す）:

1. 画面を開く（`/`・`style.css`・`app.js`）
2. 初回だけアカウント登録とログイン（`e2e-perf-<実行ID>-<番号>@example.com`）
3. ボードを開く（ログイン中のユーザー・ボード・列・タスクの一覧）
4. タスクを作る → 検索する → 別の列に移す → 完了にする → 編集する → 消す
5. 1秒待つ（人が画面を見ている時間）

結果は、操作ごとの応答時間（中央値・95%・最大）を表にして表示します。詳しい数値は `perf/results/<日時>.json`（Git には入れない）に保存します。

| 目安（95%の応答がこれより速い） | 値 |
|---|---|
| 画面のファイル | 500ms |
| API（ログイン・登録以外） | 1秒 |
| ログイン・アカウント登録（パスワードのハッシュ計算があるので遅い） | 3秒 |
| 失敗したリクエスト | 1%未満 |

- 目安を超えると、表の「目安」の列が NG になり、`perf.ps1` もエラーで終わります
- テストが終わると（途中で止めた場合も）、テスト用ユーザーとそのボード・列・タスクを DB から消し、サーバーのメモリとコンテナの使用量を表示します。普段のデータには触りません
- t3.micro は CPU クレジットを使い切ると遅くなります（追加料金はかかりません）。長時間・大人数のテストは避け、続けて流すときは間を空けてください

## 品質チェック

変更したときや、定期的な確認のときに使うコマンドです。どれも読み取りだけで、AWS上の物を作ったり消したりはしません（料金はかかりません）。PowerShell で `infra/terraform` に移動してから実行します。

```powershell
$tf = "$env:USERPROFILE\tools\terraform\terraform.exe"
$r = 'ap-northeast-1'
```

### 1. 書式と構文（AWSのログイン不要）

```powershell
& $tf fmt -check -recursive   # 書式が崩れていれば、そのファイル名が表示される（直すなら -check を外す）
& $tf validate                # 「Success! The configuration is valid.」なら OK
```

### 2. テンプレートの展開（AWSのログイン不要）

`user_data.sh.tftpl` で、docker compose の `${DB_PASSWORD}` が残り、Terraform の値が埋め込まれることを確かめます。

```powershell
'templatefile("user_data.sh.tftpl", {region="ap-northeast-1", db_host="db.example", db_name="taskmanager", db_username="taskmanager", db_password_parameter="/p"})' | & $tf console
```

### 3. 設定と実物のずれ（環境があるとき）

```powershell
& $tf plan   # 「No changes.」なら、コンソールで手で変えたものはない
```

### 4. 公開範囲と秘密情報（環境があるとき）

```powershell
# RDS がインターネットに公開されていないこと（False なら OK）
aws rds describe-db-instances --region $r --db-instance-identifier task-manager-app-db --query "DBInstances[0].PubliclyAccessible"

# EC2 で開いているポート（80 だけなら OK）
aws ec2 describe-security-group-rules --region $r --filters "Name=group-id,Values=$(aws ec2 describe-security-groups --region $r --filters Name=group-name,Values=task-manager-app-app --query 'SecurityGroups[0].GroupId' --output text)" --query 'SecurityGroupRules[?IsEgress==`false`].[FromPort,CidrIpv4]' --output text

# state にDBのパスワードが入っていないこと（0 なら OK）
$p = aws ssm get-parameter --region $r --name /task-manager-app/db/password --with-decryption --query Parameter.Value --output text
(Select-String -Path terraform.tfstate -Pattern $p -SimpleMatch).Count
Remove-Variable p
```

外から接続できないことも確かめます（`up.ps1` で表示されたIPを使う）。

```powershell
$ip = & $tf output -raw public_ip
(Invoke-WebRequest "http://$ip/").StatusCode                                       # 200 なら OK
$c = [Net.Sockets.TcpClient]::new(); $c.ConnectAsync($ip, 8080).Wait(5000); $c.Dispose()   # False なら OK（8080 は閉じている）
$c = [Net.Sockets.TcpClient]::new(); $c.ConnectAsync((& $tf output -raw db_endpoint), 5432).Wait(5000); $c.Dispose()   # False なら OK（RDS に外から入れない）
```

### 5. 消し忘れ（`down.ps1` のあと）

```powershell
aws ec2 describe-instances --region $r --filters Name=tag:Project,Values=task-manager-app Name=instance-state-name,Values=pending,running,stopping,stopped --query "Reservations[].Instances[].InstanceId" --output text   # 空なら OK
aws ec2 describe-addresses --region $r --query "Addresses[].PublicIp" --output text            # 空なら OK（Elastic IP の消し忘れは料金がかかる）
aws rds describe-db-instances --region $r --query "DBInstances[].DBInstanceIdentifier" --output text   # 空なら OK
aws rds describe-db-snapshots --region $r --snapshot-type manual --query "DBSnapshots[].[DBSnapshotIdentifier,Encrypted]" --output text   # 2つまで、暗号化 True なら OK
```

### チェックの観点

| 観点 | 見るところ |
|---|---|
| 公開範囲 | EC2 は 80 番だけ（8080 は `expose_backend_port` のときだけ、22 は開けない）。RDS は非公開で、5432 番はアプリのEC2からだけ |
| 秘密情報 | DBのパスワードが Git・state・`user_data`・起動ログに出ていない。`*.tfstate` / `*.tfvars` は `.gitignore` 済み |
| 権限 | EC2のロールは Session Manager と、パスワードのパラメータ1つを読む権限だけ |
| 暗号化 | EBS・RDS・スナップショットが暗号化されている。IMDSv2 必須 |
| 費用 | 無料枠のサイズ。CPUクレジットは `standard`。有料の部品（NAT・ロードバランサー・Secrets Manager など）を使っていない。消し忘れがない |
| データ | 消すときは `down.ps1`（スナップショットを取ってから消す）を使う |

## state について

`terraform.tfstate` には、作ったリソースの情報が入っています。このPCにだけ保存していて、Gitには入れません（`.gitignore` 済み）。消すと Terraform がリソースを管理できなくなるので、消さないでください。
