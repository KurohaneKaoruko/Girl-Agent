# 少女智能体 Girl-Ai-Agent

简体中文 | [English](./README.en.md) | [日本語](./README.ja.md)

「少女智能体」（Girl-Ai-Agent）是一个 AI 智能体平台，目标是打造可连接任意 AI 应用、功能丰富的智能体系统。

## 项目结构

```text
Girl-Ai-Agent/
├─ docs/                        # 产品与架构文档
├─ crates/
│  ├─ app-contracts/            # App 仓内共享的 Rust 契约
│  ├─ app-domain/               # App 仓内本地拥有的领域模块与运行时入口
│  ├─ app-host-core/            # Web/Tauri 共用的 bootstrap/runtime 装配
│  └─ network-binding/          # App 产品内的网络绑定能力
└─ apps/
   ├─ web/
   │  ├─ server/                # 无头宿主（Axum + Bearer）
   │  └─ console/               # Web 管理界面（React/Vite）
   └─ app/                      # 应用宿主（当前基于 Tauri）
```

当前工作区只保留 `App` 与 `Game` 两个产品仓；App 产品域能力由仓内 `app-domain` 本地承载。

## 技术栈

- 后端：Rust（宿主无关核心 + 应用/无头宿主）
- 应用宿主：Tauri 2.x
- 无头宿主：Axum HTTP 服务
- 前端：React + TypeScript + Vite
- 数据契约：应用宿主 invoke 与 HTTP API 共享契约
- 工程编排：Cargo workspace + pnpm workspace + Moonrepo

## 快速开始

1. 安装前端依赖：

```powershell
pnpm install
```

2. 启动应用端（当前桌面形态，需要 Rust 工具链中的 Tauri CLI）：

```powershell
cargo tauri dev --manifest-path apps/app/Cargo.toml
```

3. 构建应用端（当前桌面形态）：

```powershell
cargo tauri build --manifest-path apps/app/Cargo.toml
```

4. 启动无头版（默认监听 `127.0.0.1:8787`）：

```powershell
$env:GIRL_AI_AGENT_TOKEN="your_token"
cargo run -p girl-ai-agent-web-server
```

## 当前范围

- 已初始化项目框架
- 已确立核心准则：连接任意 AI 应用
- 已交付双运行形态最小实现：应用端 + 无头版
- 已搭建核心设置页骨架：
  - 提供商设置
  - 模型设置
  - 智能体设置
- Provider / Model / Agent 的基础 CRUD 与 SQLite 持久化已接通
- 设计文档位于 `docs/`
- Web 控制台在零配置时展示快速初始化卡片，输入 Provider Key 即可自动创建 Provider/Model/Agent 并开始聊天
- 聊天工作台支持流式回复中“停止生成”，中止后自动回同步会话消息
- Web console 的 `dev/build` 现已内置 Rust -> TS 契约同步，不再要求手动先跑一遍导出脚本

## Monorepo 命令

```powershell
# Rust 全量检查
cargo check --workspace

# 从 Rust contracts/domain 导出前端类型
pnpm run sync:contracts:app

# 仅校验生成文件是否已同步
pnpm run check:contracts:app

# 直接运行前端 dev/build 时会自动先同步契约
pnpm --dir apps/web/console dev
pnpm --dir apps/web/console build

# 无头版验收（自动起服务 + 配置 + 可选聊天验证）
$env:GIRL_AI_AGENT_PROVIDER_KEY="your_provider_key"
pnpm run verify:headless

# 显式 smoke / full 两档
pnpm run verify:headless:smoke
pnpm run verify:headless:full
# full 需要提供真实 Key（环境变量 GIRL_AI_AGENT_PROVIDER_KEY 或脚本参数 -ProviderKey）
# full 默认额外验证 /api/chat/stream（SSE）
# 如需仅验证非流式聊天，可使用：
pnpm run verify:headless:full:no-stream
# 如需额外验证“流式中途停止”，可使用：
pnpm run verify:headless:full:abort
# CI 中可通过仓库 Secret `GIRL_AI_AGENT_PROVIDER_KEY` 自动启用 full/full:abort
# GitHub Actions 支持 workflow_dispatch 输入 `run_full` / `run_abort` 手动分档执行
# `headless-verify` 任务会上传 target 下的 verify JSON artifact

# 如果你已手动启动无头服务，可直接复用现有实例验收
pnpm run verify:headless:running

# CI 入口（输出 JSON 到临时目录）
pnpm run verify:headless:ci
# 聚合验收结果（优先 target，自动回退当前目录与临时目录）
pnpm run verify:headless:summary

# 需要自定义参数/输出 JSON 时，直接执行脚本
.\scripts\verify-headless.ps1 -Mode smoke -OutputJson .\target\verify-headless.json

# 打印压缩 JSON 到 stdout（CI 友好）
.\scripts\verify-headless.ps1 -Mode smoke -PrintResultJson

# Moon 任务（需先安装依赖）
pnpm run moon:check
```

## 本地联调说明

当前仓内不需要额外的跨仓 path patch；直接在本仓内迭代即可。

