# AgentM2M

We present AgentM2M, a model-to-model transformation framework that dynamically transforms agent
collaboration models across strategic, tactical, and operational abstraction levels.

This repository contains a working prototype of the approach described in [`docs/agentm2m.tex`](docs/agentm2m.tex),
built per the plan in [`docs/dev.md`](docs/dev.md). See [`docs/architecture.md`](docs/architecture.md) for
what was actually built vs. the full target architecture, and [`docs/algorithm-mapping.md`](docs/algorithm-mapping.md)
for exactly which code implements which part of the paper.

## What's here

- **`apps/engine`** — a Fastify/TypeScript service implementing the paper's five algorithms (`RunTeam`,
  `Lift`, `GuardedRestore`, `Propagate`, `Adapt`), fully tested including a real, no-mocks, no-API-key
  end-to-end run against a local Ollama model.
- **`apps/dashboard`** — a Next.js dashboard for composing teams, registering models (cloud or local
  Ollama), running teams, and browsing benchmark/evaluation results.
- **`apps/bench`** — a Python FastAPI service that fetches real SWE-bench dataset variants and runs a
  Docker-based per-instance execution harness, with RQ1/RQ3-style evaluation runners.
- **`packages/schema`** — the shared zod domain model (`Team`, `AgentDef`, `EdgeDef`, `ViewMetamodel`, ...).

## Quickstart

```bash
pnpm install
pnpm --filter @agentm2m/schema build

# Engine (real algorithms, real Ollama calls if you have one running locally)
pnpm --filter @agentm2m/engine dev      # http://localhost:4000

# Dashboard
pnpm --filter @agentm2m/dashboard dev   # http://localhost:3000

# Bench service (see apps/bench/README.md for its own setup)
```

Or bring the whole stack up with Docker Compose:

```bash
cp .env.example .env
docker compose up --build
```

Local Ollama is **not** containerized by default (see `.env.example`'s `OLLAMA_DEFAULT_HOST`) — point it at
your own running Ollama server.

## Testing

```bash
pnpm --filter @agentm2m/schema test
pnpm --filter @agentm2m/engine test     # includes a real Ollama integration test — needs a local Ollama
                                         # server with a small model pulled (e.g. `ollama pull qwen2.5:3b`)
```

See each app's own docs for its test suite (`apps/dashboard`'s Playwright e2e tests, `apps/bench`'s pytest suite).
