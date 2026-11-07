import type { RouteOutputSchema } from "@/domain/maps/skill-contracts";
import type { z } from "zod";

type Route = z.infer<typeof RouteOutputSchema>;

/**
 * The map renders a route by drawing it. When the browser never acknowledges the
 * draw — offline tab, throttled background page, a client that dropped the
 * stream — the same computed route is still perfectly usable as words. This
 * renders only what plan_route already returned; it never invents a distance,
 * an entrance or a step.
 */
export function routeDirectionsText(route: Route): string {
  const steps = route.steps
    .map(
      (step, index) =>
        `${index + 1}. ${step.instruction}（${Math.round(step.distanceMeters)} 米）`,
    )
    .join("\n");
  return [
    `地图这边没能显示出来，先用文字给你指路：从${route.start.name}到${route.end.name}，步行约 ${Math.round(route.distanceMeters)} 米、约 ${route.estimatedMinutes} 分钟。`,
    steps,
    route.crossesZones ? "跨区路段要走下沉隧道。" : "",
    "需要的话我再试一次在地图上标出来。",
  ]
    .filter(Boolean)
    .join("\n");
}
