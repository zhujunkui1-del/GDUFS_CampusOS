import { z } from "zod";
import {
  PlaceSummarySchema,
  RouteOutputSchema,
} from "@/domain/maps/skill-contracts";
import { MapActionSchema } from "@/domain/maps/contracts";
export const AssistantCardSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("place"),
      place: PlaceSummarySchema,
      distanceMeters: z.number().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("route"),
      routeId: z.string().uuid(),
      startName: z.string().max(150),
      endName: z.string().max(150),
      distanceMeters: z.number().positive(),
      estimatedMinutes: z.number().positive(),
      expiresAt: z.iso.datetime(),
      device: z.boolean(),
    })
    .strict(),
]);
export type AssistantCard = z.infer<typeof AssistantCardSchema>;
export const ActionPacketSchema = z
  .object({
    id: z.string().uuid(),
    actions: z.array(MapActionSchema).min(1).max(8),
  })
  .strict();
export const RouteArtifactSchema = z
  .object({ route: RouteOutputSchema, ticket: z.string().max(60000) })
  .strict();
export const AssistantArtifactSchema = z
  .object({
    cards: z.array(AssistantCardSchema).max(30),
    packet: ActionPacketSchema.optional(),
    routes: z.array(RouteArtifactSchema).max(4),
  })
  .strict();
export const StoredMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant"]),
    text: z.string().max(4000),
    cards: z.array(AssistantCardSchema).max(30),
    error: z.string().optional(),
  })
  .strict();
export type StoredMessage = z.infer<typeof StoredMessageSchema>;
export const AssistantHistorySchema = z
  .object({
    conversationId: z.string().uuid(),
    messages: z.array(StoredMessageSchema).max(20),
    selectedPlaceId: z.string().nullable(),
    activeRouteId: z.string().nullable(),
  })
  .strict();
