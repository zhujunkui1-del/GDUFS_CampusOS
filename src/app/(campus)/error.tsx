"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="module-page">
      <div className="module-empty">
        <h1>页面暂时无法加载</h1>
        <p>请重试；如果问题持续，可以先使用其他校园页面。</p>
        <button className="icon-button retry-button" onClick={reset}>
          重试
        </button>
      </div>
    </section>
  );
}
