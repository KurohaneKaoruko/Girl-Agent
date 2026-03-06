export type ProviderPreset = {
  id: string;
  name: string;
  apiBase: string;
  supportsMultiKey: boolean;
};

export type AppBootstrap = {
  appName: string;
  appVersion: string;
  apiVersion: string;
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

export type RuntimeStatusResponse = {
  appName: string;
  appVersion: string;
  apiVersion: string;
  chatGatewayKind: string;
  providerCount: number;
  modelCount: number;
  agentCount: number;
  sessionCount: number;
  messageCount: number;
};

export type ProbeProviderConnectionRequest = {
  providerId: string;
};

export type ProbeProviderConnectionResponse = {
  providerId: string;
  reachable: boolean;
  latencyMs: number;
  detail: string;
};

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

export type ProbeModelConnectionRequest = {
  modelRefId: string;
};

export type ProbeModelConnectionResponse = {
  modelRefId: string;
  modelId: string;
  reachable: boolean;
  latencyMs: number;
  detail: string;
};

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

export type SlotParams = {
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
};

export type ComponentParamSlot = {
  asr: SlotParams;
  tts: SlotParams;
  vision: SlotParams;
};

export type ToolParamSlot = {
  planner: SlotParams;
  executor: SlotParams;
};

export type AgentParamSlots = {
  component: ComponentParamSlot;
  tool: ToolParamSlot;
  reply: SlotParams;
  decision: SlotParams;
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
  paramSlots: AgentParamSlots;
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
  paramSlots: AgentParamSlots;
};

export type UpdateAgentRequest = CreateAgentRequest;

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatMessageRole;
  content: string;
};

export type ChatWithAgentRequest = {
  agentId: string;
  sessionId: string | null;
  userMessage: string;
  history: ChatMessage[];
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
};

export type RegenerateChatReplyRequest = {
  agentId: string;
  sessionId: string | null;
  replaceLastAssistant: boolean;
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
};

export type UndoLastChatTurnRequest = {
  agentId: string;
  sessionId: string | null;
};

export type RewriteLastUserMessageRequest = {
  agentId: string;
  sessionId: string | null;
  userMessage: string;
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
};

export type RewriteChatUserMessageRequest = {
  agentId: string;
  sessionId: string | null;
  targetUserOffset: number;
  userMessage: string;
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
};

export type ChatWithAgentResponse = {
  agentId: string;
  sessionId: string;
  modelRefId: string;
  modelId: string;
  message: string;
};

export type UndoLastChatTurnResponse = {
  agentId: string;
  sessionId: string;
  removedCount: number;
};

export type ChatSession = {
  id: string;
  agentId: string;
  title: string;
  isDefault: boolean;
  isPinned: boolean;
  isArchived: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessageRole: ChatMessageRole | null;
  lastMessagePreview: string | null;
};

export type TabKey = "provider" | "model" | "agent" | "chat";
