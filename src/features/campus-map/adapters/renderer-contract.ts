import type { LocalMapAdapter } from "./local-map-adapter";
import type { Coordinate } from "../data/campus";

// Business capabilities stay identical; SDK-specific objects are not the contract.
export type CampusRenderer = Omit<LocalMapAdapter, "native" | "map"> & {
  supports2_5D: boolean;
  native: {
    on(
      name: string,
      listener: (event: { originalEvent?: unknown }) => void,
    ): unknown;
  };
  map: {
    on(name: string, listener: () => void): unknown;
    getZoom(): number;
    getRotation(): number;
    setZoom(value: number): void;
    setRotation(value: number): void;
    setZoomAndCenter(value: number, center: Coordinate): void;
  };
};
