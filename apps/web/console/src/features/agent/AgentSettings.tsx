import { useEffect, useMemo, useState } from "react";
import type {
  AgentConfig,
  AgentMode,
  AgentParamSlots,
  CreateAgentRequest,
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
}) {
  return (
    <>
      <h3>{title}</h3>
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
  const [drafts, setDrafts] = useState<Record<string, UpdateAgentRequest>>({});

  const replyModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          (model.category === "llm" || model.category === "vlm") &&
          hasMode(model.capabilities.outputModes, "text"),
      ),
    [models],
  );

  const asrModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          model.category === "asr" &&
          hasMode(model.capabilities.outputModes, "text"),
      ),
    [models],
  );

  const ttsModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          model.category === "tts" &&
          hasMode(model.capabilities.outputModes, "audio"),
      ),
    [models],
  );

  const visionModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          model.category === "vlm" &&
          hasMode(model.capabilities.inputModes, "image"),
      ),
    [models],
  );

  const toolModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          (model.category === "llm" || model.category === "vlm") &&
          hasMode(model.capabilities.outputModes, "text"),
      ),
    [models],
  );

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
        <h2>智能体设置</h2>
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
          <AgentForm
            asrModels={asrModels}
            decisionModels={toolModels}
            onChange={(value) => setCreateForm(value as CreateAgentRequest)}
            replyModels={replyModels}
            toolModels={toolModels}
            ttsModels={ttsModels}
            title="新增智能体"
            value={createForm}
            visionModels={visionModels}
          />
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
        </article>
      )}

      <div className="stack">
        {agents.map((agent) => {
          const draft = drafts[agent.id];
          if (!draft) return null;
          return (
            <article className="card" key={agent.id}>
              <AgentForm
                asrModels={asrModels}
                decisionModels={toolModels}
                onChange={(value) =>
                  setDrafts((current) => ({
                    ...current,
                    [agent.id]: value as UpdateAgentRequest,
                  }))
                }
                replyModels={replyModels}
                toolModels={toolModels}
                ttsModels={ttsModels}
                title={`编辑智能体：${agent.name}`}
                value={draft}
                visionModels={visionModels}
              />
              <div className="actions">
                <button
                  className="primary"
                  disabled={saving}
                  onClick={() => onUpdate(agent.id, draft)}
                  type="button"
                >
                  保存
                </button>
                <button
                  className="danger"
                  disabled={saving}
                  onClick={() => onDelete(agent.id)}
                  type="button"
                >
                  删除
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
