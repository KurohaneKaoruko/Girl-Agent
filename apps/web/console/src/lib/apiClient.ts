import { invoke } from "@tauri-apps/api/core";
import type {
  AgentConfig,
  ApiError,
  AppBootstrap,
  ChatMessage,
  ChatSession,
  ChatWithAgentRequest,
  ChatWithAgentResponse,
  CreateAgentRequest,
  CreateModelRequest,
  CreateProviderRequest,
  ModelConfig,
  ProviderConfig,
  RegenerateChatReplyRequest,
  RewriteChatUserMessageRequest,
  RewriteLastUserMessageRequest,
  UndoLastChatTurnRequest,
  UndoLastChatTurnResponse,
  UpdateAgentRequest,
  UpdateModelRequest,
  UpdateProviderRequest,
} from "@/types";

export type ApiClient = {
  getBootstrap(): Promise<AppBootstrap>;
  listProviders(): Promise<ProviderConfig[]>;
  createProvider(input: CreateProviderRequest): Promise<ProviderConfig>;
  updateProvider(id: string, input: UpdateProviderRequest): Promise<ProviderConfig>;
  deleteProvider(id: string): Promise<void>;
  listModels(): Promise<ModelConfig[]>;
  createModel(input: CreateModelRequest): Promise<ModelConfig>;
  updateModel(id: string, input: UpdateModelRequest): Promise<ModelConfig>;
  deleteModel(id: string): Promise<void>;
  listAgents(): Promise<AgentConfig[]>;
  createAgent(input: CreateAgentRequest): Promise<AgentConfig>;
  updateAgent(id: string, input: UpdateAgentRequest): Promise<AgentConfig>;
  deleteAgent(id: string): Promise<void>;
  chatWithAgent(input: ChatWithAgentRequest): Promise<ChatWithAgentResponse>;
  chatWithAgentStream(
    input: ChatWithAgentRequest,
    onDelta: (chunk: string) => void,
  ): Promise<ChatWithAgentResponse>;
  regenerateChatReply(input: RegenerateChatReplyRequest): Promise<ChatWithAgentResponse>;
  regenerateChatReplyStream(
    input: RegenerateChatReplyRequest,
    onDelta: (chunk: string) => void,
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

function mapError(raw: unknown): ApiError {
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

  chatWithAgent(input: ChatWithAgentRequest) {
    return invokeCommand<ChatWithAgentResponse>("chat_with_agent", { input });
  }

  async chatWithAgentStream(input: ChatWithAgentRequest, onDelta: (chunk: string) => void) {
    const result = await this.chatWithAgent(input);
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
  ) {
    const result = await this.regenerateChatReply(input);
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
      throw (
        payload ?? {
          code: "HTTP_ERROR",
          message: `HTTP ${response.status}`,
        }
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  getBootstrap() {
    return this.request<AppBootstrap>("/api/bootstrap");
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
  ) {
    const { baseUrl, token } = getHeadlessConfig();
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "text/event-stream");
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      let payload: ApiError | undefined;
      try {
        payload = (await response.json()) as ApiError;
      } catch {
        payload = undefined;
      }
      throw (
        payload ?? {
          code: "HTTP_ERROR",
          message: `HTTP ${response.status}`,
        }
      );
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

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffered += decoder.decode(value, { stream: true });
      while (true) {
        const separatorIndex = buffered.indexOf("\n\n");
        if (separatorIndex < 0) break;

        const packet = buffered.slice(0, separatorIndex);
        buffered = buffered.slice(separatorIndex + 2);
        const parsed = parseSsePacket(packet);
        if (!parsed) continue;

        if (parsed.event === "delta") {
          try {
            const payload = JSON.parse(parsed.data) as { text?: string };
            if (payload.text) {
              onDelta(payload.text);
            }
          } catch {
            continue;
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
      }
    }

    if (!finalResponse) {
      throw {
        code: "STREAM_ERROR",
        message: "stream ended without done event",
      } satisfies ApiError;
    }

    return finalResponse;
  }

  async chatWithAgentStream(input: ChatWithAgentRequest, onDelta: (chunk: string) => void) {
    return this.streamChatResponse("/api/chat/stream", input, onDelta);
  }

  async regenerateChatReplyStream(
    input: RegenerateChatReplyRequest,
    onDelta: (chunk: string) => void,
  ) {
    return this.streamChatResponse("/api/chat/regenerate/stream", input, onDelta);
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
