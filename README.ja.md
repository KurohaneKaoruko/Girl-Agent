# Girl-Ai-Agent

[简体中文](./README.md) | [English](./README.en.md) | 日本語

Girl-Ai-Agent は、あらゆる AI アプリケーションに接続できる高機能な「少女エージェント」を構築するための AI エージェントプラットフォームです。

## プロジェクト構成

```text
Girl-Ai-Agent/
├─ docs/                        # プロダクト・アーキテクチャ文書
└─ apps/
   ├─ web/
   │  ├─ server/                # ヘッドレスホスト（Axum + Bearer 認証）
   │  └─ console/               # 共有 Web UI
   └─ app/                      # アプリホスト（現行は Tauri + Rust）
```

Core は独立リポジトリから参照します:

- `git@github.com:KurohaneKaoruko/Girl-Agent-Core.git`

## 技術スタック

- バックエンド: Rust（ホスト非依存コア + アプリ/ヘッドレスホスト）
- アプリホスト: Tauri 2.x
- ヘッドレスホスト: Axum HTTP サービス
- フロントエンド: React + TypeScript + Vite
- データ契約: アプリホスト invoke と HTTP API で共通契約を使用
- オーケストレーション: Cargo workspace + pnpm workspace + Moonrepo

## クイックスタート

1. フロントエンド依存関係をインストール:

```powershell
pnpm install
```

2. アプリホストを起動（現行はデスクトップ形態、Rust ツールチェーン内の Tauri CLI が必要）:

```powershell
cargo tauri dev --manifest-path apps/app/Cargo.toml
```

3. アプリホストをビルド（現行はデスクトップ形態）:

```powershell
cargo tauri build --manifest-path apps/app/Cargo.toml
```

4. ヘッドレス版を起動（既定 `127.0.0.1:8787`）:

```powershell
$env:GIRL_AI_AGENT_TOKEN="your_token"
cargo run -p girl-ai-agent-web-server
```

## 現在のスコープ

- プロジェクト骨組みを初期化済み
- 核心原則を定義済み: あらゆる AI アプリに接続
- アプリホスト + ヘッドレスの最小実装を提供済み
- 設定画面の基本 UI 骨組み:
  - Provider 設定
  - Model 設定
  - Agent 設定
- Provider / Model / Agent の CRUD と SQLite 永続化を接続済み
- 設計ドキュメントは `docs/` に配置

## Monorepo コマンド

```powershell
# Rust ワークスペースチェック
cargo check --workspace

# Moon タスク（依存インストール後）
pnpm run moon:check
```

## Core のローカル上書き（任意）

Core をローカルで同時開発する場合は `.cargo/config.toml.example` を `.cargo/config.toml` にコピーして path patch を有効化してください。

