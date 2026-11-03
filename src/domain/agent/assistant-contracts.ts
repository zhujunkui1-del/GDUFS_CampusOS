import { z } from "zod";
import {
  PlaceSummarySchema,
  RouteOutputSchema,
} from "@/domain/maps/skill-contracts";
import { MapActionSchema } from "@/domain/maps/contracts";
export const AssistantCardSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("external_source"),
      title: z.string().max(250),
      sourceName: z.string().max(160),
      originalUrl: z.url().refine((v) => /^https:\/\//.test(v)),
      publishedAt: z.string().nullable(),
      snippet: z.string().max(700),
      authority: z.enum(["official", "student_experience", "unverified"]),
      evidenceKind: z.enum(["page_excerpt", "search_excerpt", "title_only"]),
      searchMode: z.enum(["web", "platform", "public_web"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("source"),
      documentId: z.string(),
      title: z.string().max(250),
      sourceName: z.string().max(250),
      originalUrl: z.url().refine((v) => /^https?:\/\//.test(v)),
      publishedAt: z.string().nullable(),
      snippet: z.string().max(800),
      evidenceType: z.enum(["full_text", "excerpt", "metadata"]),
      classificationState: z.enum(["knowledge", "radar", "unknown"]),
      validity: z.enum(["current", "historical", "expired", "unknown"]),
      readable: z.boolean(),
      calendarLinks: z
        .array(
          z.object({
            title: z.string().max(250),
            href: z
              .string()
              .regex(
                /^\/calendar\?date=\d{4}-\d{2}-\d{2}&event=event-[a-f0-9]{40}$/,
              ),
          }),
        )
        .max(6)
        .optional(),
    })
    .strict(),
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
    text: z.string().max(200000),
    cards: z.array(AssistantCardSchema).max(30),
    error: z.string().optional(),
    sequence: z.number().int().positive().optional(),
  })
  .strict();
export type StoredMessage = z.infer<typeof StoredMessageSchema>;
export const AssistantHistorySchema = z
  .object({
    smartSearch: z.boolean().optional(),
    smartSearchVersion: z.number().int().nonnegative().optional(),
    conversationId: z.string().uuid(),
    messages: z.array(StoredMessageSchema),
    selectedPlaceId: z.string().nullable(),
    activeRouteId: z.string().nullable(),
    title: z.string().max(48).optional(),
    olderCursor: z.number().int().positive().nullable().optional(),
    latestSequence: z.number().int().nonnegative().optional(),
    hasMoreUpdates: z.boolean().optional(),
  })
  .strict();
export const ConversationSummarySchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().max(48),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
export const ConversationListSchema = z
  .object({
    conversations: z.array(ConversationSummarySchema).max(20),
    nextCursor: z.string().nullable(),
  })
  .strict();
// An older open browser tab uses strict response schemas. New clients opt in
// to the title field; both forms still use identical server ownership checks.
export function historyForClient(
  history: z.infer<typeof AssistantHistorySchema>,
  expanded: boolean,
  paginated = false,
  preferences = false,
) {
  return {
    conversationId: history.conversationId,
    ...(preferences
      ? {
          smartSearch: history.smartSearch ?? false,
          smartSearchVersion: history.smartSearchVersion ?? 0,
        }
      : {}),
    messages: paginated
      ? history.messages
      : history.messages.map((message) => {
          const legacy = { ...message, text: message.text.slice(0, 4000) };
          delete legacy.sequence;
          return legacy;
        }),
    selectedPlaceId: history.selectedPlaceId,
    activeRouteId: history.activeRouteId,
    ...(expanded ? { title: history.title } : {}),
    ...(paginated
      ? {
          olderCursor: history.olderCursor,
          latestSequence: history.latestSequence,
          hasMoreUpdates: history.hasMoreUpdates,
        }
      : {}),
  };
}
