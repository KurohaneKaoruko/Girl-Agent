# Girl-Ai-Agent 无头版 API（V1 最小可用）

## 启动参数

通过环境变量控制：

- `GIRL_AI_AGENT_BIND`：监听地址，默认 `127.0.0.1:8787`
- `GIRL_AI_AGENT_DB_URL`：SQLite 连接串，默认 `sqlite://girl-ai-agent.db`
- `GIRL_AI_AGENT_TOKEN`：Bearer Token；不设置时启动会生成一次随机 Token 并打印

## 鉴权

- 除 `GET /health` 外，所有接口都需要：
  - `Authorization: Bearer <token>`

## 接口

- `GET /health`
- `GET /api/bootstrap`
- `GET /api/runtime/status`
- `POST /api/runtime/provider-probe`
- `POST /api/runtime/model-probe`
- `GET /api/providers`
- `POST /api/providers`
- `PUT /api/providers/{id}`
- `DELETE /api/providers/{id}`
- `GET /api/models`
- `POST /api/models`
- `PUT /api/models/{id}`
- `DELETE /api/models/{id}`
- `GET /api/agents`
- `POST /api/agents`
- `PUT /api/agents/{id}`
- `DELETE /api/agents/{id}`
- `GET /api/agents/{id}/chat/sessions`
- `POST /api/agents/{id}/chat/sessions`
- `PUT /api/agents/{id}/chat/sessions/{session_id}`
- `DELETE /api/agents/{id}/chat/sessions/{session_id}`
- `POST /api/agents/{id}/chat/sessions/{session_id}/duplicate`
- `PUT /api/agents/{id}/chat/sessions/{session_id}/pin`
- `PUT /api/agents/{id}/chat/sessions/{session_id}/archive`
- `PUT /api/agents/{id}/chat/sessions/{session_id}/tags`
- `GET /api/agents/{id}/chat/sessions/{session_id}/messages`
- `DELETE /api/agents/{id}/chat/sessions/{session_id}/messages`
- `GET /api/agents/{id}/chat/messages`
- `DELETE /api/agents/{id}/chat/messages`
- `POST /api/chat`
- `POST /api/chat/undo`
- `POST /api/chat/rewrite-user-message`
- `POST /api/chat/rewrite-last-user`
- `POST /api/chat/stream`（SSE）
- `POST /api/chat/regenerate`
- `POST /api/chat/regenerate/stream`（SSE）

## 自动验收脚本

项目内置 `scripts/verify-headless.ps1`，用于验证无头版最小可用链路：

- 健康检查与鉴权
- Provider / Model / Agent 创建
- Provider / Model 连通探测
- `smoke/full` 两档验收
- `full` 模式默认覆盖 `POST /api/chat/stream`（SSE）回归验证
- 可选覆盖“流式中途停止（abort）”回归验证
- 可选输出结构化 JSON 结果（文件或 stdout，含 `status` / `failureCode` / `providerProbe` / `modelProbe` / `streamVerified` / `streamAbortVerified`）

执行示例：

```powershell
# smoke（默认）：不强制外网可达，可用于本地冒烟
$env:GIRL_AI_AGENT_PROVIDER_KEY="your_provider_key"
pnpm run verify:headless

# full：强制连通探测通过 + 真实聊天验证
$env:GIRL_AI_AGENT_PROVIDER_KEY="your_provider_key"
pnpm run verify:headless:full
# full 模式要求存在真实 Provider Key
# full 默认包含 /api/chat/stream 回归验证
# 如需关闭流式验证：
pnpm run verify:headless:full:no-stream
# 如需额外验证“流式中途停止”：
pnpm run verify:headless:full:abort
# CI 中可通过仓库 Secret `GIRL_AI_AGENT_PROVIDER_KEY` 自动启用 full/full:abort
# GitHub Actions workflow_dispatch 输入：
# - run_full: 手动启用 full
# - run_abort: 手动启用 full:abort
# headless-verify 任务会上传 verify JSON artifact

# 若你已手动启动服务：
pnpm run verify:headless:running

# CI 常用（输出压缩 JSON 到 stdout）
pnpm run verify:headless:ci
# 聚合当前 target 下的验收结果
pnpm run verify:headless:summary

# 需要自定义参数/输出 JSON 时，直接执行脚本
.\scripts\verify-headless.ps1 -Mode smoke -OutputJson .\target\verify-headless.json
.\scripts\verify-headless.ps1 -Mode smoke -PrintResultJson
# .\scripts\verify-headless.ps1 -Mode full -VerifyStream:$false
# .\scripts\verify-headless.ps1 -Mode full -VerifyStreamAbort
```

## `/api/bootstrap`（更新）

响应体新增 `apiVersion` 字段，便于前后端做协议版本对齐。

示例：

```json
{
  "appVersion": "0.1.0",
  "apiVersion": "1.0.0",
  "chatGatewayKind": "openai_compat"
}
```

## `/api/runtime/status`（新增）

- 用于读取运行时总览统计（Provider/Model/Agent/Session/Message 数量）。

响应示例：

```json
{
  "providerCount": 2,
  "modelCount": 6,
  "agentCount": 3,
  "sessionCount": 9,
  "messageCount": 128,
  "chatGatewayKind": "openai_compat"
}
```

## `/api/runtime/provider-probe`（新增）

- 用于检测指定 Provider 配置是否可达。
- 请求体：

```json
{
  "providerId": "provider-id"
}
```

- 响应体：

```json
{
  "providerId": "provider-id",
  "reachable": true,
  "latencyMs": 182,
  "detail": "reachable"
}
```

说明：

- 当网络异常、鉴权失败或服务不可用时，接口仍返回 `200`，但 `reachable=false`。
- 当 `providerId` 不存在或配置非法（例如缺少 `apiBase`）时，返回业务错误（如 `NOT_FOUND` / `VALIDATION_ERROR`）。

## `/api/runtime/model-probe`（新增）

- 用于检测指定模型（含 providerRef/customProvider）是否可调用。
- 请求体：

```json
{
  "modelRefId": "model-id"
}
```

- 响应体：

```json
{
  "modelRefId": "model-id",
  "modelId": "gpt-4.1-mini",
  "reachable": true,
  "latencyMs": 421,
  "detail": "reachable"
}
```

说明：

- 探测通过一次最小聊天请求执行连通性验证。
- 调用失败时同样返回 `200` 且 `reachable=false`，`detail` 包含失败原因摘要。

## 错误格式

```json
{
  "code": "VALIDATION_ERROR",
  "message": "modelId is required",
  "details": null
}
```

常见 `code`：

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `CONFLICT`
- `REFERENCE_IN_USE`
- `UNAUTHORIZED`
- `INTERNAL_ERROR`

## 智能体 `paramSlots`（新增）

`POST /api/agents` 与 `PUT /api/agents/{id}` 中支持 `paramSlots`，用于为不同槽位覆盖模型参数。

示例：

```json
{
  "name": "少女助手",
  "persona": "温柔、理性",
  "speechRules": "先结论后细节",
  "mode": "chat",
  "componentSlot": {
    "asrModelId": null,
    "ttsModelId": null,
    "visionModelId": null
  },
  "toolSlot": {
    "plannerModelId": null,
    "executorModelId": null
  },
  "replyModelId": "model-id",
  "decisionSlot": {
    "modelId": null,
    "enabled": false
  },
  "paramSlots": {
    "component": {
      "asr": { "temperature": null, "maxTokens": null, "topP": null, "frequencyPenalty": null },
      "tts": { "temperature": null, "maxTokens": null, "topP": null, "frequencyPenalty": null },
      "vision": { "temperature": null, "maxTokens": null, "topP": null, "frequencyPenalty": null }
    },
    "tool": {
      "planner": { "temperature": null, "maxTokens": null, "topP": null, "frequencyPenalty": null },
      "executor": { "temperature": null, "maxTokens": null, "topP": null, "frequencyPenalty": null }
    },
    "reply": { "temperature": 0.6, "maxTokens": 512, "topP": 0.9, "frequencyPenalty": 0.2 },
    "decision": { "temperature": null, "maxTokens": null, "topP": null, "frequencyPenalty": null }
  }
}
```

规则：

- `temperature` 范围 `0.0 ~ 2.0`
- `maxTokens` 必须 `> 0`
- `topP` 范围 `0.0 ~ 1.0`
- `frequencyPenalty` 范围 `-2.0 ~ 2.0`
- 为 `null` 或缺省时，使用模型默认参数

## `/api/chat` 参数覆盖优先级

`/api/chat` 支持 `temperature`、`maxTokens`、`topP`、`frequencyPenalty` 临时覆盖，优先级如下：

1. 模型默认参数
2. 智能体 `paramSlots.reply`
3. `/api/chat` 请求中的 `temperature` / `maxTokens` / `topP` / `frequencyPenalty`

## `/api/chat/stream`（新增）

- 与 `/api/chat` 使用同一请求体。
- 响应类型：`text/event-stream`。
- 事件：
  - `start`：返回会话和模型元信息
  - `delta`：增量文本分片，`data` 形如 `{ "text": "..." }`
  - `done`：完整 `ChatWithAgentResponse`

## `/api/chat/undo`（新增）

- 用于撤销会话中的上一轮对话。
- 请求体示例：

```json
{
  "agentId": "agent-id",
  "sessionId": "session-id"
}
```

- 行为：
  - 默认删除最后一条 `assistant` 消息以及其前一条对应 `user` 消息。
  - 若当前会话没有 `assistant` 消息，则尝试删除最后一条 `user` 消息。
  - 若没有可删除消息，返回 `removedCount=0`。
- 响应示例：

```json
{
  "agentId": "agent-id",
  "sessionId": "session-id",
  "removedCount": 2
}
```

## `/api/chat/rewrite-last-user`（新增）

- 用于改写会话中最后一条用户消息，并重跑该轮回复。
- 请求体示例：

```json
{
  "agentId": "agent-id",
  "sessionId": "session-id",
  "userMessage": "改写后的问题",
  "temperature": null,
  "maxTokens": null,
  "topP": null,
  "frequencyPenalty": null
}
```

- 行为：
  - 找到会话中最后一条 `user` 消息。
  - 保留其之前的历史消息，删除该 `user` 及其后续消息。
  - 用新 `userMessage` 重新生成并写入新的 `assistant` 回复。
  - 若会话中不存在 `user` 消息，返回 `VALIDATION_ERROR`。

## `/api/chat/rewrite-user-message`（新增）

- 用于按偏移改写会话中的任意一条用户消息，并从该点重跑后续回复。
- 请求体示例：

```json
{
  "agentId": "agent-id",
  "sessionId": "session-id",
  "targetUserOffset": 1,
  "userMessage": "改写后的问题",
  "temperature": null,
  "maxTokens": null,
  "topP": null,
  "frequencyPenalty": null
}
```

- 规则：
  - `targetUserOffset=0`：改写最后一条用户消息（与 `/api/chat/rewrite-last-user` 等价）。
  - `targetUserOffset=1`：改写倒数第二条用户消息，以此类推。
  - `targetUserOffset` 必须 `>= 0`，且不能超过会话中用户消息数量，否则返回 `VALIDATION_ERROR`。
- 行为：
  - 保留目标用户消息之前的历史。
  - 删除目标用户消息及其之后的消息。
  - 写入新的 `userMessage` 和重新生成的 `assistant` 回复。

## `/api/chat/regenerate`（新增）

- 用于“重新生成上条回复”。
- 请求体示例：

```json
{
  "agentId": "agent-id",
  "sessionId": "session-id",
  "replaceLastAssistant": true,
  "temperature": null,
  "maxTokens": null,
  "topP": null,
  "frequencyPenalty": null
}
```

- 行为：
  - 读取会话中最后一条 `user` 消息作为本次重生成输入。
  - `replaceLastAssistant=false`：保留既有会话消息，新增一条 `assistant` 消息作为重生成结果。
  - `replaceLastAssistant=true`：先删除会话中最后一条 `assistant` 消息，再写入新的重生成结果。
  - 若会话中不存在 `user` 消息，返回 `VALIDATION_ERROR`。

## `/api/chat/regenerate/stream`（新增）

- 与 `/api/chat/regenerate` 使用同一请求体。
- 响应类型：`text/event-stream`。
- 事件与 `/api/chat/stream` 一致：`start` / `delta` / `done`。

## 聊天消息持久化（新增）

- `/api/chat` 每次成功调用后，会自动把本次用户消息与助手回复写入该 `agentId` 下对应会话的聊天记录。
- `/api/chat` 请求体可选 `sessionId`：
  - 传入：使用指定会话。
  - 不传：使用该智能体默认会话。
- 当 `/api/chat` 请求体中的 `history` 为空数组时，服务端会自动读取该会话已持久化历史作为上下文。
- 当服务端从持久化中读取历史时，会自动截断到最近窗口，避免长会话导致请求失败。
- `GET /api/agents/{id}/chat/messages`：兼容接口，读取默认会话消息。
- `DELETE /api/agents/{id}/chat/messages`：兼容接口，清空默认会话消息。
- `GET /api/agents/{id}/chat/sessions/{session_id}/messages`：读取指定会话消息。
- `DELETE /api/agents/{id}/chat/sessions/{session_id}/messages`：清空指定会话消息。

## 会话管理（新增）

- `GET /api/agents/{id}/chat/sessions`：获取该智能体的会话列表（含默认会话）。
- 会话对象新增摘要字段，便于前端直接渲染会话侧栏：

```json
{
  "id": "session-id",
  "agentId": "agent-id",
  "title": "工作流讨论",
  "isDefault": false,
  "isPinned": true,
  "isArchived": false,
  "tags": ["工作", "规划"],
  "createdAt": "2026-03-03 10:22:31",
  "updatedAt": "2026-03-03 10:25:10",
  "messageCount": 14,
  "lastMessageRole": "assistant",
  "lastMessagePreview": "这里是最后一条消息的预览文本"
}
```

- `POST /api/agents/{id}/chat/sessions`：创建会话，请求体：

```json
{
  "title": "工作流讨论"
}
```

- `PUT /api/agents/{id}/chat/sessions/{session_id}`：重命名会话，请求体：

```json
{
  "title": "新会话名"
}
```

- `DELETE /api/agents/{id}/chat/sessions/{session_id}`：删除会话（默认会话不可删除）。
- `POST /api/agents/{id}/chat/sessions/{session_id}/duplicate`：复制会话（含完整消息历史），请求体：

```json
{
  "title": "工作流讨论-副本"
}
```

- `PUT /api/agents/{id}/chat/sessions/{session_id}/pin`：设置会话置顶，请求体：

```json
{
  "pinned": true
}
```

- `PUT /api/agents/{id}/chat/sessions/{session_id}/archive`：设置会话归档，请求体：

```json
{
  "archived": true
}
```

- `PUT /api/agents/{id}/chat/sessions/{session_id}/tags`：设置会话标签，请求体：

```json
{
  "tags": ["工作", "规划"]
}
```




