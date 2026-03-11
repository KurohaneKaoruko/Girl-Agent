import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentSettings } from "@/features/agent/AgentSettings";
import { ChatWorkspace } from "@/features/chat/ChatWorkspace";
import { LoginPage } from "@/LoginPage";
import { ModelSettings } from "@/features/model/ModelSettings";
import { NetworkSettings } from "@/features/network/NetworkSettings";
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
  CreateNetworkBindingRequest,
  CreateProviderRequest,
  CreateWorkspaceChatSessionRequest,
  ModelConfig,
  NetworkBindingConfig,
  NetworkBindingRuntimeStatus,
  ProbeModelConnectionRequest,
  ProbeModelConnectionResponse,
  ProbeProviderConnectionRequest,
  ProbeProviderConnectionResponse,
  ProviderConfig,
  RuntimeStatusResponse,
  UpdateAgentRequest,
  UpdateModelRequest,
  UpdateNetworkBindingRequest,
  UpdateProviderRequest,
  UpdateWorkspaceChatSessionRequest,
} from "@/types";

type MainSection = "overview" | "chat" | "provider" | "model" | "agent" | "network" | "settings";
type NavIconName = MainSection;

function NavIcon({ icon }: { icon: NavIconName }) {
  switch (icon) {
    case "overview":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M5 5h5v5H5V5Zm9 0h5v7h-5V5ZM5 14h7v5H5v-5Zm11 1h3v4h-3v-4Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "chat":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M6 17.5 3.5 20v-5A8.5 8.5 0 1 1 12 20.5H6Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "provider":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M8.5 6.5h3v4h-3a2 2 0 0 0 0 4h3v4h-3a6 6 0 0 1 0-12Zm7 0a6 6 0 0 1 0 12h-3v-4h3a2 2 0 0 0 0-4h-3v-4h3Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "model":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M12 4 4 8l8 4 8-4-8-4Zm-8 8 8 4 8-4M4 16l8 4 8-4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "agent":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M12 13a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-6.5 6a6.5 6.5 0 0 1 13 0"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "network":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M12 6.5a6.5 6.5 0 0 0-6.2 4.6H4a2.5 2.5 0 0 0 0 5h2.2a6.5 6.5 0 0 0 11.6 0H20a2.5 2.5 0 0 0 0-5h-1.8A6.5 6.5 0 0 0 12 6.5Zm0 4v4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    default:
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M12 3.5v3m0 11v3m8.5-8.5h-3m-11 0h-3m12.4 5.9-2.1-2.1m-7.6 0-2.1 2.1m0-11.8 2.1 2.1m7.6 0 2.1-2.1"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <circle cx="12" cy="12" fill="currentColor" r="2.6" />
        </svg>
      );
  }
}

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

const navItems: Array<{ key: MainSection; label: string; caption: string; icon: NavIconName }> = [
  { key: "overview", label: "总览", caption: "控制中心", icon: "overview" },
  { key: "chat", label: "聊天", caption: "实时对话", icon: "chat" },
  { key: "provider", label: "提供商", caption: "提供商配置", icon: "provider" },
  { key: "model", label: "模型", caption: "模型编排", icon: "model" },
  { key: "agent", label: "智能体", caption: "角色设定", icon: "agent" },
  { key: "network", label: "网络", caption: "端口绑定", icon: "network" },
  { key: "settings", label: "设置", caption: "工作台设置", icon: "settings" },
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
  const [networkBindings, setNetworkBindings] = useState<NetworkBindingConfig[]>([]);
  const [networkRuntimeStatuses, setNetworkRuntimeStatuses] = useState<NetworkBindingRuntimeStatus[]>([]);
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
    const [
      nextBootstrap,
      nextRuntimeStatus,
      nextProviders,
      nextModels,
      nextAgents,
      nextNetworkBindings,
      nextNetworkRuntimeStatuses,
    ] = await Promise.all([
      api.getBootstrap(),
      api.getRuntimeStatus(),
      api.listProviders(),
      api.listModels(),
      api.listAgents(),
      api.listNetworkBindings(),
      api.listNetworkBindingRuntimeStatuses(),
    ]);
    setBootstrap(nextBootstrap);
    setRuntimeStatus(nextRuntimeStatus);
    setProviders(nextProviders);
    setModels(nextModels);
    setAgents(nextAgents);
    setNetworkBindings(nextNetworkBindings);
    setNetworkRuntimeStatuses(nextNetworkRuntimeStatuses);
    setBackendStatus("已连接");
    setError(null);
  }, []);

  const refreshRuntimeStatus = useCallback(async () => {
    try {
      const [next, nextNetworkRuntimeStatuses] = await Promise.all([
        api.getRuntimeStatus(),
        api.listNetworkBindingRuntimeStatuses(),
      ]);
      setRuntimeStatus(next);
      setNetworkRuntimeStatuses(nextNetworkRuntimeStatuses);
      setBackendStatus("已连接");
    } catch {
      setBackendStatus("未连接");
      setRuntimeStatus(null);
      setNetworkRuntimeStatuses([]);
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
    setNetworkBindings([]);
    setNetworkRuntimeStatuses([]);
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
  const totalResourceCount = providers.length + models.length + agents.length + networkBindings.length;
  const runningNetworkBindingCount = useMemo(
    () => networkRuntimeStatuses.filter((item) => item.running).length,
    [networkRuntimeStatuses],
  );
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
    {
      label: "网络绑定",
      value: networkBindings.length,
      caption: "外部接入端口数",
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
            <span aria-hidden="true" className="app-brand-mark">
              <svg fill="none" viewBox="0 0 24 24">
                <path
                  d="m12 4 2.3 4.8L19.5 10l-3.8 3.7.9 5.3L12 16.5 7.4 19l.9-5.3L4.5 10l5.2-1.2L12 4Z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
              </svg>
            </span>
            <div className="app-brand-copy">
              <span className="app-brand-kicker">少女智能体控制台</span>
              <h1>Girl-Ai-Agent</h1>
            </div>
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
              title={item.label}
              type="button"
            >
              <span aria-hidden="true" className="app-nav-icon">
                <NavIcon icon={item.icon} />
              </span>
              <span className="app-nav-copy">
                <span className="app-nav-label">{item.label}</span>
                <span className="app-nav-caption">{item.caption}</span>
              </span>
            </button>
          ))}
        </nav>
        <div className="app-sidebar-footer">
          <div className={backendStatus === "已连接" ? "sidebar-status-pill online" : "sidebar-status-pill"}>
            <span aria-hidden="true" className="sidebar-status-dot" />
            <span className="sidebar-status-text">后端：{backendStatus}</span>
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
                  <span className="overview-meta-pill">绑定：{networkBindings.length}</span>
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
                <small>运行中绑定：{runningNetworkBindingCount}</small>
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

        {activeSection === "network" && (
          <NetworkSettings
            agents={agents}
            bindings={networkBindings}
            onCreate={(input: CreateNetworkBindingRequest) =>
              withAction(async () => {
                await api.createNetworkBinding(input);
                setNetworkBindings(await api.listNetworkBindings());
                await refreshRuntimeStatus();
              })
            }
            onDelete={(id: string) =>
              withAction(async () => {
                await api.deleteNetworkBinding(id);
                setNetworkBindings(await api.listNetworkBindings());
                await refreshRuntimeStatus();
              })
            }
            onRestart={(id: string) =>
              withAction(async () => {
                await api.restartNetworkBinding(id);
                await refreshRuntimeStatus();
              })
            }
            onUpdate={(id: string, input: UpdateNetworkBindingRequest) =>
              withAction(async () => {
                await api.updateNetworkBinding(id, input);
                setNetworkBindings(await api.listNetworkBindings());
                await refreshRuntimeStatus();
              })
            }
            runtimeStatuses={networkRuntimeStatuses}
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
                  <span className="workspace-section-pill">运行中绑定：{runningNetworkBindingCount}</span>
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
                    <span>网络绑定</span>
                    <strong>{networkBindings.length}</strong>
                    <small>运行中 {runningNetworkBindingCount}</small>
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

