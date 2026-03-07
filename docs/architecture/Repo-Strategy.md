# Girl-Ai-Agent 分仓策略（支持多应用复用 Core）

## 目标

在保证 Girl-Ai-Agent 主项目持续迭代的同时，让后续其他应用能稳定复用 `Girl-Ai-Agent-Core`，避免重复实现核心 AI 功能。

## 推荐仓库模型

使用 `1 Core + N App` 的多仓结构：

1. `Girl-Ai-Agent-Core`（独立仓库）
- 仅包含通用核心能力（领域模型、服务层、存储抽象、错误模型、协议适配接口）
- 不包含任何产品 UI、桥接插件、品牌逻辑

2. `Girl-Ai-Agent`（产品仓库）
- 依赖 `Girl-Ai-Agent-Core`
- 包含桌面版、无头版、完整桥接能力

3. `Another-App`（产品仓库示例）
- 依赖 `Girl-Ai-Agent-Core`
- 聚焦纯软件内交互体验，不强制引入丰富桥接能力

## 依赖策略

- Core 使用语义化版本发布（SemVer）
- 应用仓库仅依赖已发布版本，不直接追踪 Core 主分支
- 重大破坏性改动仅在 Core 主版本升级时引入，并提供迁移文档

## Core 边界约束

Core 必须保持“宿主无关”：

- 允许：Rust 领域逻辑、存储接口、业务规则、统一错误模型
- 禁止：Tauri/Axum 宿主启动逻辑、前端状态管理、产品特有桥接流程

## 发布与升级流程

1. 在 `Girl-Ai-Agent-Core` 完成功能并通过测试
2. 发布新版本（例如 `v0.5.2`）
3. `Girl-Ai-Agent` / 其他应用分别升级依赖并运行集成测试
4. 若涉及兼容变更，按迁移指南修改应用层代码

## 本仓现阶段定位

当前仓库作为应用层开发仓（Monorepo）维护：

- `apps/web/`
- `apps/app/`

并通过 Git 依赖使用独立 Core 仓库：

- `git@github.com:KurohaneKaoruko/Girl-Agent-Core.git`

后续新应用应继续采用同样方式依赖 Core，而不是复制 Core 代码。

