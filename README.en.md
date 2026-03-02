# GirlAgent

[简体中文](./README.md) | English | [日本語](./README.ja.md)

GirlAgent is an AI agent platform for building a feature-rich "girl agent" that can connect to any AI application.

## Project Structure

```text
GirlAgent/
├─ docs/                        # Product and architecture documents
├─ apps/web/
│  ├─ server/                   # Headless host (Axum + Bearer auth)
│  └─ console/                  # Shared web UI
└─ apps/desktop/
   └─ app/                      # Desktop host (Tauri + Rust)
```

Core is consumed from an independent repository:

- `git@github.com:KurohaneKaoruko/Girl-Agent-Core.git`

## Tech Stack

- Backend: Rust (host-agnostic core + desktop/headless hosts)
- Desktop host: Tauri 2.x
- Headless host: Axum HTTP service
- Frontend: React + TypeScript + Vite
- Data contract: shared API contract for desktop invoke and HTTP API
- Orchestration: Cargo workspace + pnpm workspace + Moonrepo

## Quick Start

1. Install frontend dependencies:

```powershell
pnpm install
```

2. Start desktop app (requires Tauri CLI in Rust toolchain):

```powershell
cargo tauri dev --manifest-path apps/desktop/app/Cargo.toml
```

3. Build desktop app:

```powershell
cargo tauri build --manifest-path apps/desktop/app/Cargo.toml
```

4. Start headless host (default `127.0.0.1:8787`):

```powershell
$env:GIRLAGENT_TOKEN="your_token"
cargo run -p girlagent-web-server
```

## Current Scope

- Project framework initialized
- Core principle defined: connect to any AI application
- Minimal dual runtime delivered: desktop + headless
- Core settings UI skeleton:
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

## Optional Local Core Override

To iterate on Core locally, copy `.cargo/config.toml.example` to `.cargo/config.toml` and use the local path patch.
