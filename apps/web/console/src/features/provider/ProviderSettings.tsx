import { useEffect, useMemo, useState } from "react";
import type {
  CreateProviderRequest,
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
}: Props) {
  const presetMap = useMemo(
    () => Object.fromEntries(presets.map((preset) => [preset.id, preset])),
    [presets],
  );
  const [createForm, setCreateForm] = useState<CreateProviderRequest>(() =>
    emptyCreateRequest(presets[0]),
  );
  const [drafts, setDrafts] = useState<Record<string, UpdateProviderRequest>>({});

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
      <header className="panel-header">
        <h2>模型提供商设置</h2>
      </header>

      <article className="card">
        <h3>新增提供商配置</h3>
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

        <button
          className="primary"
          disabled={saving}
          onClick={async () => {
            await onCreate(createForm);
            setCreateForm(emptyCreateRequest(presets[0]));
          }}
          type="button"
        >
          新建提供商配置
        </button>
      </article>

      <div className="stack">
        {providers.map((provider) => {
          const draft = drafts[provider.id];
          if (!draft) return null;
          const preset = presetMap[draft.providerKind];

          return (
            <article className="card" key={provider.id}>
              <div className="field-grid">
                <label>
                  设置项名称
                  <input
                    value={draft.displayName}
                    onChange={(event) =>
                      setDraft(provider.id, (current) => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  提供商类型
                  <select
                    value={draft.providerKind}
                    onChange={(event) => {
                      const nextPreset = presetMap[event.target.value];
                      setDraft(provider.id, (current) => ({
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
                  value={draft.apiBase}
                  onChange={(event) =>
                    setDraft(provider.id, (current) => ({
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
                  onClick={() => setDraft(provider.id, (current) => addKey(current))}
                  type="button"
                >
                  新增 Key
                </button>
              </div>

              <div className="stack">
                {draft.keys.map((key, index) => (
                  <input
                    key={`${provider.id}-key-${index}`}
                    value={key}
                    onChange={(event) =>
                      setDraft(provider.id, (current) =>
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
                  checked={draft.enabled}
                  onChange={(event) =>
                    setDraft(provider.id, (current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                启用该提供商配置
              </label>

              <small className="hint">
                {preset?.supportsMultiKey
                  ? "该提供商建议启用多 Key 轮询。"
                  : "该提供商通常使用单 Key，也可拆分多个设置项。"}
              </small>

              <div className="actions">
                <button
                  className="primary"
                  disabled={saving}
                  onClick={() => onUpdate(provider.id, draft)}
                  type="button"
                >
                  保存
                </button>
                <button
                  className="danger"
                  disabled={saving}
                  onClick={() => onDelete(provider.id)}
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
