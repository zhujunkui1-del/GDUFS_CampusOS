// Isolated SDK fixture. Used only via Playwright route interception, never bundled by the app.
(() => {
  const point = (p) => ({ getLng: () => p[0], getLat: () => p[1] });
  class Map {
    constructor(element, options) {
      this.element = element;
      this.zoom = options.zoom;
      this.pitch = options.pitch;
      this.rotation = 0;
      this.center = options.center;
      this.zooms = options.zooms || [2, 20];
      this.events = {};
      this.click = (event) => {
        const height = element.clientHeight;
        const p =
          event.clientY < height / 2
            ? [
                113.3917 + (event.clientX % 100) / 200000,
                23.0687 + (event.clientY % 100) / 200000,
              ]
            : [113.3905, 23.0628];
        this.emit("click", { lnglat: point(p) });
      };
      element.addEventListener("click", this.click);
    }
    emit(name, event = {}) {
      (this.events[name] || []).forEach((callback) => callback(event));
    }
    on(name, callback) {
      (this.events[name] ||= []).push(callback);
      if (name === "complete") setTimeout(() => callback({}), 10);
    }
    off(name, callback) {
      this.events[name] = (this.events[name] || []).filter(
        (item) => item !== callback,
      );
    }
    getZoom() {
      return this.zoom;
    }
    setZoom(value) {
      this.zoom = Math.max(this.zooms[0], Math.min(this.zooms[1], value));
      this.emit("zoomend");
    }
    getPitch() {
      return this.pitch;
    }
    setPitch(value) {
      this.pitch = value;
    }
    getRotation() {
      return this.rotation;
    }
    setRotation(value) {
      this.rotation = value;
    }
    getCenter() {
      return point(this.center);
    }
    getBounds() {
      return {
        getSouthWest: () =>
          point([this.center[0] - 0.01, this.center[1] - 0.01]),
        getNorthEast: () =>
          point([this.center[0] + 0.01, this.center[1] + 0.01]),
      };
    }
    setZooms(zooms) {
      this.zooms = zooms;
      this.setZoom(this.zoom);
    }
    setLimitBounds(bounds) {
      this.limitBounds = bounds;
    }
    clearLimitBounds() {
      this.limitBounds = null;
    }
    setZoomAndCenter(zoom, position) {
      this.center = position;
      this.setZoom(zoom);
    }
    setBounds(bounds) {
      this.center = [
        (bounds.sw[0] + bounds.ne[0]) / 2,
        (bounds.sw[1] + bounds.ne[1]) / 2,
      ];
      this.setZoom(16);
    }
    lngLatToContainer(coordinate) {
      const scale = 2 ** (this.zoom - 16);
      const angle = (this.rotation * Math.PI) / 180;
      const x = (coordinate[0] - this.center[0]) * 170000 * scale;
      const y = (this.center[1] - coordinate[1]) * 185000 * scale;
      return {
        getX: () =>
          this.element.clientWidth / 2 +
          x * Math.cos(angle) -
          y * Math.sin(angle),
        getY: () =>
          this.element.clientHeight / 2 +
          x * Math.sin(angle) +
          y * Math.cos(angle),
      };
    }
    add(overlays) {
      // Deterministic renderer fixture; this projection is not a campus screenshot.
      for (const overlay of Array.isArray(overlays) ? overlays : [overlays])
        overlay.setMap(this);
    }
    remove(overlays) {
      for (const overlay of Array.isArray(overlays) ? overlays : [overlays])
        overlay.setMap(null);
    }
    containerToLngLat(pixel) {
      const scale = 2 ** (this.zoom - 16),
        angle = (this.rotation * Math.PI) / 180;
      const x = pixel[0] - this.element.clientWidth / 2,
        y = pixel[1] - this.element.clientHeight / 2;
      return point([
        this.center[0] +
          (x * Math.cos(angle) + y * Math.sin(angle)) / (170000 * scale),
        this.center[1] -
          (-x * Math.sin(angle) + y * Math.cos(angle)) / (185000 * scale),
      ]);
    }
    destroy() {
      this.element.removeEventListener("click", this.click);
      this.element.replaceChildren();
      this.events = {};
    }
  }
  class Overlay {
    constructor(options) {
      this.options = options;
      this.element = options.content || document.createElement("span");
      this.element.style.position = "absolute";
    }
    setMap(map) {
      this.map = map;
      if (map) {
        map.element.append(this.element);
        const position = this.options.position || [113.391, 23.068];
        const pixel = map.lngLatToContainer(position);
        this.element.style.left = `${pixel.getX()}px`;
        this.element.style.top = `${pixel.getY()}px`;
      } else this.element.remove();
    }
    hide() {
      this.element.hidden = true;
    }
    show() {
      this.element.hidden = false;
    }
    setzIndex(value) {
      this.element.style.zIndex = value;
    }
  }
  window.AMap = {
    Map,
    Marker: Overlay,
    Polyline: Overlay,
    Polygon: Overlay,
    Bounds: class {
      constructor(sw, ne) {
        this.sw = sw;
        this.ne = ne;
      }
    },
    Pixel: class {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
    },
    plugin: (_names, callback) => callback(),
    convertFrom: (positions, _system, callback) =>
      callback("complete", { locations: positions.map(point) }),
    PlaceSearch: class {
      searchInBounds(_query, _bounds, callback) {
        callback("complete", {
          poiList: {
            pois: [
              {
                id: "fixture-outside",
                name: "隔离测试校外地点",
                location: point([0, 0]),
              },
            ],
          },
        });
      }
    },
    Walking: class {
      search(start, end, callback) {
        setTimeout(
          () =>
            callback("complete", {
              routes: [
                {
                  distance: 90,
                  time: 90,
                  steps: [
                    {
                      instruction: "隔离测试步行步骤",
                      distance: 90,
                      path: [
                        point(start),
                        point([(start[0] + end[0]) / 2, start[1]]),
                        point(end),
                      ],
                    },
                  ],
                },
              ],
            }),
          30,
        );
      }
    },
  };
})();
