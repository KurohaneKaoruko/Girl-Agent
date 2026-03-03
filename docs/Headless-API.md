# GirlAgent 无头版 API（V1 最小可用）

## 启动参数

通过环境变量控制：

- `GIRLAGENT_BIND`：监听地址，默认 `127.0.0.1:8787`
- `GIRLAGENT_DB_URL`：SQLite 连接串，默认 `sqlite://girlagent.db`
- `GIRLAGENT_TOKEN`：Bearer Token；不设置时启动会生成一次随机 Token 并打印

## 鉴权

- 除 `GET /health` 外，所有接口都需要：
  - `Authorization: Bearer <token>`

## 接口

- `GET /health`
- `GET /api/bootstrap`
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



