# AgentM2M Prototype — Development Plan

A full-stack, Docker-composable platform implementing the **AgentM2M** approach: hierarchical model-to-model transformation for adaptive multi-agent collaboration, with a dashboard for composing agent teams (assigning cloud or local/Ollama models to roles), running SWE-bench-family benchmarks, and reproducing the paper's RQ1–RQ6 evaluations.

---

## 1. Goals & Scope

| Goal | Description |
| --- | --- |
| G1 | A dashboard to define **view metamodels**, **agents**, **teams (L1)**, **correspondence rules $R_e$/oracles $O_e$**, and **adaptation rules $\\Lambda$ (L2/HOT)** — matching the paper's `Team`, `Agent`, `Edge` definitions. |
| G2 | Per-agent **model assignment**: any agent role can be bound to a cloud model (OpenAI, Anthropic, Google, etc.) or a **local Ollama model**, discovered from a user-specified host. |
| G3 | An **orchestration engine** implementing the five algorithms: `RunTeam`, `Lift`, `GuardedRestore`, `Propagate`, `Adapt`. |
| G4 | **Benchmark fetchers** for SWE-bench Lite, Lite-S, Verified, Live, and Pro, with per-instance Docker execution. |
| G5 | An **evaluation suite** reproducing RQ1–RQ6 (effectiveness, collaboration quality, ablations, adaptation, fidelity/oracle error, cost/scalability), each in its own directory with its own runner and report generator. |
| G6 | One-command bring-up via `docker compose up`. |

Non-goals for the prototype: production-grade auth/multi-tenant billing, exhaustive language support beyond Python repos (matches paper's SWE-bench scope), formal OCL constraint engine (a JSON-Schema + custom-validator subset is enough).

---

## 2. High-Level Architecture

```mermaid
flowchart TB
  subgraph Client
    UI[Next.js + Tailwind Dashboard]
  end

  subgraph AppLayer["App / API Layer (Next.js Route Handlers + tRPC)"]
    API[REST/tRPC API]
    WS[WebSocket / SSE gateway]
  end

  subgraph Engine["Orchestration Engine (Node.js service)"]
    RunTeam
    Lift
    GuardedRestore
    Propagate
    Adapt
    ModelRouter[Model Router]
  end

  subgraph Models["Model Providers"]
    Cloud[OpenAI / Anthropic / Google / OpenRouter]
    Ollama[Ollama (local, user-specified host)]
  end

  subgraph BenchSvc["Benchmark & Evaluation Service (Python)"]
    Fetchers[SWE-bench fetchers]
    Harness[Per-instance Docker harness]
    RQ[RQ1..RQ6 runners]
  end

  subgraph Data
    PG[(PostgreSQL)]
    Redis[(Redis: queues, cache, pub/sub)]
    S3[(MinIO / local volume: artifacts, traces)]
  end

  UI --> API
  UI <--> WS
  API --> Engine
  API --> BenchSvc
  Engine --> ModelRouter --> Cloud
  ModelRouter --> Ollama
  Engine --> PG
  Engine --> Redis
  BenchSvc --> PG
  BenchSvc --> Redis
  BenchSvc --> S3
  BenchSvc -. docker-in-docker .- DockerHost[(Docker Engine / sibling containers)]
```

**Why two backend services instead of one Next.js monolith:**

- The orchestration engine (`RunTeam`/`Lift`/`Propagate`/etc.) is stateful, long-running per task, and needs WebSocket streaming to the dashboard — a good fit for a dedicated Node service rather than serverless route handlers.
- The benchmark harness must spin up **one Docker container per SWE-bench instance** (the official harness is Python-based and Docker-driven). Re-implementing this in Node is wasted effort; a Python service using the official `swebench` harness is far more reliable and keeps parity with published numbers.
- Next.js remains the single **dashboard + gateway** the user interacts with; it proxies to the two backend services so the user never has to open multiple ports mentally — Docker Compose still exposes only the dashboard.

---

## 3. Tech Stack

**Frontend / Dashboard**

- Next.js 14+ (App Router), TypeScript
- Tailwind CSS + shadcn/ui (Radix primitives) for the professional dashboard look
- `@tanstack/react-query` + tRPC client for data fetching
- `reactflow` (or `@xyflow/react`) for the **team graph editor** (drag agents, draw edges, inspect $R_e$)
- `recharts` for RQ1–RQ6 result charts
- `zustand` for local UI state (team-builder canvas state)
- `zod` for schema validation shared with backend

**Orchestration Engine (Node.js)**

- Fastify or NestJS (recommend **NestJS** for its module system, matching the 5-algorithm separation cleanly)
- `bullmq` (Redis-backed) for the `Obl` (obligations) worklist / job queue
- `ajv` for JSON-Schema validation of lifted view models (implements `Def. II.2` conformance checks)
- `ollama` npm client + raw HTTP for Ollama's `/api/tags`, `/api/generate`
- Provider SDKs: `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, generic OpenAI-compatible client for OpenRouter/local vLLM
- `socket.io` or native `ws` for streaming run events to the dashboard

**Benchmark & Evaluation Service (Python)**

- FastAPI (thin API wrapper called by Next.js/Node)
- `swebench` official package (harness, dataset loaders) for Lite/Verified
- Custom fetchers for SWE-bench-Live (rolling GitHub-issue dataset) and SWE-Bench Pro
- `docker` SDK for Python (spins sibling containers via mounted `/var/run/docker.sock`)
- `pandas`, `statsmodels` (GLMM via `statsmodels` or `pymer4`/R bridge if needed) for RQ1–RQ6 statistics
- `pytest` for harness tests

**Data & Infra**

- PostgreSQL 16 (teams, agents, runs, traces, benchmark results)
- Redis 7 (queues, pub/sub for live run logs)
- MinIO (S3-compatible) or a bind-mounted volume for large artifacts (patches, container logs, per-run JSON traces)
- Prisma ORM (Node side) + SQLAlchemy (Python side) against the same Postgres, or a single Node-owned schema exposed to Python via the FastAPI layer (recommended — **one owner of the schema**, Python only talks to Postgres through the Node API to avoid migration drift)

**DevOps**

- Docker Compose v2, multi-stage Dockerfiles
- `docker compose watch` (or bind mounts + nodemon/uvicorn `--reload`) for dev mode
- GitHub Actions CI: lint, typecheck, unit tests, `docker compose config` validation

---

## 4. Monorepo Directory Structure

```
agentm2m/
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── package.json                 # pnpm workspaces root
├── pnpm-workspace.yaml
├── turbo.json                   # (optional) turborepo pipeline
│
├── apps/
│   ├── dashboard/                # Next.js app
│   │   ├── app/
│   │   │   ├── (dashboard)/
│   │   │   │   ├── teams/                 # team list, team builder (L1)
│   │   │   │   │   ├── [teamId]/
│   │   │   │   │   │   ├── builder/       # canvas: agents, edges, ω
│   │   │   │   │   │   ├── metamodels/    # per-agent view metamodel editor (L0)
│   │   │   │   │   │   ├── rules/         # R_e^str, Rule_e, O_e editor (Table II)
│   │   │   │   │   │   └── adaptation/    # Λ rule library, HOT templates (L2)
│   │   │   │   │   └── new/
│   │   │   │   ├── models/                # model/provider registry incl. Ollama
│   │   │   │   ├── runs/                  # live run monitor (RunTeam trace viewer)
│   │   │   │   ├── benchmarks/            # dataset browser, run launcher
│   │   │   │   └── evaluation/            # RQ1-RQ6 dashboards
│   │   │   ├── api/                       # thin Next.js route handlers -> proxies
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── team-graph/                # reactflow nodes/edges for agents/edges
│   │   │   ├── model-picker/              # cloud + ollama model selector
│   │   │   ├── run-trace/                 # Lift/Restore/Propagate/Adapt timeline
│   │   │   └── charts/
│   │   ├── lib/trpc/
│   │   ├── tailwind.config.ts
│   │   └── Dockerfile
│   │
│   ├── engine/                    # NestJS orchestration engine
│   │   ├── src/
│   │   │   ├── algorithms/
│   │   │   │   ├── run-team.service.ts        # Algorithm 1
│   │   │   │   ├── lift.service.ts             # Algorithm 2
│   │   │   │   ├── guarded-restore.service.ts  # Algorithm 3
│   │   │   │   ├── propagate.service.ts        # Algorithm 4
│   │   │   │   └── adapt.service.ts            # Algorithm 5
│   │   │   ├── model-router/
│   │   │   │   ├── providers/
│   │   │   │   │   ├── openai.provider.ts
│   │   │   │   │   ├── anthropic.provider.ts
│   │   │   │   │   ├── google.provider.ts
│   │   │   │   │   └── ollama.provider.ts      # discovery + generate
│   │   │   │   └── model-router.service.ts
│   │   │   ├── metamodel/                       # TG, Φ, JSON-Schema derivation
│   │   │   ├── hot/                             # Def. IV.1 template library Θ
│   │   │   ├── obligations/                     # Def. III.5 scheduler
│   │   │   ├── teams/                           # Team CRUD, ω, β
│   │   │   ├── traces/                          # per-run event log (WS + persisted)
│   │   │   └── main.ts
│   │   └── Dockerfile
│   │
│   └── bench/                      # Python FastAPI benchmark & eval service
│       ├── app/
│       │   ├── main.py
│       │   ├── datasets/
│       │   │   ├── swebench_lite.py
│       │   │   ├── swebench_verified.py
│       │   │   ├── swebench_live.py
│       │   │   └── swebench_pro.py
│       │   ├── harness/
│       │   │   ├── docker_runner.py            # per-instance container exec
│       │   │   ├── oracle_executable.py         # test-execution oracle (O_e)
│       │   │   └── patch_apply.py
│       │   └── baselines/
│       │       ├── swe_agent_adapter.py
│       │       ├── openhands_adapter.py
│       │       ├── agentless_adapter.py
│       │       └── magis_adapter.py
│       ├── evaluation/
│       │   ├── rq1_effectiveness/
│       │   │   ├── run.py
│       │   │   ├── glmm.py
│       │   │   └── report.ipynb -> report.py
│       │   ├── rq2_collaboration_quality/
│       │   │   ├── annotate_handoffs.py
│       │   │   ├── mast_judge.py               # LLM-as-judge, MAST taxonomy
│       │   │   └── report.py
│       │   ├── rq3_ablations/
│       │   │   ├── variants/                   # no-guards, llm-only, forward-only, etc.
│       │   │   └── run.py
│       │   ├── rq4_adaptation/
│       │   │   ├── scenarios/{s1_backend,s2_req_drift,s3_multifile,s4_agent_fault}.py
│       │   │   └── run.py
│       │   ├── rq5_fidelity/
│       │   │   ├── lift_fidelity.py
│       │   │   ├── oracle_error.py
│       │   │   └── order_sensitivity.py
│       │   └── rq6_cost_scalability/
│       │       ├── budget_sweep.py
│       │       └── team_size_sweep.py
│       ├── preregistration/          # frozen hypotheses (Table I), hashes, timestamps
│       ├── pyproject.toml
│       └── Dockerfile
│
├── packages/
│   ├── schema/                      # zod + JSON-Schema shared types (TS)
│   │   ├── metamodel.ts             # Def. II.1/II.2
│   │   ├── team.ts                  # Def. III.2
│   │   ├── obligation.ts            # Def. III.5
│   │   └── team-templates/          # DevTeam (RA/AR/DV/TS) starter template
│   ├── db/                          # Prisma schema + migrations (single source of truth)
│   │   └── schema.prisma
│   └── ui/                          # shared design tokens, shadcn wrappers
│
├── teams/
│   └── devteam/                     # paper's running-example team, seed data
│       ├── metamodels/{ra,ar,dv,ts}.json
│       ├── rules.json               # Table II correspondences
│       └── adapt.yaml               # Λ: insert-impact-analyst, switch-backend, split-role
│
├── infra/
│   ├── postgres/init.sql
│   ├── ollama/README.md             # how to point at remote/local Ollama
│   └── grafana-dashboards/          # optional metrics
│
└── docs/
    ├── architecture.md
    ├── algorithm-mapping.md          # paper section -> code path (mirrors Table VI)
    └── benchmark-setup.md
```

---

## 5. Core Domain Model (maps directly to the paper's definitions)

```ts
// packages/schema/metamodel.ts  — Definition II.1 / II.2
type FieldType = "string" | "number" | "boolean" | "id" | "NL"; // NL = free text
interface ClassDef {
  name: string;
  concept?: string;             // concept annotation γ_a(c) used by HOT templates
  attributes: { name: string; type: FieldType; required: boolean }[];
  references: { name: string; target: string; multiplicity: "1" | "0..1" | "0..*" | "1..*" }[];
}
interface ViewMetamodel {
  agentRole: string;
  classes: ClassDef[];
  constraints: JSONSchemaSubset;  // Φ, compiled to Ajv schema + custom validators
}

// packages/schema/team.ts — Definition III.2
interface AgentDef {
  id: string;
  role: string;                 // e.g. "RA", "AR", "DV", "TS"
  metamodel: ViewMetamodel;
  modelBinding: ModelBinding;    // <-- G2: cloud or Ollama
  tools: string[];
}
interface ModelBinding {
  provider: "openai" | "anthropic" | "google" | "openrouter" | "ollama";
  modelId: string;               // e.g. "gpt-4.1", "llama3.1:70b"
  ollamaHost?: string;           // only for provider === "ollama"
  temperature?: number;
  maxTokens?: number;
}
interface EdgeDef {
  id: string;
  source: string; target: string;         // agent ids
  omega: "->" | "<-" | "<->";              // propagation rights
  structuralRule: RuleSpec;                 // R_e^str (declarative + TGG-style repair rule)
  oracle: OracleSpec;                       // O_e
  budgets: { k: number; l: number };
}
interface OracleSpec {
  kind: "executable" | "llm_judge" | "hybrid";
  executable?: { command: string };         // e.g. run pytest node id
  llmJudge?: { promptTemplate: string; modelBinding?: ModelBinding };
}
interface AdaptationRule {                  // Λ entries
  id: string; priority: number;
  condition: string;                        // DSL expression over monitored events K
  action: "insert_agent" | "split_role" | "switch_backend" | "custom";
  params: Record<string, unknown>;
}
interface Team {
  id: string; name: string;
  agents: AgentDef[]; edges: EdgeDef[];
  adaptationRules: AdaptationRule[];
  thresholds: { theta: number; A_max: number };
}
```

This schema is rendered directly by the **Team Builder** canvas (agents = nodes, edges = directed connectors labeled with $\\omega$), and is what the Model Router and Engine consume at run time — one schema, one editor, one execution format.

---

## 6. Dashboard Specification (G1 + G2)

### 6.1 Pages

1. **Teams → Builder** (`/teams/[id]/builder`): drag-and-drop agent nodes onto a canvas (reactflow), draw edges, set $\\omega$ per edge via a side panel, live-validate the team model against `MM_Team` (JSON-Schema) before save.
2. **Teams → Metamodels**: per-agent form editor to define classes/attributes/references (Def. II.1); "Concept" tag autocomplete pulls from the HOT template library so newly-added agents can auto-wire (`Adapt`/HOT preview).
3. **Teams → Rules**: table view mirroring the paper's Table II — one row per edge with structural rule builder (visual predicate builder: "every X has ≥1 Y"), oracle type selector, and a **live oracle tester** (paste a sample pair, see accept/reject + latency).
4. **Teams → Adaptation**: rule list for $\\Lambda$ with condition DSL editor + a simulated event stream to dry-run `Adapt` without spending tokens.
5. **Models registry** (`/models`):
   - **Cloud tab**: add API keys (stored via server-side secrets, never sent to client) per provider; list available models via each provider's `/models` endpoint.
   - **Local (Ollama) tab**: user enters an **Ollama host URL** (default `http://localhost:11434`, but editable — supports remote GPU boxes too); "Test connection" hits `/api/tags`; discovered models populate a searchable list with size/quantization badges; supports multiple named Ollama hosts (e.g. "workstation", "gpu-server").
   - Per-model **capability tags** (context window, tool-use support, cost/1k tokens) surfaced in the Model Picker used inside the Team Builder's per-agent binding dropdown.
6. **Runs** (`/runs`, `/runs/[runId]`): live trace of `RunTeam`'s loop — obligation queue, each `Lift` attempt (with repair diffs), each `GuardedRestore` (rule-fixed skeleton vs. LLM-filled holes vs. oracle verdict), `Propagate` worklist visualization (which edges got enqueued/why), and `Adapt` events (team diff before/after). WebSocket-driven, replayable from persisted trace JSON.
7. **Benchmarks** (`/benchmarks`): dataset cards (Lite / Lite-S / Verified / Live / Pro) showing instance counts and freshness (Live re-fetches on demand); "Run" launches a job against a chosen Team + baseline set, with budget/temperature/backend fields (matches the paper's Protocol subsection).
8. **Evaluation** (`/evaluation`): one tab per RQ1–RQ6, rendering the exact tables/figures of the paper (Table III–IX, Fig. 2–5) from live data instead of placeholders, plus hypothesis status badges (H1–H7: supported/not supported, with OR + CI).

### 6.2 Key UI components

- `ModelPicker`: unified combobox listing cloud models (grouped by provider) and Ollama models (grouped by host); shows a "local" badge and pings latency for Ollama entries.
- `TeamGraphCanvas`: reactflow wrapper; node = agent (icon + role + bound model badge); edge = correspondence relation (color-coded by $\\omega$ direction; dashed while "unconstrained/plain message passing" per the paper's incremental-adoption note).
- `RunTraceTimeline`: vertical timeline grouping events by algorithm (color per algorithm), expandable to show JSON diffs.
- `HypothesisCard`: shows H1–H7 text, statistical test, result, and links to the underlying report script (transparency = same spirit as the paper's pre-registration/artifact-mapping table).

---

## 7. Orchestration Engine — Implementation Notes

- **`RunTeam`**: NestJS `RunTeamService` owns the main loop (BullMQ job); on each tick it calls `Schedule()` (priority queue: escalation > failing > hole > task, tie-broken by fixed agent order — implement as a stable sort key, not `Math.random`), invokes the agent's bound model via `ModelRouterService`, then `Lift`, then `Propagate`, then `Adapt`, exactly mirroring Algorithm 1's control flow. Emits a `RunEvent` after every line-numbered step for the trace viewer.
- **`Lift`**: derive a JSON-Schema from `ViewMetamodel` (cached per metamodel version); `Ajv` validates; on violation, re-prompt the *same* model binding with `Explain(V)` (structured validation errors) up to `k_L` times; **stable IDs**: reuse an object's id when its structural signature matches a previous element (simple content-hash-based matching is sufficient for the prototype; note as a known simplification vs. a full model-matching algorithm).
- **`GuardedRestore`**: `Rule_e` implemented as a small rule-DSL interpreter (pattern: for-each unmatched X, create skeleton Y with holes) rather than full TGG — documented as an intentional MVP simplification of TGG-style rules. Holes are filled by one additional model call scoped to *only* the hole fields (smaller prompt, cheaper, matches paper's "LLM fills only holes").
- **`Propagate`**: implement the worklist literally as a `PriorityQueue<Edge>` keyed by a fixed edge order (config array) to guarantee reproducibility (Remark on Stability); persist `u[e]` counters per propagation call for the termination proof to be checkable in traces.
- **`Adapt`**: `Λ` rules evaluated in priority order against `K` (an in-memory + Redis-backed event log); `Try()` is transactional — compute `team'`, run `H`, `Validate`, `μ`, and a scoped `Propagate` on new/changed edges only, and only commit to Postgres if no `X'` remain on `N` (else roll back, matching Proposition IV.3 exactly).
- **Model Router**: a single `ModelBinding -> generate(prompt, tools?) -> text` interface; `OllamaProvider` calls `GET {host}/api/tags` for discovery and `POST {host}/api/generate` (or `/api/chat` for tool-capable models) for inference; all providers implement retry/backoff and token accounting for RQ6 cost tracking.

---

## 8. Benchmark Integration (G4)

| Benchmark | Fetch strategy | Notes |
| --- | --- | --- |
| SWE-bench Lite (300) | `swebench` package dataset loader (HF `datasets` under the hood) | includes Lite-S filter (exclude flagged instances per Agentless's list) |
| SWE-bench Verified (500) | same loader, `princeton-nlp/SWE-bench_Verified` | human-validated subset |
| SWE-bench-Live | scheduled fetcher (`datasets/swebench_live.py`) pulls newest tagged release + filters instances created after the configured `backend_training_cutoff` date | needs its own per-instance Docker image pull |
| SWE-Bench Pro | fetcher against its public HF/GitHub release; supports multi-file gold patches | flag long-horizon instances for RQ2's file-count covariate |

Each fetcher writes normalized instance records (`repo`, `base_commit`, `problem_statement`, `gold_patch`, `test_patch`, `FAIL_TO_PASS`, `PASS_TO_PASS`, `docker_image`) into Postgres, and downloads/builds the associated Docker image lazily on first run (cached in a named volume). The `docker_runner.py` applies a candidate patch inside the instance container, runs the specified tests, and returns pass/fail — this **is** the executable oracle referenced by edges like $e_3$/$e_4$.

---

## 9. Evaluation Suite (G5) — one directory per RQ

Each `evaluation/rqN_*` module has: `run.py` (executes the required system/variant combinations against selected benchmarks and writes raw per-instance JSON to `results/`), a statistics module (GLMM via `statsmodels.genmod` mixed-effects or `bambi`, Holm–Bonferroni correction via `statsmodels.stats.multitest`), and `report.py` that emits the table/figure data consumed by the `/evaluation` dashboard (JSON over the FastAPI service, rendered with `recharts` — no server-side plotting needed, keeping the dashboard interactive).

- **RQ1**: launches SWE-agent, OpenHands, Agentless, MAGIS, MAGIS-M2M, DevTeam-{NL,Typed,Schema}, and AgentM2M(DevTeam) across Lite/Lite-S/Verified/Live/Pro; three repeated runs each (seeded differently, same budget).
- **RQ2**: replays traces into a normalized "rendered context" format for both message-passing and view-model systems so metrics are comparable; hooks into the MAST LLM-judge (configurable judge model, including Ollama for cost-free local evaluation) with a human-annotation import format (CSV) for $\\kappa$ agreement.
- **RQ3**: variant flags (`--no-guards`, `--llm-only-restorers`, `--forward-only`, `--no-lift-repair`, `--fixed-team`) toggle engine feature flags exposed via env vars / team config overrides — no code forks needed.
- **RQ4**: scenario injectors (backend swap mid-run, issue-comment injection with a strict "no post-fix comments" filter, natural multi-file sampling, forced agent timeout) wrap the engine's job with fault-injection middleware.
- **RQ5**: fidelity sampling harness pulls N random turns/oracle calls into an annotation queue (simple review UI page `/evaluation/rq5/annotate`) and computes precision/recall and $\\hat\\epsilon_e$/$\\hat\\rho_e$; bound-check script compares observed vs. Proposition IV.2's formula using logged $N_e$.
- **RQ6**: budget sweep + agent-count sweep (auto-generates 6/8-agent DevTeam variants by role-splitting templates) with per-step call/cost logging already emitted by the Model Router.

A `preregistration/` folder stores the frozen hypothesis table (Table I equivalent) with a content hash + timestamp, checked at CI time so evaluation code can't silently diverge from the pre-registered design.

---

## 10. Docker Compose

```yaml
# docker-compose.yml (excerpt)
services:
  dashboard:
    build: ./apps/dashboard
    ports: ["3000:3000"]
    environment:
      - ENGINE_URL=http://engine:4000
      - BENCH_URL=http://bench:8000
    depends_on: [engine, bench]

  engine:
    build: ./apps/engine
    ports: ["4000:4000"]
    environment:
      - DATABASE_URL=postgresql://agentm2m:agentm2m@postgres:5432/agentm2m
      - REDIS_URL=redis://redis:6379
      - OLLAMA_DEFAULT_HOST=${OLLAMA_DEFAULT_HOST:-http://host.docker.internal:11434}
    depends_on: [postgres, redis]

  bench:
    build: ./apps/bench
    ports: ["8000:8000"]
    environment:
      - DATABASE_URL=postgresql://agentm2m:agentm2m@postgres:5432/agentm2m
      - REDIS_URL=redis://redis:6379
      - DOCKER_HOST=unix:///var/run/docker.sock
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock   # sibling containers for SWE-bench instances
      - bench_images:/root/.cache/swebench
    depends_on: [postgres, redis]

  postgres:
    image: postgres:16
    environment:
      - POSTGRES_USER=agentm2m
      - POSTGRES_PASSWORD=agentm2m
      - POSTGRES_DB=agentm2m
    volumes: ["pg_data:/var/lib/postgresql/data"]

  redis:
    image: redis:7

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    volumes: ["minio_data:/data"]

volumes:
  pg_data:
  minio_data:
  bench_images:
```

- **Ollama itself is not bundled** as a service by default — the plan treats it as "the user's local system," per the requirement. The Model registry UI lets the user point at any reachable Ollama host (`http://host.docker.internal:11434` on Mac/Windows Docker Desktop, or a LAN IP for a remote GPU box, or an internal Docker network name if they *do* choose to run `ollama serve` in their own compose stack). An optional `docker-compose.ollama.yml` overlay is provided for users who want Ollama containerized too (`ollama/ollama` image + GPU passthrough via `deploy.resources.reservations.devices`).
- `docker compose up` (using the base file) is the single command that brings up dashboard + engine + bench + postgres + redis + minio; migrations run automatically via an `engine` entrypoint script (`prisma migrate deploy`) before the Nest app boots.
- `docker-compose.dev.yml` overlay adds bind mounts + hot reload for all three app services.

---

## 11. API Surface (selected)

```
POST   /api/teams                       create team
GET    /api/teams/:id                    fetch team (agents, edges, Λ)
PUT    /api/teams/:id                    update (validated against MM_Team)
POST   /api/models/ollama/hosts          register a local Ollama host {name, url}
GET    /api/models/ollama/hosts/:id/models   list discovered models (proxied /api/tags)
POST   /api/models/test-connection        ping a provider or ollama host
POST   /api/runs                         start RunTeam(task, team, φ, budget)
GET    /api/runs/:id/events (SSE/WS)      live trace stream
POST   /api/benchmarks/:name/fetch        (re)fetch dataset (Live especially)
POST   /api/benchmarks/run                launch a benchmark job {team|baseline, dataset, budget}
GET    /api/evaluation/rq1 .. rq6         aggregated results for dashboard charts
GET    /api/evaluation/hypotheses         H1-H7 status
```

---

## 12. Development Phases

1. **Phase 0 — Scaffolding (Week 1)**: monorepo, Docker Compose skeleton, Postgres schema (Prisma), CI, shared `packages/schema`.
2. **Phase 1 — Team Builder & Model Registry (Weeks 2–3)**: G1 + G2 fully working end-to-end with mocked model calls; Ollama discovery + cloud provider key management; seed the `DevTeam` template.
3. **Phase 2 — Orchestration Engine (Weeks 4–6)**: implement `Lift`, `GuardedRestore`, `Propagate`, `RunTeam` against real model calls on the running example (`Duration.parse` bug), with the trace viewer.
4. **Phase 3 — Adaptation (Week 7)**: `Adapt` + HOT templates + the impact-analyst insertion scenario end-to-end.
5. **Phase 4 — Benchmark Harness (Weeks 8–9)**: SWE-bench Lite/Verified fetch + Docker execution; baseline adapters (SWE-agent, Agentless as first two, simplest to integrate).
6. **Phase 5 — Live/Pro + Remaining Baselines (Week 10)**: OpenHands, MAGIS, MAGIS-M2M; SWE-bench-Live/Pro fetchers.
7. **Phase 6 — Evaluation Suite (Weeks 11–13)**: RQ1 → RQ6 runners, statistics, dashboard tabs, pre-registration lock-in.
8. **Phase 7 — Hardening (Week 14)**: budgets/cost guards, error states, docs, `docker compose up` smoke test on a clean machine.

---

## 13. Testing & CI

- Unit tests per algorithm service (engine) with mocked `ModelRouter` returning scripted LLM outputs — deterministic tests of `Propagate` termination/ordering (Proposition IV.1/Lemma IV.1 as executable tests).
- Contract tests for `ModelBinding` providers (including a fake Ollama server fixture).
- Integration test: full run of the `Duration.parse` running example against a small local model (Ollama `llama3.2:3b`) as a fast, API-key-free CI check.
- `docker compose config` + `docker compose up --wait` smoke test in CI.

---

## 14. Security & Config Notes

- API keys stored server-side only (engine's env/secrets store), never exposed to the dashboard client; dashboard calls a proxy route that injects credentials.
- Ollama hosts are user-supplied URLs — validate/allowlist per-deployment to avoid SSRF from the dashboard's "test connection" feature reaching internal-only infra unintentionally.
- Benchmark containers run untrusted repository code — isolate via the same sandboxing the official `swebench` harness already assumes (no network egress inside instance containers beyond what the harness allows).

---

This plan gives you a working skeleton after Phase 1 (team + model assignment dashboard, incl. Ollama), a faithful implementation of the paper's five algorithms by Phase 3, and full benchmark + RQ1–RQ6 parity by Phase 6 — all launched with `docker compose up`.