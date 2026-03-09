// Generated from app Rust contracts/domain sources. Do not edit by hand.

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

export type CreateProviderRequest = {
  displayName: string;
  providerKind: string;
  apiBase: string;
  keys: string[];
  enabled: boolean;
};

export type UpdateProviderRequest = {
  displayName: string;
  providerKind: string;
  apiBase: string;
  keys: string[];
  enabled: boolean;
};

export type CreateModelRequest = {
  name: string;
  providerRef: string | null;
  customProvider: CustomProvider | null;
  modelId: string;
  category: ModelCategory;
  categories: ModelCategory[];
  capabilities: ModelCapabilities;
  params: ModelParams;
  enabled: boolean;
};

export type UpdateModelRequest = {
  name: string;
  providerRef: string | null;
  customProvider: CustomProvider | null;
  modelId: string;
  category: ModelCategory;
  categories: ModelCategory[];
  capabilities: ModelCapabilities;
  params: ModelParams;
  enabled: boolean;
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

export type UpdateAgentRequest = {
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

export type CreateChatSessionRequest = {
  title: string;
};

export type RenameChatSessionRequest = {
  title: string;
};

export type DuplicateChatSessionRequest = {
  title: string;
};

export type SetChatSessionPinnedRequest = {
  pinned: boolean;
};

export type SetChatSessionArchivedRequest = {
  archived: boolean;
};

export type SetChatSessionTagsRequest = {
  tags: string[];
};

export type RuntimeStats = {
  providerCount: number;
  modelCount: number;
  agentCount: number;
  sessionCount: number;
  messageCount: number;
};

export type CreateWorkspaceChatSessionRequest = {
  title: string;
  participants: WorkspaceChatParticipant[];
};

export type UpdateWorkspaceChatSessionRequest = {
  title: string;
  participants: WorkspaceChatParticipant[];
  isPinned: boolean;
  isArchived: boolean;
  tags: string[];
};

export type ChatWithSessionRequest = {
  sessionId: string;
  userMessage: string;
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
};

export type ChatWithSessionResponse = {
  sessionId: string;
  replies: WorkspaceChatReply[];
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

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export type ProviderConfig = {
  id: string;
  displayName: string;
  providerKind: string;
  apiBase: string;
  keys: string[];
  enabled: boolean;
};

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
  categories: ModelCategory[];
  capabilities: ModelCapabilities;
  params: ModelParams;
  enabled: boolean;
};

export type ComponentSlot = {
  asrModelId: string | null;
  ttsModelId: string | null;
  visionModelId: string | null;
};

export type ToolSlot = {
  plannerModelId: string | null;
  executorModelId: string | null;
};

export type ReplySlot = {
  modelId: string;
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

export type AgentModelSlots = {
  component: ComponentSlot;
  tool: ToolSlot;
  reply: ReplySlot;
  decision: DecisionSlot;
};

export type AgentConfig = {
  id: string;
  name: string;
  persona: string;
  speechRules: string;
  mode: AgentMode;
  modelSlots: AgentModelSlots;
  paramSlots: AgentParamSlots;
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
  lastMessageRole: string | null;
  lastMessagePreview: string | null;
};

export type WorkspaceChatParticipant = {
  agentId: string;
  receiveMode: WorkspaceChatParticipantMode;
  replyMode: WorkspaceChatParticipantMode;
  sortOrder: number;
};

export type WorkspaceChatSession = {
  id: string;
  title: string;
  participants: WorkspaceChatParticipant[];
  isGroup: boolean;
  isPinned: boolean;
  isArchived: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessageRole: string | null;
  lastMessagePreview: string | null;
};

export type WorkspaceChatMessage = {
  role: WorkspaceChatMessageRole;
  content: string;
  agentId: string | null;
  visibleToAgentIds: string[];
  createdAt: string;
};

export type WorkspaceChatReply = {
  agentId: string;
  agentName: string;
  modelRefId: string;
  modelId: string;
  message: string;
};

export type ModelCategory = "llm" | "vlm" | "asr" | "tts";

export type AgentMode = "chat" | "ambient";

export type WorkspaceChatParticipantMode = "all" | "mention";

export type WorkspaceChatMessageRole = "system" | "user" | "assistant" | "tool";

export type NetworkBindingConfig = {
  id: string;
  name: string;
  enabled: boolean;
  transportKind: NetworkTransportKind;
  bindHost: string | null;
  bindPort: number | null;
  targetUrl: string | null;
  agentId: string;
  sessionMode: NetworkSessionMode;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreateNetworkBindingRequest = {
  name: string;
  enabled: boolean;
  transportKind: NetworkTransportKind;
  bindHost: string | null;
  bindPort: number | null;
  targetUrl: string | null;
  agentId: string;
  sessionMode: NetworkSessionMode;
  metadata: Record<string, unknown>;
};

export type NetworkBindingRuntimeStatus = {
  bindingId: string;
  name: string;
  enabled: boolean;
  transportKind: NetworkTransportKind;
  agentId: string;
  state: NetworkBindingRuntimeState;
  running: boolean;
  detail: string;
  lastError: string | null;
  lastActivityAtMs: number | null;
};

export type SessionOpenRequest = {
  requestId: string;
  externalSessionId: string | null;
  metadata: Record<string, unknown>;
};

export type SessionCloseRequest = {
  requestId: string;
  externalSessionId: string | null;
};

export type MessageCreateRequest = {
  requestId: string;
  externalSessionId: string | null;
  input: string;
  system: string | null;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  stream: boolean;
};

export type SessionOpenedEvent = {
  requestId: string;
  externalSessionId: string;
  internalSessionId: string;
};

export type SessionClosedEvent = {
  requestId: string;
  externalSessionId: string;
};

export type MessageChunkEvent = {
  requestId: string;
  externalSessionId: string;
  chunk: string;
};

export type MessageCompletedEvent = {
  requestId: string;
  externalSessionId: string;
  internalSessionId: string;
  modelRefId: string;
  modelId: string;
  message: string;
};

export type BindingErrorEvent = {
  requestId: string;
  code: string;
  message: string;
};

export type NetworkTransportKind = "http_server" | "http_client" | "websocket_server" | "websocket_client";

export type NetworkSessionMode = "shared" | "external_session";

export type NetworkBindingRuntimeState = "stopped" | "starting" | "connecting" | "running" | "error" | "unsupported";

export type UpdateNetworkBindingRequest = CreateNetworkBindingRequest;
