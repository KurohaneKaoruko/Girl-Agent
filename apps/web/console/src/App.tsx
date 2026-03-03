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
  ChatMessage,
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
  { key: "chat", label: "对话测试" },
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
  const [chatAgentId, setChatAgentId] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatModelId, setChatModelId] = useState("");
  const [chatTemperature, setChatTemperature] = useState("");
  const [chatMaxTokens, setChatMaxTokens] = useState("");
  const [chatTopP, setChatTopP] = useState("");
  const [chatFrequencyPenalty, setChatFrequencyPenalty] = useState("");

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

  useEffect(() => {
    if (!chatAgentId && agents.length > 0) {
      setChatAgentId(agents[0].id);
    }
  }, [agents, chatAgentId]);

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
    if (activeTab === "chat") {
      return (
        <section className="panel">
          <header className="panel-header">
            <h2>对话测试</h2>
          </header>
          <div className="card">
            <label>
              选择智能体
              <select
                onChange={(event) => setChatAgentId(event.target.value)}
                value={chatAgentId}
              >
                {agents.length === 0 && <option value="">暂无智能体</option>}
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="chat-log">
              {chatMessages.length === 0 && (
                <p className="hint">发送第一条消息开始测试模型回复。</p>
              )}
              {chatMessages.map((item, index) => (
                <div
                  className={item.role === "assistant" ? "chat-bubble assistant" : "chat-bubble user"}
                  key={`${item.role}-${index}`}
                >
                  <strong>{item.role === "assistant" ? "少女智能体" : "你"}</strong>
                  <p>{item.content}</p>
                </div>
              ))}
            </div>

            <label>
              输入消息
              <textarea
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="输入你想说的话..."
                rows={4}
                value={chatInput}
              />
            </label>

            <div className="field-grid">
              <label>
                æœ¬æ¬¡æ¸©åº¦è¦†ç›–ï¼ˆå¯é€‰ï¼‰
                <input
                  max="2"
                  min="0"
                  onChange={(event) => setChatTemperature(event.target.value)}
                  placeholder="ç•™ç©ºåˆ™ä½¿ç”¨æ™ºèƒ½ä½“é…ç½®"
                  step="0.1"
                  type="number"
                  value={chatTemperature}
                />
              </label>
              <label>
                æœ¬æ¬¡ Max Tokens è¦†ç›–ï¼ˆå¯é€‰ï¼‰
                <input
                  min="1"
                  onChange={(event) => setChatMaxTokens(event.target.value)}
                  placeholder="ç•™ç©ºåˆ™ä½¿ç”¨æ™ºèƒ½ä½“é…ç½®"
                  type="number"
	                  value={chatMaxTokens}
	                />
	              </label>
	              <label>
	                Top P Override
	                <input
	                  max="1"
	                  min="0"
	                  onChange={(event) => setChatTopP(event.target.value)}
	                  placeholder="Leave empty to use agent/model setting"
	                  step="0.05"
	                  type="number"
	                  value={chatTopP}
	                />
	              </label>
	              <label>
	                Frequency Penalty Override
	                <input
	                  max="2"
	                  min="-2"
	                  onChange={(event) => setChatFrequencyPenalty(event.target.value)}
	                  placeholder="Leave empty to use agent/model setting"
	                  step="0.1"
	                  type="number"
	                  value={chatFrequencyPenalty}
	                />
	              </label>
	            </div>

            <div className="actions">
              <button
                className="primary"
                disabled={saving || !chatAgentId || !chatInput.trim()}
                onClick={() =>
                  withAction(async () => {
                    const userMessage = chatInput.trim();
                    const history = [...chatMessages];
                    const parsedTemperature = chatTemperature.trim()
                      ? Number(chatTemperature)
                      : null;
                    const parsedMaxTokens = chatMaxTokens.trim() ? Number(chatMaxTokens) : null;
                    const parsedTopP = chatTopP.trim() ? Number(chatTopP) : null;
                    const parsedFrequencyPenalty = chatFrequencyPenalty.trim()
                      ? Number(chatFrequencyPenalty)
                      : null;
                    const result = await api.chatWithAgent({
                      agentId: chatAgentId,
                      userMessage,
                      history,
                      temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : null,
                      maxTokens: Number.isFinite(parsedMaxTokens) ? parsedMaxTokens : null,
                      topP: Number.isFinite(parsedTopP) ? parsedTopP : null,
                      frequencyPenalty: Number.isFinite(parsedFrequencyPenalty)
                        ? parsedFrequencyPenalty
                        : null,
                    });

                    setChatMessages((previous) => [
                      ...previous,
                      { role: "user", content: userMessage },
                      { role: "assistant", content: result.message },
                    ]);
                    setChatInput("");
                    setChatModelId(result.modelId);
                  })
                }
                type="button"
              >
                发送
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setChatMessages([]);
                  setChatModelId("");
                  setChatTemperature("");
                  setChatMaxTokens("");
                  setChatTopP("");
                  setChatFrequencyPenalty("");
                }}
                type="button"
              >
                清空会话
              </button>
            </div>

            {chatModelId && <small className="hint">最近回复模型：{chatModelId}</small>}
          </div>
        </section>
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
    chatAgentId,
    chatInput,
    chatMessages,
    chatModelId,
    chatMaxTokens,
    chatFrequencyPenalty,
    chatTopP,
    chatTemperature,
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
