#Requires -Version 7
# アプリ（app.jar とフロントエンド）をビルドして、EC2 にデプロイする。
# 流れ: ローカルでビルド → S3 に置く → EC2 が S3 から取り込み、バックエンドを起動し直す
# 使い方:  ./deploy.ps1             （ビルドしてデプロイ）
#          ./deploy.ps1 -SkipBuild  （ビルド済みの jar をそのまま使う）
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$tf = "$env:USERPROFILE\tools\terraform\terraform.exe"
$region = 'ap-northeast-1'
Set-Location $PSScriptRoot
# 失敗したときに表示するサーバーのログを文字化けさせない
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:AWS_CLI_OUTPUT_ENCODING = 'utf-8'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path

aws sts get-caller-identity --output text *> $null
if ($LASTEXITCODE -ne 0) { throw 'AWSにログインしていません。aws login を実行してから、もう一度実行してください。' }

$bucket = & $tf output -raw artifacts_bucket 2>$null
$instance = & $tf output -raw instance_id 2>$null
$url = & $tf output -raw app_url 2>$null
if (-not $bucket -or -not $instance) { throw '環境がありません。先に ./up.ps1 を実行してください。' }

# 1. ビルド（Java 25 / Maven はこのPCの ~/tools にあるもの。テストは PR のときに流すので、ここでは省く）
$jar = "$repo\backend\target\task-manager-api-0.1.0.jar"
$frontendFiles = 'index.html', 'style.css', 'app.js'
if (-not $SkipBuild) {
    Write-Host 'ビルドしています（1〜2分）'
    $env:JAVA_HOME = "$env:USERPROFILE\tools\jdk-25.0.4.1+1"
    $env:MAVEN_OPTS = '-Xmx384m'
    & "$env:USERPROFILE\tools\apache-maven-3.9.16\bin\mvn.cmd" -q -o -f "$repo\backend\pom.xml" package -DskipTests
    if ($LASTEXITCODE -ne 0) { throw 'ビルドに失敗しました。' }
}
if (-not (Test-Path $jar)) { throw "jar がありません: $jar" }

# 2. S3 に置く
Write-Host 'ファイルをアップロードしています'
aws s3 cp $jar "s3://$bucket/app.jar" --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'app.jar のアップロードに失敗しました。' }
foreach ($f in $frontendFiles) {
    aws s3 cp "$repo\$f" "s3://$bucket/frontend/$f" --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw "$f のアップロードに失敗しました。" }
}

# 3. EC2 で取り込み、バックエンドを起動し直す。ログインなしの /api/boards が 401 を返せば起動完了
# （EC2 にはバケットの一覧を見る権限を付けていないので、--recursive は使わず1ファイルずつ取る）
$commands = @(
    'set -e',
    'cd /opt/task-manager',
    "aws s3 cp --region $region --only-show-errors s3://$bucket/app.jar app.jar.new",
    'mv app.jar.new app.jar'
) + ($frontendFiles | ForEach-Object { "aws s3 cp --region $region --only-show-errors s3://$bucket/frontend/$_ frontend/$_" }) + @(
    'docker compose up -d --force-recreate app',
    'for i in $(seq 1 36); do code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/boards); if [ "$code" = 401 ]; then echo backend-ready; exit 0; fi; sleep 5; done',
    'echo backend-not-ready; docker compose logs --tail 80 app; exit 1'
)
$params = Join-Path ([IO.Path]::GetTempPath()) 'task-manager-deploy.json'
# aws CLI は file:// を Windows の既定の文字コード（Shift-JIS）で読むので、日本語が入っても読めるように \uXXXX にしておく
@{ commands = $commands } | ConvertTo-Json -EscapeHandling EscapeNonAscii | Set-Content $params -Encoding utf8NoBOM

# 作った直後は、EC2 が Session Manager に登録されるまで数分かかる（IAM の反映待ち）。登録されるまで待つ
for ($i = 0; $i -lt 60; $i++) {
    $ping = aws ssm describe-instance-information --region $region --filters "Key=InstanceIds,Values=$instance" `
        --query 'InstanceInformationList[0].PingStatus' --output text 2>$null
    if ($ping -eq 'Online') { break }
    if ($i -eq 0) { Write-Host 'サーバーが Session Manager に登録されるのを待っています（数分）' }
    Start-Sleep 10
}
if ($ping -ne 'Online') { throw '10分待っても、サーバーが Session Manager に登録されません。EC2コンソールで状態を確認してください。' }

Write-Host 'サーバーに反映しています（バックエンドの起動に1〜3分）'
$commandId = aws ssm send-command --region $region --instance-ids $instance --document-name AWS-RunShellScript `
    --parameters "file://$params" --timeout-seconds 600 --query Command.CommandId --output text
if ($LASTEXITCODE -ne 0) { throw 'サーバーへの反映を始められませんでした。' }
Remove-Item $params

do {
    Start-Sleep 5
    $status = aws ssm get-command-invocation --region $region --command-id $commandId --instance-id $instance --query Status --output text 2>$null
} while ($status -in 'Pending', 'InProgress', 'Delayed', $null, '')

if ($status -ne 'Success') {
    aws ssm get-command-invocation --region $region --command-id $commandId --instance-id $instance `
        --query '[StandardOutputContent, StandardErrorContent]' --output text | Write-Host
    throw "デプロイに失敗しました（$status）。上のログを確認してください。"
}
Write-Host "デプロイしました: $url"
