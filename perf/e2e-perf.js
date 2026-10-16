// E2E パフォーマンステスト（k6）
// ブラウザでの操作と同じ順番で、画面の表示 → ログイン → 取引の登録・月の集計・検索・カテゴリ付け替え・編集・削除 を繰り返す。
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
    '画面 /', '画面 _next/static',
    'POST /api/users/register', 'POST /api/auth/login', 'GET /api/auth/me',
    'POST /api/books/ensure-default', 'GET /api/books/{id}/categories', 'GET /api/books/{id}/transactions',
    'GET /api/books/{id}/summary', 'POST /api/books/{id}/transactions', 'GET /api/books/{id}/transactions?q=',
    'PATCH /api/transactions/{id}/move', 'PUT /api/transactions/{id}', 'DELETE /api/transactions/{id}',
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
let bookId;
let categoryIds;

function login() {
    const email = `${EMAIL_PREFIX}${RUN_ID}-${__VU}${EMAIL_DOMAIN}`;
    ok(api('POST', '/api/users/register', { email, password: PASSWORD }, 'POST /api/users/register'), 'アカウント登録', 201);
    loggedIn = ok(api('POST', '/api/auth/login', { email, password: PASSWORD }, 'POST /api/auth/login'), 'ログイン');
}

export default function () {
    group('画面の表示', () => {
        const page = http.get(`${BASE_URL}/`, { tags: { name: '画面 /', kind: 'static' } });
        ok(page, '画面 /');
        // Next.js が書き出す JS・CSS はファイル名にハッシュが付くので、HTML から実際のパスを拾って取りに行く
        const assets = [...new Set((page.body || '').match(/\/_next\/static\/[^"']+\.(?:js|css)/g) || [])];
        check(assets, { '画面の JS・CSS が見つかる': (a) => a.length > 0 });
        for (const path of assets) {
            ok(http.get(`${BASE_URL}${path}`, { tags: { name: '画面 _next/static', kind: 'static' } }), `画面 ${path}`);
        }
    });

    if (!loggedIn) {
        login();
        if (!loggedIn) {
            sleep(1);
            return;
        }
    }

    // 画面と同じく、今月の取引と集計を表示する
    const month = new Date().toISOString().slice(0, 7);

    group('家計簿を開く', () => {
        ok(api('GET', '/api/auth/me', undefined, 'GET /api/auth/me'), 'ログイン中のユーザー');
        const books = api('POST', '/api/books/ensure-default', undefined, 'POST /api/books/ensure-default');
        if (ok(books, '家計簿一覧')) {
            bookId = books.json()[0].id;
        }
        const categories = api('GET', `/api/books/${bookId}/categories`, undefined, 'GET /api/books/{id}/categories');
        if (ok(categories, 'カテゴリ一覧')) {
            categoryIds = categories.json().map((c) => c.id);
        }
        ok(api('GET', `/api/books/${bookId}/transactions?month=${month}&sort=date`, undefined, 'GET /api/books/{id}/transactions'), '取引一覧');
        ok(api('GET', `/api/books/${bookId}/summary?month=${month}`, undefined, 'GET /api/books/{id}/summary'), '月の集計');
    });
    if (!bookId || !categoryIds || categoryIds.length < 2) {
        sleep(1);
        return;
    }

    group('取引を操作する', () => {
        const txn = {
            amount: 1000 + __ITER,
            date: `${month}-01`,
            categoryId: categoryIds[1],
            memo: `負荷テスト ${__VU}-${__ITER}`,
            tags: ['perf'],
        };
        const created = api('POST', `/api/books/${bookId}/transactions`, txn, 'POST /api/books/{id}/transactions');
        if (!ok(created, '取引の登録', 201)) {
            return;
        }
        const txnId = created.json().id;
        ok(api('GET', `/api/books/${bookId}/summary?month=${month}`, undefined, 'GET /api/books/{id}/summary'), '登録後の集計');
        sleep(0.5);
        ok(api('GET', `/api/books/${bookId}/transactions?month=${month}&q=${encodeURIComponent('負荷テスト')}&sort=amount`, undefined, 'GET /api/books/{id}/transactions?q='), '取引の検索');
        ok(api('PATCH', `/api/transactions/${txnId}/move`, { categoryId: categoryIds[2] }, 'PATCH /api/transactions/{id}/move'), 'カテゴリの付け替え');
        ok(api('PUT', `/api/transactions/${txnId}`, { ...txn, categoryId: categoryIds[2], amount: txn.amount + 1, memo: `${txn.memo}（編集）` }, 'PUT /api/transactions/{id}'), '取引の編集');
        sleep(0.5);
        ok(api('DELETE', `/api/transactions/${txnId}`, undefined, 'DELETE /api/transactions/{id}'), '取引の削除', 204);
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
