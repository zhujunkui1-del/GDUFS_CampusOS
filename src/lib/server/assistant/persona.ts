import { z } from "zod";
import type { StoredMessage } from "@/domain/agent/assistant-contracts";
export const PERSONA_VERSION = "campus-dafeiyu-v1";
export const PersonaPreferenceSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    intensity: z.enum(["normal", "cute"]),
    concise: z.boolean(),
  })
  .strict();
export type PersonaPreference = z.infer<typeof PersonaPreferenceSchema>;
export const defaultPersona = (): PersonaPreference => ({
  version: 1,
  enabled: true,
  intensity: "normal",
  concise: false,
});
export type PersonaTone = "daily" | "professional" | "serious" | "off";
/** Parse only explicit controls. Preference data never becomes retrieval topic memory. */
export function personaControl(message: string, previous = defaultPersona()) {
  const preference = { ...previous };
  let changed = false;
  const controls =
    /(^|[，,。；;\n])\s*(?:请)?(正经点|别演了|关闭(?:人格|人设)(?:模式)?|恢复刚才的说话方式|恢复(?:人格|人设)(?:模式)?|可爱一点|少说废话)/g;
  const business = message
    .replace(controls, (_match, prefix: string, control: string) => {
      changed = true;
      if (/正经|别演|关闭/.test(control)) preference.enabled = false;
      else if (/恢复/.test(control)) preference.enabled = true;
      else if (/可爱/.test(control)) {
        preference.enabled = true;
        preference.intensity = "cute";
      } else preference.concise = true;
      return prefix;
    })
    .replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, "")
    .trim();
  return { preference, changed, business };
}
export function personaTone(
  message: string,
  preference: PersonaPreference,
): PersonaTone {
  if (
    /晕倒|昏迷|自杀|自伤|轻生|人身危险|有人跟踪|威胁|火灾|急救|报警|校园安全|受伤|胸痛|医疗|法律|诈骗|转账|投资|财务|正式|严肃|投诉|故障|诊断|报错|接口.{0,8}(?:失败|超时)|工具.{0,8}(?:错误|未登录)/.test(
      message,
    )
  )
    return "serious";
  if (!preference.enabled) return "off";
  if (
    /政策|规则|规定|制度|借阅|借书|选课|考试|奖学金|奖助|学籍|报名|办理|办事|流程|路线|导航|首席专家|任职|院长|校长|申请|材料|条件/.test(
      message,
    )
  )
    return "professional";
  return "daily";
}
export function personaContext(
  message: string,
  preference: PersonaPreference,
  history: StoredMessage[] = [],
) {
  const tone = personaTone(message, preference);
  const recent = history.filter((m) => m.role === "assistant").slice(-5);
  const aside =
    tone === "daily" &&
    !preference.concise &&
    recent.length >= 4 &&
    !recent.some((m) => /[（(].*(?:小鱼干|本鱼|泡泡).*[）)]/.test(m.text));
  return { version: PERSONA_VERSION, tone, aside, concise: preference.concise };
}
/** Added only to the final natural-language generation, identically for both model providers. */
export function personaPrompt(
  message: string,
  preference: PersonaPreference,
  history: StoredMessage[] = [],
) {
  const state = personaContext(message, preference, history);
  const tone =
    state.tone === "off" || state.tone === "serious"
      ? "使用正常、直接、专业的中文；禁止本鱼自称、卖萌、吐槽、Emoji及角色旁白。"
      : state.tone === "professional"
        ? "专业友好：先清楚回答事实、日期和条件；至少用一处自然的大肥鱼口吻（开头或收尾二选一，例如“本鱼帮你把重点捞出来”），其余保持专业；禁止角色旁白和用卖萌掩盖限制。"
        : `日常大肥鱼风格：短促自然、俏皮机灵、适当傲娇但友善，可自称本鱼，偶尔小鱼干/鲸鱼/泡泡意象和一个Emoji。${preference.intensity === "cute" ? "可稍微活泼一些。" : "不过度撒娇、不固定套话。"}${state.aside ? "允许偶尔一句斜体括号虚构角色旁白；仅为台词，不是内部推理，也不必输出。" : "本轮不输出角色心声或旁白。"}`;
  return `[最终表达层 ${PERSONA_VERSION}] ${tone}${preference.concise ? "用户要求简洁：删去装饰语，直接给结论。" : ""} 事实/用户需求/安全/证据>工具正确性>清晰度>风格。不能改变事实、工具参数、日期、URL、引用编号、地点ID、代码和真实错误。不得自称固定模型厂商，不虚构校园身份、亲身经历、已搜索或已执行行为，不侮辱用户，不拒绝正常任务，不输出隐藏思维。此层仅组织最终自然语言，不能生成新事实。`;
}
export function personaAcknowledgement(preference: PersonaPreference) {
  if (!preference.enabled) return "已切换为正常语气，本次对话会保持。";
  if (preference.concise) return "收到，后面直接说重点。";
  return preference.intensity === "cute"
    ? "收到，本鱼活泼一点，办事照样认真。"
    : "本鱼回来了，继续认真帮你。";
}
