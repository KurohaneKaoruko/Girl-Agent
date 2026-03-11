# Girl-Ai-Agent

[简体中文](./README.md) | English | [日本語](./README.ja.md)

Girl-Ai-Agent is an AI agent platform for building a feature-rich "girl agent" that can connect to any AI application.

## Project Structure

```text
Girl-Ai-Agent/
├─ docs/                        # Product and architecture documents
├─ core/
│  ├─ contracts/                # Shared Rust host contracts inside the App repo
│  ├─ domain/                   # App-owned domain/runtime implementation
│  ├─ host-core/                # Shared bootstrap/runtime builders for Web + Tauri
│  └─ network-binding/          # Network binding feature owned by the App product
└─ apps/
   ├─ web/
   │  ├─ server/                # Headless host (Axum + Bearer auth)
   │  └─ console/               # Shared web UI
   └─ app/                      # App host (currently powered by Tauri + Rust)
```

This workspace now keeps only the `App` and `Game` product repos. App-specific domain logic lives inside `core/domain`, while Rust -> TypeScript contract export is handled inside this repo.

## Tech Stack

- Backend: Rust (host-agnostic core + app/headless hosts)
- App host: Tauri 2.x
- Headless host: Axum HTTP service
- Frontend: React + TypeScript + Vite
- Data contract: shared API contract for app-host invoke and HTTP API
- Orchestration: Cargo workspace + pnpm workspace + Moonrepo

## Quick Start

1. Install frontend dependencies:

```powershell
pnpm install
```

2. Start app host (current desktop form, requires Tauri CLI in Rust toolchain):

```powershell
cargo tauri dev --manifest-path apps/app/Cargo.toml
```

3. Build app host (current desktop form):

```powershell
cargo tauri build --manifest-path apps/app/Cargo.toml
```

4. Start headless host (default `127.0.0.1:8787`):

```powershell
$env:GIRL_AI_AGENT_TOKEN="your_token"
cargo run -p girl-ai-agent-web-server
```

## Current Scope

- Project framework initialized
- Primary principle defined: connect to any AI application
- Minimal dual runtime delivered: app host + headless
- Main settings UI skeleton:
  - Provider settings
  - Model settings
  - Agent settings
- Provider / Model / Agent CRUD + SQLite persistence connected
- Product design notes documented in `docs/`

## Monorepo Commands

```powershell
# Rust workspace check
cargo check --workspace

# Moon tasks (after installing dependencies)
pnpm run moon:check
```

## Contract Workflow

```powershell
# Export Rust contracts/domain types for the web console
pnpm run sync:contracts:app

# Check whether generated frontend types are up to date
pnpm run check:contracts:app

# Direct console dev/build also auto-sync contracts first
pnpm --dir apps/web/console dev
pnpm --dir apps/web/console build
```

