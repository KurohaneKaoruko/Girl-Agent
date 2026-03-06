import { useEffect, useState } from "react";
import { ActionIconButton } from "@/components/ActionIconButton";
import { FormModal } from "@/components/FormModal";
import type {
  CreateModelRequest,
  ModelCapabilities,
  ModelCategory,
  ModelConfig,
  ProbeModelConnectionRequest,
  ProbeModelConnectionResponse,
  ProviderConfig,
  UpdateModelRequest,
} from "@/types";

type Props = {
  providers: ProviderConfig[];
  models: ModelConfig[];
  saving: boolean;
  onCreate: (input: CreateModelRequest) => Promise<void>;
  onUpdate: (id: string, input: UpdateModelRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onProbe: (input: ProbeModelConnectionRequest) => Promise<ProbeModelConnectionResponse>;
};

type ModeOption = {
  value: string;
  label: string;
};

const commonModeOptions: ModeOption[] = [
  { value: "text", label: "文本" },
  { value: "image", label: "图像" },
  { value: "audio", label: "音频" },
  { value: "video", label: "视频" },
];

const commonModeValueSet = new Set(commonModeOptions.map((item) => item.value));

const uniqueModes = (values: string[]) =>
  Array.from(
    new Set(
      values
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    ),
  );

const splitModes = (text: string) =>
  uniqueModes(text.split(/[,\n，]/));

const joinModes = (values: string[]) => values.join(", ");
const hasMode = (values: string[], target: string) =>
  values.some((item) => item.trim().toLowerCase() === target);
const toggleMode = (values: string[], target: string) =>
  hasMode(values, target)
    ? values.filter((item) => item.trim().toLowerCase() !== target)
    : uniqueModes([...values, target]);
const extractCustomModes = (values: string[]) =>
  values.filter((item) => !commonModeValueSet.has(item.trim().toLowerCase()));
const syncCustomModes = (values: string[], raw: string) =>
  uniqueModes([
    ...values.filter((item) => commonModeValueSet.has(item.trim().toLowerCase())),
    ...splitModes(raw).filter((item) => !commonModeValueSet.has(item)),
  ]);
const formatModes = (values: string[]) => (values.length > 0 ? values.join(" + ") : "未设置");

const defaultCapabilities = (): ModelCapabilities => ({
  inputModes: ["text"],
  outputModes: ["text"],
  supportsFunctionCall: false,
  supportsStreaming: true,
  maxContextWindow: null,
});

const defaultCreateForm = (): CreateModelRequest => ({
  name: "",
  providerRef: null,
  customProvider: null,
  modelId: "",
  category: "llm",
  categories: ["llm"],
  capabilities: defaultCapabilities(),
  params: {
    temperature: 0.8,
    maxTokens: 2048,
    topP: 1,
    frequencyPenalty: 0,
  },
  enabled: true,
});

const toUpdateForm = (model: ModelConfig): UpdateModelRequest => ({
  name: model.name,
  providerRef: model.providerRef,
  customProvider: model.customProvider,
  modelId: model.modelId,
  category: model.category,
  categories: resolveCategories(model.category, model.categories),
  capabilities: model.capabilities,
  params: model.params,
  enabled: model.enabled,
});

const categoryOptions: Array<{ label: string; value: ModelCategory }> = [
  { label: "语言 (LLM)", value: "llm" },
  { label: "视觉 (VLM)", value: "vlm" },
  { label: "语音识别 (ASR)", value: "asr" },
  { label: "语音合成 (TTS)", value: "tts" },
];

const categoryLabelByValue: Record<ModelCategory, string> = {
  llm: "语言",
  vlm: "视觉",
  asr: "语音识别",
  tts: "语音合成",
};

const categoryPresetByValue: Record<
  ModelCategory,
  { inputModes: string[]; outputModes: string[]; hint: string }
> = {
  llm: {
    inputModes: ["text"],
    outputModes: ["text"],
    hint: "文本 -> 文本",
  },
  vlm: {
    inputModes: ["text", "image"],
    outputModes: ["text"],
    hint: "文本/图像 -> 文本",
  },
  asr: {
    inputModes: ["audio"],
    outputModes: ["text"],
    hint: "音频 -> 文本",
  },
  tts: {
    inputModes: ["text"],
    outputModes: ["audio"],
    hint: "文本 -> 音频",
  },
};

const resolveCategories = (category: ModelCategory, categories?: ModelCategory[]) =>
  Array.from(new Set((categories?.length ? categories : [category]) as ModelCategory[]));
const hasCategory = (values: ModelCategory[], target: ModelCategory) => values.includes(target);
const toggleCategory = (values: ModelCategory[], target: ModelCategory) => {
  if (hasCategory(values, target)) {
    return values.length === 1 ? values : values.filter((item) => item !== target);
  }
  return [...values, target];
};
const formatCategories = (values: ModelCategory[]) =>
  values.map((item) => categoryLabelByValue[item]).join(" + ");
const recommendedModesForCategories = (categories: ModelCategory[]) => ({
  inputModes: uniqueModes(categories.flatMap((item) => categoryPresetByValue[item].inputModes)),
  outputModes: uniqueModes(categories.flatMap((item) => categoryPresetByValue[item].outputModes)),
});
const applyCategoryPresets = (
  capabilities: ModelCapabilities,
  categories: ModelCategory[],
): ModelCapabilities => {
  const recommended = recommendedModesForCategories(categories);
  return {
    ...capabilities,
    inputModes: uniqueModes([...recommended.inputModes, ...capabilities.inputModes]),
    outputModes: uniqueModes([...recommended.outputModes, ...capabilities.outputModes]),
  };
};
const describeCategoryPresets = (categories: ModelCategory[]) =>
  categories
    .map((item) => `${categoryLabelByValue[item]}：${categoryPresetByValue[item].hint}`)
    .join(" · ");

function ModeSelector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <div className="mode-select-panel">
      <span className="mode-select-label">{label}</span>
      <div className="mode-toggle-grid">
        {commonModeOptions.map((option) => (
          <button
            className={hasMode(value, option.value) ? "mode-toggle active" : "mode-toggle"}
            key={`${label}-${option.value}`}
            onClick={() => onChange(toggleMode(value, option.value))}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <label>
        其他模态（逗号分隔，可选）
        <input
          onChange={(event) => onChange(syncCustomModes(value, event.target.value))}
          placeholder="例如：depth, sensor"
          value={joinModes(extractCustomModes(value))}
        />
      </label>
    </div>
  );
}

function CategorySelector({
  value,
  onChange,
}: {
  value: ModelCategory[];
  onChange: (value: ModelCategory[]) => void;
}) {
  return (
    <div className="mode-select-panel">
      <span className="mode-select-label">模型类型（可多选）</span>
      <div className="category-toggle-grid">
        {categoryOptions.map((option) => (
          <button
            className={hasCategory(value, option.value) ? "category-toggle active" : "category-toggle"}
            key={option.value}
            onClick={() => onChange(toggleCategory(value, option.value))}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelForm({
  title,
  value,
  providers,
  onChange,
  showTitle = true,
}: {
  title: string;
  value: CreateModelRequest | UpdateModelRequest;
  providers: ProviderConfig[];
  onChange: (value: CreateModelRequest | UpdateModelRequest) => void;
  showTitle?: boolean;
}) {
  const useCustomProvider = value.customProvider !== null;
  const resolvedCategories = resolveCategories(value.category, value.categories);

  return (
    <>
      {showTitle && <h3>{title}</h3>}
      <div className="field-grid">
        <label>
          模型名称
          <input
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            placeholder="例如：主对话模型"
            value={value.name}
          />
        </label>

        <label>
          模型 ID
          <input
            onChange={(event) => onChange({ ...value, modelId: event.target.value })}
            placeholder="例如：gpt-4.1-mini"
            value={value.modelId}
          />
        </label>
      </div>

      <div className="field-grid">
        <CategorySelector
          onChange={(nextCategories) => {
            onChange({
              ...value,
              category: nextCategories[0],
              categories: nextCategories,
              capabilities: applyCategoryPresets(value.capabilities, nextCategories),
            });
          }}
          value={resolvedCategories}
        />

        <label className="inline-check">
          <input
            checked={useCustomProvider}
            onChange={(event) => {
              if (event.target.checked) {
                onChange({
                  ...value,
                  providerRef: null,
                  customProvider: { apiBase: "", apiKey: "" },
                });
              } else {
                onChange({
                  ...value,
                  providerRef: providers[0]?.id ?? null,
                  customProvider: null,
                });
              }
            }}
            type="checkbox"
          />
          使用自定义 Provider
        </label>
      </div>

      <small className="hint">
        推荐预设：{describeCategoryPresets(resolvedCategories)}。切换类型时会补齐推荐模态，不会删除你已手动设置的能力。
      </small>

      {useCustomProvider ? (
        <div className="field-grid">
          <label>
            自定义 API Base
            <input
              onChange={(event) =>
                onChange({
                  ...value,
                  customProvider: {
                    apiBase: event.target.value,
                    apiKey: value.customProvider?.apiKey ?? "",
                  },
                })
              }
              placeholder="https://api.example.com/v1"
              value={value.customProvider?.apiBase ?? ""}
            />
          </label>

          <label>
            自定义 Key
            <input
              onChange={(event) =>
                onChange({
                  ...value,
                  customProvider: {
                    apiBase: value.customProvider?.apiBase ?? "",
                    apiKey: event.target.value,
                  },
                })
              }
              type="password"
              value={value.customProvider?.apiKey ?? ""}
            />
          </label>
        </div>
      ) : (
        <label>
          引用提供商设置
          <select
            onChange={(event) =>
              onChange({
                ...value,
                providerRef: event.target.value || null,
                customProvider: null,
              })
            }
            value={value.providerRef ?? ""}
          >
            <option value="">请选择</option>
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="field-grid">
        <ModeSelector
          label="输入模态"
          onChange={(nextModes) =>
            onChange({
              ...value,
              capabilities: {
                ...value.capabilities,
                inputModes: nextModes,
              },
            })
          }
          value={value.capabilities.inputModes}
        />

        <ModeSelector
          label="输出模态"
          onChange={(nextModes) =>
            onChange({
              ...value,
              capabilities: {
                ...value.capabilities,
                outputModes: nextModes,
              },
            })
          }
          value={value.capabilities.outputModes}
        />
      </div>

      <div className="field-grid">
        <label className="inline-check">
          <input
            checked={value.capabilities.supportsFunctionCall}
            onChange={(event) =>
              onChange({
                ...value,
                capabilities: {
                  ...value.capabilities,
                  supportsFunctionCall: event.target.checked,
                },
              })
            }
            type="checkbox"
          />
          支持函数调用
        </label>

        <label className="inline-check">
          <input
            checked={value.capabilities.supportsStreaming}
            onChange={(event) =>
              onChange({
                ...value,
                capabilities: {
                  ...value.capabilities,
                  supportsStreaming: event.target.checked,
                },
              })
            }
            type="checkbox"
          />
          支持流式
        </label>
      </div>

      <div className="field-grid">
        <label>
          温度
          <input
            max="2"
            min="0"
            onChange={(event) =>
              onChange({
                ...value,
                params: {
                  ...value.params,
                  temperature: Number(event.target.value),
                },
              })
            }
            step="0.1"
            type="number"
            value={value.params.temperature}
          />
        </label>
        <label>
          最大 Token
          <input
            min="1"
            onChange={(event) =>
              onChange({
                ...value,
                params: {
                  ...value.params,
                  maxTokens: Number(event.target.value),
                },
              })
            }
            type="number"
            value={value.params.maxTokens}
          />
        </label>
        <label>
          Top-p
          <input
            max="1"
            min="0"
            onChange={(event) =>
              onChange({
                ...value,
                params: {
                  ...value.params,
                  topP: Number(event.target.value),
                },
              })
            }
            step="0.05"
            type="number"
            value={value.params.topP}
          />
        </label>
        <label>
          频率惩罚
          <input
            max="2"
            min="-2"
            onChange={(event) =>
              onChange({
                ...value,
                params: {
                  ...value.params,
                  frequencyPenalty: Number(event.target.value),
                },
              })
            }
            step="0.1"
            type="number"
            value={value.params.frequencyPenalty}
          />
        </label>
      </div>

      <label className="inline-check">
        <input
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
          type="checkbox"
        />
        启用模型
      </label>
    </>
  );
}

export function ModelSettings({
  providers,
  models,
  saving,
  onCreate,
  onUpdate,
  onDelete,
  onProbe,
}: Props) {
  const [createForm, setCreateForm] = useState<CreateModelRequest>(defaultCreateForm);
  const [showCreate, setShowCreate] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, UpdateModelRequest>>({});
  const [probing, setProbing] = useState<Record<string, boolean>>({});
  const [probeResults, setProbeResults] = useState<Record<string, ProbeModelConnectionResponse>>({});
  const providerNameById = Object.fromEntries(providers.map((provider) => [provider.id, provider.displayName]));
  const editingModel = models.find((model) => model.id === editingModelId) ?? null;
  const editingDraft = editingModelId ? drafts[editingModelId] : undefined;

  useEffect(() => {
    const next: Record<string, UpdateModelRequest> = {};
    for (const model of models) {
      next[model.id] = toUpdateForm(model);
    }
    setDrafts(next);
  }, [models]);

  useEffect(() => {
    if (createForm.customProvider || createForm.providerRef || providers.length === 0) return;
    setCreateForm((current) => ({ ...current, providerRef: providers[0].id }));
  }, [createForm.customProvider, createForm.providerRef, providers]);

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>模型</h2>
          <small className="hint">管理模型编排、能力声明和连通性校验。</small>
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
        <FormModal title="新增模型" onClose={() => setShowCreate(false)}>
          <div className="stack">
            <ModelForm
              onChange={(value) => setCreateForm(value as CreateModelRequest)}
              providers={providers}
              showTitle={false}
              title="新增模型"
              value={createForm}
            />
            <div className="actions">
              <button className="ghost" onClick={() => setShowCreate(false)} type="button">
                取消
              </button>
              <button
                className="primary"
                disabled={saving}
                onClick={async () => {
                  await onCreate(createForm);
                  setCreateForm(defaultCreateForm());
                  setShowCreate(false);
                }}
                type="button"
              >
                新建模型
              </button>
            </div>
          </div>
        </FormModal>
      )}

      {editingModel && editingDraft && (
        <FormModal title={`编辑模型：${editingModel.name}`} onClose={() => setEditingModelId(null)}>
          <div className="stack">
            <ModelForm
              onChange={(value) =>
                setDrafts((current) => ({
                  ...current,
                  [editingModel.id]: value as UpdateModelRequest,
                }))
              }
              providers={providers}
              showTitle={false}
              title={`编辑模型：${editingModel.name}`}
              value={editingDraft}
            />
            <div className="actions">
              <button className="ghost" onClick={() => setEditingModelId(null)} type="button">
                取消
              </button>
              <button
                className="primary"
                disabled={saving}
                onClick={async () => {
                  await onUpdate(editingModel.id, editingDraft);
                  setEditingModelId(null);
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
        {models.length === 0 && (
          <article className="card settings-summary-empty">
            <p className="hint">还没有模型，先新增一个。</p>
          </article>
        )}
        {models.map((model) => {
          const probeRunning = probing[model.id] ?? false;
          const probeResult = probeResults[model.id];
          const sourceLabel = model.customProvider
            ? "自定义 Provider"
            : (model.providerRef ? providerNameById[model.providerRef] : null) ?? "未绑定 Provider";
          const categories = resolveCategories(model.category, model.categories);
          return (
            <article className="card settings-summary-card" key={model.id}>
              <div className="settings-summary-head">
                <div className="settings-summary-copy">
                  <h3>{model.name}</h3>
                  <small>{model.modelId}</small>
                </div>
                <div className="settings-summary-tools">
                  <span className={model.enabled ? "status-badge is-live" : "status-badge"}>
                    {model.enabled ? "已启用" : "已停用"}
                  </span>
                  <div className="settings-summary-actions">
                    <ActionIconButton
                      busy={probeRunning}
                      disabled={saving || probeRunning}
                      icon="probe"
                      label={probeRunning ? "探测中" : "连通测试"}
                      onClick={async () => {
                        setProbing((current) => ({ ...current, [model.id]: true }));
                        try {
                          const result = await onProbe({ modelRefId: model.id });
                          setProbeResults((current) => ({ ...current, [model.id]: result }));
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
                            [model.id]: {
                              modelRefId: model.id,
                              modelId: model.modelId,
                              reachable: false,
                              latencyMs: 0,
                              detail: message,
                            },
                          }));
                        } finally {
                          setProbing((current) => ({ ...current, [model.id]: false }));
                        }
                      }}
                      tone="ghost"
                      type="button"
                    />
                    <ActionIconButton
                      icon="edit"
                      label="编辑设置"
                      onClick={() => setEditingModelId(model.id)}
                      tone="primary"
                      type="button"
                    />
                    <ActionIconButton
                      disabled={saving}
                      icon="delete"
                      label="删除"
                      onClick={() => onDelete(model.id)}
                      tone="danger"
                      type="button"
                    />
                  </div>
                </div>
              </div>
              <div className="settings-summary-meta">
                <span className="settings-summary-pill">{formatCategories(categories)}</span>
                <span className="settings-summary-pill">{sourceLabel}</span>
                <span className="settings-summary-pill" title={formatModes(model.capabilities.inputModes)}>
                  输入：{formatModes(model.capabilities.inputModes)}
                </span>
                <span className="settings-summary-pill" title={formatModes(model.capabilities.outputModes)}>
                  输出：{formatModes(model.capabilities.outputModes)}
                </span>
                {model.capabilities.supportsStreaming && (
                  <span className="settings-summary-pill">流式</span>
                )}
                {model.capabilities.supportsFunctionCall && (
                  <span className="settings-summary-pill">函数调用</span>
                )}
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
