// E2E パフォーマンステスト（k6）
// ブラウザでの操作と同じ順番で、画面の表示 → ログイン → タスクの作成・検索・移動・完了・編集・削除 を繰り返す。
// 直接は実行せず、infra/terraform/perf.ps1 から実行する（URL の受け渡しと、テストデータの後片付けをするため）。
import http from 'k6/http';
import { check, group, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL;
const RUN_ID = __ENV.RUN_ID || `${Date.now()}`;
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '2m';
const RESULT_FILE = __ENV.RESULT_FILE || 'perf-result.json';
// テスト用ユーザーのメールアドレス。perf.ps1 はこの形のユーザーだけを後片付けで消す
const EMAIL_PREFIX = 'e2e-perf-';
const EMAIL_DOMAIN = '@example.com';
const PASSWORD = 'perf-test-password';

// 操作ごとの応答時間を集計するため、リクエストに name タグを付ける
const ENDPOINTS = [
    '画面 /', '画面 style.css', '画面 app.js',
    'POST /api/users/register', 'POST /api/auth/login', 'GET /api/auth/me',
    'POST /api/boards/ensure-default', 'GET /api/boards/{id}/columns', 'GET /api/boards/{id}/tasks',
    'POST /api/boards/{id}/tasks', 'GET /api/boards/{id}/tasks?q=', 'PATCH /api/tasks/{id}/move',
    'PATCH /api/tasks/{id}/complete', 'PUT /api/tasks/{id}', 'DELETE /api/tasks/{id}',
];

// 目安（t3.micro・メモリ1GB の環境で、普段使いに困らない速さ）。超えたらテストは失敗扱い
const thresholds = {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{kind:static}': ['p(95)<500'],
    'http_req_duration{kind:api}': ['p(95)<1000'],
};
// ログインはパスワードのハッシュ計算（BCrypt）で遅くて当然なので、ほかの API とは別に見る
for (const name of ENDPOINTS) {
    thresholds[`http_req_duration{name:${name}}`] = [name.includes('login') || name.includes('register') ? 'p(95)<3000' : 'p(95)<1000'];
}

export const options = {
    scenarios: {
        users: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: VUS }, // 少しずつ人数を増やす（起動直後の JVM を温める）
                { duration: DURATION, target: VUS },
                { duration: '15s', target: 0 },
            ],
            gracefulRampDown: '30s',
        },
    },
    thresholds,
    // k6 は既定で繰り返しのたびに Cookie を消す。ブラウザと同じくログインを保つため、消さないようにする
    noCookiesReset: true,
    summaryTrendStats: ['avg', 'med', 'p(95)', 'max'],
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function api(method, path, body, name) {
    const params = { headers: JSON_HEADERS, tags: { name, kind: 'api' } };
    return http.request(method, `${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), params);
}

function ok(res, label, status = 200) {
    return check(res, { [`${label} が ${status}`]: (r) => r.status === status });
}

// VU（仮想ユーザー）ごとに1回だけ、アカウントを作ってログインする。Cookie は VU ごとに保持される
let loggedIn = false;
let boardId;
let columnIds;

function login() {
    const email = `${EMAIL_PREFIX}${RUN_ID}-${__VU}${EMAIL_DOMAIN}`;
    ok(api('POST', '/api/users/register', { email, password: PASSWORD }, 'POST /api/users/register'), 'アカウント登録', 201);
    loggedIn = ok(api('POST', '/api/auth/login', { email, password: PASSWORD }, 'POST /api/auth/login'), 'ログイン');
}

export default function () {
    group('画面の表示', () => {
        for (const [path, name] of [['/', '画面 /'], ['/style.css', '画面 style.css'], ['/app.js', '画面 app.js']]) {
            ok(http.get(`${BASE_URL}${path}`, { tags: { name, kind: 'static' } }), name);
        }
    });

    if (!loggedIn) {
        login();
        if (!loggedIn) {
            sleep(1);
            return;
        }
    }

    group('ボードを開く', () => {
        ok(api('GET', '/api/auth/me', undefined, 'GET /api/auth/me'), 'ログイン中のユーザー');
        const boards = api('POST', '/api/boards/ensure-default', undefined, 'POST /api/boards/ensure-default');
        if (ok(boards, 'ボード一覧')) {
            boardId = boards.json()[0].id;
        }
        const columns = api('GET', `/api/boards/${boardId}/columns`, undefined, 'GET /api/boards/{id}/columns');
        if (ok(columns, '列一覧')) {
            columnIds = columns.json().map((c) => c.id);
        }
        ok(api('GET', `/api/boards/${boardId}/tasks?sort=manual`, undefined, 'GET /api/boards/{id}/tasks'), 'タスク一覧');
    });
    if (!boardId || !columnIds || columnIds.length < 2) {
        sleep(1);
        return;
    }

    group('タスクを操作する', () => {
        const task = {
            title: `負荷テスト ${__VU}-${__ITER}`,
            description: 'E2E パフォーマンステストで作成',
            columnId: columnIds[0],
            priority: 'HIGH',
            categories: ['perf'],
            checklist: [{ text: '確認する', done: false }],
        };
        const created = api('POST', `/api/boards/${boardId}/tasks`, task, 'POST /api/boards/{id}/tasks');
        if (!ok(created, 'タスク作成', 201)) {
            return;
        }
        const taskId = created.json().id;
        sleep(0.5);
        ok(api('GET', `/api/boards/${boardId}/tasks?q=${encodeURIComponent('負荷テスト')}&sort=due`, undefined, 'GET /api/boards/{id}/tasks?q='), 'タスク検索');
        ok(api('PATCH', `/api/tasks/${taskId}/move`, { columnId: columnIds[1], displayOrder: 0 }, 'PATCH /api/tasks/{id}/move'), 'タスク移動');
        ok(api('PATCH', `/api/tasks/${taskId}/complete`, { completed: true }, 'PATCH /api/tasks/{id}/complete'), 'タスク完了');
        ok(api('PUT', `/api/tasks/${taskId}`, { ...task, columnId: columnIds[1], title: `${task.title}（編集）`, completed: true }, 'PUT /api/tasks/{id}'), 'タスク編集');
        sleep(0.5);
        ok(api('DELETE', `/api/tasks/${taskId}`, undefined, 'DELETE /api/tasks/{id}'), 'タスク削除', 204);
    });

    sleep(1); // 人が画面を見ている時間
}

// 結果を日本語の表で表示し、詳しい数値は JSON に保存する
export function handleSummary(data) {
    const m = data.metrics;
    const ms = (v) => (v === undefined ? '-' : `${Math.round(v)}ms`);
    const lines = [];
    lines.push('');
    lines.push('===== E2E パフォーマンステストの結果 =====');
    lines.push(`同時ユーザー: 最大 ${VUS} 人 / 継続時間: ${DURATION}（前後の増減を除く）`);
    lines.push(`リクエスト数: ${m.http_reqs.values.count}（毎秒 ${m.http_reqs.values.rate.toFixed(1)} 件）`);
    lines.push(`失敗率: ${(m.http_req_failed.values.rate * 100).toFixed(2)}% / チェック成功率: ${(m.checks.values.rate * 100).toFixed(2)}%`);
    lines.push('');
    lines.push('操作                                   中央値    95%     最大   目安');
    for (const name of ENDPOINTS) {
        const metric = m[`http_req_duration{name:${name}}`];
        if (!metric) continue;
        const v = metric.values;
        const passed = Object.values(metric.thresholds || {}).every((t) => t.ok);
        lines.push(`${name.padEnd(38)} ${ms(v.med).padStart(6)} ${ms(v['p(95)']).padStart(7)} ${ms(v.max).padStart(7)}   ${passed ? 'OK' : 'NG'}`);
    }
    lines.push('');
    const failed = Object.entries(m).filter(([, metric]) => Object.values(metric.thresholds || {}).some((t) => !t.ok));
    lines.push(failed.length === 0 ? '判定: すべての目安を満たしました' : `判定: 目安を超えたもの → ${failed.map(([k]) => k).join(', ')}`);
    lines.push('');
    return { stdout: lines.join('\n'), [RESULT_FILE]: JSON.stringify(data, null, 2) };
}
