# EC2環境（Terraform）

AWSの無料枠の範囲で、タスク管理アプリを動かすEC2を1台作ります。

## 作られるもの

| リソース | 内容 |
|---|---|
| EC2 | `t3.micro`（無料枠の対象）、Amazon Linux 2023、ディスク20GB（gp3・暗号化） |
| Elastic IP | 固定のIPアドレス。サーバーを止めて起動し直してもURLが変わらない |
| セキュリティグループ | フロントエンド（80番）とバックエンド（8080番）だけ開ける。SSH（22番）は開けない |
| IAMロール | Session Manager でサーバーに入るための権限（`AmazonSSMManagedInstanceCore`）だけ |

## ポートの分け方

| ポート | 役割 | 中身 |
|---|---|---|
| 80 | フロントエンド | nginx が `/opt/task-manager/frontend/`（`index.html` / `style.css` / `app.js`）を配信する |
| 8080 | バックエンドAPI | Spring Boot（`/opt/task-manager/app.jar`） |

フロントエンドの `app.js` は、ページを開いたのと同じホストの8080番をAPIの宛先にします。バックエンドには、環境変数 `APP_CORS_ALLOWED_ORIGINS` で、Elastic IP のフロントエンドのURL（`http://<IP>`）からのCookie付き通信を許可しています。

サーバーの初回起動時に `user_data.sh.tftpl` が次の準備をします。

- 2GBのスワップを作る（メモリ1GBで Spring Boot と PostgreSQL を同時に動かすため）
- Docker と Docker Compose を入れる
- `/opt/task-manager/` に `docker-compose.yml` を置き、PostgreSQL（`db`）と nginx（`web`）を起動する
  - nginx は、デプロイするまで「準備中」のページを表示する
  - DBのパスワードはサーバー上でランダムに作り、`/opt/task-manager/.env` に保存する。Gitにも Terraform の state にも残らない

アプリ本体（フロントエンドのファイルと `app.jar`）のデプロイは、この設定には含まれていません。デプロイ後に `docker compose up -d app` でバックエンドを起動します。

## 無料枠に収めるための工夫と、注意点

- RDS・NATゲートウェイ・ロードバランサーなど、有料になりやすい部品は使いません。DBも同じEC2で動かします
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
