import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentSettings } from "@/features/agent/AgentSettings";
import { ModelSettings } from "@/features/model/ModelSettings";
import { ProviderSettings } from "@/features/provider/ProviderSettings";
import {
  getApiClient,
  getHeadlessConfig,
  setHeadlessConfig,
} from "@/lib/apiClient";
import type {
  AgentConfig,
  ApiError,
  AppBootstrap,
  CreateAgentRequest,
  CreateModelRequest,
  CreateProviderRequest,
  ModelConfig,
  ProviderConfig,
  TabKey,
  UpdateAgentRequest,
  UpdateModelRequest,
  UpdateProviderRequest,
} from "@/types";

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "provider", label: "提供商设置" },
  { key: "model", label: "模型设置" },
  { key: "agent", label: "智能体设置" },
];

const fallbackBootstrap: AppBootstrap = {
  appName: "少女智能体",
  appVersion: "0.1.0",
  providerPresets: [],
};

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const api = getApiClient();

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("provider");
  const [bootstrap, setBootstrap] = useState<AppBootstrap>(fallbackBootstrap);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [backendStatus, setBackendStatus] = useState("连接中");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [headlessBaseUrl, setHeadlessBaseUrl] = useState(() => getHeadlessConfig().baseUrl);
  const [headlessToken, setHeadlessToken] = useState(() => getHeadlessConfig().token);

  const withAction = useCallback(async (action: () => Promise<void>) => {
    setSaving(true);
    try {
      await action();
      setError(null);
    } catch (rawError) {
      setError(rawError as ApiError);
    } finally {
      setSaving(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [nextBootstrap, nextProviders, nextModels, nextAgents] = await Promise.all([
        api.getBootstrap(),
        api.listProviders(),
        api.listModels(),
        api.listAgents(),
      ]);
      setBootstrap(nextBootstrap);
      setProviders(nextProviders);
      setModels(nextModels);
      setAgents(nextAgents);
      setBackendStatus("已连接");
      setError(null);
    } catch (rawError) {
      setBackendStatus("未连接");
      setError(rawError as ApiError);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const tabContent = useMemo(() => {
    if (activeTab === "provider") {
      return (
        <ProviderSettings
          onCreate={(input: CreateProviderRequest) =>
            withAction(async () => {
              await api.createProvider(input);
              setProviders(await api.listProviders());
            })
          }
          onDelete={(id: string) =>
            withAction(async () => {
              await api.deleteProvider(id);
              setProviders(await api.listProviders());
            })
          }
          onUpdate={(id: string, input: UpdateProviderRequest) =>
            withAction(async () => {
              await api.updateProvider(id, input);
              setProviders(await api.listProviders());
            })
          }
          presets={bootstrap.providerPresets}
          providers={providers}
          saving={saving}
        />
      );
    }
    if (activeTab === "model") {
      return (
        <ModelSettings
          models={models}
          onCreate={(input: CreateModelRequest) =>
            withAction(async () => {
              await api.createModel(input);
              setModels(await api.listModels());
            })
          }
          onDelete={(id: string) =>
            withAction(async () => {
              await api.deleteModel(id);
              setModels(await api.listModels());
            })
          }
          onUpdate={(id: string, input: UpdateModelRequest) =>
            withAction(async () => {
              await api.updateModel(id, input);
              setModels(await api.listModels());
            })
          }
          providers={providers}
          saving={saving}
        />
      );
    }
    return (
      <AgentSettings
        agents={agents}
        models={models}
        onCreate={(input: CreateAgentRequest) =>
          withAction(async () => {
            await api.createAgent(input);
            setAgents(await api.listAgents());
          })
        }
        onDelete={(id: string) =>
          withAction(async () => {
            await api.deleteAgent(id);
            setAgents(await api.listAgents());
          })
        }
        onUpdate={(id: string, input: UpdateAgentRequest) =>
          withAction(async () => {
            await api.updateAgent(id, input);
            setAgents(await api.listAgents());
          })
        }
        saving={saving}
      />
    );
  }, [
    activeTab,
    agents,
    bootstrap.providerPresets,
    models,
    providers,
    saving,
    withAction,
  ]);

  return (
    <main className="layout">
      <aside className="sidebar">
        <h1>少女智能体</h1>
        <p className="hint">少女智能体配置台</p>
        <small className="hint">
          后端状态：{backendStatus}
          <br />
          版本：{bootstrap.appVersion}
        </small>

        {!isTauri && (
          <div className="card card-dark">
            <strong>无头连接</strong>
            <label>
              Base URL
              <input
                onChange={(event) => setHeadlessBaseUrl(event.target.value)}
                value={headlessBaseUrl}
              />
            </label>
            <label>
              Bearer Token
              <input
                onChange={(event) => setHeadlessToken(event.target.value)}
                type="password"
                value={headlessToken}
              />
            </label>
            <button
              className="ghost"
              onClick={() =>
                withAction(async () => {
                  setHeadlessConfig(headlessBaseUrl, headlessToken);
                  await loadAll();
                })
              }
              type="button"
            >
              应用连接
            </button>
          </div>
        )}

        {error && (
          <div className="error-box">
            <strong>{error.code}</strong>
            <div>{error.message}</div>
          </div>
        )}

        <nav className="nav">
          {tabs.map((tab) => (
            <button
              className={tab.key === activeTab ? "tab active" : "tab"}
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="content">{tabContent}</section>
    </main>
  );
}
