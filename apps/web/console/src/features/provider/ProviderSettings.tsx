import { useEffect, useMemo, useState } from "react";
import { ActionIconButton } from "@/components/ActionIconButton";
import { FormModal } from "@/components/FormModal";
import type {
  CreateProviderRequest,
  ProbeProviderConnectionRequest,
  ProbeProviderConnectionResponse,
  ProviderConfig,
  ProviderPreset,
  UpdateProviderRequest,
} from "@/types";

type Props = {
  presets: ProviderPreset[];
  providers: ProviderConfig[];
  saving: boolean;
  onCreate: (input: CreateProviderRequest) => Promise<void>;
  onUpdate: (id: string, input: UpdateProviderRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onProbe: (input: ProbeProviderConnectionRequest) => Promise<ProbeProviderConnectionResponse>;
};

const toUpdateRequest = (provider: ProviderConfig): UpdateProviderRequest => ({
  displayName: provider.displayName,
  providerKind: provider.providerKind,
  apiBase: provider.apiBase,
  keys: provider.keys.length > 0 ? provider.keys : [""],
  enabled: provider.enabled,
});

const emptyCreateRequest = (preset: ProviderPreset | undefined): CreateProviderRequest => ({
  displayName: preset ? `${preset.name} 配置` : "",
  providerKind: preset?.id ?? "",
  apiBase: preset?.apiBase ?? "",
  keys: [""],
  enabled: true,
});

export function ProviderSettings({
  presets,
  providers,
  saving,
  onCreate,
  onUpdate,
  onDelete,
  onProbe,
}: Props) {
  const presetMap = useMemo(
    () => Object.fromEntries(presets.map((preset) => [preset.id, preset])),
    [presets],
  );
  const [createForm, setCreateForm] = useState<CreateProviderRequest>(() =>
    emptyCreateRequest(presets[0]),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, UpdateProviderRequest>>({});
  const [probing, setProbing] = useState<Record<string, boolean>>({});
  const [probeResults, setProbeResults] = useState<
    Record<string, ProbeProviderConnectionResponse | undefined>
  >({});
  const editingProvider = providers.find((provider) => provider.id === editingProviderId) ?? null;
  const editingDraft = editingProviderId ? drafts[editingProviderId] : undefined;

  useEffect(() => {
    const next: Record<string, UpdateProviderRequest> = {};
    for (const provider of providers) {
      next[provider.id] = toUpdateRequest(provider);
    }
    setDrafts(next);
  }, [providers]);

  useEffect(() => {
    if (createForm.providerKind || presets.length === 0) return;
    setCreateForm(emptyCreateRequest(presets[0]));
  }, [createForm.providerKind, presets]);

  const setDraft = (
    id: string,
    updater: (current: UpdateProviderRequest) => UpdateProviderRequest,
  ) => {
    setDrafts((current) => {
      const target = current[id];
      if (!target) return current;
      return { ...current, [id]: updater(target) };
    });
  };

  const updateKeys = (
    input: CreateProviderRequest | UpdateProviderRequest,
    index: number,
    value: string,
  ) => {
    const keys = [...input.keys];
    keys[index] = value;
    return { ...input, keys };
  };

  const addKey = (input: CreateProviderRequest | UpdateProviderRequest) => ({
    ...input,
    keys: [...input.keys, ""],
  });

  return (
    <section className="panel">
      <header className="panel-header workspace-section-hero">
        <div className="workspace-section-copy">
          <span className="hero-chip hero-chip-soft">Provider Hub</span>
          <h2>提供商</h2>
          <p className="workspace-section-lead">管理模型来源、Key 池和连通性校验，确保后续模型和智能体都有稳定入口。</p>
          <div className="workspace-section-pills">
            <span className="workspace-section-pill">已配置 {providers.length}</span>
            <span className="workspace-section-pill">已启用 {providers.filter((provider) => provider.enabled).length}</span>
            <span className="workspace-section-pill">内置预设 {presets.length}</span>
          </div>
        </div>
        <div className="section-actions">
          <button
            className="primary"
            onClick={() => setShowCreate(true)}
            type="button"
          >
            新增
          </button>
        </div>
      </header>

      {showCreate && (
        <FormModal title="新增提供商配置" onClose={() => setShowCreate(false)}>
          <div className="stack">
            <div className="field-grid">
              <label>
                设置项名称
                <input
                  value={createForm.displayName}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                  placeholder="例如：OpenAI 主力池"
                />
              </label>

              <label>
                提供商类型
                <select
                  value={createForm.providerKind}
                  onChange={(event) => {
                    const preset = presetMap[event.target.value];
                    setCreateForm((current) => ({
                      ...current,
                      providerKind: event.target.value,
                      apiBase: preset?.apiBase ?? current.apiBase,
                    }));
                  }}
                >
                  <option value="">请选择</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              API Base URL
              <input
                value={createForm.apiBase}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    apiBase: event.target.value,
                  }))
                }
                placeholder="https://api.example.com/v1"
              />
            </label>

            <div className="sub-header">
              <strong>Key 池</strong>
              <button
                className="ghost"
                onClick={() => setCreateForm((current) => addKey(current))}
                type="button"
              >
                新增 Key
              </button>
            </div>

            <div className="stack">
              {createForm.keys.map((key, index) => (
                <input
                  key={`create-key-${index}`}
                  value={key}
                  onChange={(event) =>
                    setCreateForm((current) => updateKeys(current, index, event.target.value))
                  }
                  placeholder={`Key #${index + 1}`}
                  type="password"
                />
              ))}
            </div>

            <div className="actions">
              <button className="ghost" onClick={() => setShowCreate(false)} type="button">
                取消
              </button>
              <button
                className="primary"
                disabled={saving}
                onClick={async () => {
                  await onCreate(createForm);
                  setCreateForm(emptyCreateRequest(presets[0]));
                  setShowCreate(false);
                }}
                type="button"
              >
                新建提供商配置
              </button>
            </div>
          </div>
        </FormModal>
      )}

      {editingProvider && editingDraft && (
        <FormModal title={`编辑提供商：${editingProvider.displayName}`} onClose={() => setEditingProviderId(null)}>
          <div className="stack">
            <div className="field-grid">
              <label>
                设置项名称
                <input
                  value={editingDraft.displayName}
                  onChange={(event) =>
                    setDraft(editingProvider.id, (current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                提供商类型
                <select
                  value={editingDraft.providerKind}
                  onChange={(event) => {
                    const nextPreset = presetMap[event.target.value];
                    setDraft(editingProvider.id, (current) => ({
                      ...current,
                      providerKind: event.target.value,
                      apiBase: nextPreset?.apiBase ?? current.apiBase,
                    }));
                  }}
                >
                  <option value="">请选择</option>
                  {presets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              API Base URL
              <input
                value={editingDraft.apiBase}
                onChange={(event) =>
                  setDraft(editingProvider.id, (current) => ({
                    ...current,
                    apiBase: event.target.value,
                  }))
                }
              />
            </label>

            <div className="sub-header">
              <strong>Key 池</strong>
              <button
                className="ghost"
                onClick={() => setDraft(editingProvider.id, (current) => addKey(current))}
                type="button"
              >
                新增 Key
              </button>
            </div>

            <div className="stack">
              {editingDraft.keys.map((key, index) => (
                <input
                  key={`${editingProvider.id}-key-${index}`}
                  value={key}
                  onChange={(event) =>
                    setDraft(editingProvider.id, (current) =>
                      updateKeys(current, index, event.target.value),
                    )
                  }
                  placeholder={`Key #${index + 1}`}
                  type="password"
                />
              ))}
            </div>

            <label className="inline-check">
              <input
                checked={editingDraft.enabled}
                onChange={(event) =>
                  setDraft(editingProvider.id, (current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              启用该提供商配置
            </label>

            <small className="hint">
              {presetMap[editingDraft.providerKind]?.supportsMultiKey
                ? "该提供商建议启用多 Key 轮询。"
                : "该提供商通常使用单 Key，也可拆分多个设置项。"}
            </small>

            <div className="actions">
              <button className="ghost" onClick={() => setEditingProviderId(null)} type="button">
                取消
              </button>
              <button
                className="primary"
                disabled={saving}
                onClick={async () => {
                  await onUpdate(editingProvider.id, editingDraft);
                  setEditingProviderId(null);
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
        {providers.length === 0 && (
          <article className="card settings-summary-empty resource-empty-state">
            <span className="resource-empty-kicker">Provider</span>
            <h3>还没有提供商配置</h3>
            <p>先接入一个模型来源。后面的模型编排、连通测试和智能体配置都会围绕这里展开。</p>
            <div className="actions">
              <button className="primary" onClick={() => setShowCreate(true)} type="button">
                新增第一个提供商
              </button>
            </div>
          </article>
        )}
        {providers.map((provider) => {
          const preset = presetMap[provider.providerKind];
          const probeResult = probeResults[provider.id];
          const probeRunning = probing[provider.id] ?? false;
          const keyCount = provider.keys.filter((key) => key.trim().length > 0).length;

          return (
            <article className="card settings-summary-card" key={provider.id}>
              <div className="settings-summary-head">
                <div className="settings-summary-copy">
                  <h3>{provider.displayName}</h3>
                  <small>{preset?.name ?? provider.providerKind ?? "未选择提供商类型"}</small>
                </div>
                <div className="settings-summary-tools">
                  <span className={provider.enabled ? "status-badge is-live" : "status-badge"}>
                    {provider.enabled ? "已启用" : "已停用"}
                  </span>
                  <div className="settings-summary-actions">
                    <ActionIconButton
                      busy={probeRunning}
                      disabled={saving || probeRunning}
                      icon="probe"
                      label={probeRunning ? "探测中" : "连通测试"}
                      onClick={async () => {
                        setProbing((current) => ({ ...current, [provider.id]: true }));
                        try {
                          const result = await onProbe({ providerId: provider.id });
                          setProbeResults((current) => ({ ...current, [provider.id]: result }));
                        } catch (error) {
                          const message =
                            typeof error === "object" &&
                            error !== null &&
                            "message" in error &&
                            typeof (error as Record<string, unknown>).message === "string"
                              ? ((error as Record<string, unknown>).message as string)
                              : "探测失败";
                          setProbeResults((current) => ({
                            ...current,
                            [provider.id]: {
                              providerId: provider.id,
                              reachable: false,
                              latencyMs: 0,
                              detail: message,
                            },
                          }));
                        } finally {
                          setProbing((current) => ({ ...current, [provider.id]: false }));
                        }
                      }}
                      tone="ghost"
                      type="button"
                    />
                    <ActionIconButton
                      icon="edit"
                      label="编辑设置"
                      onClick={() => setEditingProviderId(provider.id)}
                      tone="primary"
                      type="button"
                    />
                    <ActionIconButton
                      disabled={saving}
                      icon="delete"
                      label="删除"
                      onClick={() => onDelete(provider.id)}
                      tone="danger"
                      type="button"
                    />
                  </div>
                </div>
              </div>
              <div className="settings-summary-meta">
                <span className="settings-summary-pill">API Base：{provider.apiBase || "未设置"}</span>
                <span className="settings-summary-pill">Key：{keyCount}</span>
                <span className="settings-summary-pill">
                  {preset?.supportsMultiKey ? "支持多 Key" : "单 Key / 多配置"}
                </span>
              </div>
              {probeResult && (
                <small className={probeResult.reachable ? "hint" : "error-inline"}>
                  探测结果：{probeResult.reachable ? "可达" : "不可达"} · {probeResult.latencyMs}ms ·{" "}
                  {probeResult.detail}
                </small>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
