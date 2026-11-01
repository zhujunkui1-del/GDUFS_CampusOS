"use client";
import {
  useEffect,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from "react";

export const routeSheetMediaQuery =
  "(max-width: 760px), (max-width: 1024px) and (max-height: 500px)";
const minimum = 88;
export function useRouteSheet() {
  const panel = useRef<HTMLElement>(null);
  const attach = useCallback((element: HTMLElement | null) => {
    panel.current = element;
  }, []);
  const compact = useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(routeSheetMediaQuery);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => window.matchMedia(routeSheetMediaQuery).matches,
    () => false,
  );
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  const drag = useRef<{ y: number; height: number; distance: number } | null>(
    null,
  );
  const ignoreClick = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const maximum = () => {
    let limit = Math.min(window.innerHeight * 0.56, window.innerHeight - 150);
    const heading =
        panel.current?.querySelector<HTMLElement>(".results-heading"),
      body = panel.current?.querySelector<HTMLElement>(".route-planner-scroll"),
      content = panel.current?.querySelector<HTMLElement>(
        ".route-planner-content",
      );
    if (heading && body && content) {
      const h = getComputedStyle(heading),
        b = getComputedStyle(body);
      const natural =
        heading.offsetHeight +
        (parseFloat(h.marginTop) || 0) +
        (parseFloat(h.marginBottom) || 0) +
        content.scrollHeight +
        (parseFloat(b.paddingTop) || 0) +
        (parseFloat(b.paddingBottom) || 0) +
        2;
      limit = Math.min(limit, natural);
    }
    const map = document.querySelector<HTMLElement>(
      '[data-testid="campus-map"]',
    );
    if (map?.dataset.routeExtent && panel.current) {
      try {
        const extent: number[] = JSON.parse(map.dataset.routeExtent);
        const zoom = Number(map.dataset.zoom),
          floor = Number(map.dataset.minZoom);
        const routeHeight =
          Math.abs(Number(map.dataset.bearing)) < 1
            ? extent[3] - extent[1]
            : Math.hypot(extent[3] - extent[1], extent[2] - extent[0]);
        const top =
          document.querySelector(".map-top")?.getBoundingClientRect().bottom ||
          110;
        // Reserve endpoint space at the existing coverage-constrained minimum zoom.
        const fit =
          panel.current.getBoundingClientRect().bottom -
          top -
          60 -
          routeHeight * 2 ** (floor - zoom) * 1.2;
        if (Number.isFinite(fit)) limit = Math.min(limit, fit);
      } catch {
        /* A route may be clearing between layout observations. */
      }
    }
    return Math.max(minimum, limit);
  };
  const write = (height: number) =>
    panel.current?.style.setProperty("--route-panel-height", `${height}px`);
  const settle = (next: boolean) => {
    collapsedRef.current = next;
    setCollapsed(next);
    if (!panel.current) return;
    panel.current.setAttribute("data-resizing", "true");
    write(next ? minimum : maximum());
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      panel.current?.removeAttribute("data-resizing");
    }, 350);
  };
  useEffect(() => {
    const resize = () => {
      if (compact) write(collapsedRef.current ? minimum : maximum());
      else panel.current?.style.removeProperty("--route-panel-height");
    };
    resize();
    const contentObserver = new ResizeObserver(resize);
    const content = panel.current?.querySelector(".route-planner-content");
    if (content) contentObserver.observe(content);
    window.addEventListener("resize", resize);
    const map = document.querySelector<HTMLElement>(
      '[data-testid="campus-map"]',
    );
    let layoutFrame = 0;
    const layout = new MutationObserver(() => {
      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => {
        if (
          !compact ||
          collapsedRef.current ||
          drag.current ||
          map?.dataset.cameraMoving !== "false" ||
          !panel.current
        )
          return;
        const limit = maximum();
        if (panel.current.getBoundingClientRect().height > limit + 2) {
          panel.current.setAttribute("data-resizing", "true");
          write(limit);
          clearTimeout(timer.current);
          timer.current = setTimeout(
            () => panel.current?.removeAttribute("data-resizing"),
            350,
          );
        }
      });
    });
    if (map)
      layout.observe(map, {
        attributes: true,
        attributeFilter: [
          "data-route-extent",
          "data-zoom",
          "data-camera-moving",
        ],
      });
    return () => {
      window.removeEventListener("resize", resize);
      clearTimeout(timer.current);
      layout.disconnect();
      contentObserver.disconnect();
      cancelAnimationFrame(layoutFrame);
    };
  }, [compact]);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (
      !compact ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("[data-route-close]")
    )
      return;
    event.preventDefault();
    ignoreClick.current = false;
    (
      (event.target as HTMLElement).closest(".route-drawer-handle") ||
      event.currentTarget
    ).setPointerCapture(event.pointerId);
    drag.current = {
      y: event.clientY,
      height: panel.current!.getBoundingClientRect().height,
      distance: 0,
    };
    panel.current!.setAttribute("data-dragging", "true");
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.distance = event.clientY - drag.current.y;
    write(
      Math.max(
        minimum,
        Math.min(maximum(), drag.current.height - drag.current.distance),
      ),
    );
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const moved = Math.abs(drag.current.distance) > 4;
    const height = panel.current!.getBoundingClientRect().height;
    ignoreClick.current =
      moved && !!(event.target as HTMLElement).closest(".route-drawer-handle");
    drag.current = null;
    panel.current!.removeAttribute("data-dragging");
    if (moved) settle(height < (minimum + maximum()) / 2);
  };
  return {
    attach,
    compact,
    collapsed,
    header: {
      onPointerDown: down,
      onPointerMove: move,
      onPointerUp: up,
      onPointerCancel: up,
    },
    toggle: (event: { detail: number }) => {
      if (ignoreClick.current && event.detail !== 0) {
        ignoreClick.current = false;
        return;
      }
      ignoreClick.current = false;
      settle(!collapsedRef.current);
    },
    expand: () => settle(false),
    collapse: () => settle(true),
  };
}
