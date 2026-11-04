import { BasicMapAdapter } from "./basic-map-adapter";
import { detectRenderCapability } from "./render-capability";
import type { CampusRenderer } from "./renderer-contract";

export async function createCampusRenderer(
  element: HTMLElement,
  signal: AbortSignal,
  basicOnly = false,
): Promise<CampusRenderer> {
  const start = performance.now();
  const capability = basicOnly ? null : detectRenderCapability();
  element.dataset.renderCapability = JSON.stringify(
    capability || { reason: "bounded-context-recovery" },
  );
  if (capability) element.dataset.renderProfile = capability.profile;
  if (capability?.webgl2 && capability.drawVerified) {
    try {
      const { LocalMapAdapter } = await import("./local-map-adapter");
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const map = await LocalMapAdapter.create(element, signal);
      element.dataset.renderer = "webgl2";
      element.dataset.renderProfile = capability.profile;
      element.dataset.interactiveMs = String(
        Math.round(performance.now() - start),
      );
      return map;
    } catch (error) {
      if (signal.aborted) throw error;
      element.dataset.renderFailure = "webgl-initialization";
    }
  }
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const map = new BasicMapAdapter(element);
  element.dataset.interactiveMs = String(Math.round(performance.now() - start));
  return map;
}
