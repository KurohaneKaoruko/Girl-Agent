import { useEffect, useMemo, useState } from "react";
import { FormModal } from "@/components/FormModal";
import type {
  AgentConfig,
  CreateNetworkBindingRequest,
  NetworkBindingConfig,
  NetworkBindingRuntimeStatus,
  NetworkSessionMode,
  NetworkTransportKind,
  UpdateNetworkBindingRequest,
} from "@/types";

type Props = {
  agents: AgentConfig[];
  bindings: NetworkBindingConfig[];
  runtimeStatuses: NetworkBindingRuntimeStatus[];
  saving: boolean;
  onCreate: (input: CreateNetworkBindingRequest) => Promise<void>;
  onUpdate: (id: string, input: UpdateNetworkBindingRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRestart: (id: string) => Promise<void>;
};

type BindingFormDraft = {
  name: string;
  enabled: boolean;
  transportKind: NetworkTransportKind;
  bindHost: string;
  bindPort: string;
  targetUrl: string;
  agentId: string;
  sessionMode: NetworkSessionMode;
  metadataText: string;
};

const transportOptions: Array<{ value: NetworkTransportKind; label: string }> = [
  { value: "http_server", label: "HTTP Server" },
  { value: "http_client", label: "HTTP Client" },
  { value: "websocket_server", label: "WebSocket Server" },
  { value: "websocket_client", label: "WebSocket Client" },
];

const sessionModeOptions: Array<{ value: NetworkSessionMode; label: string }> = [
  { value: "external_session", label: "外部会话" },
  { value: "shared", label: "共享会话" },
];

function createEmptyDraft(agentId: string): BindingFormDraft {
  return {
    name: "",
    enabled: true,
    transportKind: "http_server",
    bindHost: "127.0.0.1",
    bindPort: "19010",
    targetUrl: "",
    agentId,
    sessionMode: "external_session",
    metadataText: "{}",
  };
}

function toDraft(binding: NetworkBindingConfig): BindingFormDraft {
  return {
    name: binding.name,
    enabled: binding.enabled,
    transportKind: binding.transportKind,
    bindHost: binding.bindHost ?? "",
    bindPort: binding.bindPort === null ? "" : String(binding.bindPort),
    targetUrl: binding.targetUrl ?? "",
    agentId: binding.agentId,
    sessionMode: binding.sessionMode,
    metadataText: JSON.stringify(binding.metadata ?? {}, null, 2),
  };
}

function toRequest(draft: BindingFormDraft): CreateNetworkBindingRequest {
  const parsedMetadata = JSON.parse(draft.metadataText || "{}") as Record<string, unknown>;
  if (parsedMetadata === null || Array.isArray(parsedMetadata)) {
    throw new Error("Metadata 必须是 JSON 对象");
  }
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    transportKind: draft.transportKind,
    bindHost: draft.bindHost.trim() || null,
    bindPort: draft.bindPort.trim() ? Number(draft.bindPort.trim()) : null,
    targetUrl: draft.targetUrl.trim() || null,
    agentId: draft.agentId,
    sessionMode: draft.sessionMode,
    metadata: parsedMetadata,
  };
}

function formatActivity(ts: number | null) {
  if (!ts) {
    return "暂无";
  }
  return new Date(ts).toLocaleString();
}

export function NetworkSettings({
  agents,
  bindings,
  runtimeStatuses,
  saving,
  onCreate,
  onUpdate,
  onDelete,
  onRestart,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState<BindingFormDraft>(() =>
    createEmptyDraft(agents[0]?.id ?? ""),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, BindingFormDraft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const runtimeById = useMemo(
    () => Object.fromEntries(runtimeStatuses.map((status) => [status.bindingId, status])),
    [runtimeStatuses],
  );
  const agentNameById = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const editingBinding = editingId ? bindings.find((binding) => binding.id === editingId) ?? null : null;

  useEffect(() => {
    setDrafts(Object.fromEntries(bindings.map((binding) => [binding.id, toDraft(binding)])));
  }, [bindings]);

  useEffect(() => {
    setCreateDraft((current) => {
      if (current.agentId || agents.length === 0) {
        return current;
      }
      return { ...current, agentId: agents[0].id };
    });
  }, [agents]);

  const renderForm = (
    draft: BindingFormDraft,
    onChange: (value: BindingFormDraft) => void,
  ) => {
    const isServer = draft.transportKind === "http_server" || draft.transportKind === "websocket_server";
    const isClient = draft.transportKind === "http_client" || draft.transportKind === "websocket_client";

    return (
      <div className="stack">
        <div className="field-grid">
          <label>
            绑定名称
            <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
          </label>
          <label>
            绑定智能体
            <select value={draft.agentId} onChange={(event) => onChange({ ...draft, agentId: event.target.value })}>
              <option value="">请选择</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-grid">
          <label>
            传输类型
            <select
              value={draft.transportKind}
              onChange={(event) =>
                onChange({ ...draft, transportKind: event.target.value as NetworkTransportKind })
              }
            >
              {transportOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            会话模式
            <select
              value={draft.sessionMode}
              onChange={(event) => onChange({ ...draft, sessionMode: event.target.value as NetworkSessionMode })}
            >
              {sessionModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isServer && (
          <div className="field-grid">
            <label>
              Bind Host
              <input value={draft.bindHost} onChange={(event) => onChange({ ...draft, bindHost: event.target.value })} />
            </label>
            <label>
              Bind Port
              <input value={draft.bindPort} onChange={(event) => onChange({ ...draft, bindPort: event.target.value })} />
            </label>
          </div>
        )}

        {isClient && (
          <label>
            Target URL
            <input value={draft.targetUrl} onChange={(event) => onChange({ ...draft, targetUrl: event.target.value })} />
          </label>
        )}

        <label className="inline-check">
          <input
            checked={draft.enabled}
            type="checkbox"
            onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
          />
          启用此绑定
        </label>

        <label>
          Metadata (JSON)
          <textarea
            rows={6}
            value={draft.metadataText}
            onChange={(event) => onChange({ ...draft, metadataText: event.target.value })}
          />
        </label>
      </div>
    );
  };

  return (
    <section className="panel">
      <header className="panel-header workspace-section-hero">
        <div className="workspace-section-copy">
          <span className="hero-chip hero-chip-soft">Network Binding</span>
          <h2>网络配置</h2>
          <p className="workspace-section-lead">把某个智能体绑定到网络入口，让 Game 或外部系统通过端口接入它。</p>
          <div className="workspace-section-pills">
            <span className="workspace-section-pill">绑定 {bindings.length}</span>
            <span className="workspace-section-pill">运行中 {runtimeStatuses.filter((item) => item.running).length}</span>
            <span className="workspace-section-pill">可绑定智能体 {agents.length}</span>
          </div>
        </div>
        <div className="section-actions">
          <button className="primary" disabled={agents.length === 0} onClick={() => setShowCreate(true)} type="button">
            新增
          </button>
        </div>
      </header>

      {showCreate && (
        <FormModal title="新增网络绑定" onClose={() => { setShowCreate(false); setFormError(null); }}>
          <div className="stack">
            {renderForm(createDraft, setCreateDraft)}
            {formError && <div className="error-box"><strong>表单错误</strong><div>{formError}</div></div>}
            <div className="actions">
              <button className="ghost" onClick={() => setShowCreate(false)} type="button">取消</button>
              <button
                className="primary"
                disabled={saving || agents.length === 0}
                onClick={async () => {
                  try {
                    setFormError(null);
                    await onCreate(toRequest(createDraft));
                    setCreateDraft(createEmptyDraft(agents[0]?.id ?? ""));
                    setShowCreate(false);
                  } catch (error) {
                    setFormError(error instanceof Error ? error.message : "创建失败");
                  }
                }}
                type="button"
              >
                创建绑定
              </button>
            </div>
          </div>
        </FormModal>
      )}

      {editingBinding && drafts[editingBinding.id] && (
        <FormModal title={`编辑绑定：${editingBinding.name}`} onClose={() => { setEditingId(null); setFormError(null); }}>
          <div className="stack">
            {renderForm(drafts[editingBinding.id], (value) =>
              setDrafts((current) => ({ ...current, [editingBinding.id]: value }))
            )}
            {formError && <div className="error-box"><strong>表单错误</strong><div>{formError}</div></div>}
            <div className="actions">
              <button className="ghost" onClick={() => setEditingId(null)} type="button">取消</button>
              <button
                className="primary"
                disabled={saving}
                onClick={async () => {
                  try {
                    setFormError(null);
                    await onUpdate(editingBinding.id, toRequest(drafts[editingBinding.id]));
                    setEditingId(null);
                  } catch (error) {
                    setFormError(error instanceof Error ? error.message : "保存失败");
                  }
                }}
                type="button"
              >
                保存设置
              </button>
            </div>
          </div>
        </FormModal>
      )}

      <div className="settings-summary-list">
        {bindings.length === 0 && (
          <article className="card settings-summary-empty resource-empty-state">
            <span className="resource-empty-kicker">Network</span>
            <h3>还没有网络绑定</h3>
            <p>先选择一个智能体，再把它挂到 HTTP 或 WebSocket 入口，让 Game 能通过端口接入。</p>
          </article>
        )}

        {bindings.map((binding) => {
          const runtime = runtimeById[binding.id];
          const address = binding.bindHost && binding.bindPort ? `${binding.bindHost}:${binding.bindPort}` : binding.targetUrl;
          return (
            <article className="card settings-summary-card" key={binding.id}>
              <div className="settings-summary-head">
                <div className="settings-summary-copy">
                  <h3>{binding.name}</h3>
                  <small>{binding.transportKind}</small>
                  <p>{address || "未配置地址"} | 绑定智能体：{agentNameById[binding.agentId] ?? binding.agentId}</p>
                </div>
                <div className="settings-summary-tools">
                  <span className={runtime?.running ? "status-badge is-live" : "status-badge"}>
                    {runtime?.state ?? (binding.enabled ? "starting" : "stopped")}
                  </span>
                  <div className="settings-summary-actions">
                    <button className="ghost" disabled={saving} onClick={() => void onRestart(binding.id)} type="button">
                      重启
                    </button>
                    <button className="ghost" onClick={() => setEditingId(binding.id)} type="button">
                      编辑
                    </button>
                    <button className="danger" disabled={saving} onClick={() => void onDelete(binding.id)} type="button">
                      删除
                    </button>
                  </div>
                </div>
              </div>
              <div className="settings-summary-meta">
                <span className="settings-summary-pill">会话模式：{binding.sessionMode}</span>
                <span className="settings-summary-pill">启用：{binding.enabled ? "是" : "否"}</span>
                <span className="settings-summary-pill">最近活动：{formatActivity(runtime?.lastActivityAtMs ?? null)}</span>
              </div>
              {runtime && (
                <div className="stack">
                  <small>运行状态：{runtime.detail}</small>
                  {runtime.lastError && <small>最近错误：{runtime.lastError}</small>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
