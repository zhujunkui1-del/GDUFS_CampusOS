import type { StoredMessage } from "@/domain/agent/assistant-contracts";
export type ConversationView = {
  id?: string;
  title: string;
  messages: StoredMessage[];
};
export const blankConversation = (): ConversationView => ({
  title: "新对话",
  messages: [],
});
export const conversationTitle = (text: string) =>
  Array.from(text.replace(/\s+/g, " ").trim()).slice(0, 48).join("") ||
  "新对话";
export const afterConversationDelete = (view: ConversationView, id: string) =>
  view.id === id ? blankConversation() : view;
export const acceptsConversationResult = (
  started: number,
  current: number,
  aborted = false,
) => started === current && !aborted;
