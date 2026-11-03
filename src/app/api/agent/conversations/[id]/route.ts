import {
  historyGet,
  conversationDelete,
  conversationPatch,
} from "@/lib/server/assistant/api";
export const dynamic = "force-dynamic";
export const GET = historyGet;
export const DELETE = conversationDelete;
export const PATCH = conversationPatch;
