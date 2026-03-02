# 少女智能体 GirlAgent

简体中文 | [English](./README.en.md) | [日本語](./README.ja.md)

「少女智能体」（GirlAgent）是一个 AI 智能体平台，目标是打造可连接任意 AI 应用、功能丰富的智能体系统。

## 项目结构

```text
GirlAgent/
├─ docs/                        # 产品与架构文档
├─ apps/web/
│  ├─ server/                   # 无头宿主（Axum + Bearer）
│  └─ console/                  # Web 管理界面（React/Vite）
└─ apps/desktop/
   └─ app/                      # 桌面宿主（Tauri）
```

核心库使用独立仓库依赖：

- `git@github.com:KurohaneKaoruko/Girl-Agent-Core.git`

## 技术栈

- 后端：Rust（宿主无关核心 + 桌面/无头宿主）
- 桌面宿主：Tauri 2.x
- 无头宿主：Axum HTTP 服务
- 前端：React + TypeScript + Vite
- 数据契约：桌面 invoke 与 HTTP API 共享契约
- 工程编排：Cargo workspace + pnpm workspace + Moonrepo

## 快速开始

1. 安装前端依赖：

```powershell
pnpm install
```

2. 启动桌面版（需要 Rust 工具链中的 Tauri CLI）：

```powershell
cargo tauri dev --manifest-path apps/desktop/app/Cargo.toml
```

3. 构建桌面版：

```powershell
cargo tauri build --manifest-path apps/desktop/app/Cargo.toml
```

4. 启动无头版（默认监听 `127.0.0.1:8787`）：

```powershell
$env:GIRLAGENT_TOKEN="your_token"
cargo run -p girlagent-web-server
```

## 当前范围

- 已初始化项目框架
- 已确立核心准则：连接任意 AI 应用
- 已交付双运行形态最小实现：桌面版 + 无头版
- 已搭建核心设置页骨架：
  - 提供商设置
  - 模型设置
  - 智能体设置
- Provider / Model / Agent 的基础 CRUD 与 SQLite 持久化已接通
- 设计文档位于 `docs/`

## Monorepo 命令

```powershell
# Rust 全量检查
cargo check --workspace

# Moon 任务（需先安装依赖）
pnpm run moon:check
```

## 本地联调 Core（可选）

如需在本机调试 Core，请复制 `.cargo/config.toml.example` 为 `.cargo/config.toml`，启用本地 path 覆盖。
