"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  Compass,
  Layers,
  LocateFixed,
  Minus,
  Navigation,
  Plus,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import type { Map as LibreMap, Marker, GeoJSONSource } from "maplibre-gl";
import data from "../data/baiyun-map.json";
import { createLocalMapStyle } from "../adapters/local-map-style";
import { locationHalo } from "../data/device-location";
import type { BaiyunEndpoint } from "../data/baiyun-routing";
import { routePadding } from "../data/route-padding";
import { CampusSwitcher } from "./campus-switcher";
import { MapUtilities } from "./map-utilities";
import { PlaceDetails } from "./place-details";
import { BaiyunNavigation } from "./baiyun-navigation";
import type { BaiyunRoute, BaiyunCoordinate } from "../data/baiyun-routing";

type Place = (typeof data.places)[number];
const categories = {
  buildings: "校园建筑",
  dormitories: "宿舍楼栋",
  sports: "体育设施",
  services: "生活服务",
};
export default function BaiyunMapWorkspace() {
  const container = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const native = useRef<LibreMap | null>(null);
  const selectRef = useRef<(place: Place, focus: boolean) => void>(() => {});
  const markers = useRef<
    Array<{
      place: Place;
      marker: Marker;
      button: HTMLButtonElement;
      attached: boolean;
    }>
  >([]);
  const location = useRef<Marker | null>(null);
  const endpointMarkers = useRef<Marker[]>([]),
    endpointRevision = useRef({ value: 0 });
  async function showEndpoints(
    start: BaiyunEndpoint | null,
    end: BaiyunEndpoint | null,
  ) {
    const revision = ++endpointRevision.current.value;
    const { Marker } = await import("maplibre-gl");
    if (revision !== endpointRevision.current.value || !native.current) return;
    endpointMarkers.current.forEach((marker) => marker.remove());
    endpointMarkers.current = [];
    for (const [point, label] of [
      [start, "起"],
      [end, "终"],
    ] as const) {
      if (!point) continue;
      const el = document.createElement("span");
      el.className =
        "route-endpoint " +
        (label === "起" ? "route-start-marker" : "route-end-marker");
      el.textContent = label;
      el.setAttribute("aria-label", label === "起" ? "已选起点" : "已选终点");
      endpointMarkers.current.push(
        new Marker({ element: el, anchor: "center" })
          .setLngLat(point.coordinate as BaiyunCoordinate)
          .addTo(native.current),
      );
    }
  }
  const follow = useRef(true);
  const locateRevision = useRef({ value: 0 });
  const [status, setStatus] = useState("loading");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<Place | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [routeEnd, setRouteEnd] = useState<Place | null>(null);
  const [picking, setPicking] = useState<{
    which: "start" | "end";
    selected: (p: Place) => void;
  } | null>(null);
  const pickingRef = useRef(picking);
  useEffect(() => {
    pickingRef.current = picking;
  }, [picking]);
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
    if (pickingRef.current) {
      pickingRef.current.selected(place);
      setPicking(null);
      return;
    }
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
  const activeRoute = useRef<BaiyunRoute | null>(null);
  function fitRoute(route: BaiyunRoute) {
    const map = native.current;
    if (!map) return;
    if (route) {
      map.setMaxBounds(null);
      map.setMinZoom(0);
      const xs = route.path.map((p) => p[0]),
        ys = route.path.map((p) => p[1]);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (native.current === map && activeRoute.current === route)
            map.fitBounds(
              [
                [Math.min(...xs), Math.min(...ys)],
                [Math.max(...xs), Math.max(...ys)],
              ],
              {
                padding: routePadding(
                  map.getContainer().clientWidth,
                  map.getContainer().clientHeight,
                ),
                maxZoom: 18,
                duration: 600,
              },
            );
        }),
      );
    }
  }
  function showRoute(route: BaiyunRoute | null) {
    activeRoute.current = route;
    const map = native.current;
    if (!map) return;
    const source = map.getSource("baiyun-route") as GeoJSONSource | undefined;
    const geometry: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: route
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: route.solidPath || route.path,
              },
            },
            ...(route.guidance || []).map((path) => ({
              type: "Feature" as const,
              properties: { guidance: true },
              geometry: { type: "LineString" as const, coordinates: path },
            })),
            ...[route.path[0], route.path.at(-1)!].map((coordinate) => ({
              type: "Feature" as const,
              properties: {},
              geometry: { type: "Point" as const, coordinates: coordinate },
            })),
          ]
        : [],
    };
    if (source) source.setData(geometry);
    else {
      map.addSource("baiyun-route", { type: "geojson", data: geometry });
      map.addLayer({
        id: "baiyun-route-line",
        type: "line",
        source: "baiyun-route",
        filter: [
          "all",
          ["==", ["geometry-type"], "LineString"],
          ["!=", ["get", "guidance"], true],
        ],
        paint: { "line-color": "#1261bb", "line-width": 6 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "baiyun-route-guidance",
        type: "line",
        source: "baiyun-route",
        filter: ["==", ["get", "guidance"], true],
        paint: {
          "line-color": "#1261bb",
          "line-width": 5,
          "line-dasharray": [2, 2],
        },
      });
      map.addLayer({
        id: "baiyun-route-points",
        type: "circle",
        source: "baiyun-route",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": "#1261bb",
          "circle-radius": 6,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
    }
    if (route) fitRoute(route);
    if (container.current) {
      container.current.dataset.routeSource = route ? "baiyun-osm" : "";
      container.current.dataset.routePoints = String(route?.path.length || 0);
    }
  }
  const refitRoute = useEffectEvent(() => {
    if (activeRoute.current) fitRoute(activeRoute.current);
  });
  useEffect(() => {
    if (navigating) follow.current = true;
    refitRoute();
  }, [navigating]);
  useEffect(() => {
    if (!routeOpen) return;
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        refitRoute();
      });
    };
    const observer = new ResizeObserver(resize);
    for (const el of document.querySelectorAll(
      ".baiyun-workspace .route-planner,.baiyun-workspace .navigation-direction,.baiyun-workspace .navigation-summary",
    ))
      observer.observe(el);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [routeOpen, navigating]);
  async function showPosition(coordinate: BaiyunCoordinate, accuracy = 0) {
    const generation = locateRevision.current.value;
    const { Marker } = await import("maplibre-gl");
    if (!native.current || generation !== locateRevision.current.value) return;
    if (navigating && follow.current)
      native.current.easeTo({
        center: coordinate,
        zoom: Math.max(17, native.current.getZoom()),
        padding: routePadding(innerWidth, innerHeight),
        duration: 600,
      });
    const halo: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [locationHalo(coordinate, accuracy)],
      },
    };
    const source = native.current.getSource("baiyun-position-accuracy") as
      GeoJSONSource | undefined;
    if (source) source.setData(halo);
    else {
      native.current.addSource("baiyun-position-accuracy", {
        type: "geojson",
        data: halo,
      });
      native.current.addLayer({
        id: "baiyun-position-accuracy",
        type: "fill",
        source: "baiyun-position-accuracy",
        paint: { "fill-color": "#1261bb", "fill-opacity": 0.12 },
      });
    }
    if (location.current) location.current.setLngLat(coordinate);
    else
      location.current = new Marker({ color: "#1261bb" })
        .setLngLat(coordinate)
        .addTo(native.current);
  }
  useEffect(() => {
    selectRef.current = select;
  });
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    const locationRequests = locateRevision.current;
    const endpointRequests = endpointRevision.current;
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
          dragRotate: true,
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: false,
          renderWorldCopies: false,
          maxBounds: [
            [data.bounds[0], data.bounds[1]],
            [data.bounds[2], data.bounds[3]],
          ],
          canvasContextAttributes: { antialias: false },
          pixelRatio: Math.min(
            devicePixelRatio || 1,
            innerWidth <= 760 ? 1.5 : 2,
          ),
        });
        native.current = map;
        map.on("dragstart", () => {
          follow.current = false;
        });
        map.touchPitch.disable();
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
            markers.current.push({ place, marker, button, attached: true });
          }
          setStatus("ready");
          const target = data.places.find(
            (p) =>
              p.id === new URLSearchParams(window.location.search).get("place"),
          );
          if (target) selectRef.current(target, true);
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
          else if (pickingRef.current)
            selectRef.current(
              {
                id: `point-${e.lngLat.lng}-${e.lngLat.lat}`,
                name: "地图选点",
                coordinate: [e.lngLat.lng, e.lngLat.lat],
                category: "services",
                minZoom: 0,
                sourceUrl: data.sourceUrl,
              },
              false,
            );
        });
        map.on("move", () => {
          if (container.current) {
            container.current.dataset.zoom = map.getZoom().toFixed(2);
            container.current.dataset.pitch = String(map.getPitch());
            container.current.dataset.bearing = String(map.getBearing());
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
      ++endpointRequests.value;
      endpointMarkers.current.forEach((marker) => marker.remove());
      endpointMarkers.current = [];
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
      for (const entry of [...markers.current].sort(
        (a, b) =>
          Number(b.place.id === selected?.id) -
            Number(a.place.id === selected?.id) ||
          a.place.minZoom - b.place.minZoom,
      )) {
        const { place, button, marker } = entry;
        const point = map.project(place.coordinate as [number, number]),
          width = Math.min(180, place.name.length * 12 + 30),
          box: [number, number, number, number] = [
            point.x - width / 2,
            point.y - 17,
            point.x + width / 2,
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
        if (button.hidden === !!visible) button.hidden = !visible;
        if (visible && !entry.attached) {
          marker.addTo(map);
          entry.attached = true;
        } else if (!visible && entry.attached) {
          marker.remove();
          entry.attached = false;
        }
        const highlighted = place.id === selected?.id;
        if (button.classList.contains("selected") !== highlighted)
          button.classList.toggle("selected", highlighted);
        if (visible) boxes.push(box);
      }
    };
    refresh();
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          refresh();
        });
    };
    map.on("move", schedule);
    return () => {
      map.off("move", schedule);
      cancelAnimationFrame(frame);
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
      data-navigation={navigating ? "walking" : "planning"}
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
        <div className="map-toolbar">
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
              ref={searchInput}
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
                className="search-clear"
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
        </div>
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
      <MapUtilities />
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
        <button
          disabled={!ready}
          aria-label="校园步行导航"
          aria-expanded={routeOpen}
          onClick={() => {
            setSearchOpen(false);
            setLayersOpen(false);
            if (routeOpen) {
              void showEndpoints(null, null);
              setPicking(null);
              showRoute(null);
              setRouteEnd(null);
            }
            setRouteOpen((v) => !v);
          }}
        >
          <Navigation size={20} />
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
      <PlaceDetails
        finalFocus={searchInput}
        place={
          selected
            ? {
                id: selected.id,
                name: selected.name,
                subtitle: `白云山校区 · ${categories[selected.category as keyof typeof categories]}`,
              }
            : null
        }
        onClose={() => {
          setSelected(null);
          native.current?.setFilter("selected", [
            "==",
            ["get", "sourceId"],
            "",
          ]);
        }}
        onNavigate={() => {
          if (selected) {
            showRoute(null);
            native.current?.setFilter("selected", [
              "==",
              ["get", "sourceId"],
              "",
            ]);
            setRouteEnd(selected);
            setSelected(null);
            setRouteOpen(true);
          }
        }}
      />
      {routeOpen && (
        <BaiyunNavigation
          key={routeEnd?.id || "new-route"}
          end={routeEnd}
          onWalking={setNavigating}
          onBearing={(value) =>
            native.current?.rotateTo(value, { duration: 600 })
          }
          onResumeFollow={() => {
            follow.current = true;
          }}
          onRoute={showRoute}
          onPosition={(p, accuracy) => void showPosition(p, accuracy)}
          onEndpoints={(start, end) => void showEndpoints(start, end)}
          onPick={(which, selected) => {
            native.current?.setMaxBounds(null);
            native.current?.setMinZoom(0);
            setPicking({ which, selected });
          }}
          onClose={() => {
            setPicking(null);
            void showEndpoints(null, null);
            setRouteOpen(false);
            setRouteEnd(null);
            showRoute(null);
          }}
        />
      )}
      {notice && !/定位|权限/.test(notice) && (
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
