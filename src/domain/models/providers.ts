export type ModelProviderId =
  | "zhipu"
  | "kimi"
  | "deepseek"
  | "doubao"
  | "minimax"
  | "xiaomi"
  | "longcat"
  | "claude"
  | "openrouter"
  | "chatgpt"
  | "gemini"
  | "copilot"
  | "custom";

export type ModelProtocol = "openai" | "anthropic" | "gemini";

export type ModelProvider = {
  id: ModelProviderId;
  label: string;
  vendor: string;
  protocol: ModelProtocol;
  baseUrl: string;
  model: string;
  /** Some vendors require a deployment/endpoint id instead of a model name. */
  modelHint?: string;
};

export const MODEL_PROVIDERS: readonly ModelProvider[] = [
  {
    id: "zhipu",
    label: "智谱 GLM",
    vendor: "智谱",
    protocol: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
  },
  {
    id: "kimi",
    label: "Kimi",
    vendor: "月之暗面",
    protocol: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    vendor: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  {
    id: "doubao",
    label: "豆包",
    vendor: "火山方舟",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
    modelHint: "填写方舟推理接入点 ID（ep-...）",
  },
  {
    id: "minimax",
    label: "MiniMax",
    vendor: "MiniMax",
    protocol: "openai",
    baseUrl: "https://api.minimax.chat/v1",
    model: "MiniMax-Text-01",
  },
  {
    id: "xiaomi",
    label: "小米 MiMo",
    vendor: "Xiaomi",
    protocol: "openai",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-7b-rl",
  },
  {
    id: "longcat",
    label: "LongCat",
    vendor: "LongCat",
    protocol: "openai",
    baseUrl: "https://api.longcat.chat/openai/v1",
    model: "LongCat-Flash-Chat",
  },
  {
    id: "claude",
    label: "Claude",
    vendor: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    vendor: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    vendor: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    id: "gemini",
    label: "Gemini",
    vendor: "Google",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.0-flash",
  },
  {
    id: "copilot",
    label: "Copilot",
    vendor: "GitHub",
    protocol: "openai",
    baseUrl: "https://models.inference.ai.azure.com",
    model: "gpt-4o-mini",
  },
  {
    id: "custom",
    label: "自定义模型",
    vendor: "手动填写",
    protocol: "openai",
    baseUrl: "",
    model: "",
    modelHint: "填写 OpenAI Chat Completions 兼容的模型名",
  },
];

export const MODEL_PROVIDER_IDS = MODEL_PROVIDERS.map((p) => p.id);

export function providerById(id: string) {
  return MODEL_PROVIDERS.find((p) => p.id === id);
}
