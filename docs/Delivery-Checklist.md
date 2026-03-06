# GirlAgent-App 交付检查清单

本清单用于发布前的最小可用验收，按顺序执行。

## 1. 构建检查

```powershell
cargo check --workspace
pnpm --dir apps/web/console build
```

## 2. 无头版验收（Smoke）

目标：不要求外网可达，确认 API 主链路可执行。

```powershell
pnpm run verify:headless:smoke
```

可选：复用已启动服务。

```powershell
pnpm run verify:headless:running
```

## 3. 无头版验收（Full）

目标：要求探测可达并执行真实聊天调用（默认含 `/api/chat/stream` SSE 验证）。

```powershell
$env:GIRLAGENT_PROVIDER_KEY="your_provider_key"
pnpm run verify:headless:full
# 可选：关闭流式验证
# pnpm run verify:headless:full:no-stream
# 可选：额外验证流式中途停止（abort）
# pnpm run verify:headless:full:abort
```

## 4. CI 结果产出（JSON）

```powershell
pnpm run verify:headless:ci
# 生成汇总文件（优先写入 target，受限环境会自动回退）
pnpm run verify:headless:summary
```

另外：

- `verify:headless:ci` 会把压缩 JSON 输出到 stdout，适合流水线日志采集。
- 如需落盘，可直接执行脚本并指定 `-OutputJson`。
- GitHub Actions `headless-verify` 任务会上传 `target/verify-headless-*.json` 与 `target/verify-headless-summary.json` artifact。
- 可通过 workflow_dispatch 的 `run_full` / `run_abort` 控制手动分档执行。

说明：

- 脚本支持直接执行并指定输出路径：

```powershell
.\scripts\verify-headless.ps1 -Mode smoke -OutputJson .\target\verify-headless.json
```

- 结果 JSON 包含 `status`、`failureCode`、`providerProbe`、`modelProbe`、`streamVerified`、`streamAbortVerified`、`created` 等字段。

## 5. 桌面端联调（可选）

```powershell
cargo tauri dev --manifest-path apps/app/Cargo.toml
```

手工检查点：

- Provider/Model/Agent 的增删改查
- Provider/Model 连通测试按钮
- 快速初始化（预设选择、连通校验开关、创建/复用提示）
- 每个智能体独立聊天窗口与多会话操作
- 流式回复“停止生成”按钮可中止前端流并自动回同步会话消息
