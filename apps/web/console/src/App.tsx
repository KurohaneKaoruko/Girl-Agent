import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentSettings } from "@/features/agent/AgentSettings";
import { ChatWorkspace } from "@/features/chat/ChatWorkspace";
import { LoginPage } from "@/LoginPage";
import { ModelSettings } from "@/features/model/ModelSettings";
import { ProviderSettings } from "@/features/provider/ProviderSettings";
import { describeApiError } from "@/lib/errorDisplay";
import { getApiClient, getHeadlessConfig, setHeadlessConfig } from "@/lib/apiClient";
import type {
  AgentConfig,
  ApiError,
  AppBootstrap,
  ChatWithSessionRequest,
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
  RuntimeStatusResponse,
  UpdateAgentRequest,
  UpdateModelRequest,
  UpdateProviderRequest,
  UpdateWorkspaceChatSessionRequest,
} from "@/types";

type MainSection = "overview" | "chat" | "provider" | "model" | "agent" | "settings";

const fallbackBootstrap: AppBootstrap = {
  appName: "Girl-Ai-Agent",
  appVersion: "0.1.0",
  apiVersion: "1.0.0",
  providerPresets: [],
};

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const api = getApiClient();
const LOGIN_SESSION_KEY = "girl-ai-agent.console.loggedIn.v1";
const MOBILE_NAV_MEDIA_QUERY = "(max-width: 880px)";

const navItems: Array<{ key: MainSection; label: string; caption: string }> = [
  { key: "overview", label: "总览", caption: "控制中心" },
  { key: "chat", label: "聊天", caption: "实时对话" },
  { key: "provider", label: "提供商", caption: "提供商配置" },
  { key: "model", label: "模型", caption: "模型编排" },
  { key: "agent", label: "智能体", caption: "角色设定" },
  { key: "settings", label: "设置", caption: "工作台设置" },
];

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

const isMobileViewport = (): boolean =>
  typeof window !== "undefined" && window.matchMedia(MOBILE_NAV_MEDIA_QUERY).matches;

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
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const errorDisplay = error ? describeApiError(error) : null;

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
    if (typeof window === "undefined") {
      return;
    }
    const mediaQuery = window.matchMedia(MOBILE_NAV_MEDIA_QUERY);
    const handleViewportChange = (event: MediaQueryListEvent | MediaQueryList) => {
      if (!event.matches) {
        setIsMobileNavOpen(false);
      }
    };

    handleViewportChange(mediaQuery);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleViewportChange);
      return () => mediaQuery.removeEventListener("change", handleViewportChange);
    }
    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

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

  const featuredAgent = useMemo(() => agents[0] ?? null, [agents]);
  const enabledProviderCount = useMemo(() => providers.filter((provider) => provider.enabled).length, [providers]);
  const enabledModelCount = useMemo(() => models.filter((model) => model.enabled).length, [models]);
  const ambientAgentCount = useMemo(
    () => agents.filter((agent) => agent.mode === "ambient").length,
    [agents],
  );
  const totalResourceCount = providers.length + models.length + agents.length;
  const handleSectionSelect = useCallback((section: MainSection) => {
    setActiveSection(section);
    if (isMobileViewport()) {
      setIsMobileNavOpen(false);
    }
  }, []);
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
      <aside className={isMobileNavOpen ? "app-sidebar mobile-nav-open" : "app-sidebar"}>
        <div className="app-brand">
          <div className="app-brand-main">
            <span className="app-brand-kicker">少女智能体控制台</span>
            <h1>Girl-Ai-Agent</h1>
          </div>
          <button
            aria-controls="console-nav"
            aria-expanded={isMobileNavOpen}
            className="app-sidebar-toggle"
            onClick={() => setIsMobileNavOpen((current) => !current)}
            type="button"
          >
            {isMobileNavOpen ? "收起" : "菜单"}
          </button>
        </div>
        <nav className="app-nav" id="console-nav">
          {navItems.map((item) => (
            <button
              className={item.key === activeSection ? "app-nav-item active" : "app-nav-item"}
              key={item.key}
              onClick={() => handleSectionSelect(item.key)}
              type="button"
            >
              <span className="app-nav-label">{item.label}</span>
              <span className="app-nav-caption">{item.caption}</span>
            </button>
          ))}
        </nav>
        <div className="app-sidebar-footer">
          <div className={backendStatus === "已连接" ? "sidebar-status-pill online" : "sidebar-status-pill"}>
            <span>后端：{backendStatus}</span>
          </div>
          <div className="sidebar-meta">
            <span>v{bootstrap.appVersion}</span>
            <span>{isTauri ? "桌面端" : "网页端"}</span>
          </div>
        </div>
      </aside>

      <section className="app-content">
        {activeSection === "overview" && (
          <section className="panel panel-overview">
            <article className="overview-hero-card">
              <div className="overview-hero-copy">
                <span className="hero-chip hero-chip-soft">Girl AI Agent</span>
                <h3>系统总览</h3>
                <p>统一查看运行状态、主要资源和当前控制台连接，不再在不同页面之间来回确认。</p>
                <div className="overview-meta-row">
                  <span className="overview-meta-pill">{bootstrap.appName}</span>
                  <span className="overview-meta-pill">入口：{isTauri ? "桌面端" : "网页端"}</span>
                  <span className="overview-meta-pill">后端：{backendStatus}</span>
                  <span className="overview-meta-pill">智能体：{agents.length}</span>
                </div>
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
                <div className="overview-mini-grid">
                  <article className="overview-mini-card">
                    <small>资源总数</small>
                    <strong>{totalResourceCount}</strong>
                    <span>提供商、模型、智能体合计</span>
                  </article>
                  <article className="overview-mini-card">
                    <small>启用模型</small>
                    <strong>{enabledModelCount}</strong>
                    <span>当前可直接参与工作流</span>
                  </article>
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
                <small>示例智能体：{featuredAgent?.name ?? "尚未创建"}</small>
                <small>运行模式：{featuredAgent?.mode ?? "等待配置"}</small>
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
          <ChatWorkspace
            agents={agents}
            disabled={saving}
            onListSessions={() => callChat(() => api.listWorkspaceChatSessions())}
            onCreateSession={(input: CreateWorkspaceChatSessionRequest) =>
              callChat(() => api.createWorkspaceChatSession(input))
            }
            onUpdateSession={(sessionId: string, input: UpdateWorkspaceChatSessionRequest) =>
              callChat(() => api.updateWorkspaceChatSession(sessionId, input))
            }
            onDeleteSession={(sessionId: string) =>
              callChat(async () => {
                await api.deleteWorkspaceChatSession(sessionId);
              })
            }
            onListMessages={(sessionId: string) => callChat(() => api.listWorkspaceChatMessages(sessionId))}
            onClearMessages={(sessionId: string) =>
              callChat(async () => {
                await api.clearWorkspaceChatMessages(sessionId);
              })
            }
            onOpenAgentSettings={() => handleSectionSelect("agent")}
            onSendMessageStream={(
              input: ChatWithSessionRequest,
              onReplyStart,
              onDelta,
              signal?: AbortSignal,
            ) =>
              callChat(() => api.chatWithSessionStream(input, onReplyStart, onDelta, signal), true).then(
                () => undefined,
              )}
          />
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
            <header className="panel-header workspace-section-hero">
              <div className="workspace-section-copy">
                <span className="hero-chip hero-chip-soft">Workspace Settings</span>
                <h2>设置</h2>
                <p className="workspace-section-lead">管理当前控制台连接、刷新、登录状态以及工作台资源概览。</p>
                <div className="workspace-section-pills">
                  <span className="workspace-section-pill">后端：{backendStatus}</span>
                  <span className="workspace-section-pill">Base URL：{headlessBaseUrl || "桌面端内置入口"}</span>
                  <span className="workspace-section-pill">会话：{runtimeStatus?.sessionCount ?? 0}</span>
                  <span className="workspace-section-pill">Ambient 智能体：{ambientAgentCount}</span>
                </div>
              </div>
            </header>
            <div className="settings-panel-grid">
              <article className="card settings-card">
                <div className="settings-grid">
                  <div className="settings-copy">
                    <h3>连接与登录</h3>
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
              <article className="card settings-card settings-card-secondary">
                <div className="settings-copy">
                  <h3>工作台概览</h3>
                  <small className="hint">把当前连接下的关键资源、活跃能力和运行状态集中在一处查看。</small>
                </div>
                <div className="settings-fact-grid">
                  <article className="settings-fact-card">
                    <span>提供商</span>
                    <strong>{providers.length}</strong>
                    <small>已启用 {enabledProviderCount}</small>
                  </article>
                  <article className="settings-fact-card">
                    <span>模型</span>
                    <strong>{models.length}</strong>
                    <small>已启用 {enabledModelCount}</small>
                  </article>
                  <article className="settings-fact-card">
                    <span>智能体</span>
                    <strong>{agents.length}</strong>
                    <small>常驻 {ambientAgentCount}</small>
                  </article>
                  <article className="settings-fact-card">
                    <span>会话</span>
                    <strong>{runtimeStatus?.sessionCount ?? 0}</strong>
                    <small>消息 {runtimeStatus?.messageCount ?? 0}</small>
                  </article>
                </div>
              </article>
            </div>
          </section>
        )}

        {error && errorDisplay && (
          <div className="error-box">
            <strong>{errorDisplay.title}</strong>
            <div>{errorDisplay.message}</div>
          </div>
        )}
      </section>
    </main>
  );
}

