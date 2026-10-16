#Requires -Version 7
# アプリ（Rails API のイメージと、Next.js で書き出したフロントエンド）をビルドして、EC2 にデプロイする。
# 流れ: ローカルでビルド → S3 に置く → EC2 が S3 から取り込み、バックエンドを起動し直す
# 使い方:  ./deploy.ps1             （ビルドしてデプロイ）
#          ./deploy.ps1 -SkipBuild  （前回ビルドしたものをそのまま使う）
# 必要なもの: Docker Desktop（イメージのビルド）、Node.js（~/tools/node-v24.22.0-win-x64）
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$tf = "$env:USERPROFILE\tools\terraform\terraform.exe"
$node = "$env:USERPROFILE\tools\node-v24.22.0-win-x64"
$region = 'ap-northeast-1'
$image = 'finance-manager-api:latest'
Set-Location $PSScriptRoot
# 失敗したときに表示するサーバーのログを文字化けさせない
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:AWS_CLI_OUTPUT_ENCODING = 'utf-8'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$buildDir = "$repo\infra\terraform\.deploy"

aws sts get-caller-identity --output text *> $null
if ($LASTEXITCODE -ne 0) { throw 'AWSにログインしていません。aws login を実行してから、もう一度実行してください。' }

$bucket = & $tf output -raw artifacts_bucket 2>$null
$instance = & $tf output -raw instance_id 2>$null
$url = & $tf output -raw app_url 2>$null
if (-not $bucket -or -not $instance) { throw '環境がありません。先に ./up.ps1 を実行してください。' }

$imageFile = "$buildDir\api-image.tar.gz"
$frontendFile = "$buildDir\frontend.tar.gz"

# 1. ビルド（テストは PR のときに流すので、ここでは省く）
if (-not $SkipBuild) {
    New-Item -ItemType Directory -Force $buildDir | Out-Null

    Write-Host 'フロントエンドを書き出しています（1〜2分）'
    $env:Path = "$node;$env:Path"
    Push-Location "$repo\frontend"
    try {
        npm ci --no-audit --no-fund --loglevel=error
        if ($LASTEXITCODE -ne 0) { throw 'npm ci に失敗しました。' }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'フロントエンドのビルドに失敗しました。' }
    } finally {
        Pop-Location
    }
    tar -czf $frontendFile -C "$repo\frontend\out" .
    if ($LASTEXITCODE -ne 0) { throw 'フロントエンドをまとめられませんでした。' }

    Write-Host 'Rails のイメージを作っています（初回は5〜10分）'
    docker build --platform linux/amd64 -t $image "$repo\backend"
    if ($LASTEXITCODE -ne 0) { throw 'イメージのビルドに失敗しました。Docker Desktop が起動しているか確認してください。' }
    $tarFile = "$buildDir\api-image.tar"
    docker save -o $tarFile $image
    if ($LASTEXITCODE -ne 0) { throw 'イメージを書き出せませんでした。' }
    # 送る量を減らすため gzip で縮める（EC2 の docker load はそのまま読める）
    $in = [IO.File]::OpenRead($tarFile)
    $out = [IO.File]::Create($imageFile)
    $gzip = [IO.Compression.GZipStream]::new($out, [IO.Compression.CompressionLevel]::Optimal)
    try { $in.CopyTo($gzip) } finally { $gzip.Dispose(); $out.Dispose(); $in.Dispose() }
    Remove-Item $tarFile
}
foreach ($f in $imageFile, $frontendFile) {
    if (-not (Test-Path $f)) { throw "ビルドしたファイルがありません: $f（-SkipBuild を付けずに実行してください）" }
}

# 2. S3 に置く
Write-Host 'ファイルをアップロードしています'
aws s3 cp $imageFile "s3://$bucket/api-image.tar.gz" --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'イメージのアップロードに失敗しました。' }
aws s3 cp $frontendFile "s3://$bucket/frontend.tar.gz" --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'フロントエンドのアップロードに失敗しました。' }

# 3. EC2 で取り込み、バックエンドを起動し直す。ログインなしの /api/books が 401 を返せば起動完了
# （EC2 にはバケットの一覧を見る権限を付けていないので、ファイル名を指定して1つずつ取る）
$commands = @(
    'set -e',
    'cd /opt/finance-manager',
    "aws s3 cp --region $region --only-show-errors s3://$bucket/api-image.tar.gz /tmp/api-image.tar.gz",
    'docker load -i /tmp/api-image.tar.gz && rm -f /tmp/api-image.tar.gz',
    "aws s3 cp --region $region --only-show-errors s3://$bucket/frontend.tar.gz /tmp/frontend.tar.gz",
    # 古いファイルが残らないよう、新しいフォルダに展開してから入れ替える
    'rm -rf frontend.new && mkdir frontend.new && tar -xzf /tmp/frontend.tar.gz -C frontend.new && rm -f /tmp/frontend.tar.gz',
    'rm -rf frontend.old && mv frontend frontend.old && mv frontend.new frontend && rm -rf frontend.old',
    'docker compose up -d --force-recreate app web',
    'docker image prune -f > /dev/null',
    'for i in $(seq 1 36); do code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/books); if [ "$code" = 401 ]; then echo backend-ready; exit 0; fi; sleep 5; done',
    'echo backend-not-ready; docker compose logs --tail 80 app; exit 1'
)
$params = Join-Path ([IO.Path]::GetTempPath()) 'finance-manager-deploy.json'
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

Write-Host 'サーバーに反映しています（イメージの読み込みとバックエンドの起動に2〜5分）'
$commandId = aws ssm send-command --region $region --instance-ids $instance --document-name AWS-RunShellScript `
    --parameters "file://$params" --timeout-seconds 900 --query Command.CommandId --output text
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
