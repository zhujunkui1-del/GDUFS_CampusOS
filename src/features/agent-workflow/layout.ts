import { z } from "zod";
import { workflowNodes } from "./graph";
export const layoutKey = "campusos.agent.layout.v1";
export const minWorkflowZoom = 0.125;
const point = z.object({ x: z.number(), y: z.number() });
export const layoutSchema = z.object({
  positions: z.record(z.string(), point),
  zoom: z.number().min(minWorkflowZoom).max(1.6),
  offset: point,
  inspectorWidth: z.number().min(280).max(900),
});
export type WorkflowLayout = z.infer<typeof layoutSchema>;
export const defaultPositions: Record<string, { x: number; y: number }> =
  Object.fromEntries(
    workflowNodes.map((node) => [node.id, { x: node.x, y: node.y }]),
  );
export function fitPositions(
  positions: WorkflowLayout["positions"],
  width: number,
  height: number,
) {
  const ps = Object.values(positions),
    left = Math.min(...ps.map((p) => p.x)),
    top = Math.min(...ps.map((p) => p.y));
  const w = Math.max(...ps.map((p) => p.x + 185)) - left,
    h = Math.max(...ps.map((p) => p.y + 112)) - top;
  const zoom = Math.max(
    minWorkflowZoom,
    Math.min(1.6, (width - 48) / w, (height - 48) / h),
  );
  return { zoom, offset: { x: 24 - left * zoom, y: 24 - top * zoom } };
}
export function readLayout(raw: string | null) {
  if (!raw) return null;
  const parsed = layoutSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    positions: Object.fromEntries(
      workflowNodes.map((node) => [
        node.id,
        parsed.data.positions[node.id] || defaultPositions[node.id],
      ]),
    ),
  };
}
