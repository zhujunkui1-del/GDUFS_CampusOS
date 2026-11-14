/* eslint-disable @next/next/no-img-element -- Pre-sized WebP assets and authenticated image responses bypass the optimizer. */
"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BuildingActivities } from "./building-activities";
import seed from "../data/building-profiles.json";
import "./building-info.css";
export function BuildingInfo({ id }: { id: string }) {
  const [profile, setProfile] = useState<{
    description: string;
    photos: string[];
  }>(
    (seed as Record<string, { description: string; photos: string[] }>)[id] || {
      description: "",
      photos: [],
    },
  );
  const [view, setView] = useState<"summary" | "photos" | "activities">(
    "summary",
  );
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    root.current?.closest(".place-details-content")?.scrollTo({ top: 0 });
  }, [view]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/building?id=" + encodeURIComponent(id), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((b) => {
        if (b.ok) setProfile(b.data);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id]);
  if (view === "photos")
    return (
      <section ref={root} className="building-info">
        <header>
          <button type="button" onClick={() => setView("summary")}>
            返回
          </button>
          <h3>更多图片</h3>
        </header>
        <div className="building-gallery">
          {profile.photos.map((url) => (
            <img key={url} src={url} alt="建筑照片" loading="lazy" />
          ))}
        </div>
      </section>
    );
  return (
    <section ref={root} className="building-info">
      {view === "summary" && (
        <>
          {profile.description && (
            <p className="building-description">{profile.description}</p>
          )}
          {profile.photos.length > 0 && (
            <div className="building-photo-preview">
              {profile.photos.slice(0, 3).map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setView("photos")}
                  aria-label="查看建筑图片"
                >
                  <img src={url} alt="建筑照片" loading="lazy" />
                </button>
              ))}
            </div>
          )}
          {profile.photos.length > 3 && (
            <button
              type="button"
              className="building-more"
              onClick={() => setView("photos")}
            >
              更多图片（{profile.photos.length}）
            </button>
          )}
          {!profile.photos.length && <p className="building-empty">暂无图片</p>}
        </>
      )}
      <BuildingActivities
        id={id}
        expanded={view === "activities"}
        onMore={() => setView("activities")}
        onBack={() => setView("summary")}
      />
    </section>
  );
}
