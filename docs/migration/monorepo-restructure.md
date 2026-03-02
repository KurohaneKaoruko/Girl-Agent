# Monorepo 结构迁移记录

## 迁移目标

将旧结构：

- `src-core`
- `src-headless`
- `src-frontend`
- `src-tauri`

迁移为三层结构：

- `GirlAgent-Core`
- `apps/web/server`
- `apps/web/console`
- `apps/app`

## 映射关系

- `src-core/**` -> `GirlAgent-Core/**`
- `src-headless/**` -> `apps/web/server/**`
- `src-frontend/**` -> `apps/web/console/**`
- `src-tauri/**` -> `apps/app/**`

## 同步调整

- Cargo workspace 成员路径已更新
- 无头服务 crate 名从 `girlagent-headless` 调整为 `girlagent-web-server`
- Tauri 前端构建路径改为 `apps/web/console`
- 新增 `pnpm-workspace.yaml` 与 `Moonrepo` 配置
