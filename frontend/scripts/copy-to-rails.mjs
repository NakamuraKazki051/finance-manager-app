// next build で書き出した out/ を backend/public/ にコピーする。
// ローカルでは Rails(http://localhost:8080/)が画面と API の両方を配信するので、同じオリジンでログインの Cookie が使える
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../out/", import.meta.url));
const pub = fileURLToPath(new URL("../../backend/public/", import.meta.url));

if (!existsSync(out)) {
  console.error("out/ がありません。先に npm run build を実行してください。");
  process.exit(1);
}
// 前回のビルドのファイルが残らないよう、robots.txt 以外は消してからコピーする
for (const name of readdirSync(pub)) {
  if (name !== "robots.txt") rmSync(new URL(name, new URL("../../backend/public/", import.meta.url)), { recursive: true, force: true });
}
cpSync(out, pub, { recursive: true });
console.log(`コピーしました: ${out} → ${pub}`);
