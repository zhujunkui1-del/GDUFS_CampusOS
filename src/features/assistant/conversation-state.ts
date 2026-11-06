import type { StoredMessage } from "@/domain/agent/assistant-contracts";
export type ConversationView = {
  id?: string;
  title: string;
  messages: StoredMessage[];
  smartSearch?: boolean;
  smartSearchVersion?: number;
  deepThinking?: boolean;
  deepThinkingVersion?: number;
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
    deepThinking?: boolean;
    deepThinkingVersion?: number;
  },
  writing: boolean,
  writingDeepThinking = false,
) {
  const sameConversation = prior.id === incoming.conversationId;
  const preserveSearch =
    sameConversation &&
    (writing ||
      (prior.smartSearchVersion ?? 0) > (incoming.smartSearchVersion ?? 0));
  const preserveDeepThinking =
    sameConversation &&
    (writingDeepThinking ||
      (prior.deepThinkingVersion ?? 0) >
        (incoming.deepThinkingVersion ?? 0));
  return {
    smartSearch: preserveSearch
      ? (prior.smartSearch ?? false)
      : (incoming.smartSearch ?? false),
    smartSearchVersion: preserveSearch
      ? (prior.smartSearchVersion ?? 0)
      : (incoming.smartSearchVersion ?? 0),
    deepThinking: preserveDeepThinking
      ? (prior.deepThinking ?? false)
      : (incoming.deepThinking ?? false),
    deepThinkingVersion: preserveDeepThinking
      ? (prior.deepThinkingVersion ?? 0)
      : (incoming.deepThinkingVersion ?? 0),
  };
}
