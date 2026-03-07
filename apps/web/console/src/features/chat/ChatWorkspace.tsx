import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
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

const buildAvatarLabel = (name: string): string => {
  const clean = name.trim();
  if (!clean) {
    return "?";
  }
  return clean.slice(0, 2).toUpperCase();
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
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const errorDisplay = error ? describeApiError(error) : null;
  const clearFeedback = (resetNotice = true) => {
    setError(null);
    if (resetNotice) {
      setNotice("");
    }
  };

  const agentNameById = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const selectedSession = sessions.find((item) => item.id === selectedSessionId) ?? null;
  const selectedParticipantNames = useMemo(
    () =>
      selectedSession?.participants.map((item) => agentNameById[item.agentId] ?? item.agentId) ?? [],
    [agentNameById, selectedSession],
  );
  const selectedSessionAvatar = selectedSession
    ? selectedSession.isGroup
      ? "群"
      : buildAvatarLabel(selectedParticipantNames[0] ?? selectedSession.title)
    : "";

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
      clearFeedback();
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
    clearFeedback();
    void loadMessages(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    const element = chatLogRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [messages, loadingMessages, streaming]);

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
      clearFeedback();
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
      clearFeedback();
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
      setNotice("会话设置已保存。");
      setError(null);
    } catch (rawError) {
      setNotice("");
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
    clearFeedback();
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
        setError(null);
        await Promise.all([loadMessages(selectedSessionId), loadSessions(selectedSessionId)]);
      } else {
        setNotice("");
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
      clearFeedback();
      await onClearMessages(selectedSessionId);
      await Promise.all([loadMessages(selectedSessionId), loadSessions(selectedSessionId)]);
      setNotice("当前会话消息已清空。");
      setError(null);
    } catch (rawError) {
      setNotice("");
      setError(toApiError(rawError));
    }
  };

  const stopGeneration = () => {
    activeStreamRef.current?.abort();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    if (!disabled && !sending && composer.trim()) {
      void sendMessage();
    }
  };

  const deleteSession = async () => {
    if (!selectedSession || !window.confirm(`确认删除会话“${selectedSession.title}”？`)) {
      return;
    }
    try {
      clearFeedback();
      await onDeleteSession(selectedSession.id);
      setShowSettingsModal(false);
      await loadSessions();
      setNotice("会话已删除。");
      setError(null);
    } catch (rawError) {
      setNotice("");
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
    <section className="panel chat-workspace-panel">
      <div className="chat-session-workbench">
        <div className="chat-session-main">
          {selectedSession ? (
            <div className="chat-thread-shell">
              <div className="chat-session-main-head">
                <div className="chat-thread-profile">
                  <div className="chat-thread-avatar">{selectedSessionAvatar}</div>
                  <div className="chat-thread-meta">
                    <div className="chat-session-main-title-row">
                      <h3>{selectedSession.title}</h3>
                      <span className="status-badge">{selectedSession.isGroup ? "群聊会话" : "单聊会话"}</span>
                    </div>
                    <div className="chat-thread-summary">
                      <span>{selectedSession.messageCount} 条</span>
                      <span>{formatDateTime(selectedSession.updatedAt)}</span>
                      {selectedSession.isPinned && <span>已置顶</span>}
                      {selectedSession.isArchived && <span>已归档</span>}
                    </div>
                    <div className="chat-session-participants">
                      {selectedSession.participants.map((participant) => (
                        <span className="chat-session-participant-pill" key={participant.agentId}>
                          <strong>{agentNameById[participant.agentId] ?? participant.agentId}</strong>
                          <small>
                            收 {participant.receiveMode === "all" ? "全" : "@"} · 回{" "}
                            {participant.replyMode === "all" ? "全" : "@"}
                          </small>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="actions chat-thread-actions">
                  <button className="ghost" disabled={disabled} onClick={() => void clearMessages()} type="button">
                    清空
                  </button>
                  <button
                    className="ghost"
                    onClick={() => {
                      setSettingsDraft(createSessionDraft(agents, selectedSession));
                      setShowSettingsModal(true);
                    }}
                    type="button"
                  >
                    设置
                  </button>
                </div>
              </div>

              {notice && <div className="chat-thread-banner">{notice}</div>}
              {error && errorDisplay && (
                <div className="chat-thread-banner is-error">
                  <strong>{errorDisplay.title}</strong>
                  <span>{errorDisplay.message}</span>
                </div>
              )}

              <div className="chat-log chat-log-standalone chat-thread-log" ref={chatLogRef}>
                {loadingMessages && <p className="hint">加载消息中...</p>}
                {!loadingMessages && messages.length === 0 && (
                  <div className="chat-thread-empty-state">
                    <strong>还没有聊天记录</strong>
                    <p>发送第一条消息开始对话，使用 `@智能体名` 定向参与者。</p>
                  </div>
                )}
                {messages.map((message, index) => {
                  const roleClass =
                    message.role === "assistant"
                      ? "assistant"
                      : message.role === "user"
                        ? "user"
                        : "system";
                  const speaker =
                    message.role === "user"
                      ? "你"
                      : message.agentId
                        ? agentNameById[message.agentId] ?? message.agentId
                        : "系统";
                  if (roleClass === "system") {
                    return (
                      <div className="chat-system-row" key={`${message.createdAt}-${index}`}>
                        <span className="chat-system-badge">{speaker}</span>
                        <p>{message.content}</p>
                      </div>
                    );
                  }
                  return (
                    <div className={`chat-message-row ${roleClass}`} key={`${message.createdAt}-${index}`}>
                      <div className={`chat-message-avatar ${roleClass}`}>{buildAvatarLabel(speaker)}</div>
                      <div className={`chat-bubble ${roleClass === "assistant" ? "assistant" : "user"}`}>
                        <div className="chat-bubble-head">
                          <strong>{speaker}</strong>
                          <small>{formatDateTime(message.createdAt)}</small>
                        </div>
                        <p>{message.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="chat-composer card">
                <textarea
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="输入消息；如果会话里有仅 @ 回复的智能体，可以使用 @名称 定向触发。"
                  rows={4}
                  value={composer}
                />
                <div className="chat-composer-actions">
                  <div className="chat-composer-hints">
                    <span className="chat-composer-chip">
                      {selectedSession.isGroup ? "群聊模式" : "单聊模式"}
                    </span>
                    <span className="chat-composer-chip">Enter 发送</span>
                    <span className="chat-composer-chip">Shift + Enter 换行</span>
                    {streaming && <span className="chat-composer-chip is-live">正在生成</span>}
                  </div>
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
                      {sending ? "发送中..." : "发送"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="chat-thread-shell chat-thread-empty-shell">
              <div className="chat-thread-empty-state">
                <strong>请选择一个会话</strong>
                <p>右侧会话列表用于切换线程，也可以直接新建单聊或群聊。</p>
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
              </div>
            </div>
          )}
        </div>

        <aside className="chat-session-sidebar">
          <div className="chat-session-sidebar-head">
            <div>
              <strong>会话列表</strong>
              <small>{sessions.length} 个会话</small>
            </div>
            <div className="actions chat-session-sidebar-tools">
              <button className="ghost" onClick={() => void loadSessions(selectedSessionId)} type="button">
                刷新
              </button>
              <button
                className="primary"
                onClick={() => {
                  setCreateDraft(createSessionDraft(agents));
                  setShowCreateModal(true);
                }}
                type="button"
              >
                新建
              </button>
            </div>
          </div>
          <div className="chat-session-list">
            {loadingSessions && <p className="hint">加载会话中...</p>}
            {!loadingSessions && sessions.length === 0 && (
              <p className="hint">还没有会话，先创建一个单聊或群组会话。</p>
            )}
            {sessions.map((session) => {
              const sessionParticipants = session.participants.map(
                (item) => agentNameById[item.agentId] ?? item.agentId,
              );
              return (
                <button
                  className={session.id === selectedSessionId ? "chat-session-item active" : "chat-session-item"}
                  key={session.id}
                  onClick={() => setSelectedSessionId(session.id)}
                  type="button"
                >
                  <div className="chat-session-avatar">
                    {session.isGroup ? "群" : buildAvatarLabel(sessionParticipants[0] ?? session.title)}
                  </div>
                  <div className="chat-session-item-body">
                    <div className="chat-session-item-top">
                      <strong>{session.title}</strong>
                      <small>{formatDateTime(session.updatedAt)}</small>
                    </div>
                    <div className="chat-session-item-meta">
                      <span>{session.isGroup ? "群聊" : "单聊"}</span>
                      {session.isPinned && <span>置顶</span>}
                      {session.isArchived && <span>归档</span>}
                    </div>
                    <small className="chat-session-item-members">
                      {sessionParticipants.join(" · ") || "暂无参与者"}
                    </small>
                    <span className="chat-session-item-preview">
                      {session.lastMessagePreview ?? "暂无消息"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

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
