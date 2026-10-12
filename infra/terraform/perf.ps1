#Requires -Version 7
# 今ある環境に、E2E パフォーマンステスト（perf/e2e-perf.js、k6）を流す。
# 終わったら、テストで作ったユーザー・ボード・タスクを DB から消し、サーバーのメモリ使用量を表示する。
# 使い方:  ./perf.ps1                      （10人で2分）
#          ./perf.ps1 -Vus 20 -Duration 5m
param(
    [ValidateRange(1, 50)][int]$Vus = 10,
    [string]$Duration = '2m'
)

$ErrorActionPreference = 'Stop'
$tf = "$env:USERPROFILE\tools\terraform\terraform.exe"
$k6 = "$env:USERPROFILE\tools\k6-v2.3.0-windows-amd64\k6.exe"
$region = 'ap-northeast-1'
Set-Location $PSScriptRoot
# aws CLI の出力（サーバーから返る日本語のログ）を文字化けさせない
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:AWS_CLI_OUTPUT_ENCODING = 'utf-8'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path

if (-not (Test-Path $k6)) { throw "k6 がありません: $k6（https://github.com/grafana/k6/releases から入れてください）" }
aws sts get-caller-identity --output text *> $null
if ($LASTEXITCODE -ne 0) { throw 'AWSにログインしていません。aws login を実行してから、もう一度実行してください。' }

$url = (& $tf output -raw app_url 2>$null) -replace '/$', ''
$instance = & $tf output -raw instance_id 2>$null
$dbHost = & $tf output -raw db_endpoint 2>$null
if (-not $url -or -not $instance) { throw '環境がありません。先に ./up.ps1 を実行してください。' }

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultDir = "$repo\perf\results"
New-Item -ItemType Directory -Force $resultDir | Out-Null
$resultFile = "$resultDir\$runId.json"

Write-Host "E2E パフォーマンステストを流します: $url（$Vus 人、$Duration）"
try {
    & $k6 run --quiet -e BASE_URL=$url -e RUN_ID=$runId -e VUS=$Vus -e DURATION=$Duration -e RESULT_FILE=$resultFile "$repo\perf\e2e-perf.js"
    $k6Exit = $LASTEXITCODE
} finally {
    # テスト用ユーザー（e2e-perf-*@example.com）のデータを消す。途中で止めた場合も必ず消す
    Write-Host 'テストデータを消して、サーバーの状態を確認しています'
    $commands = @(
        'set -e',
        'cd /opt/task-manager',
        'docker pull -q postgres:16-alpine > /dev/null',
        "docker run --rm -i --env-file .env -e PGHOST=$dbHost -e PGSSLMODE=require postgres:16-alpine sh -c 'PGPASSWORD=`$DB_PASSWORD psql -q -v ON_ERROR_STOP=1 -U taskmanager -d taskmanager' <<'SQL'",
        'BEGIN;',
        "CREATE TEMP TABLE perf_users AS SELECT id FROM users WHERE email LIKE 'e2e-perf-%@example.com';",
        'CREATE TEMP TABLE perf_tasks AS SELECT t.id FROM tasks t JOIN boards b ON b.id = t.board_id WHERE b.user_id IN (SELECT id FROM perf_users);',
        'DELETE FROM checklist_items WHERE task_id IN (SELECT id FROM perf_tasks);',
        'DELETE FROM task_categories WHERE task_id IN (SELECT id FROM perf_tasks);',
        'DELETE FROM tasks WHERE id IN (SELECT id FROM perf_tasks);',
        'DELETE FROM board_columns WHERE board_id IN (SELECT id FROM boards WHERE user_id IN (SELECT id FROM perf_users));',
        'DELETE FROM boards WHERE user_id IN (SELECT id FROM perf_users);',
        '\echo テストユーザーを消しました:',
        'SELECT count(*) AS deleted_users FROM perf_users;',
        'DELETE FROM users WHERE id IN (SELECT id FROM perf_users);',
        'COMMIT;',
        'SQL',
        'echo "--- サーバーのメモリ（MB）"',
        'free -m',
        'echo "--- コンテナ"',
        'docker stats --no-stream --format "{{.Name}}: CPU {{.CPUPerc}} / メモリ {{.MemUsage}}"'
    )
    $params = Join-Path ([IO.Path]::GetTempPath()) 'task-manager-perf.json'
    # aws CLI は file:// を Windows の既定の文字コード（Shift-JIS）で読むので、日本語は \uXXXX にしておく
    @{ commands = $commands } | ConvertTo-Json -EscapeHandling EscapeNonAscii | Set-Content $params -Encoding utf8NoBOM
    $commandId = aws ssm send-command --region $region --instance-ids $instance --document-name AWS-RunShellScript `
        --parameters "file://$params" --timeout-seconds 300 --query Command.CommandId --output text
    $sendExit = $LASTEXITCODE
    Remove-Item $params
    if ($sendExit -ne 0) { throw 'テストデータの後片付けを始められませんでした。もう一度 ./perf.ps1 を実行すると、前回のテストデータも消えます。' }
    do {
        Start-Sleep 5
        $status = aws ssm get-command-invocation --region $region --command-id $commandId --instance-id $instance --query Status --output text 2>$null
    } while ($status -in 'Pending', 'InProgress', 'Delayed', $null, '')
    aws ssm get-command-invocation --region $region --command-id $commandId --instance-id $instance `
        --query '[StandardOutputContent, StandardErrorContent]' --output text | Write-Host
    if ($status -ne 'Success') { Write-Warning "テストデータの後片付けに失敗しました（$status）。上のログを確認してください。" }
}

Write-Host "詳しい結果: $resultFile"
if ($k6Exit -ne 0) { throw '目安を超えた項目があります（上の表の NG）。' }
