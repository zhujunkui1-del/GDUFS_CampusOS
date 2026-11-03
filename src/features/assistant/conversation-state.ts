import type { StoredMessage } from "@/domain/agent/assistant-contracts";
export type ConversationView = {
  id?: string;
  title: string;
  messages: StoredMessage[];
  smartSearch?: boolean;
  smartSearchVersion?: number;
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

export function restoredSearchPreference(
  prior: ConversationView,
  incoming: {
    conversationId: string;
    smartSearch?: boolean;
    smartSearchVersion?: number;
  },
  writing: boolean,
) {
  return prior.id === incoming.conversationId &&
    (writing ||
      (prior.smartSearchVersion ?? 0) > (incoming.smartSearchVersion ?? 0))
    ? {
        smartSearch: prior.smartSearch ?? false,
        smartSearchVersion: prior.smartSearchVersion ?? 0,
      }
    : {
        smartSearch: incoming.smartSearch ?? false,
        smartSearchVersion: incoming.smartSearchVersion ?? 0,
      };
}
