import { invoke } from "@tauri-apps/api/core";
import type {
  AgentConfig,
  ApiError,
  AppBootstrap,
  ChatMessage,
  ChatSession,
  ChatWithAgentRequest,
  ChatWithAgentResponse,
  ChatWithSessionRequest,
  ChatWithSessionResponse,
  CreateAgentRequest,
  CreateModelRequest,
  CreateProviderRequest,
  CreateWorkspaceChatSessionRequest,
  ModelConfig,
  ProbeModelConnectionRequest,
  ProbeModelConnectionResponse,
  ProbeProviderConnectionRequest,
  ProbeProviderConnectionResponse,
  ProviderConfig,
  RegenerateChatReplyRequest,
  RewriteChatUserMessageRequest,
  RewriteLastUserMessageRequest,
  RuntimeStatusResponse,
  UndoLastChatTurnRequest,
  UndoLastChatTurnResponse,
  UpdateAgentRequest,
  UpdateModelRequest,
  UpdateProviderRequest,
  UpdateWorkspaceChatSessionRequest,
  WorkspaceChatMessage,
  WorkspaceChatReply,
  WorkspaceChatSession,
} from "@/types";

export type ApiClient = {
  getBootstrap(): Promise<AppBootstrap>;
  getRuntimeStatus(): Promise<RuntimeStatusResponse>;
  listProviders(): Promise<ProviderConfig[]>;
  createProvider(input: CreateProviderRequest): Promise<ProviderConfig>;
  updateProvider(id: string, input: UpdateProviderRequest): Promise<ProviderConfig>;
  deleteProvider(id: string): Promise<void>;
  probeProviderConnection(
    input: ProbeProviderConnectionRequest,
  ): Promise<ProbeProviderConnectionResponse>;
  listModels(): Promise<ModelConfig[]>;
  createModel(input: CreateModelRequest): Promise<ModelConfig>;
  updateModel(id: string, input: UpdateModelRequest): Promise<ModelConfig>;
  deleteModel(id: string): Promise<void>;
  probeModelConnection(input: ProbeModelConnectionRequest): Promise<ProbeModelConnectionResponse>;
  listAgents(): Promise<AgentConfig[]>;
  createAgent(input: CreateAgentRequest): Promise<AgentConfig>;
  updateAgent(id: string, input: UpdateAgentRequest): Promise<AgentConfig>;
  deleteAgent(id: string): Promise<void>;
  listWorkspaceChatSessions(): Promise<WorkspaceChatSession[]>;
  createWorkspaceChatSession(input: CreateWorkspaceChatSessionRequest): Promise<WorkspaceChatSession>;
  updateWorkspaceChatSession(
    sessionId: string,
    input: UpdateWorkspaceChatSessionRequest,
  ): Promise<WorkspaceChatSession>;
  deleteWorkspaceChatSession(sessionId: string): Promise<void>;
  listWorkspaceChatMessages(sessionId: string): Promise<WorkspaceChatMessage[]>;
  clearWorkspaceChatMessages(sessionId: string): Promise<void>;
  chatWithSession(input: ChatWithSessionRequest): Promise<ChatWithSessionResponse>;
  chatWithSessionStream(
    input: ChatWithSessionRequest,
    onReplyStart: (reply: Omit<WorkspaceChatReply, "message">) => void,
    onDelta: (agentId: string, chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatWithSessionResponse>;
  chatWithAgent(input: ChatWithAgentRequest): Promise<ChatWithAgentResponse>;
  chatWithAgentStream(
    input: ChatWithAgentRequest,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatWithAgentResponse>;
  regenerateChatReply(input: RegenerateChatReplyRequest): Promise<ChatWithAgentResponse>;
  regenerateChatReplyStream(
    input: RegenerateChatReplyRequest,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatWithAgentResponse>;
  undoLastChatTurn(input: UndoLastChatTurnRequest): Promise<UndoLastChatTurnResponse>;
  rewriteChatUserMessage(input: RewriteChatUserMessageRequest): Promise<ChatWithAgentResponse>;
  rewriteLastUserMessage(input: RewriteLastUserMessageRequest): Promise<ChatWithAgentResponse>;
  listAgentChatSessions(agentId: string): Promise<ChatSession[]>;
  createAgentChatSession(agentId: string, title: string): Promise<ChatSession>;
  renameAgentChatSession(agentId: string, sessionId: string, title: string): Promise<ChatSession>;
  duplicateAgentChatSession(agentId: string, sourceSessionId: string, title: string): Promise<ChatSession>;
  setAgentChatSessionPinned(agentId: string, sessionId: string, pinned: boolean): Promise<ChatSession>;
  setAgentChatSessionArchived(
    agentId: string,
    sessionId: string,
    archived: boolean,
  ): Promise<ChatSession>;
  setAgentChatSessionTags(agentId: string, sessionId: string, tags: string[]): Promise<ChatSession>;
  deleteAgentChatSession(agentId: string, sessionId: string): Promise<void>;
  listAgentChatMessages(agentId: string): Promise<ChatMessage[]>;
  clearAgentChatMessages(agentId: string): Promise<void>;
  listChatSessionMessages(agentId: string, sessionId: string): Promise<ChatMessage[]>;
  clearChatSessionMessages(agentId: string, sessionId: string): Promise<void>;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const DEFAULT_HEADLESS_BASE_URL = "http://127.0.0.1:8787";
const HEADLESS_BASE_URL_KEY = "girlagent.headlessBaseUrl";
const HEADLESS_TOKEN_KEY = "girlagent.headlessToken";

export function getHeadlessConfig() {
  return {
    baseUrl: localStorage.getItem(HEADLESS_BASE_URL_KEY) ?? DEFAULT_HEADLESS_BASE_URL,
    token: localStorage.getItem(HEADLESS_TOKEN_KEY) ?? "",
  };
}

export function setHeadlessConfig(baseUrl: string, token: string) {
  localStorage.setItem(HEADLESS_BASE_URL_KEY, baseUrl.trim());
  localStorage.setItem(HEADLESS_TOKEN_KEY, token.trim());
}

function isAbortLikeError(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }

  const payload = raw as { name?: unknown; code?: unknown; message?: unknown };
  if (payload.code === "STREAM_ABORTED") {
    return true;
  }
  if (payload.name === "AbortError") {
    return true;
  }
  if (typeof payload.message === "string" && payload.message.toLowerCase().includes("abort")) {
    return true;
  }
  return false;
}

function mapError(raw: unknown): ApiError {
  if (isAbortLikeError(raw)) {
    return {
      code: "STREAM_ABORTED",
      message: "已停止生成",
    };
  }

  if (typeof raw === "object" && raw !== null) {
    const maybePayload = raw as Record<string, unknown>;
    const code = maybePayload.code;
    const message = maybePayload.message;
    if (typeof code === "string" && typeof message === "string") {
      return {
        code,
        message,
        details: maybePayload.details,
      };
    }
  }

  if (raw instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: raw.message,
    };
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as ApiError;
      if (parsed && typeof parsed.code === "string" && typeof parsed.message === "string") {
        return parsed;
      }
    } catch {
      return {
        code: "INTERNAL_ERROR",
        message: raw,
      };
    }
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Unknown error",
  };
}

function createHttpError(status: number, path: string): ApiError {
  switch (status) {
    case 400:
      return {
        code: "BAD_REQUEST",
        message: "请求参数不正确，请检查后重试。",
        details: { status, path },
      };
    case 401:
      return {
        code: "UNAUTHORIZED",
        message: "登录已失效或访问令牌无效，请重新登录。",
        details: { status, path },
      };
    case 403:
      return {
        code: "FORBIDDEN",
        message: "当前没有权限执行这个操作。",
        details: { status, path },
      };
    case 404:
      return {
        code: "NOT_FOUND",
        message: "请求的接口不存在，请确认后端服务地址和版本是否匹配。",
        details: { status, path },
      };
    case 409:
      return {
        code: "CONFLICT",
        message: "当前资源状态冲突，请刷新数据后再试。",
        details: { status, path },
      };
    case 422:
      return {
        code: "VALIDATION_ERROR",
        message: "提交的数据未通过校验，请检查填写内容。",
        details: { status, path },
      };
    default:
      if (status >= 500) {
        return {
          code: "SERVER_ERROR",
          message: "后端服务暂时不可用，请稍后重试。",
          details: { status, path },
        };
      }
      return {
        code: "HTTP_ERROR",
        message: `请求失败（HTTP ${status}）`,
        details: { status, path },
      };
  }
}

function parseSsePacket(packet: string): { event: string; data: string } | null {
  const lines = packet
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  return {
    event,
    data: dataLines.join("\n"),
  };
}

function readSsePacket(buffered: string): { packet: string; rest: string } | null {
  const crlfSeparatorIndex = buffered.indexOf("\r\n\r\n");
  const lfSeparatorIndex = buffered.indexOf("\n\n");

  if (crlfSeparatorIndex < 0 && lfSeparatorIndex < 0) {
    return null;
  }

  if (crlfSeparatorIndex >= 0 && (lfSeparatorIndex < 0 || crlfSeparatorIndex < lfSeparatorIndex)) {
    return {
      packet: buffered.slice(0, crlfSeparatorIndex),
      rest: buffered.slice(crlfSeparatorIndex + 4),
    };
  }

  return {
    packet: buffered.slice(0, lfSeparatorIndex),
    rest: buffered.slice(lfSeparatorIndex + 2),
  };
}

function splitTextChunks(text: string, chunkSize: number): string[] {
  if (!text || chunkSize <= 0) {
    return [];
  }
  const chunks: string[] = [];
  let current = "";
  let currentLength = 0;
  for (const ch of text) {
    current += ch;
    currentLength += 1;
    if (currentLength >= chunkSize) {
      chunks.push(current);
      current = "";
      currentLength = 0;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw mapError(error);
  }
}

class DesktopClient implements ApiClient {
  getBootstrap() {
    return invokeCommand<AppBootstrap>("get_bootstrap_data");
  }

  getRuntimeStatus() {
    return invokeCommand<RuntimeStatusResponse>("get_runtime_status");
  }

  listProviders() {
    return invokeCommand<ProviderConfig[]>("list_providers");
  }

  createProvider(input: CreateProviderRequest) {
    return invokeCommand<ProviderConfig>("create_provider", { input });
  }

  updateProvider(id: string, input: UpdateProviderRequest) {
    return invokeCommand<ProviderConfig>("update_provider", { id, input });
  }

  deleteProvider(id: string) {
    return invokeCommand<void>("delete_provider", { id });
  }

  probeProviderConnection(input: ProbeProviderConnectionRequest) {
    return invokeCommand<ProbeProviderConnectionResponse>("probe_provider_connection", { input });
  }

  listModels() {
    return invokeCommand<ModelConfig[]>("list_models");
  }

  createModel(input: CreateModelRequest) {
    return invokeCommand<ModelConfig>("create_model", { input });
  }

  updateModel(id: string, input: UpdateModelRequest) {
    return invokeCommand<ModelConfig>("update_model", { id, input });
  }

  deleteModel(id: string) {
    return invokeCommand<void>("delete_model", { id });
  }

  probeModelConnection(input: ProbeModelConnectionRequest) {
    return invokeCommand<ProbeModelConnectionResponse>("probe_model_connection", { input });
  }

  listAgents() {
    return invokeCommand<AgentConfig[]>("list_agents");
  }

  createAgent(input: CreateAgentRequest) {
    return invokeCommand<AgentConfig>("create_agent", { input });
  }

  updateAgent(id: string, input: UpdateAgentRequest) {
    return invokeCommand<AgentConfig>("update_agent", { id, input });
  }

  deleteAgent(id: string) {
    return invokeCommand<void>("delete_agent", { id });
  }

  listWorkspaceChatSessions() {
    return invokeCommand<WorkspaceChatSession[]>("list_workspace_chat_sessions");
  }

  createWorkspaceChatSession(input: CreateWorkspaceChatSessionRequest) {
    return invokeCommand<WorkspaceChatSession>("create_workspace_chat_session", { input });
  }

  updateWorkspaceChatSession(sessionId: string, input: UpdateWorkspaceChatSessionRequest) {
    return invokeCommand<WorkspaceChatSession>("update_workspace_chat_session", {
      sessionId,
      input,
    });
  }

  deleteWorkspaceChatSession(sessionId: string) {
    return invokeCommand<void>("delete_workspace_chat_session", { sessionId });
  }

  listWorkspaceChatMessages(sessionId: string) {
    return invokeCommand<WorkspaceChatMessage[]>("list_workspace_chat_messages", { sessionId });
  }

  clearWorkspaceChatMessages(sessionId: string) {
    return invokeCommand<void>("clear_workspace_chat_messages", { sessionId });
  }

  chatWithSession(input: ChatWithSessionRequest) {
    return invokeCommand<ChatWithSessionResponse>("chat_with_session", { input });
  }

  async chatWithSessionStream(
    input: ChatWithSessionRequest,
    onReplyStart: (reply: Omit<WorkspaceChatReply, "message">) => void,
    onDelta: (agentId: string, chunk: string) => void,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) {
      throw {
        code: "STREAM_ABORTED",
        message: "已停止生成",
      } satisfies ApiError;
    }
    const result = await this.chatWithSession(input);
    for (const reply of result.replies) {
      if (signal?.aborted) {
        throw {
          code: "STREAM_ABORTED",
          message: "已停止生成",
        } satisfies ApiError;
      }
      onReplyStart({
        agentId: reply.agentId,
        agentName: reply.agentName,
        modelRefId: reply.modelRefId,
        modelId: reply.modelId,
      });
      for (const chunk of splitTextChunks(reply.message, 24)) {
        if (signal?.aborted) {
          throw {
            code: "STREAM_ABORTED",
            message: "已停止生成",
          } satisfies ApiError;
        }
        onDelta(reply.agentId, chunk);
        await new Promise((resolve) => window.setTimeout(resolve, 8));
      }
    }
    return result;
  }

  chatWithAgent(input: ChatWithAgentRequest) {
    return invokeCommand<ChatWithAgentResponse>("chat_with_agent", { input });
  }

  async chatWithAgentStream(
    input: ChatWithAgentRequest,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) {
      throw {
        code: "STREAM_ABORTED",
        message: "已停止生成",
      } satisfies ApiError;
    }
    const result = await this.chatWithAgent(input);
    if (signal?.aborted) {
      throw {
        code: "STREAM_ABORTED",
        message: "已停止生成",
      } satisfies ApiError;
    }
    if (result.message) {
      onDelta(result.message);
    }
    return result;
  }

  regenerateChatReply(input: RegenerateChatReplyRequest) {
    return invokeCommand<ChatWithAgentResponse>("regenerate_chat_reply", { input });
  }

  async regenerateChatReplyStream(
    input: RegenerateChatReplyRequest,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) {
      throw {
        code: "STREAM_ABORTED",
        message: "已停止生成",
      } satisfies ApiError;
    }
    const result = await this.regenerateChatReply(input);
    if (signal?.aborted) {
      throw {
        code: "STREAM_ABORTED",
        message: "已停止生成",
      } satisfies ApiError;
    }
    if (result.message) {
      onDelta(result.message);
    }
    return result;
  }

  undoLastChatTurn(input: UndoLastChatTurnRequest) {
    return invokeCommand<UndoLastChatTurnResponse>("undo_last_chat_turn", { input });
  }

  rewriteChatUserMessage(input: RewriteChatUserMessageRequest) {
    return invokeCommand<ChatWithAgentResponse>("rewrite_chat_user_message", { input });
  }

  rewriteLastUserMessage(input: RewriteLastUserMessageRequest) {
    return invokeCommand<ChatWithAgentResponse>("rewrite_last_user_message", { input });
  }

  listAgentChatSessions(agentId: string) {
    return invokeCommand<ChatSession[]>("list_agent_chat_sessions", { agentId });
  }

  createAgentChatSession(agentId: string, title: string) {
    return invokeCommand<ChatSession>("create_agent_chat_session", { agentId, title });
  }

  renameAgentChatSession(agentId: string, sessionId: string, title: string) {
    return invokeCommand<ChatSession>("rename_agent_chat_session", { agentId, sessionId, title });
  }

  duplicateAgentChatSession(agentId: string, sourceSessionId: string, title: string) {
    return invokeCommand<ChatSession>("duplicate_agent_chat_session", {
      agentId,
      sourceSessionId,
      title,
    });
  }

  setAgentChatSessionPinned(agentId: string, sessionId: string, pinned: boolean) {
    return invokeCommand<ChatSession>("set_agent_chat_session_pinned", {
      agentId,
      sessionId,
      pinned,
    });
  }

  setAgentChatSessionArchived(agentId: string, sessionId: string, archived: boolean) {
    return invokeCommand<ChatSession>("set_agent_chat_session_archived", {
      agentId,
      sessionId,
      archived,
    });
  }

  setAgentChatSessionTags(agentId: string, sessionId: string, tags: string[]) {
    return invokeCommand<ChatSession>("set_agent_chat_session_tags", {
      agentId,
      sessionId,
      tags,
    });
  }

  deleteAgentChatSession(agentId: string, sessionId: string) {
    return invokeCommand<void>("delete_agent_chat_session", { agentId, sessionId });
  }

  listAgentChatMessages(agentId: string) {
    return invokeCommand<ChatMessage[]>("list_agent_chat_messages", { agentId });
  }

  clearAgentChatMessages(agentId: string) {
    return invokeCommand<void>("clear_agent_chat_messages", { agentId });
  }

  listChatSessionMessages(agentId: string, sessionId: string) {
    return invokeCommand<ChatMessage[]>("list_chat_session_messages", {
      agentId,
      sessionId,
    });
  }

  clearChatSessionMessages(agentId: string, sessionId: string) {
    return invokeCommand<void>("clear_chat_session_messages", {
      agentId,
      sessionId,
    });
  }
}

class HeadlessClient implements ApiClient {
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const { baseUrl, token } = getHeadlessConfig();
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      let payload: ApiError | undefined;
      try {
        payload = (await response.json()) as ApiError;
      } catch {
        payload = undefined;
      }
      throw (payload ?? createHttpError(response.status, "/api/workspace/chat/stream"));
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  getBootstrap() {
    return this.request<AppBootstrap>("/api/bootstrap");
  }

  getRuntimeStatus() {
    return this.request<RuntimeStatusResponse>("/api/runtime/status");
  }

  listProviders() {
    return this.request<ProviderConfig[]>("/api/providers");
  }

  createProvider(input: CreateProviderRequest) {
    return this.request<ProviderConfig>("/api/providers", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateProvider(id: string, input: UpdateProviderRequest) {
    return this.request<ProviderConfig>(`/api/providers/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  deleteProvider(id: string) {
    return this.request<void>(`/api/providers/${id}`, { method: "DELETE" });
  }

  probeProviderConnection(input: ProbeProviderConnectionRequest) {
    return this.request<ProbeProviderConnectionResponse>("/api/runtime/provider-probe", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listModels() {
    return this.request<ModelConfig[]>("/api/models");
  }

  createModel(input: CreateModelRequest) {
    return this.request<ModelConfig>("/api/models", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateModel(id: string, input: UpdateModelRequest) {
    return this.request<ModelConfig>(`/api/models/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  deleteModel(id: string) {
    return this.request<void>(`/api/models/${id}`, { method: "DELETE" });
  }

  probeModelConnection(input: ProbeModelConnectionRequest) {
    return this.request<ProbeModelConnectionResponse>("/api/runtime/model-probe", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listAgents() {
    return this.request<AgentConfig[]>("/api/agents");
  }

  createAgent(input: CreateAgentRequest) {
    return this.request<AgentConfig>("/api/agents", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateAgent(id: string, input: UpdateAgentRequest) {
    return this.request<AgentConfig>(`/api/agents/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  deleteAgent(id: string) {
    return this.request<void>(`/api/agents/${id}`, { method: "DELETE" });
  }

  listWorkspaceChatSessions() {
    return this.request<WorkspaceChatSession[]>("/api/workspace/sessions");
  }

  createWorkspaceChatSession(input: CreateWorkspaceChatSessionRequest) {
    return this.request<WorkspaceChatSession>("/api/workspace/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateWorkspaceChatSession(sessionId: string, input: UpdateWorkspaceChatSessionRequest) {
    return this.request<WorkspaceChatSession>(`/api/workspace/sessions/${sessionId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  deleteWorkspaceChatSession(sessionId: string) {
    return this.request<void>(`/api/workspace/sessions/${sessionId}`, { method: "DELETE" });
  }

  listWorkspaceChatMessages(sessionId: string) {
    return this.request<WorkspaceChatMessage[]>(`/api/workspace/sessions/${sessionId}/messages`);
  }

  clearWorkspaceChatMessages(sessionId: string) {
    return this.request<void>(`/api/workspace/sessions/${sessionId}/messages`, {
      method: "DELETE",
    });
  }

  chatWithSession(input: ChatWithSessionRequest) {
    return this.request<ChatWithSessionResponse>("/api/workspace/chat", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  private async streamWorkspaceChatResponse(
    input: ChatWithSessionRequest,
    onReplyStart: (reply: Omit<WorkspaceChatReply, "message">) => void,
    onDelta: (agentId: string, chunk: string) => void,
    signal?: AbortSignal,
  ) {
    const { baseUrl, token } = getHeadlessConfig();
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "text/event-stream");
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/workspace/chat/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        signal,
      });
    } catch (error) {
      if (isAbortLikeError(error) || signal?.aborted) {
        throw {
          code: "STREAM_ABORTED",
          message: "已停止生成",
        } satisfies ApiError;
      }
      throw mapError(error);
    }

    if (!response.ok) {
      let payload: ApiError | undefined;
      try {
        payload = (await response.json()) as ApiError;
      } catch {
        payload = undefined;
      }
      throw (payload ?? createHttpError(response.status, "/api/workspace/chat/stream"));
    }

    if (!response.body) {
      throw {
        code: "STREAM_ERROR",
        message: "response body is empty",
      } satisfies ApiError;
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffered = "";
    let finalResponse: ChatWithSessionResponse | null = null;

    const processPacket = (packet: string) => {
      const parsed = parseSsePacket(packet);
      if (!parsed) return;
      if (parsed.event === "reply_start") {
        onReplyStart(JSON.parse(parsed.data) as Omit<WorkspaceChatReply, "message">);
        return;
      }
      if (parsed.event === "delta") {
        const payload = JSON.parse(parsed.data) as { agentId: string; text?: string };
        if (payload.text) {
          onDelta(payload.agentId, payload.text);
        }
        return;
      }
      if (parsed.event === "done") {
        finalResponse = JSON.parse(parsed.data) as ChatWithSessionResponse;
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        while (true) {
          const readResult = readSsePacket(buffered);
          if (!readResult) break;
          buffered = readResult.rest;
          processPacket(readResult.packet);
        }
      }
    } catch (error) {
      if (isAbortLikeError(error) || signal?.aborted) {
        throw {
          code: "STREAM_ABORTED",
          message: "已停止生成",
        } satisfies ApiError;
      }
      throw mapError(error);
    }

    if (buffered.trim()) {
      processPacket(buffered.trim());
    }
    if (!finalResponse) {
      throw {
        code: "STREAM_ERROR",
        message: "stream ended without done event",
      } satisfies ApiError;
    }
    return finalResponse;
  }

  chatWithAgent(input: ChatWithAgentRequest) {
    return this.request<ChatWithAgentResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  regenerateChatReply(input: RegenerateChatReplyRequest) {
    return this.request<ChatWithAgentResponse>("/api/chat/regenerate", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  undoLastChatTurn(input: UndoLastChatTurnRequest) {
    return this.request<UndoLastChatTurnResponse>("/api/chat/undo", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  rewriteChatUserMessage(input: RewriteChatUserMessageRequest) {
    return this.request<ChatWithAgentResponse>("/api/chat/rewrite-user-message", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  rewriteLastUserMessage(input: RewriteLastUserMessageRequest) {
    return this.request<ChatWithAgentResponse>("/api/chat/rewrite-last-user", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  private async streamChatResponse(
    path: string,
    input: ChatWithAgentRequest | RegenerateChatReplyRequest,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
  ) {
    const { baseUrl, token } = getHeadlessConfig();
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "text/event-stream");
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        signal,
      });
    } catch (error) {
      if (isAbortLikeError(error) || signal?.aborted) {
        throw {
          code: "STREAM_ABORTED",
          message: "已停止生成",
        } satisfies ApiError;
      }
      throw mapError(error);
    }

    if (!response.ok) {
      let payload: ApiError | undefined;
      try {
        payload = (await response.json()) as ApiError;
      } catch {
        payload = undefined;
      }
      throw (payload ?? createHttpError(response.status, "/api/workspace/chat/stream"));
    }

    if (!response.body) {
      throw {
        code: "STREAM_ERROR",
        message: "response body is empty",
      } satisfies ApiError;
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffered = "";
    let finalResponse: ChatWithAgentResponse | null = null;

    const processPacket = (packet: string) => {
      const parsed = parseSsePacket(packet);
      if (!parsed) return;

      if (parsed.event === "delta") {
        try {
          const payload = JSON.parse(parsed.data) as { text?: string };
          if (payload.text) {
            onDelta(payload.text);
          }
        } catch {
          return;
        }
      }

      if (parsed.event === "done") {
        try {
          finalResponse = JSON.parse(parsed.data) as ChatWithAgentResponse;
        } catch {
          throw {
            code: "STREAM_ERROR",
            message: "invalid done payload",
          } satisfies ApiError;
        }
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffered += decoder.decode(value, { stream: true });
        while (true) {
          const readResult = readSsePacket(buffered);
          if (!readResult) break;
          buffered = readResult.rest;
          processPacket(readResult.packet);
        }
      }
    } catch (error) {
      if (isAbortLikeError(error) || signal?.aborted) {
        throw {
          code: "STREAM_ABORTED",
          message: "已停止生成",
        } satisfies ApiError;
      }
      throw mapError(error);
    }

    const tailPacket = buffered.trim();
    if (tailPacket.length > 0) {
      processPacket(tailPacket);
    }

    if (!finalResponse) {
      throw {
        code: "STREAM_ERROR",
        message: "stream ended without done event",
      } satisfies ApiError;
    }

    return finalResponse;
  }

  async chatWithAgentStream(
    input: ChatWithAgentRequest,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
  ) {
    return this.streamChatResponse("/api/chat/stream", input, onDelta, signal);
  }

  async chatWithSessionStream(
    input: ChatWithSessionRequest,
    onReplyStart: (reply: Omit<WorkspaceChatReply, "message">) => void,
    onDelta: (agentId: string, chunk: string) => void,
    signal?: AbortSignal,
  ) {
    return this.streamWorkspaceChatResponse(input, onReplyStart, onDelta, signal);
  }

  async regenerateChatReplyStream(
    input: RegenerateChatReplyRequest,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
  ) {
    return this.streamChatResponse("/api/chat/regenerate/stream", input, onDelta, signal);
  }

  listAgentChatSessions(agentId: string) {
    return this.request<ChatSession[]>(`/api/agents/${agentId}/chat/sessions`);
  }

  createAgentChatSession(agentId: string, title: string) {
    return this.request<ChatSession>(`/api/agents/${agentId}/chat/sessions`, {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  }

  renameAgentChatSession(agentId: string, sessionId: string, title: string) {
    return this.request<ChatSession>(`/api/agents/${agentId}/chat/sessions/${sessionId}`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    });
  }

  duplicateAgentChatSession(agentId: string, sourceSessionId: string, title: string) {
    return this.request<ChatSession>(
      `/api/agents/${agentId}/chat/sessions/${sourceSessionId}/duplicate`,
      {
        method: "POST",
        body: JSON.stringify({ title }),
      },
    );
  }

  setAgentChatSessionPinned(agentId: string, sessionId: string, pinned: boolean) {
    return this.request<ChatSession>(`/api/agents/${agentId}/chat/sessions/${sessionId}/pin`, {
      method: "PUT",
      body: JSON.stringify({ pinned }),
    });
  }

  setAgentChatSessionArchived(agentId: string, sessionId: string, archived: boolean) {
    return this.request<ChatSession>(`/api/agents/${agentId}/chat/sessions/${sessionId}/archive`, {
      method: "PUT",
      body: JSON.stringify({ archived }),
    });
  }

  setAgentChatSessionTags(agentId: string, sessionId: string, tags: string[]) {
    return this.request<ChatSession>(`/api/agents/${agentId}/chat/sessions/${sessionId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    });
  }

  deleteAgentChatSession(agentId: string, sessionId: string) {
    return this.request<void>(`/api/agents/${agentId}/chat/sessions/${sessionId}`, {
      method: "DELETE",
    });
  }

  listAgentChatMessages(agentId: string) {
    return this.request<ChatMessage[]>(`/api/agents/${agentId}/chat/messages`);
  }

  clearAgentChatMessages(agentId: string) {
    return this.request<void>(`/api/agents/${agentId}/chat/messages`, {
      method: "DELETE",
    });
  }

  listChatSessionMessages(agentId: string, sessionId: string) {
    return this.request<ChatMessage[]>(`/api/agents/${agentId}/chat/sessions/${sessionId}/messages`);
  }

  clearChatSessionMessages(agentId: string, sessionId: string) {
    return this.request<void>(`/api/agents/${agentId}/chat/sessions/${sessionId}/messages`, {
      method: "DELETE",
    });
  }
}

let singleton: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (!singleton) {
    singleton = isTauriRuntime() ? new DesktopClient() : new HeadlessClient();
  }
  return singleton;
}
