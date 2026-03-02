import { invoke } from "@tauri-apps/api/core";
import type {
  AgentConfig,
  ApiError,
  AppBootstrap,
  ChatWithAgentRequest,
  ChatWithAgentResponse,
  CreateAgentRequest,
  CreateModelRequest,
  CreateProviderRequest,
  ModelConfig,
  ProviderConfig,
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
}

let singleton: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (!singleton) {
    singleton = isTauriRuntime() ? new DesktopClient() : new HeadlessClient();
  }
  return singleton;
}
