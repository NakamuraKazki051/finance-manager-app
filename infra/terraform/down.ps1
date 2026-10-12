#Requires -Version 7
# 環境（EC2・RDS・Elastic IP など）を全部消す。
# DBのデータは、消す前にRDSのスナップショットに保存し、次の up.ps1 で復元する。
# 使い方:  ./down.ps1          （確認あり）
#          ./down.ps1 -Force   （確認なし）
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$tf = "$env:USERPROFILE\tools\terraform\terraform.exe"
$region = 'ap-northeast-1'
$db = 'task-manager-app-db'
$keepSnapshots = 2
Set-Location $PSScriptRoot

aws sts get-caller-identity --output text *> $null
if ($LASTEXITCODE -ne 0) { throw 'AWSにログインしていません。aws login を実行してから、もう一度実行してください。' }

if (-not $Force) {
    $answer = Read-Host '環境を消します（DBのデータはスナップショットに保存します）。よろしいですか？ (y/N)'
    if ($answer -ne 'y') { Write-Host 'やめました。'; return }
}

# 1. DBがあれば、スナップショットを取って完了まで待つ。失敗したら、何も消さずに止める
aws rds describe-db-instances --region $region --db-instance-identifier $db --output text *> $null
if ($LASTEXITCODE -eq 0) {
    $snapshot = "$db-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Write-Host "DBのスナップショットを作っています: $snapshot（数分かかります）"
    aws rds create-db-snapshot --region $region --db-instance-identifier $db --db-snapshot-identifier $snapshot --output text *> $null
    if ($LASTEXITCODE -ne 0) { throw 'スナップショットを作れませんでした。環境は消していません。' }
    aws rds wait db-snapshot-available --region $region --db-snapshot-identifier $snapshot
    if ($LASTEXITCODE -ne 0) { throw 'スナップショットが完成しませんでした。環境は消していません。' }
    Write-Host 'スナップショットができました。'
} else {
    Write-Host 'DBが見つからないので、スナップショットは取りません。'
}

# 2. 全部消す
& $tf destroy -auto-approve -input=false
if ($LASTEXITCODE -ne 0) { throw 'terraform destroy に失敗しました。もう一度 ./down.ps1 を実行してください。' }

# 3. 古いスナップショットを消す（新しいものから $keepSnapshots 個だけ残す。保存容量の料金を抑えるため）
$old = aws rds describe-db-snapshots --region $region --snapshot-type manual `
    --query "reverse(sort_by(DBSnapshots[?starts_with(DBSnapshotIdentifier, '$db-') && Status=='available'], &SnapshotCreateTime))[$($keepSnapshots):].DBSnapshotIdentifier" `
    --output text
foreach ($id in ($old -split '\s+' | Where-Object { $_ })) {
    Write-Host "古いスナップショットを消します: $id"
    aws rds delete-db-snapshot --region $region --db-snapshot-identifier $id --output text *> $null
}

Write-Host '環境を消しました。次に使うときは ./up.ps1 を実行してください。'
