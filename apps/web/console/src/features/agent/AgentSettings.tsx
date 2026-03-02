import { useEffect, useState } from "react";
import type {
  AgentConfig,
  AgentMode,
  CreateAgentRequest,
  ModelConfig,
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
});

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

function AgentForm({
  title,
  models,
  value,
  onChange,
}: {
  title: string;
  models: ModelConfig[];
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
            {models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h4>组件模型</h4>
      <div className="field-grid">
        <ModelSelect
          label="ASR 模型"
          models={models}
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
          models={models}
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
          models={models}
          onChange={(next) =>
            onChange({
              ...value,
              componentSlot: { ...value.componentSlot, visionModelId: next },
            })
          }
          value={value.componentSlot.visionModelId}
        />
      </div>

      <h4>工具模型</h4>
      <div className="field-grid">
        <ModelSelect
          label="工具规划模型"
          models={models}
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
          models={models}
          onChange={(next) =>
            onChange({
              ...value,
              toolSlot: { ...value.toolSlot, executorModelId: next },
            })
          }
          value={value.toolSlot.executorModelId}
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
        models={models}
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
  const [drafts, setDrafts] = useState<Record<string, UpdateAgentRequest>>({});

  useEffect(() => {
    const next: Record<string, UpdateAgentRequest> = {};
    for (const agent of agents) {
      next[agent.id] = toUpdateAgent(agent);
    }
    setDrafts(next);
  }, [agents]);

  useEffect(() => {
    if (createForm.replyModelId || models.length === 0) return;
    setCreateForm((current) => ({ ...current, replyModelId: models[0].id }));
  }, [createForm.replyModelId, models]);

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>智能体设置</h2>
      </header>

      <article className="card">
        <AgentForm
          models={models}
          onChange={(value) => setCreateForm(value as CreateAgentRequest)}
          title="新增智能体"
          value={createForm}
        />
        <button
          className="primary"
          disabled={saving}
          onClick={async () => {
            await onCreate(createForm);
            setCreateForm(emptyAgentRequest());
          }}
          type="button"
        >
          新建智能体
        </button>
      </article>

      <div className="stack">
        {agents.map((agent) => {
          const draft = drafts[agent.id];
          if (!draft) return null;
          return (
            <article className="card" key={agent.id}>
              <AgentForm
                models={models}
                onChange={(value) =>
                  setDrafts((current) => ({
                    ...current,
                    [agent.id]: value as UpdateAgentRequest,
                  }))
                }
                title={`编辑智能体：${agent.name}`}
                value={draft}
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
