import { useEffect, useMemo, useState } from "react";
import { ActionIconButton } from "@/components/ActionIconButton";
import { FormModal } from "@/components/FormModal";
import type {
  AgentConfig,
  AgentMode,
  AgentParamSlots,
  CreateAgentRequest,
  ModelCategory,
  ModelConfig,
  SlotParams,
  UpdateAgentRequest,
} from "@/types";

type Props = {
  models: ModelConfig[];
  agents: AgentConfig[];
  saving: boolean;
  onCreate: (input: CreateAgentRequest) => Promise<void>;
  onUpdate: (id: string, input: UpdateAgentRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

const emptyAgentRequest = (): CreateAgentRequest => ({
  name: "",
  persona: "",
  speechRules: "",
  mode: "chat",
  componentSlot: {
    asrModelId: null,
    ttsModelId: null,
    visionModelId: null,
  },
  toolSlot: {
    plannerModelId: null,
    executorModelId: null,
  },
  replyModelId: "",
  decisionSlot: {
    modelId: null,
    enabled: false,
  },
  paramSlots: emptyParamSlots(),
});

const toUpdateAgent = (agent: AgentConfig): UpdateAgentRequest => ({
  name: agent.name,
  persona: agent.persona,
  speechRules: agent.speechRules,
  mode: agent.mode,
  componentSlot: agent.modelSlots.component,
  toolSlot: agent.modelSlots.tool,
  replyModelId: agent.modelSlots.reply.modelId,
  decisionSlot: agent.modelSlots.decision,
  paramSlots: agent.paramSlots ?? emptyParamSlots(),
});

const hasMode = (modes: string[], target: string) =>
  modes.some((mode) => mode.trim().toLowerCase() === target.toLowerCase());
const modelHasCategory = (model: ModelConfig, category: ModelCategory) =>
  (
    Array.isArray(model.categories) && model.categories.length > 0
      ? model.categories
      : [model.category]
  ).includes(category);

const emptySlotParams = (): SlotParams => ({
  temperature: null,
  maxTokens: null,
  topP: null,
  frequencyPenalty: null,
});

const emptyParamSlots = (): AgentParamSlots => ({
  component: {
    asr: emptySlotParams(),
    tts: emptySlotParams(),
    vision: emptySlotParams(),
  },
  tool: {
    planner: emptySlotParams(),
    executor: emptySlotParams(),
  },
  reply: emptySlotParams(),
  decision: emptySlotParams(),
});

const parseOptionalNumber = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const showOptionalNumber = (value: number | null) => (value === null ? "" : String(value));

function ModelSelect({
  label,
  models,
  value,
  onChange,
}: {
  label: string;
  models: ModelConfig[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <label>
      {label}
      <select onChange={(event) => onChange(event.target.value || null)} value={value ?? ""}>
        <option value="">不设置</option>
        {models.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SlotParamFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: SlotParams;
  onChange: (value: SlotParams) => void;
}) {
  return (
    <div className="card">
      <h4>{title}参数覆盖</h4>
      <div className="field-grid">
        <label>
          温度覆盖（可选）
          <input
            max="2"
            min="0"
            onChange={(event) =>
              onChange({
                ...value,
                temperature: parseOptionalNumber(event.target.value),
              })
            }
            placeholder="留空则使用模型默认"
            step="0.1"
            type="number"
            value={showOptionalNumber(value.temperature)}
          />
        </label>

        <label>
          Max Tokens 覆盖（可选）
          <input
            min="1"
            onChange={(event) =>
              onChange({
                ...value,
                maxTokens: parseOptionalNumber(event.target.value),
              })
            }
            placeholder="留空则使用模型默认"
            type="number"
            value={showOptionalNumber(value.maxTokens)}
          />
        </label>
      </div>

      <div className="field-grid">
        <label>
          Top-p 覆盖（可选）
          <input
            max="1"
            min="0"
            onChange={(event) =>
              onChange({
                ...value,
                topP: parseOptionalNumber(event.target.value),
              })
            }
            placeholder="留空则使用模型默认"
            step="0.05"
            type="number"
            value={showOptionalNumber(value.topP)}
          />
        </label>

        <label>
          频率惩罚覆盖（可选）
          <input
            max="2"
            min="-2"
            onChange={(event) =>
              onChange({
                ...value,
                frequencyPenalty: parseOptionalNumber(event.target.value),
              })
            }
            placeholder="留空则使用模型默认"
            step="0.1"
            type="number"
            value={showOptionalNumber(value.frequencyPenalty)}
          />
        </label>
      </div>
    </div>
  );
}

function AgentForm({
  title,
  replyModels,
  asrModels,
  ttsModels,
  visionModels,
  toolModels,
  decisionModels,
  value,
  onChange,
  showTitle = true,
}: {
  title: string;
  replyModels: ModelConfig[];
  asrModels: ModelConfig[];
  ttsModels: ModelConfig[];
  visionModels: ModelConfig[];
  toolModels: ModelConfig[];
  decisionModels: ModelConfig[];
  value: CreateAgentRequest | UpdateAgentRequest;
  onChange: (value: CreateAgentRequest | UpdateAgentRequest) => void;
  showTitle?: boolean;
}) {
  return (
    <>
      {showTitle && <h3>{title}</h3>}
      <div className="field-grid">
        <label>
          智能体名称
          <input
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            placeholder="例如：少女助手"
            value={value.name}
          />
        </label>

        <label>
          运行模式
          <select
            onChange={(event) => {
              const mode = event.target.value as AgentMode;
              onChange({
                ...value,
                mode,
                decisionSlot:
                  mode === "ambient"
                    ? {
                        enabled: true,
                        modelId: value.decisionSlot.modelId,
                      }
                    : value.decisionSlot,
              });
            }}
            value={value.mode}
          >
            <option value="chat">对话框模式（必定回复）</option>
            <option value="ambient">常驻模式（决策后回复）</option>
          </select>
        </label>
      </div>

      <label>
        人格设定
        <textarea
          onChange={(event) => onChange({ ...value, persona: event.target.value })}
          placeholder="例如：温柔、理性、善于总结。"
          rows={4}
          value={value.persona}
        />
      </label>

      <label>
        说话规则
        <textarea
          onChange={(event) => onChange({ ...value, speechRules: event.target.value })}
          placeholder="例如：先结论后细节，简洁中文。"
          rows={4}
          value={value.speechRules}
        />
      </label>

      <div className="field-grid">
        <label>
          回复模型（必填）
          <select
            onChange={(event) => onChange({ ...value, replyModelId: event.target.value })}
            value={value.replyModelId}
          >
            <option value="">请选择</option>
            {replyModels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <SlotParamFields
        onChange={(next) =>
          onChange({
            ...value,
            paramSlots: {
              ...value.paramSlots,
              reply: next,
            },
          })
        }
        title="回复"
        value={value.paramSlots.reply}
      />

      <h4>组件模型</h4>
      <div className="field-grid">
        <ModelSelect
          label="ASR 模型"
          models={asrModels}
          onChange={(next) =>
            onChange({
              ...value,
              componentSlot: { ...value.componentSlot, asrModelId: next },
            })
          }
          value={value.componentSlot.asrModelId}
        />
        <ModelSelect
          label="TTS 模型"
          models={ttsModels}
          onChange={(next) =>
            onChange({
              ...value,
              componentSlot: { ...value.componentSlot, ttsModelId: next },
            })
          }
          value={value.componentSlot.ttsModelId}
        />
        <ModelSelect
          label="视觉模型"
          models={visionModels}
          onChange={(next) =>
            onChange({
              ...value,
              componentSlot: { ...value.componentSlot, visionModelId: next },
            })
          }
          value={value.componentSlot.visionModelId}
        />
      </div>

      <div className="stack">
        <SlotParamFields
          onChange={(next) =>
            onChange({
              ...value,
              paramSlots: {
                ...value.paramSlots,
                component: {
                  ...value.paramSlots.component,
                  asr: next,
                },
              },
            })
          }
          title="ASR"
          value={value.paramSlots.component.asr}
        />
        <SlotParamFields
          onChange={(next) =>
            onChange({
              ...value,
              paramSlots: {
                ...value.paramSlots,
                component: {
                  ...value.paramSlots.component,
                  tts: next,
                },
              },
            })
          }
          title="TTS"
          value={value.paramSlots.component.tts}
        />
        <SlotParamFields
          onChange={(next) =>
            onChange({
              ...value,
              paramSlots: {
                ...value.paramSlots,
                component: {
                  ...value.paramSlots.component,
                  vision: next,
                },
              },
            })
          }
          title="视觉"
          value={value.paramSlots.component.vision}
        />
      </div>

      <h4>工具模型</h4>
      <div className="field-grid">
        <ModelSelect
          label="工具规划模型"
          models={toolModels}
          onChange={(next) =>
            onChange({
              ...value,
              toolSlot: { ...value.toolSlot, plannerModelId: next },
            })
          }
          value={value.toolSlot.plannerModelId}
        />
        <ModelSelect
          label="工具执行模型"
          models={toolModels}
          onChange={(next) =>
            onChange({
              ...value,
              toolSlot: { ...value.toolSlot, executorModelId: next },
            })
          }
          value={value.toolSlot.executorModelId}
        />
      </div>

      <div className="stack">
        <SlotParamFields
          onChange={(next) =>
            onChange({
              ...value,
              paramSlots: {
                ...value.paramSlots,
                tool: {
                  ...value.paramSlots.tool,
                  planner: next,
                },
              },
            })
          }
          title="工具规划"
          value={value.paramSlots.tool.planner}
        />
        <SlotParamFields
          onChange={(next) =>
            onChange({
              ...value,
              paramSlots: {
                ...value.paramSlots,
                tool: {
                  ...value.paramSlots.tool,
                  executor: next,
                },
              },
            })
          }
          title="工具执行"
          value={value.paramSlots.tool.executor}
        />
      </div>

      <h4>决策模型</h4>
      <label className="inline-check">
        <input
          checked={value.decisionSlot.enabled}
          onChange={(event) =>
            onChange({
              ...value,
              decisionSlot: {
                ...value.decisionSlot,
                enabled: event.target.checked,
              },
            })
          }
          type="checkbox"
        />
        启用决策模型（用于 ambient / 桌宠 / 机器人）
      </label>
      <ModelSelect
        label="决策模型"
        models={decisionModels}
        onChange={(next) =>
          onChange({
            ...value,
            decisionSlot: {
              ...value.decisionSlot,
              modelId: next,
            },
          })
        }
        value={value.decisionSlot.modelId}
      />

      <SlotParamFields
        onChange={(next) =>
          onChange({
            ...value,
            paramSlots: {
              ...value.paramSlots,
              decision: next,
            },
          })
        }
        title="决策"
        value={value.paramSlots.decision}
      />
    </>
  );
}

export function AgentSettings({
  models,
  agents,
  saving,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const [createForm, setCreateForm] = useState<CreateAgentRequest>(emptyAgentRequest);
  const [showCreate, setShowCreate] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, UpdateAgentRequest>>({});
  const modelNameById = useMemo(
    () => Object.fromEntries(models.map((model) => [model.id, model.name])),
    [models],
  );

  const replyModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          (modelHasCategory(model, "llm") || modelHasCategory(model, "vlm")) &&
          hasMode(model.capabilities.outputModes, "text"),
      ),
    [models],
  );

  const asrModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          modelHasCategory(model, "asr") &&
          hasMode(model.capabilities.outputModes, "text"),
      ),
    [models],
  );

  const ttsModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          modelHasCategory(model, "tts") &&
          hasMode(model.capabilities.outputModes, "audio"),
      ),
    [models],
  );

  const visionModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          modelHasCategory(model, "vlm") &&
          hasMode(model.capabilities.inputModes, "image"),
      ),
    [models],
  );

  const toolModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          (modelHasCategory(model, "llm") || modelHasCategory(model, "vlm")) &&
          hasMode(model.capabilities.outputModes, "text"),
      ),
    [models],
  );
  const editingAgent = agents.find((agent) => agent.id === editingAgentId) ?? null;
  const editingDraft = editingAgentId ? drafts[editingAgentId] : undefined;

  useEffect(() => {
    const next: Record<string, UpdateAgentRequest> = {};
    for (const agent of agents) {
      next[agent.id] = toUpdateAgent(agent);
    }
    setDrafts(next);
  }, [agents]);

  useEffect(() => {
    if (createForm.replyModelId || replyModels.length === 0) return;
    setCreateForm((current) => ({ ...current, replyModelId: replyModels[0].id }));
  }, [createForm.replyModelId, replyModels]);

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>智能体</h2>
          <small className="hint">管理角色设定、槽位模型和参数覆盖。</small>
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
        <FormModal title="新增智能体" onClose={() => setShowCreate(false)}>
          <div className="stack">
            <AgentForm
              asrModels={asrModels}
              decisionModels={toolModels}
              onChange={(value) => setCreateForm(value as CreateAgentRequest)}
              replyModels={replyModels}
              showTitle={false}
              toolModels={toolModels}
              ttsModels={ttsModels}
              title="新增智能体"
              value={createForm}
              visionModels={visionModels}
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
                  setCreateForm(emptyAgentRequest());
                  setShowCreate(false);
                }}
                type="button"
              >
                新建智能体
              </button>
            </div>
          </div>
        </FormModal>
      )}

      {editingAgent && editingDraft && (
        <FormModal title={`编辑智能体：${editingAgent.name}`} onClose={() => setEditingAgentId(null)}>
          <div className="stack">
            <AgentForm
              asrModels={asrModels}
              decisionModels={toolModels}
              onChange={(value) =>
                setDrafts((current) => ({
                  ...current,
                  [editingAgent.id]: value as UpdateAgentRequest,
                }))
              }
              replyModels={replyModels}
              showTitle={false}
              toolModels={toolModels}
              ttsModels={ttsModels}
              title={`编辑智能体：${editingAgent.name}`}
              value={editingDraft}
              visionModels={visionModels}
            />
            <div className="actions">
              <button className="ghost" onClick={() => setEditingAgentId(null)} type="button">
                取消
              </button>
              <button
                className="primary"
                disabled={saving}
                onClick={async () => {
                  await onUpdate(editingAgent.id, editingDraft);
                  setEditingAgentId(null);
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
        {agents.length === 0 && (
          <article className="card settings-summary-empty">
            <p className="hint">还没有智能体，先新增一个。</p>
          </article>
        )}
        {agents.map((agent) => {
          const componentCount = [
            agent.modelSlots.component.asrModelId,
            agent.modelSlots.component.ttsModelId,
            agent.modelSlots.component.visionModelId,
          ].filter(Boolean).length;
          const toolCount = [
            agent.modelSlots.tool.plannerModelId,
            agent.modelSlots.tool.executorModelId,
          ].filter(Boolean).length;
          const personaPreview =
            agent.persona.trim().length > 0 ? agent.persona.trim().slice(0, 88) : "未填写人格设定";
          return (
            <article className="card settings-summary-card" key={agent.id}>
              <div className="settings-summary-head">
                <div className="settings-summary-copy">
                  <h3>{agent.name}</h3>
                  <small>{agent.mode === "ambient" ? "常驻模式" : "对话模式"}</small>
                  <p>{personaPreview}{agent.persona.trim().length > 88 ? "..." : ""}</p>
                </div>
                <div className="settings-summary-tools">
                  <span className="status-badge is-live">
                    {agent.mode === "ambient" ? "Ambient" : "Chat"}
                  </span>
                  <div className="settings-summary-actions">
                    <ActionIconButton
                      icon="edit"
                      label="编辑设置"
                      onClick={() => setEditingAgentId(agent.id)}
                      tone="primary"
                      type="button"
                    />
                    <ActionIconButton
                      disabled={saving}
                      icon="delete"
                      label="删除"
                      onClick={() => onDelete(agent.id)}
                      tone="danger"
                      type="button"
                    />
                  </div>
                </div>
              </div>
              <div className="settings-summary-meta">
                <span className="settings-summary-pill">
                  回复模型：{modelNameById[agent.modelSlots.reply.modelId] ?? agent.modelSlots.reply.modelId}
                </span>
                <span className="settings-summary-pill">组件槽位：{componentCount}</span>
                <span className="settings-summary-pill">工具槽位：{toolCount}</span>
                <span className="settings-summary-pill">
                  决策：{agent.modelSlots.decision.enabled ? "已启用" : "未启用"}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
