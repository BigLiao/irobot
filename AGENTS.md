# Repository Guidelines

## Project Structure & Module Organization
The repo is a pnpm workspace (`pnpm-workspace.yaml`) with two packages under `packages/`. `packages/dashboard` hosts the Vue 3 dashboard plus the Express/WebSocket server (`src/` for UI assets, `server/` for backend). `packages/injector` contains the Puppeteer launcher and browser script (`src/index.ts` boots Chromium, `src/monitor.ts` is injected). Shared TypeScript config sits at the root (`tsconfig.json`). Use `start.sh` to build and run everything with one command when scripting or demonstrating features.

## Build, Test, and Development Commands
From the root run `PUPPETEER_SKIP_DOWNLOAD=true pnpm install` to reuse a local Chrome. `pnpm build` runs both injector and dashboard builds; `pnpm start` serves the compiled dashboard at port 3000. Use `pnpm dev` for parallel front/back-end dev servers (5173 + 3000) or `pnpm dev:dashboard` and `pnpm dev:server` when you need separate terminals. Injector-only workflows can rely on `pnpm --filter injector build` or `pnpm build:injector`. Run `./start.sh` if you want an end-to-end smoke build+serve loop, and `pnpm clean` before large refactors to drop stale `dist/` output.

## Coding Style & Naming Conventions
Code is TypeScript-first, strict mode via `tsconfig.json`, ECMAScript modules, and two-space indentation (match existing files). Keep Vue SFCs PascalCase (`App.vue`), hooks/utilities camelCase, and environment constants screaming snake case (e.g., `DASHBOARD_WS_URL`). Prefer explicit return types on exported functions, descriptive console output with emoji prefixes for user-facing logs, and keep injector scripts side-effect free except for browser instrumentation. Linting is manual, so run `pnpm exec vue-tsc --noEmit` or `tsc --project tsconfig.server.json` to catch typing regressions before pushing.

## Testing Guidelines
Formal test suites have not been added yet; rely on scripted smoke tests. After changes, run `pnpm dev` and: 1) open `http://localhost:3000`, 2) monitor a known URL such as `https://www.baidu.com`, 3) verify the injector console prints `✅ 监控脚本已加载`, and 4) confirm dashboard log colors match the README table. When adding automated coverage, follow a `*.spec.ts` naming pattern inside `packages/<module>/tests/` so future runners can glob consistently, and keep fixtures under `packages/dashboard/src/assets/demo/` to avoid polluting build output.

## Commit & Pull Request Guidelines
History shows a lightweight Conventional Commits style (`feat: …` in either English or Chinese). Continue using `type(optional-scope): summary` and reference an issue ID when available. PRs should describe what changed, how to reproduce before/after, and any dashboard screenshots that prove API events render correctly. Link to logs when behavior differs across `dev` vs `start` builds, and call out injector environment variables a reviewer must set.

## Security & Configuration Tips
Never commit real credentials. When testing without Chromium downloads, export `PUPPETEER_SKIP_DOWNLOAD=true` and point `executablePath` in `packages/injector/src/index.ts` at your installed Chrome. Use `DASHBOARD_WS_URL`, `MOCK_RULES`, or `CUSTOM_SCRIPT` env vars instead of modifying `monitor.ts` for experiment-specific settings. Keep the dashboard on localhost unless you have hardened the WebSocket endpoints; port 3000 should remain firewalled when running demos.
