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
| IAMロール | Session Manager の権限と、DBのパスワードのパラメータ1つを読む権限だけ |

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

アプリ本体（フロントエンドのファイルと `app.jar`）のデプロイは、この設定には含まれていません。デプロイ後に `docker compose up -d app` でバックエンドを起動します。

## 無料枠に収めるための工夫と、注意点

- NATゲートウェイ・ロードバランサー・Secrets Manager など、有料になりやすい部品は使いません
- RDSは無料枠の対象のサイズ（`db.t4g.micro`、シングルAZ、20GB）にし、Performance Insights と拡張モニタリングは使いません
- **`terraform destroy` を実行すると、RDSのデータも消えます**（最終スナップショットは取りません）。消す前に、アプリの「エクスポート」でデータを書き出してください
- CPUクレジットを `standard` にしています。CPUを使い切っても遅くなるだけで、追加料金はかかりません
- **パブリックIPv4アドレス（Elastic IP）は無料枠の対象外です**（1時間あたり約0.005ドル、月に約3.6ドル）。無料プランのクレジットから引かれます
  - EC2を停止している間も、Elastic IP の料金はかかります。使わない期間が長いときは `terraform destroy` で消してください
- EC2を停止すると、インスタンスの料金はかかりませんが、ディスク（EBS）は残ります。完全に消すには `terraform destroy` を実行します
- 通信はHTTP（暗号化なし）です。HTTPSにするには独自ドメインが必要なので、必要になったら追加します

## 使い方

前提：`aws login` でログインしていること。Terraform は `~/tools/terraform/terraform.exe` にあります。

```powershell
cd infra/terraform
$tf = "$env:USERPROFILE\tools\terraform\terraform.exe"

& $tf init      # 初回だけ。AWSプロバイダーをダウンロードする
& $tf plan      # 何が作られるかを確認する（まだ何も作らない）
& $tf apply     # 実際に作る（yes と入力すると作成が始まる）
& $tf destroy   # 全部消す
```

アクセスを自分の回線だけに絞りたい場合は、`terraform.tfvars.example` を `terraform.tfvars` という名前でコピーして編集します。

## サーバーに入る

SSHの鍵は使いません。`terraform apply` のあとに表示される `connect_command` を実行します。

```powershell
aws ssm start-session --target <インスタンスID> --region ap-northeast-1
```

このコマンドを使うには、PCに [Session Manager プラグイン](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) を入れる必要があります。ブラウザから入るなら、EC2コンソールの「接続」→「セッションマネージャー」でも入れます。

## state について

`terraform.tfstate` には、作ったリソースの情報が入っています。このPCにだけ保存していて、Gitには入れません（`.gitignore` 済み）。消すと Terraform がリソースを管理できなくなるので、消さないでください。
