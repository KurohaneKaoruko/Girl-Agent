import { useEffect, useState } from "react";
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

const splitModes = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const joinModes = (values: string[]) => values.join(", ");

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

function ModelForm({
  title,
  value,
  providers,
  onChange,
}: {
  title: string;
  value: CreateModelRequest | UpdateModelRequest;
  providers: ProviderConfig[];
  onChange: (value: CreateModelRequest | UpdateModelRequest) => void;
}) {
  const useCustomProvider = value.customProvider !== null;

  return (
    <>
      <h3>{title}</h3>
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
        <label>
          模型类型
          <select
            onChange={(event) =>
              onChange({ ...value, category: event.target.value as ModelCategory })
            }
            value={value.category}
          >
            {categoryOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

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
        <label>
          输入模态（逗号分隔）
          <input
            onChange={(event) =>
              onChange({
                ...value,
                capabilities: {
                  ...value.capabilities,
                  inputModes: splitModes(event.target.value),
                },
              })
            }
            value={joinModes(value.capabilities.inputModes)}
          />
        </label>

        <label>
          输出模态（逗号分隔）
          <input
            onChange={(event) =>
              onChange({
                ...value,
                capabilities: {
                  ...value.capabilities,
                  outputModes: splitModes(event.target.value),
                },
              })
            }
            value={joinModes(value.capabilities.outputModes)}
          />
        </label>
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
  const [drafts, setDrafts] = useState<Record<string, UpdateModelRequest>>({});
  const [probing, setProbing] = useState<Record<string, boolean>>({});
  const [probeResults, setProbeResults] = useState<Record<string, ProbeModelConnectionResponse>>({});

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
        <h2>模型设置</h2>
        <button
          className="primary"
          onClick={() => setShowCreate((current) => !current)}
          type="button"
        >
          {showCreate ? "收起新增" : "新增"}
        </button>
      </header>

      {showCreate && (
        <article className="card">
          <ModelForm
            onChange={(value) => setCreateForm(value as CreateModelRequest)}
            providers={providers}
            title="新增模型"
            value={createForm}
          />
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
        </article>
      )}

      <div className="stack">
        {models.map((model) => {
          const draft = drafts[model.id];
          if (!draft) return null;
          const probeRunning = probing[model.id] ?? false;
          const probeResult = probeResults[model.id];
          return (
            <article className="card" key={model.id}>
              <ModelForm
                onChange={(value) =>
                  setDrafts((current) => ({
                    ...current,
                    [model.id]: value as UpdateModelRequest,
                  }))
                }
                providers={providers}
                title={`编辑模型：${model.name}`}
                value={draft}
              />
              <div className="actions">
                <button
                  className="ghost"
                  disabled={saving || probeRunning}
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
                  type="button"
                >
                  {probeRunning ? "探测中..." : "连通测试"}
                </button>
                <button
                  className="primary"
                  disabled={saving}
                  onClick={() => onUpdate(model.id, draft)}
                  type="button"
                >
                  保存
                </button>
                <button
                  className="danger"
                  disabled={saving}
                  onClick={() => onDelete(model.id)}
                  type="button"
                >
                  删除
                </button>
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
