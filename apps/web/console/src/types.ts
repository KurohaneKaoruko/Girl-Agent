export type ProviderPreset = {
  id: string;
  name: string;
  apiBase: string;
  supportsMultiKey: boolean;
};

export type AppBootstrap = {
  appName: string;
  appVersion: string;
  providerPresets: ProviderPreset[];
};

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ProviderConfig = {
  id: string;
  displayName: string;
  providerKind: string;
  apiBase: string;
  keys: string[];
  enabled: boolean;
};

export type CreateProviderRequest = {
  displayName: string;
  providerKind: string;
  apiBase: string;
  keys: string[];
  enabled: boolean;
};

export type UpdateProviderRequest = CreateProviderRequest;

export type ModelCategory = "llm" | "vlm" | "asr" | "tts";

export type ModelCapabilities = {
  inputModes: string[];
  outputModes: string[];
  supportsFunctionCall: boolean;
  supportsStreaming: boolean;
  maxContextWindow: number | null;
};

export type ModelParams = {
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
};

export type CustomProvider = {
  apiBase: string;
  apiKey: string;
};

export type ModelConfig = {
  id: string;
  name: string;
  providerRef: string | null;
  customProvider: CustomProvider | null;
  modelId: string;
  category: ModelCategory;
  capabilities: ModelCapabilities;
  params: ModelParams;
  enabled: boolean;
};

export type CreateModelRequest = Omit<ModelConfig, "id">;
export type UpdateModelRequest = CreateModelRequest;

export type AgentMode = "chat" | "ambient";

export type ComponentSlot = {
  asrModelId: string | null;
  ttsModelId: string | null;
  visionModelId: string | null;
};

export type ToolSlot = {
  plannerModelId: string | null;
  executorModelId: string | null;
};

export type DecisionSlot = {
  modelId: string | null;
  enabled: boolean;
};

export type AgentConfig = {
  id: string;
  name: string;
  persona: string;
  speechRules: string;
  mode: AgentMode;
  modelSlots: {
    component: ComponentSlot;
    tool: ToolSlot;
    reply: { modelId: string };
    decision: DecisionSlot;
  };
};

export type CreateAgentRequest = {
  name: string;
  persona: string;
  speechRules: string;
  mode: AgentMode;
  componentSlot: ComponentSlot;
  toolSlot: ToolSlot;
  replyModelId: string;
  decisionSlot: DecisionSlot;
};

export type UpdateAgentRequest = CreateAgentRequest;

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatMessageRole;
  content: string;
};

export type ChatWithAgentRequest = {
  agentId: string;
  userMessage: string;
  history: ChatMessage[];
  temperature: number | null;
  maxTokens: number | null;
};

export type ChatWithAgentResponse = {
  agentId: string;
  modelRefId: string;
  modelId: string;
  message: string;
};

export type TabKey = "provider" | "model" | "agent" | "chat";
