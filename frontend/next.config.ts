import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// 本番(next build)は静的ファイル(out/)に書き出し、Rails(ローカル)や nginx(EC2)から配信する。
// 静的書き出しでは rewrites が使えないので、next dev のときだけ /api/ を Rails(localhost:8080)へ中継する
export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      async rewrites() {
        return [{ source: "/api/:path*", destination: "http://localhost:8080/api/:path*" }];
      },
    };
  }
  return { output: "export" };
}
