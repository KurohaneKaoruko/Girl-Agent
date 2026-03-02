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
