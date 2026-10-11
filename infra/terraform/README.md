# EC2環境（Terraform）

AWSの無料枠の範囲で、タスク管理アプリを動かすEC2を1台作ります。

## 作られるもの

| リソース | 内容 |
|---|---|
| EC2 | `t3.micro`（無料枠の対象）、Amazon Linux 2023、ディスク20GB（gp3・暗号化） |
| セキュリティグループ | HTTP（80番）だけ開ける。SSH（22番）は開けない |
| IAMロール | Session Manager でサーバーに入るための権限（`AmazonSSMManagedInstanceCore`）だけ |

サーバーの初回起動時に `user_data.sh` が次の準備をします。

- 2GBのスワップを作る（メモリ1GBで Spring Boot と PostgreSQL を同時に動かすため）
- Docker と Docker Compose を入れる
- `/opt/task-manager/` に `docker-compose.yml` を置き、PostgreSQL を起動する
  - DBのパスワードはサーバー上でランダムに作り、`/opt/task-manager/.env` に保存する。Gitにも Terraform の state にも残らない

アプリ本体（`app.jar`）のデプロイは、この設定には含まれていません。

## 無料枠に収めるための工夫と、注意点

- RDS・NATゲートウェイ・ロードバランサーなど、有料になりやすい部品は使いません。DBも同じEC2で動かします
- CPUクレジットを `standard` にしています。CPUを使い切っても遅くなるだけで、追加料金はかかりません
- **パブリックIPv4アドレスは無料枠の対象外です**（1時間あたり約0.005ドル、月に約3.6ドル）。無料プランのクレジットから引かれます
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
