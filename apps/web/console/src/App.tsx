import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentSettings } from "@/features/agent/AgentSettings";
import { ChatWorkspace } from "@/features/chat/ChatWorkspace";
import { LoginPage } from "@/LoginPage";
import { ModelSettings } from "@/features/model/ModelSettings";
import { ProviderSettings } from "@/features/provider/ProviderSettings";
import { getApiClient, getHeadlessConfig, setHeadlessConfig } from "@/lib/apiClient";
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
  ProbeModelConnectionRequest,
  ProbeModelConnectionResponse,
  ProbeProviderConnectionRequest,
  ProbeProviderConnectionResponse,
  ProviderConfig,
  RegenerateChatReplyRequest,
  RewriteChatUserMessageRequest,
  RuntimeStatusResponse,
  UndoLastChatTurnRequest,
  UndoLastChatTurnResponse,
  UpdateAgentRequest,
  UpdateModelRequest,
  UpdateProviderRequest,
} from "@/types";

type MainSection = "overview" | "chat" | "provider" | "model" | "agent" | "settings";

const fallbackBootstrap: AppBootstrap = {
  appName: "少女智能体",
  appVersion: "0.1.0",
  apiVersion: "1.0.0",
  providerPresets: [],
};

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const api = getApiClient();
const LOGIN_SESSION_KEY = "girlagent.console.loggedIn.v1";

const navItems: Array<{ key: MainSection; label: string; caption: string }> = [
  { key: "overview", label: "总览", caption: "控制中心" },
  { key: "chat", label: "聊天", caption: "实时对话" },
  { key: "provider", label: "提供商", caption: "提供商配置" },
  { key: "model", label: "模型", caption: "模型编排" },
  { key: "agent", label: "智能体", caption: "角色设定" },
  { key: "settings", label: "设置", caption: "工作台设置" },
];

const sectionMeta: Record<
  MainSection,
  {
    eyebrow: string;
    title: string;
    description: string;
  }
> = {
  overview: {
    eyebrow: "控制中心",
    title: "系统总览",
    description: "统一查看运行状态、资源规模与当前控制台入口。",
  },
  chat: {
    eyebrow: "实时对话",
    title: "聊天工作台",
    description: "围绕智能体与多会话展开的主操作舞台，保持效率同时提升沉浸感。",
  },
  provider: {
    eyebrow: "提供商配置",
    title: "提供商设置",
    description: "集中维护各类模型提供商与连接状态，保持后续模型接入一致。",
  },
  model: {
    eyebrow: "模型编排",
    title: "模型设置",
    description: "管理模型类型、模态与默认参数，为智能体分配可用能力。",
  },
  agent: {
    eyebrow: "角色设定",
    title: "智能体设置",
    description: "配置人格、说话规则与槽位分配，形成统一的角色工作流。",
  },
  settings: {
    eyebrow: "工作台设置",
    title: "工作台设置",
    description: "管理当前控制台连接状态与刷新入口，维持 Web / App 一致体验。",
  },
};

const readPersistedLoginState = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  const persisted = window.localStorage.getItem(LOGIN_SESSION_KEY) === "1";
  const { token } = getHeadlessConfig();
  return persisted && token.trim().length > 0;
};

const persistLoginState = (loggedIn: boolean) => {
  if (typeof window === "undefined") {
    return;
  }
  if (loggedIn) {
    window.localStorage.setItem(LOGIN_SESSION_KEY, "1");
    return;
  }
  window.localStorage.removeItem(LOGIN_SESSION_KEY);
};

const toApiError = (error: unknown): ApiError => {
  if (typeof error === "object" && error !== null) {
    const payload = error as { code?: unknown; message?: unknown; name?: unknown; details?: unknown };
    if (payload.code === "STREAM_ABORTED" || payload.name === "AbortError") {
      return { code: "STREAM_ABORTED", message: "已停止生成" };
    }
    if (typeof payload.code === "string" && typeof payload.message === "string") {
      return {
        code: payload.code,
        message: payload.message,
        details: payload.details,
      };
    }
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message };
  }
  return { code: "INTERNAL_ERROR", message: "Unknown error" };
};

export function App() {
  const [bootstrap, setBootstrap] = useState<AppBootstrap>(fallbackBootstrap);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusResponse | null>(null);
  const [backendStatus, setBackendStatus] = useState("连接中");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [headlessBaseUrl, setHeadlessBaseUrl] = useState(() => getHeadlessConfig().baseUrl);
  const [headlessToken, setHeadlessToken] = useState(() => getHeadlessConfig().token);
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    isTauri ? true : readPersistedLoginState(),
  );
  const [activeSection, setActiveSection] = useState<MainSection>("chat");
  const [activeAgentId, setActiveAgentId] = useState("");

  const safeError = useCallback((rawError: unknown) => {
    const mapped = toApiError(rawError);
    setError(mapped);
    return mapped;
  }, []);

  const loadAll = useCallback(async () => {
    const [nextBootstrap, nextRuntimeStatus, nextProviders, nextModels, nextAgents] = await Promise.all([
      api.getBootstrap(),
      api.getRuntimeStatus(),
      api.listProviders(),
      api.listModels(),
      api.listAgents(),
    ]);
    setBootstrap(nextBootstrap);
    setRuntimeStatus(nextRuntimeStatus);
    setProviders(nextProviders);
    setModels(nextModels);
    setAgents(nextAgents);
    setBackendStatus("已连接");
    setError(null);
  }, []);

  const refreshRuntimeStatus = useCallback(async () => {
    try {
      const next = await api.getRuntimeStatus();
      setRuntimeStatus(next);
      setBackendStatus("已连接");
    } catch {
      setBackendStatus("未连接");
      setRuntimeStatus(null);
    }
  }, []);

  const withAction = useCallback(
    async (action: () => Promise<void>) => {
      setSaving(true);
      try {
        await action();
        setError(null);
      } catch (rawError) {
        safeError(rawError);
      } finally {
        setSaving(false);
      }
    },
    [safeError],
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    void (async () => {
      try {
        await loadAll();
      } catch (rawError) {
        safeError(rawError);
        setBackendStatus("未连接");
      }
    })();
  }, [isAuthenticated, loadAll, safeError]);

  useEffect(() => {
    if (agents.length === 0) {
      setActiveAgentId("");
      return;
    }
    const exists = agents.some((agent) => agent.id === activeAgentId);
    if (!exists) {
      setActiveAgentId(agents[0].id);
    }
  }, [activeAgentId, agents]);

  const handleLogin = useCallback(
    async (baseUrl: string, token: string) => {
      setSaving(true);
      setAuthError(null);
      setError(null);
      setHeadlessConfig(baseUrl, token);
      setHeadlessBaseUrl(baseUrl);
      setHeadlessToken(token);
      try {
        await loadAll();
        persistLoginState(true);
        setIsAuthenticated(true);
      } catch (rawError) {
        const mapped = toApiError(rawError);
        setAuthError(mapped.message);
        persistLoginState(false);
        setIsAuthenticated(false);
      } finally {
        setSaving(false);
      }
    },
    [loadAll],
  );

  const handleLogout = useCallback(() => {
    setHeadlessConfig(headlessBaseUrl, "");
    setHeadlessToken("");
    setIsAuthenticated(false);
    setAuthError(null);
    setError(null);
    setBackendStatus("未连接");
    setRuntimeStatus(null);
    setProviders([]);
    setModels([]);
    setAgents([]);
    setActiveAgentId("");
    persistLoginState(false);
  }, [headlessBaseUrl]);

  const callChat = useCallback(
    async <T,>(fn: () => Promise<T>, ignoreAbort = false): Promise<T> => {
      try {
        const result = await fn();
        void refreshRuntimeStatus();
        setError(null);
        return result;
      } catch (rawError) {
        const mapped = toApiError(rawError);
        if (!(ignoreAbort && mapped.code === "STREAM_ABORTED")) {
          setError(mapped);
        }
        throw mapped;
      }
    },
    [refreshRuntimeStatus],
  );

  const activeAgent = useMemo(
    () => agents.find((item) => item.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );
  const activeMeta = sectionMeta[activeSection];
  const overviewStats = [
    {
      label: "提供商",
      value: runtimeStatus?.providerCount ?? providers.length,
      caption: "模型来源配置数",
    },
    {
      label: "模型",
      value: runtimeStatus?.modelCount ?? models.length,
      caption: "可分配模型数",
    },
    {
      label: "智能体",
      value: runtimeStatus?.agentCount ?? agents.length,
      caption: "当前可用智能体",
    },
    {
      label: "会话",
      value: runtimeStatus?.sessionCount ?? 0,
      caption: "累计对话会话数",
    },
    {
      label: "消息",
      value: runtimeStatus?.messageCount ?? 0,
      caption: "已记录消息数",
    },
    {
      label: "预设",
      value: bootstrap.providerPresets.length,
      caption: "内置提供商模板",
    },
  ];

  if (!isTauri && !isAuthenticated) {
    return (
      <LoginPage
        errorMessage={authError}
        initialBaseUrl={headlessBaseUrl}
        initialToken={headlessToken}
        loading={saving}
        onSubmit={handleLogin}
      />
    );
  }

  return (
    <main className="console-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <span className="app-brand-kicker">少女智能体控制台</span>
          <h1>GirlAgent</h1>
          <p>统一管理提供商、模型、智能体和对话会话的控制台。</p>
        </div>
        <nav className="app-nav">
          {navItems.map((item) => (
            <button
              className={item.key === activeSection ? "app-nav-item active" : "app-nav-item"}
              key={item.key}
              onClick={() => setActiveSection(item.key)}
              type="button"
            >
              <span className="app-nav-label">{item.label}</span>
              <span className="app-nav-caption">{item.caption}</span>
            </button>
          ))}
        </nav>
        <div className="app-sidebar-footer">
          <div className={backendStatus === "已连接" ? "sidebar-status-pill online" : "sidebar-status-pill"}>
            <small>后端状态</small>
            <strong>{backendStatus}</strong>
          </div>
          <div className="sidebar-meta">
            <span>v{bootstrap.appVersion}</span>
            <span>{isTauri ? "桌面端" : "网页端"}</span>
          </div>
        </div>
      </aside>

      <section className="app-content">
        <header className="app-content-hero">
          <div className="app-content-copy">
            <span className="hero-chip">{activeMeta.eyebrow}</span>
            <h2>{activeMeta.title}</h2>
            <p>{activeMeta.description}</p>
          </div>
          <div className="app-content-metrics">
            <div className="hero-metric">
              <strong>{agents.length}</strong>
              <span>智能体</span>
            </div>
            <div className="hero-metric">
              <strong>{backendStatus}</strong>
              <span>后端状态</span>
            </div>
            <div className="hero-metric">
              <strong>{isTauri ? "桌面端" : "网页端"}</strong>
              <span>当前入口</span>
            </div>
          </div>
        </header>

        {activeSection === "overview" && (
          <section className="panel panel-overview">
            <article className="overview-hero-card">
              <div className="overview-hero-copy">
                <span className="hero-chip hero-chip-soft">{bootstrap.appName}</span>
                <h3>把模型、智能体和会话集中到同一个工作台。</h3>
                <p>
                  当前控制台同时服务于网页端和桌面端。你可以在同一套界面里完成配置、校验和多会话对话，不用在不同页面之间来回切换。
                </p>
              </div>
              <div className="overview-hero-actions">
                <button className="primary" disabled={saving} onClick={() => void withAction(loadAll)} type="button">
                  刷新数据
                </button>
                <div className="overview-status-card">
                  <small>当前连接</small>
                  <strong>{backendStatus}</strong>
                  <span>{headlessBaseUrl || "桌面端内置入口"}</span>
                </div>
              </div>
            </article>
            <div className="overview-grid">
              {overviewStats.map((item) => (
                <article className="card overview-card" key={item.label}>
                  <span className="overview-card-label">{item.label}</span>
                  <strong className="overview-card-value">{item.value}</strong>
                  <small>{item.caption}</small>
                </article>
              ))}
            </div>
            <div className="overview-detail-grid">
              <article className="card overview-detail-card">
                <h3>版本与接口</h3>
                <small>应用名称：{bootstrap.appName}</small>
                <small>应用版本：{bootstrap.appVersion}</small>
                <small>API 版本：{bootstrap.apiVersion}</small>
              </article>
              <article className="card overview-detail-card">
                <h3>当前焦点</h3>
                <small>当前智能体：{activeAgent?.name ?? "未选择"}</small>
                <small>运行模式：{activeAgent?.mode ?? "等待选择"}</small>
                <small>功能分区：{navItems.length}</small>
              </article>
              <article className="card overview-detail-card">
                <h3>运行环境</h3>
                <small>入口类型：{isTauri ? "桌面端应用" : "网页控制台"}</small>
                <small>Base URL：{headlessBaseUrl || "桌面端内置入口"}</small>
                <small>提供商预设：{bootstrap.providerPresets.length}</small>
              </article>
            </div>
          </section>
        )}

        {activeSection === "chat" && (
          <section className="panel">
            <header className="panel-header">
              <h2>聊天工作台</h2>
              <div className="actions">
                <label className="compact-field">
                  当前智能体
                  <select onChange={(event) => setActiveAgentId(event.target.value)} value={activeAgentId}>
                    {agents.length === 0 && <option value="">暂无智能体</option>}
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="ghost" onClick={() => setActiveSection("agent")} type="button">
                  管理智能体
                </button>
              </div>
            </header>
            {activeAgent && <small className="hint">模式：{activeAgent.mode}</small>}
            <ChatWorkspace
              agents={agents}
              disabled={saving}
              focusedAgentId={activeAgentId}
              onChat={(input: ChatWithAgentRequest) => callChat(() => api.chatWithAgent(input))}
              onChatStream={(input: ChatWithAgentRequest, onDelta: (chunk: string) => void, signal?: AbortSignal) =>
                callChat(() => api.chatWithAgentStream(input, onDelta, signal), true)
              }
              onRegenerate={(input: RegenerateChatReplyRequest) => callChat(() => api.regenerateChatReply(input))}
              onRegenerateStream={(input: RegenerateChatReplyRequest, onDelta: (chunk: string) => void, signal?: AbortSignal) =>
                callChat(() => api.regenerateChatReplyStream(input, onDelta, signal), true)
              }
              onUndoLastTurn={(input: UndoLastChatTurnRequest): Promise<UndoLastChatTurnResponse> =>
                callChat(() => api.undoLastChatTurn(input))
              }
              onRewriteUserMessage={(input: RewriteChatUserMessageRequest) =>
                callChat(() => api.rewriteChatUserMessage(input))
              }
              onListSessions={(agentId: string) => api.listAgentChatSessions(agentId)}
              onCreateSession={(agentId: string, title: string) => callChat(() => api.createAgentChatSession(agentId, title))}
              onRenameSession={(agentId: string, sessionId: string, title: string) =>
                api.renameAgentChatSession(agentId, sessionId, title)
              }
              onDuplicateSession={(agentId: string, sourceSessionId: string, title: string) =>
                callChat(() => api.duplicateAgentChatSession(agentId, sourceSessionId, title))
              }
              onSetSessionPinned={(agentId: string, sessionId: string, pinned: boolean) =>
                api.setAgentChatSessionPinned(agentId, sessionId, pinned)
              }
              onSetSessionArchived={(agentId: string, sessionId: string, archived: boolean) =>
                api.setAgentChatSessionArchived(agentId, sessionId, archived)
              }
              onSetSessionTags={(agentId: string, sessionId: string, tags: string[]) =>
                api.setAgentChatSessionTags(agentId, sessionId, tags)
              }
              onDeleteSession={(agentId: string, sessionId: string) =>
                callChat(async () => {
                  await api.deleteAgentChatSession(agentId, sessionId);
                })
              }
              onLoadSessionMessages={(agentId: string, sessionId: string) =>
                api.listChatSessionMessages(agentId, sessionId)
              }
              onClearSessionMessages={(agentId: string, sessionId: string) =>
                callChat(async () => {
                  await api.clearChatSessionMessages(agentId, sessionId);
                })
              }
            />
          </section>
        )}

        {activeSection === "provider" && (
          <ProviderSettings
            onCreate={(input: CreateProviderRequest) =>
              withAction(async () => {
                await api.createProvider(input);
                setProviders(await api.listProviders());
                await refreshRuntimeStatus();
              })
            }
            onDelete={(id: string) =>
              withAction(async () => {
                await api.deleteProvider(id);
                setProviders(await api.listProviders());
                await refreshRuntimeStatus();
              })
            }
            onUpdate={(id: string, input: UpdateProviderRequest) =>
              withAction(async () => {
                await api.updateProvider(id, input);
                setProviders(await api.listProviders());
                await refreshRuntimeStatus();
              })
            }
            onProbe={(input: ProbeProviderConnectionRequest): Promise<ProbeProviderConnectionResponse> =>
              api.probeProviderConnection(input)
            }
            presets={bootstrap.providerPresets}
            providers={providers}
            saving={saving}
          />
        )}

        {activeSection === "model" && (
          <ModelSettings
            models={models}
            onCreate={(input: CreateModelRequest) =>
              withAction(async () => {
                await api.createModel(input);
                setModels(await api.listModels());
                await refreshRuntimeStatus();
              })
            }
            onDelete={(id: string) =>
              withAction(async () => {
                await api.deleteModel(id);
                setModels(await api.listModels());
                await refreshRuntimeStatus();
              })
            }
            onUpdate={(id: string, input: UpdateModelRequest) =>
              withAction(async () => {
                await api.updateModel(id, input);
                setModels(await api.listModels());
                await refreshRuntimeStatus();
              })
            }
            onProbe={(input: ProbeModelConnectionRequest): Promise<ProbeModelConnectionResponse> =>
              api.probeModelConnection(input)
            }
            providers={providers}
            saving={saving}
          />
        )}

        {activeSection === "agent" && (
          <AgentSettings
            agents={agents}
            models={models}
            onCreate={(input: CreateAgentRequest) =>
              withAction(async () => {
                await api.createAgent(input);
                const nextAgents = await api.listAgents();
                setAgents(nextAgents);
                await refreshRuntimeStatus();
              })
            }
            onDelete={(id: string) =>
              withAction(async () => {
                await api.deleteAgent(id);
                const nextAgents = await api.listAgents();
                setAgents(nextAgents);
                await refreshRuntimeStatus();
              })
            }
            onUpdate={(id: string, input: UpdateAgentRequest) =>
              withAction(async () => {
                await api.updateAgent(id, input);
                const nextAgents = await api.listAgents();
                setAgents(nextAgents);
                await refreshRuntimeStatus();
              })
            }
            saving={saving}
          />
        )}

        {activeSection === "settings" && (
          <section className="panel">
            <header className="panel-header">
              <h2>设置</h2>
            </header>
            <article className="card settings-card">
              <div className="settings-grid">
                <div className="settings-copy">
                  <h3>工作台设置</h3>
                  <small className="hint">当前 Base URL：{headlessBaseUrl || "桌面端内置入口"}</small>
                  <small className="hint">当前环境：{isTauri ? "Tauri Desktop" : "Web Console"}</small>
                  <small className="hint">后端状态：{backendStatus}</small>
                </div>
                <div className="actions settings-actions">
                  <button className="ghost" disabled={saving} onClick={() => void withAction(loadAll)} type="button">
                    刷新全部数据
                  </button>
                  {!isTauri && (
                    <button className="danger" onClick={handleLogout} type="button">
                      退出登录
                    </button>
                  )}
                </div>
              </div>
            </article>
          </section>
        )}

        {error && (
          <div className="error-box">
            <strong>{error.code}</strong>
            <div>{error.message}</div>
          </div>
        )}
      </section>
    </main>
  );
}
