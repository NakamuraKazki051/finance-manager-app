import FinanceApp from "@/components/FinanceApp";

// 1画面だけのアプリ。データはすべてブラウザから API(/api/)へ取りに行く
export default function Page() {
  return <FinanceApp />;
}
