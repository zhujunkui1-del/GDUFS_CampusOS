import type { StyleSpecification } from "maplibre-gl";

export function createLocalMapStyle(
  url: string,
  initialGeometry: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  },
  swimmingIds: string[] = [],
): StyleSpecification {
  return {
    version: 8,
    sources: {
      campus: { type: "geojson", data: url },
      initial: { type: "geojson", data: initialGeometry },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f2f1ec" },
      },
      {
        id: "initial-geometry",
        type: "fill",
        source: "initial",
        paint: {
          "fill-color": [
            "match",
            ["get", "kind"],
            "land",
            "#e5e9db",
            "#e0d8ce",
          ],
        },
      },
      {
        id: "land",
        type: "fill",
        source: "campus",
        filter: ["==", ["get", "kind"], "land"],
        paint: { "fill-color": "#eeede7" },
      },
      {
        id: "green",
        type: "fill",
        source: "campus",
        filter: ["==", ["get", "kind"], "green"],
        paint: { "fill-color": "#d5e3cf" },
      },
      {
        id: "water",
        type: "fill",
        source: "campus",
        filter: [
          "all",
          ["==", ["get", "kind"], "water"],
          ["==", ["geometry-type"], "Polygon"],
        ],
        paint: { "fill-color": "#bfdae2" },
      },
      {
        id: "sports",
        type: "fill",
        source: "campus",
        filter: [
          "all",
          ["==", ["get", "kind"], "sports"],
          ["==", ["geometry-type"], "Polygon"],
        ],
        paint: {
          "fill-color": [
            "case",
            ["in", ["get", "sourceId"], ["literal", swimmingIds]],
            "#bfdae2",
            [
              "match",
              ["get", "sport"],
              "soccer",
              "#b8d0a1",
              "basketball",
              "#d4b6a2",
              "tennis",
              "#b0c9bd",
              "#ccd3c0",
            ],
          ],
          "fill-outline-color": "#fafaf6",
        },
      },
      {
        id: "roads-outline",
        type: "line",
        source: "campus",
        filter: ["==", ["get", "kind"], "road"],
        paint: {
          "line-color": "#d7d5ce",
          "line-width": ["interpolate", ["linear"], ["zoom"], 15, 4, 19, 22],
        },
        layout: { "line-join": "round", "line-cap": "round" },
      },
      {
        id: "plazas",
        type: "fill",
        source: "campus",
        filter: ["==", ["get", "kind"], "plaza"],
        paint: { "fill-color": "#e9e9e5", "fill-outline-color": "#b9bcb9" },
      },
      {
        id: "parking",
        type: "fill",
        source: "campus",
        filter: ["==", ["get", "kind"], "parking"],
        paint: { "fill-color": "#e6e6e1", "fill-outline-color": "#b9bcb9" },
      },
      {
        id: "roads",
        type: "line",
        source: "campus",
        filter: ["==", ["get", "kind"], "road"],
        paint: {
          "line-color": "#fffef9",
          "line-width": ["interpolate", ["linear"], ["zoom"], 15, 2, 19, 18],
        },
        layout: { "line-join": "round", "line-cap": "round" },
      },
      {
        id: "buildings",
        type: "fill",
        source: "campus",
        filter: ["==", ["get", "kind"], "building"],
        paint: { "fill-color": "#e0d8ce", "fill-outline-color": "#bdb5aa" },
      },
      {
        id: "underground",
        type: "line",
        source: "campus",
        filter: ["==", ["get", "tunnel"], "yes"],
        paint: {
          "line-color": "#7c8894",
          "line-width": 4,
          "line-dasharray": [2, 2],
        },
      },
      {
        id: "selected",
        type: "fill",
        source: "campus",
        filter: ["==", ["get", "sourceId"], ""],
        paint: {
          "fill-color": "#1261bb",
          "fill-opacity": 0.35,
          "fill-outline-color": "#1261bb",
        },
      },
    ],
  };
}
