import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  AgentConfig,
  ApiError,
  ChatWithSessionRequest,
  CreateWorkspaceChatSessionRequest,
  UpdateWorkspaceChatSessionRequest,
  WorkspaceChatMessage,
  WorkspaceChatParticipant,
  WorkspaceChatParticipantMode,
  WorkspaceChatReply,
  WorkspaceChatSession,
} from "@/types";
import { FormModal } from "@/components/FormModal";
import { describeApiError } from "@/lib/errorDisplay";

type Props = {
  agents: AgentConfig[];
  disabled: boolean;
  onListSessions: () => Promise<WorkspaceChatSession[]>;
  onCreateSession: (input: CreateWorkspaceChatSessionRequest) => Promise<WorkspaceChatSession>;
  onUpdateSession: (
    sessionId: string,
    input: UpdateWorkspaceChatSessionRequest,
  ) => Promise<WorkspaceChatSession>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onListMessages: (sessionId: string) => Promise<WorkspaceChatMessage[]>;
  onClearMessages: (sessionId: string) => Promise<void>;
  onOpenAgentSettings: () => void;
  onSendMessageStream: (
    input: ChatWithSessionRequest,
    onReplyStart: (reply: Omit<WorkspaceChatReply, "message">) => void,
    onDelta: (agentId: string, chunk: string) => void,
    signal?: AbortSignal,
  ) => Promise<unknown>;
};

type ParticipantDraft = {
  agentId: string;
  enabled: boolean;
  receiveMode: WorkspaceChatParticipantMode;
  replyMode: WorkspaceChatParticipantMode;
};

type SessionDraft = {
  title: string;
  isPinned: boolean;
  isArchived: boolean;
  tags: string;
  participants: ParticipantDraft[];
};

const toApiError = (error: unknown): ApiError => {
  if (typeof error === "object" && error !== null) {
    const payload = error as Record<string, unknown>;
    if (typeof payload.code === "string" && typeof payload.message === "string") {
      return {
        code: payload.code,
        message: payload.message,
        details: payload.details,
      };
    }
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message };
  }
  return { code: "INTERNAL_ERROR", message: "Unknown chat error" };
};

const formatDateTime = (raw: string): string => {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const createSessionDraft = (
  agents: AgentConfig[],
  session?: WorkspaceChatSession | null,
): SessionDraft => ({
  title: session?.title ?? "",
  isPinned: session?.isPinned ?? false,
  isArchived: session?.isArchived ?? false,
  tags: session?.tags.join(", ") ?? "",
  participants: agents.map((agent) => {
    const matched = session?.participants.find((item) => item.agentId === agent.id);
    return {
      agentId: agent.id,
      enabled: Boolean(matched),
      receiveMode: matched?.receiveMode ?? "all",
      replyMode: matched?.replyMode ?? "all",
    };
  }),
});

const buildParticipantPayload = (draft: SessionDraft): WorkspaceChatParticipant[] =>
  draft.participants
    .filter((item) => item.enabled)
    .map((item, index) => ({
      agentId: item.agentId,
      receiveMode: item.receiveMode,
      replyMode: item.replyMode,
      sortOrder: index,
    }));

const modeOptions: Array<{ value: WorkspaceChatParticipantMode; label: string }> = [
  { value: "all", label: "全消息" },
  { value: "mention", label: "仅 @" },
];

export function ChatWorkspace({
  agents,
  disabled,
  onListSessions,
  onCreateSession,
  onUpdateSession,
  onDeleteSession,
  onListMessages,
  onClearMessages,
  onOpenAgentSettings,
  onSendMessageStream,
}: Props) {
  const [sessions, setSessions] = useState<WorkspaceChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [messages, setMessages] = useState<WorkspaceChatMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [createDraft, setCreateDraft] = useState<SessionDraft>(() => createSessionDraft(agents));
  const [settingsDraft, setSettingsDraft] = useState<SessionDraft>(() => createSessionDraft(agents));
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState("");
  const activeStreamRef = useRef<AbortController | null>(null);
  const dragAgentIdRef = useRef<string | null>(null);
  const errorDisplay = error ? describeApiError(error) : null;

  const agentNameById = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const selectedSession = sessions.find((item) => item.id === selectedSessionId) ?? null;

  const loadSessions = async (preferredSessionId?: string) => {
    setLoadingSessions(true);
    try {
      const nextSessions = await onListSessions();
      setSessions(nextSessions);
      setSelectedSessionId((current) => {
        const candidate =
          nextSessions.find((item) => item.id === preferredSessionId)?.id ??
          nextSessions.find((item) => item.id === current)?.id ??
          nextSessions[0]?.id ??
          "";
        return candidate;
      });
      setError(null);
    } catch (rawError) {
      setError(toApiError(rawError));
    } finally {
      setLoadingSessions(false);
    }
  };

  const loadMessages = async (sessionId: string) => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    try {
      setMessages(await onListMessages(sessionId));
      setError(null);
    } catch (rawError) {
      setError(toApiError(rawError));
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    setCreateDraft(createSessionDraft(agents));
    setSettingsDraft(createSessionDraft(agents, selectedSession));
  }, [agents, selectedSession]);

  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedSessionId);
  }, [selectedSessionId]);

  const updateDraftParticipant = (
    setter: Dispatch<SetStateAction<SessionDraft>>,
    agentId: string,
    patch: Partial<ParticipantDraft>,
  ) => {
    setter((current) => ({
      ...current,
      participants: current.participants.map((item) =>
        item.agentId === agentId ? { ...item, ...patch } : item,
      ),
    }));
  };

  const moveDraftParticipant = (
    setter: Dispatch<SetStateAction<SessionDraft>>,
    sourceAgentId: string,
    targetAgentId: string,
  ) => {
    if (sourceAgentId === targetAgentId) {
      return;
    }
    setter((current) => {
      const next = [...current.participants];
      const sourceIndex = next.findIndex((item) => item.agentId === sourceAgentId);
      const targetIndex = next.findIndex((item) => item.agentId === targetAgentId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return {
        ...current,
        participants: next,
      };
    });
  };

  const submitCreate = async () => {
    const title = createDraft.title.trim();
    const participants = buildParticipantPayload(createDraft);
    if (!title || participants.length === 0) {
      setError({
        code: "VALIDATION_ERROR",
        message: "请至少填写会话名称，并选择一个参与智能体。",
      });
      return;
    }
    try {
      const created = await onCreateSession({ title, participants });
      setShowCreateModal(false);
      setCreateDraft(createSessionDraft(agents));
      await loadSessions(created.id);
      setNotice("");
      setError(null);
    } catch (rawError) {
      setError(toApiError(rawError));
    }
  };

  const submitSettings = async () => {
    if (!selectedSession) {
      return;
    }
    const title = settingsDraft.title.trim();
    const participants = buildParticipantPayload(settingsDraft);
    if (!title || participants.length === 0) {
      setError({
        code: "VALIDATION_ERROR",
        message: "会话名称不能为空，且至少保留一个参与智能体。",
      });
      return;
    }
    try {
      await onUpdateSession(selectedSession.id, {
        title,
        participants,
        isPinned: settingsDraft.isPinned,
        isArchived: settingsDraft.isArchived,
        tags: settingsDraft.tags
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      });
      setShowSettingsModal(false);
      await loadSessions(selectedSession.id);
      setError(null);
    } catch (rawError) {
      setError(toApiError(rawError));
    }
  };

  const sendMessage = async () => {
    if (!selectedSessionId || !composer.trim()) {
      return;
    }
    const userMessage = composer.trim();
    const controller = new AbortController();
    activeStreamRef.current?.abort();
    activeStreamRef.current = controller;
    setSending(true);
    setStreaming(true);
    try {
      const tempUserMessage: WorkspaceChatMessage = {
        role: "user",
        content: userMessage,
        agentId: null,
        visibleToAgentIds: [],
        createdAt: `temp-user-${Date.now()}`,
      };
      setMessages((current) => [...current, tempUserMessage]);
      setComposer("");
      await onSendMessageStream(
        {
          sessionId: selectedSessionId,
          userMessage,
          temperature: null,
          maxTokens: null,
          topP: null,
          frequencyPenalty: null,
        },
        (reply) => {
          const tempKey = `temp-assistant-${reply.agentId}-${Date.now()}-${Math.random()}`;
          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              content: "",
              agentId: reply.agentId,
              visibleToAgentIds: [],
              createdAt: tempKey,
            },
          ]);
        },
        (agentId, chunk) => {
          setMessages((current) => {
            const next = [...current];
            for (let index = next.length - 1; index >= 0; index -= 1) {
              const item = next[index];
              if (
                item.role === "assistant" &&
                item.agentId === agentId &&
                item.createdAt.startsWith("temp-assistant-")
              ) {
                next[index] = {
                  ...item,
                  content: `${item.content}${chunk}`,
                };
                break;
              }
            }
            return next;
          });
        },
        controller.signal,
      );
      await Promise.all([loadMessages(selectedSessionId), loadSessions(selectedSessionId)]);
      setNotice("消息已发送。若没有回复，通常是当前会话规则未命中回复条件。");
      setError(null);
    } catch (rawError) {
      const mapped = toApiError(rawError);
      if (mapped.code === "STREAM_ABORTED") {
        setNotice("已停止生成。");
        await Promise.all([loadMessages(selectedSessionId), loadSessions(selectedSessionId)]);
      } else {
        setError(mapped);
        await Promise.all([loadMessages(selectedSessionId), loadSessions(selectedSessionId)]);
      }
    } finally {
      setSending(false);
      setStreaming(false);
      if (activeStreamRef.current === controller) {
        activeStreamRef.current = null;
      }
    }
  };

  const clearMessages = async () => {
    if (!selectedSessionId || !window.confirm("确认清空当前会话消息？")) {
      return;
    }
    try {
      await onClearMessages(selectedSessionId);
      await Promise.all([loadMessages(selectedSessionId), loadSessions(selectedSessionId)]);
    } catch (rawError) {
      setError(toApiError(rawError));
    }
  };

  const stopGeneration = () => {
    activeStreamRef.current?.abort();
  };

  const deleteSession = async () => {
    if (!selectedSession || !window.confirm(`确认删除会话“${selectedSession.title}”？`)) {
      return;
    }
    try {
      await onDeleteSession(selectedSession.id);
      setShowSettingsModal(false);
      await loadSessions();
    } catch (rawError) {
      setError(toApiError(rawError));
    }
  };

  const renderParticipantEditor = (
    draft: SessionDraft,
    setter: Dispatch<SetStateAction<SessionDraft>>,
  ) => (
    <div className="chat-participant-editor">
      {agents.map((agent) => {
        const participant = draft.participants.find((item) => item.agentId === agent.id);
        if (!participant) {
          return null;
        }
        return (
          <div
            className={participant.enabled ? "chat-participant-row is-draggable" : "chat-participant-row"}
            draggable={participant.enabled}
            key={agent.id}
            onDragOver={(event) => {
              if (!participant.enabled) {
                return;
              }
              event.preventDefault();
            }}
            onDragStart={() => {
              dragAgentIdRef.current = agent.id;
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sourceAgentId = dragAgentIdRef.current;
              if (!sourceAgentId || !participant.enabled) {
                return;
              }
              moveDraftParticipant(setter, sourceAgentId, agent.id);
              dragAgentIdRef.current = null;
            }}
            onDragEnd={() => {
              dragAgentIdRef.current = null;
            }}
          >
            <label className="inline-check">
              <input
                checked={participant.enabled}
                onChange={(event) =>
                  updateDraftParticipant(setter, agent.id, { enabled: event.target.checked })
                }
                type="checkbox"
              />
              {agent.name}
            </label>
            <span className="chat-participant-drag-hint">
              {participant.enabled ? "拖拽调整顺序" : "启用后可排序"}
            </span>
            <label>
              接收
              <select
                disabled={!participant.enabled}
                onChange={(event) =>
                  updateDraftParticipant(setter, agent.id, {
                    receiveMode: event.target.value as WorkspaceChatParticipantMode,
                  })
                }
                value={participant.receiveMode}
              >
                {modeOptions.map((option) => (
                  <option key={`${agent.id}-receive-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              回复
              <select
                disabled={!participant.enabled}
                onChange={(event) =>
                  updateDraftParticipant(setter, agent.id, {
                    replyMode: event.target.value as WorkspaceChatParticipantMode,
                  })
                }
                value={participant.replyMode}
              >
                {modeOptions.map((option) => (
                  <option key={`${agent.id}-reply-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        );
      })}
    </div>
  );

  if (agents.length === 0) {
    return (
      <section className="panel">
        <header className="panel-header">
          <div>
            <h2>聊天工作台</h2>
            <small className="hint">先创建至少一个智能体，才能开始单聊或群组会话。</small>
          </div>
        </header>
        <article className="card">
          <p className="hint">请先在“智能体设置”中创建至少一个智能体。</p>
          <div className="actions">
            <button className="primary" onClick={onOpenAgentSettings} type="button">
              前往智能体设置
            </button>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>聊天工作台</h2>
          <small className="hint">会话列表优先，支持单聊与群组会话，以及按参与者设置接收/回复规则。</small>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => void loadSessions(selectedSessionId)} type="button">
            刷新会话
          </button>
          <button
            className="primary"
            onClick={() => {
              setCreateDraft(createSessionDraft(agents));
              setShowCreateModal(true);
            }}
            type="button"
          >
            新建会话
          </button>
        </div>
      </header>

      <div className="chat-session-workbench">
        <aside className="chat-session-sidebar">
          <div className="chat-session-sidebar-head">
            <strong>会话列表</strong>
            <small>{sessions.length} 个会话</small>
          </div>
          <div className="chat-session-list">
            {loadingSessions && <p className="hint">加载会话中...</p>}
            {!loadingSessions && sessions.length === 0 && (
              <p className="hint">还没有会话，先创建一个单聊或群组会话。</p>
            )}
            {sessions.map((session) => (
              <button
                className={session.id === selectedSessionId ? "chat-session-item active" : "chat-session-item"}
                key={session.id}
                onClick={() => setSelectedSessionId(session.id)}
                type="button"
              >
                <strong>{session.title}</strong>
                <small>
                  {session.participants.map((item) => agentNameById[item.agentId] ?? item.agentId).join(" / ")}
                </small>
                <small>
                  {session.messageCount} 条 · {formatDateTime(session.updatedAt)}
                </small>
                <span>{session.lastMessagePreview ?? "暂无消息"}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="chat-session-main">
          {selectedSession ? (
            <>
              <div className="chat-session-main-head">
                <div>
                  <div className="chat-session-main-title-row">
                    <h3>{selectedSession.title}</h3>
                    <span className="status-badge">{selectedSession.isGroup ? "群组会话" : "单聊会话"}</span>
                  </div>
                  <div className="chat-session-participants">
                    {selectedSession.participants.map((participant) => (
                      <span className="chat-session-participant-pill" key={participant.agentId}>
                        {agentNameById[participant.agentId] ?? participant.agentId}
                        <small>
                          接收 {participant.receiveMode === "all" ? "全消息" : "仅 @"} · 回复{" "}
                          {participant.replyMode === "all" ? "全消息" : "仅 @"}
                        </small>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="actions">
                  <button className="ghost" disabled={disabled} onClick={() => void clearMessages()} type="button">
                    清空消息
                  </button>
                  <button
                    className="ghost"
                    onClick={() => {
                      setSettingsDraft(createSessionDraft(agents, selectedSession));
                      setShowSettingsModal(true);
                    }}
                    type="button"
                  >
                    会话设置
                  </button>
                </div>
              </div>

              <div className="chat-log chat-log-standalone">
                {loadingMessages && <p className="hint">加载消息中...</p>}
                {!loadingMessages && messages.length === 0 && (
                  <p className="hint">发送第一条消息开始对话。使用 `@智能体名` 可以只触发指定参与者。</p>
                )}
                {messages.map((message, index) => {
                  const speaker =
                    message.role === "user"
                      ? "你"
                      : message.agentId
                        ? agentNameById[message.agentId] ?? message.agentId
                        : "系统";
                  return (
                    <div
                      className={message.role === "assistant" ? "chat-bubble assistant" : "chat-bubble user"}
                      key={`${message.createdAt}-${index}`}
                    >
                      <div className="chat-bubble-head">
                        <strong>{speaker}</strong>
                        <small>{formatDateTime(message.createdAt)}</small>
                      </div>
                      <div>{message.content}</div>
                    </div>
                  );
                })}
              </div>

              <div className="chat-composer card">
                <textarea
                  onChange={(event) => setComposer(event.target.value)}
                  placeholder="输入消息；如果会话里有仅 @ 回复的智能体，可以使用 @名称 定向触发。"
                  rows={4}
                  value={composer}
                />
                <div className="chat-composer-actions">
                  <small className="hint">
                    当前会话 {selectedSession.isGroup ? "包含多名智能体" : "仅包含一个智能体"}。
                    {streaming ? " 正在生成回复，可手动停止。" : ""}
                  </small>
                  <div className="actions">
                    {streaming && (
                      <button className="ghost" onClick={stopGeneration} type="button">
                        停止生成
                      </button>
                    )}
                    <button
                      className="primary"
                      disabled={disabled || sending || !composer.trim()}
                      onClick={() => void sendMessage()}
                      type="button"
                    >
                      {sending ? "发送中..." : "发送消息"}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <article className="card">
              <p className="hint">请选择一个会话，或先新建会话。</p>
              <div className="actions">
                <button
                  className="primary"
                  onClick={() => {
                    setCreateDraft(createSessionDraft(agents));
                    setShowCreateModal(true);
                  }}
                  type="button"
                >
                  新建会话
                </button>
              </div>
            </article>
          )}
        </div>
      </div>

      {notice && <div className="hint workspace-chat-notice">{notice}</div>}
      {error && errorDisplay && (
        <div className="error-box">
          <strong>{errorDisplay.title}</strong>
          <div>{errorDisplay.message}</div>
        </div>
      )}

      {showCreateModal && (
        <FormModal title="新建会话" onClose={() => setShowCreateModal(false)}>
          <div className="stack">
            <label>
              会话名称
              <input
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="例如：产品策划群聊"
                value={createDraft.title}
              />
            </label>
            {renderParticipantEditor(createDraft, setCreateDraft)}
            <small className="hint">单个参与者就是单聊，多个参与者会创建群组会话。</small>
            <div className="actions">
              <button className="ghost" onClick={() => setShowCreateModal(false)} type="button">
                取消
              </button>
              <button className="primary" onClick={() => void submitCreate()} type="button">
                创建会话
              </button>
            </div>
          </div>
        </FormModal>
      )}

      {showSettingsModal && selectedSession && (
        <FormModal title="会话设置" onClose={() => setShowSettingsModal(false)}>
          <div className="stack">
            <label>
              会话名称
              <input
                onChange={(event) =>
                  setSettingsDraft((current) => ({ ...current, title: event.target.value }))
                }
                value={settingsDraft.title}
              />
            </label>
            <div className="field-grid">
              <label className="inline-check">
                <input
                  checked={settingsDraft.isPinned}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, isPinned: event.target.checked }))
                  }
                  type="checkbox"
                />
                置顶会话
              </label>
              <label className="inline-check">
                <input
                  checked={settingsDraft.isArchived}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, isArchived: event.target.checked }))
                  }
                  type="checkbox"
                />
                归档会话
              </label>
            </div>
            <label>
              标签（逗号分隔）
              <input
                onChange={(event) =>
                  setSettingsDraft((current) => ({ ...current, tags: event.target.value }))
                }
                placeholder="例如：规划, 高优先级"
                value={settingsDraft.tags}
              />
            </label>
            {renderParticipantEditor(settingsDraft, setSettingsDraft)}
            <div className="actions">
              <button className="danger" onClick={() => void deleteSession()} type="button">
                删除会话
              </button>
              <button className="ghost" onClick={() => setShowSettingsModal(false)} type="button">
                取消
              </button>
              <button className="primary" onClick={() => void submitSettings()} type="button">
                保存设置
              </button>
            </div>
          </div>
        </FormModal>
      )}
    </section>
  );
}
