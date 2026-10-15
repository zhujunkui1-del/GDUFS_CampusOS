import { z } from "zod";
const CoordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

export const AgentChatRequestSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    clientRequestId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(2000),
    mapContext: z
      .object({
        selectedPlaceId: z.string().min(1).max(128).optional(),
        activeRouteId: z.string().min(1).max(128).nullable().optional(),
        routeTicket: z.string().max(60000).optional(),
        mode: z.enum(["2d", "2.5d", "3d"]).optional(),
        visibleLayers: z
          .array(z.enum(["buildings", "sports", "dormitories", "services"]))
          .max(4)
          .optional(),
        viewport: z
          .object({ center: CoordinateSchema, zoom: z.number().min(3).max(20) })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    locationGrant: z
      .object({
        challenge: z.string().min(20).max(100),
        coordinate: CoordinateSchema,
        accuracyMeters: z.number().min(0).max(100),
        capturedAt: z.number().int(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AgentChatRequest = z.infer<typeof AgentChatRequestSchema>;
export const AgentEventSchema = z
  .object({
    runId: z.string().uuid(),
    eventId: z.string().min(1),
    timestamp: z.iso.datetime(),
    type: z.enum([
      "message.delta",
      "tool.started",
      "tool.finished",
      "artifact.ready",
      "confirmation.required",
      "run.completed",
      "run.failed",
    ]),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export function encodeAgentEvent(event: AgentEvent) {
  const valid = AgentEventSchema.parse(event);
  return `id: ${valid.eventId}\nevent: ${valid.type}\ndata: ${JSON.stringify(valid)}\n\n`;
}
