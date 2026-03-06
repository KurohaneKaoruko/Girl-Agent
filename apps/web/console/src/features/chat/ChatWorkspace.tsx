import { useEffect, useRef, useState } from "react";
import type {
  AgentConfig,
  ApiError,
  ChatMessage,
  ChatSession,
  ChatWithAgentRequest,
  ChatWithAgentResponse,
  RegenerateChatReplyRequest,
  RewriteChatUserMessageRequest,
  UndoLastChatTurnRequest,
  UndoLastChatTurnResponse,
} from "@/types";

type Props = {
  agents: AgentConfig[];
  focusedAgentId?: string | null;
  disabled: boolean;
  onChat: (input: ChatWithAgentRequest) => Promise<ChatWithAgentResponse>;
  onChatStream: (
    input: ChatWithAgentRequest,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
  ) => Promise<ChatWithAgentResponse>;
  onRegenerate: (input: RegenerateChatReplyRequest) => Promise<ChatWithAgentResponse>;
  onRegenerateStream: (
    input: RegenerateChatReplyRequest,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
  ) => Promise<ChatWithAgentResponse>;
  onRewriteUserMessage: (input: RewriteChatUserMessageRequest) => Promise<ChatWithAgentResponse>;
  onUndoLastTurn: (input: UndoLastChatTurnRequest) => Promise<UndoLastChatTurnResponse>;
  onListSessions: (agentId: string) => Promise<ChatSession[]>;
  onCreateSession: (agentId: string, title: string) => Promise<ChatSession>;
  onRenameSession: (agentId: string, sessionId: string, title: string) => Promise<ChatSession>;
  onDuplicateSession: (agentId: string, sourceSessionId: string, title: string) => Promise<ChatSession>;
  onSetSessionPinned: (agentId: string, sessionId: string, pinned: boolean) => Promise<ChatSession>;
  onSetSessionArchived: (agentId: string, sessionId: string, archived: boolean) => Promise<ChatSession>;
  onSetSessionTags: (agentId: string, sessionId: string, tags: string[]) => Promise<ChatSession>;
  onDeleteSession: (agentId: string, sessionId: string) => Promise<void>;
  onLoadSessionMessages: (agentId: string, sessionId: string) => Promise<ChatMessage[]>;
  onClearSessionMessages: (agentId: string, sessionId: string) => Promise<void>;
};

const CHAT_WINDOW_PREF_KEY = "girlagent.chat.windowPrefs.v1";

type AgentChatWindow = {
  sessions: ChatSession[];
  selectedSessionId: string;
  sessionSearch: string;
  sessionFilter: "all" | "active" | "archived";
  sessionOnlyPinned: boolean;
  messages: ChatMessage[];
  input: string;
  temperature: string;
  maxTokens: string;
  topP: string;
  frequencyPenalty: string;
  streamingEnabled: boolean;
  regenerateReplaceLastAssistant: boolean;
  lastModelId: string;
  sending: boolean;
  streaming: boolean;
  rewriting: boolean;
  undoing: boolean;
  loadingSessions: boolean;
  loadingMessages: boolean;
  clearing: boolean;
  exportingAll: boolean;
  highlightedMessageIndexes: number[];
  highlightToken: number;
  error: ApiError | null;
};

type WindowPreference = {
  selectedSessionId?: string;
  sessionSearch?: string;
  sessionFilter?: "all" | "active" | "archived";
  sessionOnlyPinned?: boolean;
  input?: string;
  temperature?: string;
  maxTokens?: string;
  topP?: string;
  frequencyPenalty?: string;
  streamingEnabled?: boolean;
  regenerateReplaceLastAssistant?: boolean;
};

const loadPreferences = (): Record<string, WindowPreference> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(CHAT_WINDOW_PREF_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, WindowPreference>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const createEmptyWindow = (preference?: WindowPreference): AgentChatWindow => ({
  sessions: [],
  selectedSessionId: preference?.selectedSessionId ?? "",
  sessionSearch: preference?.sessionSearch ?? "",
  sessionFilter: preference?.sessionFilter ?? "active",
  sessionOnlyPinned: preference?.sessionOnlyPinned ?? false,
  messages: [],
  input: preference?.input ?? "",
  temperature: preference?.temperature ?? "",
  maxTokens: preference?.maxTokens ?? "",
  topP: preference?.topP ?? "",
  frequencyPenalty: preference?.frequencyPenalty ?? "",
  streamingEnabled: preference?.streamingEnabled ?? true,
  regenerateReplaceLastAssistant: preference?.regenerateReplaceLastAssistant ?? true,
  lastModelId: "",
  sending: false,
  streaming: false,
  rewriting: false,
  undoing: false,
  loadingSessions: true,
  loadingMessages: false,
  clearing: false,
  exportingAll: false,
  highlightedMessageIndexes: [],
  highlightToken: 0,
  error: null,
});

const parseOptionalNumber = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const toApiError = (error: unknown): ApiError => {
  if (typeof error === "object" && error !== null) {
    const payload = error as { code?: unknown; name?: unknown; message?: unknown };
    if (payload.code === "STREAM_ABORTED" || payload.name === "AbortError") {
      return { code: "STREAM_ABORTED", message: "已停止生成" };
    }
  }
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

const pickDefaultSessionId = (sessions: ChatSession[]): string =>
  sessions.find((item) => item.isDefault)?.id ?? sessions[0]?.id ?? "";

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

const formatSessionFileName = (agentName: string, sessionTitle: string): string =>
  `${agentName}-${sessionTitle}`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 64) || "chat-session";

export function ChatWorkspace({
  agents,
  focusedAgentId = null,
  disabled,
  onChat,
  onChatStream,
  onRegenerate,
  onRegenerateStream,
  onRewriteUserMessage,
  onUndoLastTurn,
  onListSessions,
  onCreateSession,
  onRenameSession,
  onDuplicateSession,
  onSetSessionPinned,
  onSetSessionArchived,
  onSetSessionTags,
  onDeleteSession,
  onLoadSessionMessages,
  onClearSessionMessages,
}: Props) {
  const [windows, setWindows] = useState<Record<string, AgentChatWindow>>({});
  const windowsRef = useRef<Record<string, AgentChatWindow>>({});
  const initializedRef = useRef<Set<string>>(new Set());
  const sessionLoadTokenRef = useRef<Record<string, number>>({});
  const messageLoadRef = useRef<Record<string, string>>({});
  const chatLogRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const preferencesRef = useRef<Record<string, WindowPreference>>(loadPreferences());
  const streamAbortRef = useRef<Record<string, AbortController | null>>({});

  const beginStream = (agentId: string) => {
    const previous = streamAbortRef.current[agentId];
    if (previous) {
      previous.abort();
    }
    const next = new AbortController();
    streamAbortRef.current[agentId] = next;
    return next;
  };

  const finishStream = (agentId: string, controller: AbortController) => {
    if (streamAbortRef.current[agentId] === controller) {
      streamAbortRef.current[agentId] = null;
    }
  };

  const updateWindow = (agentId: string, patch: Partial<AgentChatWindow>) => {
    setWindows((current) => {
      const window = current[agentId] ?? createEmptyWindow(preferencesRef.current[agentId]);
      return {
        ...current,
        [agentId]: {
          ...window,
          ...patch,
        },
      };
    });
  };

  const collectRewriteHighlightIndexes = (messages: ChatMessage[], targetUserOffset: number): number[] => {
    const userIndexes = messages
      .map((message, index) => (message.role === "user" ? index : -1))
      .filter((index) => index >= 0);
    const targetPosition = userIndexes.length - 1 - targetUserOffset;
    if (targetPosition < 0 || targetPosition >= userIndexes.length) {
      return [];
    }
    const targetUserIndex = userIndexes[targetPosition];
    let targetAssistantIndex = -1;
    for (let index = targetUserIndex + 1; index < messages.length; index += 1) {
      if (messages[index].role === "assistant") {
        targetAssistantIndex = index;
        break;
      }
      if (messages[index].role === "user") {
        break;
      }
    }
    return targetAssistantIndex >= 0 ? [targetUserIndex, targetAssistantIndex] : [targetUserIndex];
  };

  const scheduleMessageHighlight = (agentId: string, indexes: number[]) => {
    const deduped = [...new Set(indexes.filter((index) => index >= 0))];
    if (deduped.length === 0) {
      return;
    }
    const token = Date.now() + Math.random();
    updateWindow(agentId, {
      highlightedMessageIndexes: deduped,
      highlightToken: token,
    });
    if (typeof window === "undefined") {
      return;
    }
    window.setTimeout(() => {
      setWindows((current) => {
        const state = current[agentId];
        if (!state || state.highlightToken !== token) {
          return current;
        }
        return {
          ...current,
          [agentId]: {
            ...state,
            highlightedMessageIndexes: [],
          },
        };
      });
    }, 3200);
  };

  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  useEffect(() => {
    return () => {
      for (const controller of Object.values(streamAbortRef.current)) {
        controller?.abort();
      }
      streamAbortRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const nextPreferences: Record<string, WindowPreference> = {};
    for (const [agentId, state] of Object.entries(windows)) {
      nextPreferences[agentId] = {
        selectedSessionId: state.selectedSessionId,
        sessionSearch: state.sessionSearch,
        sessionFilter: state.sessionFilter,
        sessionOnlyPinned: state.sessionOnlyPinned,
        input: state.input,
        temperature: state.temperature,
        maxTokens: state.maxTokens,
        topP: state.topP,
        frequencyPenalty: state.frequencyPenalty,
        streamingEnabled: state.streamingEnabled,
        regenerateReplaceLastAssistant: state.regenerateReplaceLastAssistant,
      };
    }
    preferencesRef.current = nextPreferences;
    window.localStorage.setItem(CHAT_WINDOW_PREF_KEY, JSON.stringify(nextPreferences));
  }, [windows]);

  useEffect(() => {
    for (const agent of agents) {
      const log = chatLogRefs.current[agent.id];
      if (!log) continue;
      log.scrollTop = log.scrollHeight;
    }
  }, [agents, windows]);

  const loadMessages = async (agentId: string, sessionId: string): Promise<ChatMessage[] | null> => {
    messageLoadRef.current[agentId] = sessionId;
    updateWindow(agentId, { loadingMessages: true, error: null });
    try {
      const messages = await onLoadSessionMessages(agentId, sessionId);
      if (messageLoadRef.current[agentId] !== sessionId) {
        return null;
      }
      updateWindow(agentId, {
        messages,
        selectedSessionId: sessionId,
        loadingMessages: false,
      });
      return messages;
    } catch (rawError) {
      if (messageLoadRef.current[agentId] !== sessionId) {
        return null;
      }
      updateWindow(agentId, {
        loadingMessages: false,
        error: toApiError(rawError),
      });
      return null;
    }
  };

  const loadSessions = async (agentId: string, preferredSessionId?: string) => {
    const token = Date.now() + Math.random();
    sessionLoadTokenRef.current[agentId] = token;
    updateWindow(agentId, { loadingSessions: true, error: null });
    try {
      const sessions = await onListSessions(agentId);
      if (sessionLoadTokenRef.current[agentId] !== token) {
        return;
      }
      const currentWindow = windowsRef.current[agentId] ?? createEmptyWindow(preferencesRef.current[agentId]);
      const persistedSessionId = preferencesRef.current[agentId]?.selectedSessionId;
      const selectedSessionId =
        sessions.find((item) => item.id === preferredSessionId)?.id ??
        sessions.find((item) => item.id === currentWindow.selectedSessionId)?.id ??
        sessions.find((item) => item.id === persistedSessionId)?.id ??
        pickDefaultSessionId(sessions);

      updateWindow(agentId, {
        sessions,
        selectedSessionId,
        loadingSessions: false,
      });

      if (selectedSessionId) {
        await loadMessages(agentId, selectedSessionId);
      } else {
        updateWindow(agentId, { messages: [] });
      }
    } catch (rawError) {
      if (sessionLoadTokenRef.current[agentId] !== token) {
        return;
      }
      updateWindow(agentId, {
        loadingSessions: false,
        error: toApiError(rawError),
      });
    }
  };

  useEffect(() => {
    setWindows((current) => {
      const next: Record<string, AgentChatWindow> = {};
      for (const agent of agents) {
        next[agent.id] = current[agent.id] ?? createEmptyWindow(preferencesRef.current[agent.id]);
      }
      return next;
    });

    const currentIds = new Set(agents.map((agent) => agent.id));
    for (const id of Array.from(initializedRef.current)) {
      if (!currentIds.has(id)) {
        initializedRef.current.delete(id);
      }
    }
    for (const [id, controller] of Object.entries(streamAbortRef.current)) {
      if (!currentIds.has(id)) {
        controller?.abort();
        delete streamAbortRef.current[id];
      }
    }

    for (const agent of agents) {
      if (initializedRef.current.has(agent.id)) continue;
      initializedRef.current.add(agent.id);
      void loadSessions(agent.id);
    }
  }, [agents]);

  const createSession = async (agentId: string) => {
    const defaultTitle = `新会话 ${new Date().toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })}`;
    const title = window.prompt("输入新会话名称", defaultTitle);
    if (!title || !title.trim()) return;
    try {
      const created = await onCreateSession(agentId, title.trim());
      await loadSessions(agentId, created.id);
    } catch (rawError) {
      updateWindow(agentId, { error: toApiError(rawError) });
    }
  };

  const renameSession = async (agentId: string) => {
    const state = windows[agentId] ?? createEmptyWindow();
    if (!state.selectedSessionId) return;
    const current = state.sessions.find((item) => item.id === state.selectedSessionId);
    if (!current || current.isDefault) return;

    const title = window.prompt("输入新会话名称", current.title);
    if (!title || !title.trim()) return;
    try {
      const renamed = await onRenameSession(agentId, state.selectedSessionId, title.trim());
      await loadSessions(agentId, renamed.id);
    } catch (rawError) {
      updateWindow(agentId, { error: toApiError(rawError) });
    }
  };

  const duplicateSession = async (agentId: string) => {
    const state = windows[agentId] ?? createEmptyWindow();
    if (!state.selectedSessionId) return;
    const source = state.sessions.find((item) => item.id === state.selectedSessionId);
    if (!source) return;

    const title = window.prompt("输入副本会话名称", `${source.title} - 副本`);
    if (!title || !title.trim()) return;
    try {
      const duplicated = await onDuplicateSession(agentId, source.id, title.trim());
      await loadSessions(agentId, duplicated.id);
    } catch (rawError) {
      updateWindow(agentId, { error: toApiError(rawError) });
    }
  };

  const toggleSessionPinned = async (agentId: string) => {
    const state = windows[agentId] ?? createEmptyWindow();
    const current = state.sessions.find((item) => item.id === state.selectedSessionId);
    if (!current) return;
    try {
      const updated = await onSetSessionPinned(agentId, current.id, !current.isPinned);
      await loadSessions(agentId, updated.id);
    } catch (rawError) {
      updateWindow(agentId, { error: toApiError(rawError) });
    }
  };

  const toggleSessionArchived = async (agentId: string) => {
    const state = windows[agentId] ?? createEmptyWindow();
    const current = state.sessions.find((item) => item.id === state.selectedSessionId);
    if (!current) return;
    try {
      const updated = await onSetSessionArchived(agentId, current.id, !current.isArchived);
      await loadSessions(agentId, updated.id);
    } catch (rawError) {
      updateWindow(agentId, { error: toApiError(rawError) });
    }
  };

  const editSessionTags = async (agentId: string) => {
    const state = windows[agentId] ?? createEmptyWindow();
    const current = state.sessions.find((item) => item.id === state.selectedSessionId);
    if (!current) return;
    const initial = current.tags.join(", ");
    const raw = window.prompt("输入标签（逗号分隔）", initial);
    if (raw === null) return;
    const tags = raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    try {
      const updated = await onSetSessionTags(agentId, current.id, tags);
      await loadSessions(agentId, updated.id);
    } catch (rawError) {
      updateWindow(agentId, { error: toApiError(rawError) });
    }
  };

  const deleteSession = async (agentId: string) => {
    const state = windows[agentId] ?? createEmptyWindow();
    if (!state.selectedSessionId) return;
    const current = state.sessions.find((item) => item.id === state.selectedSessionId);
    if (!current || current.isDefault) return;

    if (!window.confirm(`删除会话「${current.title}」？`)) return;
    try {
      await onDeleteSession(agentId, current.id);
      await loadSessions(agentId);
    } catch (rawError) {
      updateWindow(agentId, { error: toApiError(rawError) });
    }
  };

  const clearMessages = async (agentId: string) => {
    const state = windows[agentId] ?? createEmptyWindow();
    if (!state.selectedSessionId) return;

    updateWindow(agentId, { clearing: true, error: null });
    try {
      await onClearSessionMessages(agentId, state.selectedSessionId);
      updateWindow(agentId, {
        messages: [],
        lastModelId: "",
        clearing: false,
        error: null,
      });
      void loadSessions(agentId, state.selectedSessionId);
    } catch (rawError) {
      updateWindow(agentId, { clearing: false, error: toApiError(rawError) });
    }
  };

  const refreshSessions = async (agentId: string) => {
    const state = windows[agentId] ?? createEmptyWindow();
    await loadSessions(agentId, state.selectedSessionId || undefined);
  };

  const stopStreaming = (agentId: string) => {
    const controller = streamAbortRef.current[agentId];
    if (!controller) {
      return;
    }
    controller.abort();
    streamAbortRef.current[agentId] = null;
    updateWindow(agentId, {
      sending: false,
      streaming: false,
      error: null,
    });
  };

  const exportSession = (agent: AgentConfig, state: AgentChatWindow) => {
    const session = state.sessions.find((item) => item.id === state.selectedSessionId);
    if (!session) return;

    const lines: string[] = [];
    lines.push(`# ${agent.name} · ${session.title}`);
    lines.push("");
    lines.push(`- 会话 ID: ${session.id}`);
    lines.push(`- 导出时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}`);
    lines.push("");

    for (const message of state.messages) {
      const speaker =
        message.role === "assistant"
          ? agent.name
          : message.role === "user"
            ? "你"
            : message.role;
      lines.push(`## ${speaker}`);
      lines.push("");
      lines.push(message.content);
      lines.push("");
    }

    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${formatSessionFileName(agent.name, session.title)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportAllSessions = async (agent: AgentConfig, state: AgentChatWindow) => {
    if (state.exportingAll) return;
    updateWindow(agent.id, { exportingAll: true, error: null });
    try {
      const sessions = [...state.sessions];
      const lines: string[] = [];
      lines.push(`# ${agent.name} · 全部会话导出`);
      lines.push("");
      lines.push(`- 导出时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}`);
      lines.push(`- 会话数量: ${sessions.length}`);
      lines.push("");
      lines.push("## 会话目录");
      lines.push("");
      for (const session of sessions) {
        lines.push(
          `- ${session.title} (${session.messageCount} 条, 更新时间 ${formatDateTime(session.updatedAt)})`,
        );
      }
      lines.push("");

      for (const session of sessions) {
        const messages =
          session.id === state.selectedSessionId
            ? state.messages
            : await onLoadSessionMessages(agent.id, session.id);
        lines.push(`## ${session.title}`);
        lines.push("");
        lines.push(`- 会话 ID: ${session.id}`);
        lines.push(`- 消息数: ${messages.length}`);
        lines.push("");
        for (const message of messages) {
          const speaker =
            message.role === "assistant" ? agent.name : message.role === "user" ? "你" : message.role;
          lines.push(`### ${speaker}`);
          lines.push("");
          lines.push(message.content);
          lines.push("");
        }
        lines.push("---");
        lines.push("");
      }

      const markdown = lines.join("\n");
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${formatSessionFileName(agent.name, "all-sessions")}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
      updateWindow(agent.id, { exportingAll: false });
    } catch (rawError) {
      updateWindow(agent.id, { exportingAll: false, error: toApiError(rawError) });
    }
  };

  const copyMessageContent = async (agentId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      updateWindow(agentId, {
        error: { code: "COPY_FAILED", message: "复制失败：当前环境不支持剪贴板写入" },
      });
    }
  };

  const quoteMessageToInput = (agentId: string, content: string) => {
    setWindows((current) => {
      const state = current[agentId] ?? createEmptyWindow(preferencesRef.current[agentId]);
      const quoted = content
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      const nextInput = state.input.trim()
        ? `${state.input.trimEnd()}\n\n${quoted}\n`
        : `${quoted}\n`;
      return {
        ...current,
        [agentId]: {
          ...state,
          input: nextInput,
        },
      };
    });
  };

  const buildRegenerateBaseMessages = (messages: ChatMessage[], replaceLastAssistant: boolean) => {
    const next = [...messages];
    if (!replaceLastAssistant) return next;
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (next[index].role === "assistant") {
        next.splice(index, 1);
        break;
      }
    }
    return next;
  };

  const regenerateReply = async (agent: AgentConfig) => {
    const state = windows[agent.id] ?? createEmptyWindow();
    if (!state.selectedSessionId || state.sending || state.rewriting || state.undoing || disabled) {
      return;
    }
    if (!state.messages.some((message) => message.role === "user")) {
      updateWindow(agent.id, {
        error: {
          code: "VALIDATION_ERROR",
          message: "当前会话没有用户消息，无法重新生成。",
        },
      });
      return;
    }

    const request: RegenerateChatReplyRequest = {
      agentId: agent.id,
      sessionId: state.selectedSessionId,
      replaceLastAssistant: state.regenerateReplaceLastAssistant,
      temperature: parseOptionalNumber(state.temperature),
      maxTokens: parseOptionalNumber(state.maxTokens),
      topP: parseOptionalNumber(state.topP),
      frequencyPenalty: parseOptionalNumber(state.frequencyPenalty),
    };

    if (state.streamingEnabled) {
      const controller = beginStream(agent.id);
      setWindows((current) => {
        const windowState = current[agent.id] ?? createEmptyWindow(preferencesRef.current[agent.id]);
        return {
          ...current,
          [agent.id]: {
            ...windowState,
            sending: true,
            streaming: true,
            error: null,
            messages: [
              ...buildRegenerateBaseMessages(
                windowState.messages,
                windowState.regenerateReplaceLastAssistant,
              ),
              { role: "assistant", content: "" },
            ],
          },
        };
      });

      try {
        const result = await onRegenerateStream(
          request,
          (chunk) => {
            setWindows((current) => {
              const windowState = current[agent.id] ?? createEmptyWindow(preferencesRef.current[agent.id]);
              const messages = [...windowState.messages];
              for (let index = messages.length - 1; index >= 0; index -= 1) {
                if (messages[index].role === "assistant") {
                  messages[index] = {
                    ...messages[index],
                    content: `${messages[index].content}${chunk}`,
                  };
                  break;
                }
              }
              return {
                ...current,
                [agent.id]: {
                  ...windowState,
                  messages,
                },
              };
            });
          },
          controller.signal,
        );

        setWindows((current) => {
          const windowState = current[agent.id] ?? createEmptyWindow(preferencesRef.current[agent.id]);
          const messages = [...windowState.messages];
          for (let index = messages.length - 1; index >= 0; index -= 1) {
            if (messages[index].role === "assistant") {
              messages[index] = {
                ...messages[index],
                content: result.message,
              };
              break;
            }
          }
          return {
            ...current,
            [agent.id]: {
              ...windowState,
              sending: false,
              streaming: false,
              lastModelId: result.modelId,
              selectedSessionId: result.sessionId,
              messages,
            },
          };
        });

        void loadSessions(agent.id, result.sessionId);
      } catch (rawError) {
        const mapped = toApiError(rawError);
        if (mapped.code === "STREAM_ABORTED") {
          setWindows((current) => {
            const windowState = current[agent.id] ?? createEmptyWindow(preferencesRef.current[agent.id]);
            return {
              ...current,
              [agent.id]: {
                ...windowState,
                sending: false,
                streaming: false,
                error: null,
              },
            };
          });
          void loadMessages(agent.id, state.selectedSessionId);
          void loadSessions(agent.id, state.selectedSessionId);
        } else {
          updateWindow(agent.id, {
            sending: false,
            streaming: false,
            error: mapped,
            messages: state.messages,
          });
          void loadMessages(agent.id, state.selectedSessionId);
        }
      } finally {
        finishStream(agent.id, controller);
      }
      return;
    }

    updateWindow(agent.id, { sending: true, streaming: false, error: null });
    try {
      const result = await onRegenerate(request);
      setWindows((current) => {
        const windowState = current[agent.id] ?? createEmptyWindow(preferencesRef.current[agent.id]);
        return {
          ...current,
          [agent.id]: {
            ...windowState,
            sending: false,
            streaming: false,
            lastModelId: result.modelId,
            selectedSessionId: result.sessionId,
            messages: [
              ...buildRegenerateBaseMessages(
                windowState.messages,
                windowState.regenerateReplaceLastAssistant,
              ),
              { role: "assistant", content: result.message },
            ],
          },
        };
      });
      void loadSessions(agent.id, result.sessionId);
    } catch (rawError) {
      updateWindow(agent.id, { sending: false, streaming: false, error: toApiError(rawError) });
    }
  };

  const rewriteUserMessage = async (
    agent: AgentConfig,
    targetUserOffset: number,
    currentMessage: string,
  ) => {
    const state = windows[agent.id] ?? createEmptyWindow();
    if (
      !state.selectedSessionId ||
      state.rewriting ||
      state.sending ||
      state.undoing ||
      disabled
    ) {
      return;
    }

    if (!Number.isInteger(targetUserOffset) || targetUserOffset < 0) {
      updateWindow(agent.id, {
        error: {
          code: "VALIDATION_ERROR",
          message: "改写目标无效。",
        },
      });
      return;
    }

    const nextUserMessage = window.prompt("编辑用户消息", currentMessage);
    if (nextUserMessage === null) return;
    const trimmed = nextUserMessage.trim();
    if (!trimmed) {
      updateWindow(agent.id, {
        error: {
          code: "VALIDATION_ERROR",
          message: "用户消息不能为空。",
        },
      });
      return;
    }

    updateWindow(agent.id, { rewriting: true, error: null });
    try {
      const result = await onRewriteUserMessage({
        agentId: agent.id,
        sessionId: state.selectedSessionId,
        targetUserOffset,
        userMessage: trimmed,
        temperature: parseOptionalNumber(state.temperature),
        maxTokens: parseOptionalNumber(state.maxTokens),
        topP: parseOptionalNumber(state.topP),
        frequencyPenalty: parseOptionalNumber(state.frequencyPenalty),
      });
      updateWindow(agent.id, {
        rewriting: false,
        lastModelId: result.modelId,
        selectedSessionId: result.sessionId,
      });
      const refreshedMessages = await loadMessages(agent.id, result.sessionId);
      if (refreshedMessages) {
        scheduleMessageHighlight(
          agent.id,
          collectRewriteHighlightIndexes(refreshedMessages, targetUserOffset),
        );
      }
      void loadSessions(agent.id, result.sessionId);
    } catch (rawError) {
      updateWindow(agent.id, { rewriting: false, error: toApiError(rawError) });
    }
  };

  const rewriteLastUserMessage = async (agent: AgentConfig) => {
    const state = windows[agent.id] ?? createEmptyWindow();
    const lastUser = [...state.messages].reverse().find((message) => message.role === "user");
    if (!lastUser) {
      updateWindow(agent.id, {
        error: {
          code: "VALIDATION_ERROR",
          message: "当前会话没有用户消息，无法改写。",
        },
      });
      return;
    }
    await rewriteUserMessage(agent, 0, lastUser.content);
  };

  const undoLastTurn = async (agentId: string) => {
    const state = windows[agentId] ?? createEmptyWindow();
    if (!state.selectedSessionId || state.undoing || state.sending || disabled) return;

    updateWindow(agentId, { undoing: true, error: null });
    try {
      await onUndoLastTurn({
        agentId,
        sessionId: state.selectedSessionId,
      });
      await loadMessages(agentId, state.selectedSessionId);
      void loadSessions(agentId, state.selectedSessionId);
      updateWindow(agentId, { undoing: false });
    } catch (rawError) {
      updateWindow(agentId, { undoing: false, error: toApiError(rawError) });
    }
  };

  const sendMessage = async (agent: AgentConfig) => {
    const state = windows[agent.id] ?? createEmptyWindow();
    const userMessage = state.input.trim();
    if (
      !userMessage ||
      !state.selectedSessionId ||
      state.sending ||
      state.rewriting ||
      state.undoing ||
      disabled
    ) {
      return;
    }

    const request: ChatWithAgentRequest = {
      agentId: agent.id,
      sessionId: state.selectedSessionId,
      userMessage,
      history: [],
      temperature: parseOptionalNumber(state.temperature),
      maxTokens: parseOptionalNumber(state.maxTokens),
      topP: parseOptionalNumber(state.topP),
      frequencyPenalty: parseOptionalNumber(state.frequencyPenalty),
    };

    if (state.streamingEnabled) {
      const controller = beginStream(agent.id);
      setWindows((current) => {
        const windowState = current[agent.id] ?? createEmptyWindow(preferencesRef.current[agent.id]);
        return {
          ...current,
          [agent.id]: {
            ...windowState,
            sending: true,
            streaming: true,
            input: "",
            error: null,
            messages: [
              ...windowState.messages,
              { role: "user", content: userMessage },
              { role: "assistant", content: "" },
            ],
          },
        };
      });

      try {
        const result = await onChatStream(
          request,
          (chunk) => {
            setWindows((current) => {
              const windowState = current[agent.id] ?? createEmptyWindow(preferencesRef.current[agent.id]);
              const messages = [...windowState.messages];
              for (let index = messages.length - 1; index >= 0; index -= 1) {
                if (messages[index].role === "assistant") {
                  messages[index] = {
                    ...messages[index],
                    content: `${messages[index].content}${chunk}`,
                  };
                  break;
                }
              }
              return {
                ...current,
                [agent.id]: {
                  ...windowState,
                  messages,
                },
              };
            });
          },
          controller.signal,
        );

        setWindows((current) => {
          const windowState = current[agent.id] ?? createEmptyWindow(preferencesRef.current[agent.id]);
          const messages = [...windowState.messages];
          for (let index = messages.length - 1; index >= 0; index -= 1) {
            if (messages[index].role === "assistant") {
              messages[index] = {
                ...messages[index],
                content: result.message,
              };
              break;
            }
          }
          return {
            ...current,
            [agent.id]: {
              ...windowState,
              sending: false,
              streaming: false,
              lastModelId: result.modelId,
              selectedSessionId: result.sessionId,
              messages,
            },
          };
        });

        void loadSessions(agent.id, result.sessionId);
      } catch (rawError) {
        const mapped = toApiError(rawError);
        if (mapped.code === "STREAM_ABORTED") {
          setWindows((current) => {
            const windowState = current[agent.id] ?? createEmptyWindow(preferencesRef.current[agent.id]);
            return {
              ...current,
              [agent.id]: {
                ...windowState,
                sending: false,
                streaming: false,
                error: null,
              },
            };
          });
          void loadMessages(agent.id, state.selectedSessionId);
          void loadSessions(agent.id, state.selectedSessionId);
        } else {
          updateWindow(agent.id, {
            sending: false,
            streaming: false,
            error: mapped,
            input: state.input,
            messages: state.messages,
          });
          void loadMessages(agent.id, state.selectedSessionId);
        }
      } finally {
        finishStream(agent.id, controller);
      }
      return;
    }

    updateWindow(agent.id, { sending: true, streaming: false, error: null });
    try {
      const result = await onChat(request);

      setWindows((current) => {
        const windowState = current[agent.id] ?? createEmptyWindow();
        return {
          ...current,
          [agent.id]: {
            ...windowState,
            sending: false,
            streaming: false,
            input: "",
            lastModelId: result.modelId,
            selectedSessionId: result.sessionId,
            messages: [
              ...windowState.messages,
              { role: "user", content: userMessage },
              { role: "assistant", content: result.message },
            ],
          },
        };
      });

      void loadSessions(agent.id, result.sessionId);
    } catch (rawError) {
      updateWindow(agent.id, { sending: false, streaming: false, error: toApiError(rawError) });
    }
  };

  if (agents.length === 0) {
    return (
      <section className="panel">
        <header className="panel-header">
          <h2>对话聊天</h2>
        </header>
        <article className="card">
          <p className="hint">请先在“智能体设置”中创建至少一个智能体。</p>
        </article>
      </section>
    );
  }

  const visibleAgents = focusedAgentId
    ? agents.filter((agent) => agent.id === focusedAgentId)
    : agents;

  if (visibleAgents.length === 0) {
    return (
      <section className="panel">
        <header className="panel-header">
          <h2>对话聊天</h2>
        </header>
        <article className="card">
          <p className="hint">请选择一个智能体开始对话。</p>
        </article>
      </section>
    );
  }

  return (
    <section className="panel">
      <header className="panel-header chat-workspace-header">
        <div>
          <span className="hero-chip hero-chip-soft">对话工作台</span>
          <h2>对话聊天</h2>
        </div>
        <small className="hint">每个智能体独立窗口，支持多会话、流式回复与快速整理</small>
      </header>

      <div
        className={
          visibleAgents.length === 1 ? "chat-window-grid chat-window-grid-single" : "chat-window-grid"
        }
      >
        {visibleAgents.map((agent) => {
          const state = windows[agent.id] ?? createEmptyWindow();
          const selectedSession = state.sessions.find((item) => item.id === state.selectedSessionId) ?? null;
          const sessionSearch = state.sessionSearch.trim().toLowerCase();
          const filteredSessions = state.sessions.filter((session) => {
            if (state.sessionFilter === "active" && session.isArchived) return false;
            if (state.sessionFilter === "archived" && !session.isArchived) return false;
            if (state.sessionOnlyPinned && !session.isPinned) return false;
            if (!sessionSearch) return true;
            const title = session.title.toLowerCase();
            const preview = (session.lastMessagePreview ?? "").toLowerCase();
            const tags = session.tags.join(" ").toLowerCase();
            if (tags.includes(sessionSearch)) return true;
            return title.includes(sessionSearch) || preview.includes(sessionSearch);
          });
          const userMessageIndices = state.messages
            .map((message, index) => (message.role === "user" ? index : -1))
            .filter((index) => index >= 0);
          const userOffsetByMessageIndex = new Map<number, number>();
          for (let userPosition = 0; userPosition < userMessageIndices.length; userPosition += 1) {
            const messageIndex = userMessageIndices[userPosition];
            userOffsetByMessageIndex.set(messageIndex, userMessageIndices.length - 1 - userPosition);
          }

          return (
            <article className="chat-window" key={agent.id}>
              <div className="chat-window-header">
                <div>
                  <span className="chat-window-kicker">当前智能体会话</span>
                  <h3>{agent.name}</h3>
                  <small className="hint">
                    模式：{agent.mode} · 最近模型：{state.lastModelId || "未发送"}
                  </small>
                </div>
                <div className="chat-window-status">
                  <span
                    className={
                      state.streaming
                        ? "status-badge is-live"
                        : state.sending
                          ? "status-badge is-busy"
                          : "status-badge"
                    }
                  >
                    {state.streaming
                      ? "流式生成中"
                      : state.sending
                        ? "处理中"
                        : selectedSession
                          ? "会话已连接"
                          : "待开始"}
                  </span>
                </div>
              </div>

              <div className="chat-body">
                <aside className="chat-session-panel">
                  <div className="chat-session-head">
                    <div>
                      <strong>会话簿</strong>
                      <small>{state.sessions.length} 个会话</small>
                    </div>
                    {selectedSession && (
                      <span className="chat-session-badge">
                        {selectedSession.isArchived ? "已归档" : "活跃"}
                      </span>
                    )}
                  </div>
                  <div className="chat-session-actions">
                    <button className="ghost" onClick={() => void createSession(agent.id)} type="button">
                      新建会话
                    </button>
                    <button
                      className="ghost"
                      disabled={
                        state.loadingSessions ||
                        state.loadingMessages ||
                        state.sending ||
                        state.rewriting ||
                        state.undoing ||
                        state.clearing
                      }
                      onClick={() => void refreshSessions(agent.id)}
                      type="button"
                    >
                      刷新会话
                    </button>
                    <button
                      className="ghost"
                      disabled={!selectedSession}
                      onClick={() => void duplicateSession(agent.id)}
                      type="button"
                    >
                      复制
                    </button>
                    <button
                      className="ghost"
                      disabled={!selectedSession || selectedSession.isDefault}
                      onClick={() => void renameSession(agent.id)}
                      type="button"
                    >
                      重命名
                    </button>
                    <button
                      className="ghost"
                      disabled={!selectedSession}
                      onClick={() => void toggleSessionPinned(agent.id)}
                      type="button"
                    >
                      {selectedSession?.isPinned ? "取消置顶" : "置顶"}
                    </button>
                    <button
                      className="ghost"
                      disabled={!selectedSession || selectedSession.isDefault}
                      onClick={() => void toggleSessionArchived(agent.id)}
                      type="button"
                    >
                      {selectedSession?.isArchived ? "取消归档" : "归档"}
                    </button>
                    <button
                      className="ghost"
                      disabled={!selectedSession}
                      onClick={() => void editSessionTags(agent.id)}
                      type="button"
                    >
                      标签
                    </button>
                    <button
                      className="ghost"
                      disabled={!selectedSession || selectedSession.isDefault}
                      onClick={() => void deleteSession(agent.id)}
                      type="button"
                    >
                      删除
                    </button>
                  </div>

                  <input
                    onChange={(event) => updateWindow(agent.id, { sessionSearch: event.target.value })}
                    placeholder="搜索标题/标签/最后消息"
                    value={state.sessionSearch}
                  />
                  <div className="chat-session-filters">
                    <select
                      onChange={(event) =>
                        updateWindow(agent.id, {
                          sessionFilter: event.target.value as "all" | "active" | "archived",
                        })
                      }
                      value={state.sessionFilter}
                    >
                      <option value="active">仅活动</option>
                      <option value="archived">仅归档</option>
                      <option value="all">全部</option>
                    </select>
                    <label className="inline-check">
                      <input
                        checked={state.sessionOnlyPinned}
                        onChange={(event) =>
                          updateWindow(agent.id, { sessionOnlyPinned: event.target.checked })
                        }
                        type="checkbox"
                      />
                      仅置顶
                    </label>
                  </div>

                  <div className="chat-session-list">
                    {state.loadingSessions && <p className="hint">加载会话中...</p>}
                    {!state.loadingSessions && state.sessions.length === 0 && <p className="hint">暂无会话</p>}
                    {!state.loadingSessions && state.sessions.length > 0 && filteredSessions.length === 0 && (
                      <p className="hint">没有匹配的会话。</p>
                    )}
                    {filteredSessions.map((session) => (
                      <button
                        className={
                          session.id === state.selectedSessionId
                            ? "chat-session-item active"
                            : "chat-session-item"
                        }
                        key={session.id}
                        onClick={() => void loadMessages(agent.id, session.id)}
                        type="button"
                      >
                        <strong>
                          {session.isPinned ? "[置顶] " : ""}
                          {session.isDefault ? `[默认] ${session.title}` : session.title}
                          {session.isArchived ? " [归档]" : ""}
                        </strong>
                        <small>
                          {session.messageCount} 条 · {formatDateTime(session.updatedAt)}
                        </small>
                        {session.tags.length > 0 && <small>标签：{session.tags.join(" / ")}</small>}
                        <span>{session.lastMessagePreview ?? "暂无消息"}</span>
                      </button>
                    ))}
                  </div>
                </aside>

                <div className="chat-main">
                  {selectedSession && (
                    <div className="chat-session-meta hint">
                      <span>{selectedSession.title}</span>
                      <span>{selectedSession.messageCount} 条消息</span>
                      <span>{selectedSession.isArchived ? "已归档" : "活动"}</span>
                    </div>
                  )}

                  <div
                    className="chat-log"
                    ref={(node) => {
                      chatLogRefs.current[agent.id] = node;
                    }}
                  >
                    {(state.loadingSessions || state.loadingMessages) && <p className="hint">加载中...</p>}
                    {!state.loadingSessions && !state.loadingMessages && state.messages.length === 0 && (
                      <p className="hint">发送第一条消息开始对话。</p>
                    )}
                    {state.messages.map((item, index) => (
                      <div
                        className={
                          [
                            "chat-bubble",
                            item.role === "assistant" ? "assistant" : "user",
                            state.highlightedMessageIndexes.includes(index) ? "highlight" : "",
                          ]
                            .filter((value) => value.length > 0)
                            .join(" ")
                        }
                        key={`${agent.id}-${item.role}-${index}`}
                      >
                        <div className="chat-bubble-head">
                          <strong>{item.role === "assistant" ? agent.name : "你"}</strong>
                          <div className="chat-bubble-actions">
                            <button
                              className="ghost"
                              onClick={() => void copyMessageContent(agent.id, item.content)}
                              type="button"
                            >
                              复制
                            </button>
                            <button
                              className="ghost"
                              onClick={() => quoteMessageToInput(agent.id, item.content)}
                              type="button"
                            >
                              引用
                            </button>
                            {item.role === "user" && (
                              <button
                                className="ghost"
                                disabled={
                                  disabled ||
                                  state.sending ||
                                  state.rewriting ||
                                  state.undoing ||
                                  state.loadingSessions ||
                                  state.loadingMessages ||
                                  state.clearing ||
                                  !state.selectedSessionId
                                }
                                onClick={() => {
                                  const targetUserOffset = userOffsetByMessageIndex.get(index);
                                  if (targetUserOffset === undefined) {
                                    updateWindow(agent.id, {
                                      error: {
                                        code: "VALIDATION_ERROR",
                                        message: "无法定位这条用户消息。",
                                      },
                                    });
                                    return;
                                  }
                                  void rewriteUserMessage(agent, targetUserOffset, item.content);
                                }}
                                type="button"
                              >
                                改写此提问
                              </button>
                            )}
                          </div>
                        </div>
                        <p>{item.content}</p>
                      </div>
                    ))}
                  </div>

                  {state.error && (
                    <div className="error-inline">
                      <strong>{state.error.code}</strong>
                      <span>{state.error.message}</span>
                    </div>
                  )}

                  <div className="chat-compose">
                    <div className="chat-option-grid">
                      <label className="inline-check">
                        <input
                          checked={state.streamingEnabled}
                          onChange={(event) =>
                            updateWindow(agent.id, { streamingEnabled: event.target.checked })
                          }
                          type="checkbox"
                        />
                        流式显示回复
                      </label>
                      <label className="inline-check">
                        <input
                          checked={state.regenerateReplaceLastAssistant}
                          onChange={(event) =>
                            updateWindow(agent.id, {
                              regenerateReplaceLastAssistant: event.target.checked,
                            })
                          }
                          type="checkbox"
                        />
                        重生成时替换上一条助手回复
                      </label>
                    </div>

                    <div className="chat-override-grid">
                      <label>
                        Temperature 覆盖
                        <input
                          max="2"
                          min="0"
                          onChange={(event) => updateWindow(agent.id, { temperature: event.target.value })}
                          step="0.1"
                          type="number"
                          value={state.temperature}
                        />
                      </label>
                      <label>
                        Max Tokens 覆盖
                        <input
                          min="1"
                          onChange={(event) => updateWindow(agent.id, { maxTokens: event.target.value })}
                          type="number"
                          value={state.maxTokens}
                        />
                      </label>
                      <label>
                        Top P 覆盖
                        <input
                          max="1"
                          min="0"
                          onChange={(event) => updateWindow(agent.id, { topP: event.target.value })}
                          step="0.05"
                          type="number"
                          value={state.topP}
                        />
                      </label>
                      <label>
                        Frequency Penalty 覆盖
                        <input
                          max="2"
                          min="-2"
                          onChange={(event) => updateWindow(agent.id, { frequencyPenalty: event.target.value })}
                          step="0.1"
                          type="number"
                          value={state.frequencyPenalty}
                        />
                      </label>
                    </div>

                    <label className="chat-input-field">
                      输入消息
                      <textarea
                        onChange={(event) => updateWindow(agent.id, { input: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void sendMessage(agent);
                          }
                        }}
                        placeholder="输入你想说的话...（Enter 发送，Shift+Enter 换行）"
                        rows={4}
                        value={state.input}
                      />
                    </label>

                    <div className="actions chat-actions">
                      <button
                        className="primary"
                        disabled={
                          disabled ||
                          state.sending ||
                          state.rewriting ||
                          state.undoing ||
                          state.loadingSessions ||
                          state.loadingMessages ||
                          state.clearing ||
                          !state.selectedSessionId ||
                          !state.input.trim()
                        }
                        onClick={() => void sendMessage(agent)}
                        type="button"
                      >
                        {state.sending ? (state.streaming ? "生成中..." : "发送中...") : "发送"}
                      </button>
                      <button
                        className="danger"
                        disabled={!state.streaming}
                        onClick={() => stopStreaming(agent.id)}
                        type="button"
                      >
                        停止生成
                      </button>
                      <button
                        className="ghost"
                        disabled={
                          disabled ||
                          state.sending ||
                          state.rewriting ||
                          state.undoing ||
                          state.loadingSessions ||
                          state.loadingMessages ||
                          state.clearing ||
                          !state.selectedSessionId ||
                          !state.messages.some((item) => item.role === "user")
                        }
                        onClick={() => void regenerateReply(agent)}
                        type="button"
                      >
                        重新生成上条回复
                      </button>
                      <button
                        className="ghost"
                        disabled={
                          disabled ||
                          state.sending ||
                          state.rewriting ||
                          state.undoing ||
                          state.loadingSessions ||
                          state.loadingMessages ||
                          state.clearing ||
                          !state.selectedSessionId ||
                          !state.messages.some((item) => item.role === "user")
                        }
                        onClick={() => void rewriteLastUserMessage(agent)}
                        type="button"
                      >
                        {state.rewriting ? "改写中..." : "改写最后提问"}
                      </button>
                      <button
                        className="ghost"
                        disabled={
                          disabled ||
                          state.sending ||
                          state.rewriting ||
                          state.undoing ||
                          state.loadingSessions ||
                          state.loadingMessages ||
                          state.clearing ||
                          !state.selectedSessionId ||
                          state.messages.length === 0
                        }
                        onClick={() => void undoLastTurn(agent.id)}
                        type="button"
                      >
                        {state.undoing ? "撤销中..." : "撤销上一轮"}
                      </button>
                      <button
                        className="ghost"
                        disabled={
                          disabled ||
                          state.sending ||
                          state.rewriting ||
                          state.undoing ||
                          state.clearing ||
                          !state.selectedSessionId
                        }
                        onClick={() => void clearMessages(agent.id)}
                        type="button"
                      >
                        {state.clearing ? "清空中..." : "清空消息"}
                      </button>
                      <button
                        className="ghost"
                        disabled={state.messages.length === 0 || !state.selectedSessionId}
                        onClick={() => exportSession(agent, state)}
                        type="button"
                      >
                        导出 Markdown
                      </button>
                      <button
                        className="ghost"
                        disabled={state.exportingAll || state.sessions.length === 0}
                        onClick={() => void exportAllSessions(agent, state)}
                        type="button"
                      >
                        {state.exportingAll ? "导出中..." : "导出全部会话"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
