"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Compass,
  Layers,
  LocateFixed,
  Minus,
  Plus,
  RotateCw,
  Search,
  UserRound,
  X,
} from "lucide-react";
import type { Map as LibreMap, Marker } from "maplibre-gl";
import data from "../data/baiyun-map.json";
import { createLocalMapStyle } from "../adapters/local-map-style";
import { CampusSwitcher } from "./campus-switcher";

type Place = (typeof data.places)[number];
const categories = {
  buildings: "校园建筑",
  dormitories: "宿舍楼栋",
  sports: "体育设施",
  services: "生活服务",
};
export default function BaiyunMapWorkspace() {
  const container = useRef<HTMLDivElement>(null);
  const native = useRef<LibreMap | null>(null);
  const selectRef = useRef<(place: Place, focus: boolean) => void>(() => {});
  const markers = useRef<
    Array<{ place: Place; marker: Marker; button: HTMLButtonElement }>
  >([]);
  const location = useRef<Marker | null>(null);
  const locateRevision = useRef({ value: 0 });
  const [status, setStatus] = useState("loading");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<Place | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [layers, setLayers] = useState<Record<string, boolean>>({
    buildings: true,
    dormitories: true,
    sports: true,
    services: true,
  });
  const ready = status === "ready";
  const results = data.places
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 12);
  function select(place: Place, focus = true) {
    setSelected(place);
    setSearchOpen(false);
    native.current?.setFilter("selected", [
      "==",
      ["get", "sourceId"],
      place.id,
    ]);
    if (focus)
      native.current?.easeTo({
        center: place.coordinate as [number, number],
        zoom: 18,
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 600,
        padding: { top: 150, bottom: 130, left: 30, right: 50 },
      });
  }
  useEffect(() => {
    selectRef.current = select;
  });
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    const locationRequests = locateRevision.current;
    void import("maplibre-gl")
      .then(({ Map, Marker, setWorkerUrl }) => {
        if (cancelled || !container.current) return;
        setWorkerUrl("/vendor/maplibre-6.14.0/maplibre-gl-worker.mjs");
        const style = createLocalMapStyle(
          data.url,
          undefined,
          data.places.filter((p) => p.name === "游泳馆").map((p) => p.id),
        );
        style.layers.splice(4, 0, {
          id: "waterways",
          type: "line",
          source: "campus",
          filter: [
            "all",
            ["==", ["get", "kind"], "water"],
            ["==", ["geometry-type"], "LineString"],
          ],
          paint: { "line-color": "#bfdae2", "line-width": 4 },
        });
        const map = new Map({
          container: container.current,
          style,
          center: [113.289, 23.203],
          zoom: 15,
          minZoom: 14,
          maxZoom: 20,
          maxPitch: 0,
          pitch: 0,
          dragRotate: false,
          touchPitch: false,
          attributionControl: false,
          renderWorldCopies: false,
          maxBounds: [
            [data.bounds[0], data.bounds[1]],
            [data.bounds[2], data.bounds[3]],
          ],
          canvasContextAttributes: { antialias: false },
          pixelRatio: Math.min(devicePixelRatio || 1, 2),
        });
        native.current = map;
        map.touchZoomRotate.disableRotation();
        const fit = () =>
          map.fitBounds(
            [
              [data.campusBounds[0], data.campusBounds[1]],
              [data.campusBounds[2], data.campusBounds[3]],
            ],
            {
              padding: {
                top: 150,
                bottom: 100,
                left: innerWidth > 760 ? 120 : 28,
                right: 65,
              },
              duration: 0,
            },
          );
        map.on("load", () => {
          if (cancelled) return;
          fit();
          for (const place of data.places) {
            const button = document.createElement("button");
            button.className = `campus-marker marker-${place.category}`;
            button.type = "button";
            button.textContent = place.name;
            button.setAttribute("aria-label", `查看${place.name}`);
            button.addEventListener("click", (e) => {
              e.stopPropagation();
              selectRef.current(place, false);
            });
            const marker = new Marker({ element: button })
              .setLngLat(place.coordinate as [number, number])
              .addTo(map);
            markers.current.push({ place, marker, button });
          }
          setStatus("ready");
        });
        map.on("error", (e) => {
          if (
            !cancelled &&
            !map.loaded() &&
            /fetch|load|source/i.test(e.error.message)
          )
            setStatus("error");
        });
        map.on("click", (e) => {
          const hit = map
            .queryRenderedFeatures(e.point, { layers: ["buildings", "sports"] })
            .find((f) =>
              data.places.some((p) => p.id === f.properties.sourceId),
            );
          const place = data.places.find(
            (p) => p.id === hit?.properties.sourceId,
          );
          if (place) selectRef.current(place, false);
        });
        map.on("move", () => {
          if (container.current) {
            container.current.dataset.zoom = map.getZoom().toFixed(2);
            container.current.dataset.pitch = String(map.getPitch());
          }
        });
        observer = new ResizeObserver(() => map.resize());
        observer.observe(container.current);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      locationRequests.value++;
      observer?.disconnect();
      location.current?.remove();
      location.current = null;
      markers.current = [];
      native.current?.remove();
      native.current = null;
    };
  }, [revision]);
  useEffect(() => {
    const map = native.current;
    if (!map || !ready) return;
    const refresh = () => {
      const boxes: Array<[number, number, number, number]> = [];
      for (const { place, button, marker } of [...markers.current].sort(
        (a, b) =>
          Number(b.place.id === selected?.id) -
            Number(a.place.id === selected?.id) ||
          a.place.minZoom - b.place.minZoom,
      )) {
        const point = map.project(place.coordinate as [number, number]),
          width = Math.min(180, place.name.length * 12 + 30),
          labelX = Math.max(
            innerWidth > 1000 ? 100 + width / 2 : 12 + width / 2,
            Math.min(point.x, map.getContainer().clientWidth - width / 2 - 12),
          ),
          box: [number, number, number, number] = [
            labelX - width / 2,
            point.y - 17,
            labelX + width / 2,
            point.y + 17,
          ];
        const visible =
          layers[place.category] &&
          (map.getZoom() >= place.minZoom || place.id === selected?.id) &&
          point.x > 10 &&
          point.x < map.getContainer().clientWidth - 10 &&
          point.y > 145 &&
          point.y <
            map.getContainer().clientHeight - (innerWidth <= 1000 ? 100 : 20) &&
          !boxes.some(
            (b) =>
              box[0] < b[2] + 8 &&
              box[2] > b[0] - 8 &&
              box[1] < b[3] + 7 &&
              box[3] > b[1] - 7,
          );
        button.hidden = !visible;
        marker.setOffset([labelX - point.x, 0]);
        button.classList.toggle("selected", place.id === selected?.id);
        if (visible) boxes.push(box);
      }
    };
    refresh();
    map.on("move", refresh);
    return () => {
      map.off("move", refresh);
    };
  }, [ready, layers, selected]);
  async function locate() {
    if (!navigator.geolocation) {
      setNotice("当前浏览器不支持定位。");
      return;
    }
    const request = ++locateRevision.current.value;
    navigator.geolocation.getCurrentPosition(
      async (result) => {
        if (request !== locateRevision.current.value || !native.current) return;
        const { longitude: x, latitude: y } = result.coords;
        if (
          x < data.bounds[0] ||
          x > data.bounds[2] ||
          y < data.bounds[1] ||
          y > data.bounds[3]
        ) {
          setNotice("当前位置不在白云山校区附近。");
          return;
        }
        const { Marker } = await import("maplibre-gl");
        if (request !== locateRevision.current.value || !native.current) return;
        location.current?.remove();
        location.current = new Marker({ color: "#1261bb" })
          .setLngLat([x, y])
          .addTo(native.current);
        native.current.easeTo({ center: [x, y], zoom: 18 });
        setNotice("");
      },
      () => {
        if (request === locateRevision.current.value)
          setNotice("定位失败，请检查位置权限。");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }
  return (
    <section
      className="map-workspace baiyun-workspace"
      aria-label="白云山校区地图"
    >
      <div
        ref={container}
        className="campus-map-canvas baiyun-map-canvas"
        data-testid="baiyun-map"
        data-status={status}
        data-mode="2d"
        data-map-version={data.version}
        aria-label="白云山校区本地地图"
      />
      <div className="map-top">
        <CampusSwitcher />
        <form
          className="map-search glass-surface"
          onSubmit={(e) => {
            e.preventDefault();
            setSearchOpen(true);
          }}
        >
          <Search size={19} />
          <label className="sr-only" htmlFor="baiyun-search">
            搜索校园地点
          </label>
          <input
            id="baiyun-search"
            placeholder="搜索地点、宿舍、体育设施"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearchOpen(false);
            }}
          />
          {query && (
            <button
              aria-label="清空地点搜索"
              type="button"
              onClick={() => {
                setQuery("");
                setSearchOpen(false);
              }}
            >
              <X size={16} />
            </button>
          )}
        </form>
        {searchOpen && query.trim() && (
          <div className="map-search-results" aria-label="校园地点搜索结果">
            {results.length ? (
              results.map((p) => (
                <button
                  className="place-result"
                  key={p.id}
                  onClick={() => select(p)}
                >
                  {p.name}
                </button>
              ))
            ) : (
              <p className="empty-search">尚未收录匹配地点。</p>
            )}
          </div>
        )}
      </div>
      <Link
        className="mobile-account glass-surface map-account-fixed"
        href="/account"
        aria-label="我的账号"
      >
        <UserRound size={20} />
      </Link>
      {!ready && (
        <div className="map-loading-card" role="status">
          <h2>
            {status === "error" ? "地图暂时无法加载" : "正在加载校园地图"}
          </h2>
          {status === "error" && (
            <button
              onClick={() => {
                setStatus("loading");
                setRevision((v) => v + 1);
              }}
            >
              重新加载
            </button>
          )}
        </div>
      )}
      <div className="map-controls glass-surface" aria-label="地图工具">
        <button
          disabled={!ready}
          aria-label="定位我的位置"
          onClick={() => void locate()}
        >
          <LocateFixed size={20} />
        </button>
        <button
          disabled
          className="map-mode-button"
          aria-label="地图模式，当前2D"
        >
          2D
        </button>
        <button
          disabled={!ready}
          aria-label="地图朝北"
          onClick={() => native.current?.easeTo({ bearing: 0 })}
        >
          <Compass size={20} />
        </button>
        <button
          disabled={!ready}
          aria-label="查看全校区"
          onClick={() =>
            native.current?.fitBounds(
              [
                [data.campusBounds[0], data.campusBounds[1]],
                [data.campusBounds[2], data.campusBounds[3]],
              ],
              {
                padding: {
                  top: 150,
                  bottom: 100,
                  left: innerWidth > 760 ? 120 : 28,
                  right: 65,
                },
                duration: 600,
              },
            )
          }
        >
          <RotateCw size={18} />
        </button>
        <button
          aria-label="地图图层"
          aria-expanded={layersOpen}
          onClick={() => setLayersOpen((v) => !v)}
        >
          <Layers size={20} />
        </button>
        <span className="tool-divider" />
        <button
          disabled={!ready}
          aria-label="放大地图"
          onClick={() => native.current?.zoomIn()}
        >
          <Plus size={20} />
        </button>
        <button
          disabled={!ready}
          aria-label="缩小地图"
          onClick={() => native.current?.zoomOut()}
        >
          <Minus size={20} />
        </button>
      </div>
      {layersOpen && (
        <div
          className="map-layers-panel"
          role="group"
          aria-label="地图图层设置"
        >
          <h2>地图图层</h2>
          {Object.entries(categories).map(([key, name]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={(e) =>
                  setLayers((v) => ({ ...v, [key]: e.target.checked }))
                }
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      )}
      {selected && (
        <aside
          className="baiyun-place-card glass-surface"
          aria-label="地点详情"
        >
          <h2>{selected.name}</h2>
          <button
            aria-label="关闭地点详情"
            onClick={() => {
              setSelected(null);
              native.current?.setFilter("selected", [
                "==",
                ["get", "sourceId"],
                "",
              ]);
            }}
          >
            <X size={20} />
          </button>
        </aside>
      )}
      {notice && (
        <div className="baiyun-notice glass-surface" role="status">
          {notice}
          <button aria-label="关闭定位提示" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="map-attribution">
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors · ODbL
        </a>
      </div>
    </section>
  );
}
