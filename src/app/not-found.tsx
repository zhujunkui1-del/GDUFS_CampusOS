import Link from "next/link";
export default function NotFound() {
  return (
    <main className="not-found">
      <span className="overline">广外通 CampusOS</span>
      <h1>页面不存在</h1>
      <p>这个地址没有对应的校园页面。</p>
      <Link href="/map">返回校园地图</Link>
    </main>
  );
}
