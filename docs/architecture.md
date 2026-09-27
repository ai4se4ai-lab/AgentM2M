# Architecture (as built)

This documents what was actually implemented for the "faithful core slice" pass, as a delta against the
full plan in `dev.md`. Read `dev.md` first for the target architecture; this file records where the
prototype matches it and where it deliberately narrows scope.

## Services

| Service | Tech | Status |
| --- | --- | --- |
| `apps/engine` | Node 22, TypeScript, Fastify + `@fastify/websocket` | Built, 42 tests passing (unit + real Ollama integration + HTTP) |
| `apps/dashboard` | Next.js 14, TypeScript, Tailwind, shadcn/ui, reactflow, recharts | Built against `docs/engine-api-contract.md` |
| `apps/bench` | Python, FastAPI | Built per `docs/dev.md` §8/§9, real SWE-bench dataset fetch + Docker harness at small scale |
| `packages/schema` | zod | Shared domain types (`Team`, `AgentDef`, `EdgeDef`, `ViewMetamodel`, `RunEvent`, ...), 10 tests |

## What's different from dev.md's target architecture, and why

**No Postgres/Redis/MinIO.** The engine uses an in-memory store with JSON-file persistence for teams and
Ollama host registrations (`apps/engine/src/store/store.ts`). Runs are not persisted across a process
restart. This was a deliberate scope cut to spend the available time on the five algorithms and real
end-to-end testing rather than a database layer + migrations that the domain model (already expressed as
zod in `packages/schema`) doesn't structurally need yet. Swapping in Prisma/Postgres later is a matter of
replacing `Store`'s two methods; nothing else references it directly.

**No BullMQ/obligation queue service.** `RunTeam`'s obligation loop runs in-process, synchronously, per
run. This matches the algorithm's own single-threaded description; a distributed queue would matter once
multiple concurrent runs need to share worker capacity, which isn't yet a requirement this prototype tests
for.

**Only the Ollama model provider is implemented end-to-end.** `openai`/`anthropic`/`google`/`openrouter`
are valid values in the `ModelBinding` schema (so UI and API surfaces can represent them), but there is no
cloud provider client wired up and no API keys configured in this environment — a run using one fails with
a clear, non-fabricated error. This is the honest tradeoff for having a **free, real, no-API-key**
integration test (`apps/engine/test/integration/duration-parse-ollama.test.ts`) that anyone can run.

**`phi` (the run's acceptance predicate) isn't yet a per-task DSL exposed over the API.** `POST /api/runs`
always drives the run to budget exhaustion and returns a best-effort artifact, honestly reported as
`status: "budget_exhausted"` rather than a fabricated `"succeeded"`. The algorithm itself (`runTeam()`)
does accept an arbitrary `phi` function — see the integration test for a real, working example that
actually reaches acceptance.

## Security notes (see also dev.md §14)

- `POST /api/teams` accepts an `EdgeDef.oracle.executable.command` string that the engine later runs via
  `child_process` with `shell: true` (`apps/engine/src/model-router/oracle-dispatch.ts`). This is inherent
  to the paper's design — a team designer authors `O_e` as an executable check — and mirrors dev.md's own
  `oracle_executable.py` concept. It means the Team API is a **trusted-author** surface, not one safe to
  expose to untrusted end users without adding a sandbox (e.g. running the command inside a locked-down
  container) — there is no such sandbox in this prototype pass. Don't expose `POST /api/teams` on an
  untrusted network without adding one first.
- The dashboard's Ollama "test connection" endpoint accepts a user-supplied URL and the engine fetches it
  server-side — a potential SSRF vector if this were ever deployed multi-tenant (dev.md §14 flags exactly
  this). The only mitigation currently in place is requiring an `http(s)://` scheme; no host allowlist is
  implemented, matching the single-user, local-dev threat model this prototype targets.
- `apps/bench`'s Docker harness applies untrusted repository code and gold/candidate patches inside
  per-instance containers, which is the same isolation boundary the official `swebench` harness assumes.
- **No authentication on any engine endpoint**, including mutating ones (`POST /api/teams`, `POST /api/runs`).
  CORS is wide open (`origin: true`). This is a deliberate scope limit for a single-user local dev tool
  (`docker compose up` on your own machine), not an oversight — the engine has no login system, no API
  keys of its own, and nothing in this repo is meant to be exposed on an untrusted network. Before ever
  deploying this beyond localhost/a trusted LAN, add a bearer-token check on mutating routes and restrict
  `origin` to the dashboard's real origin.
- The SSRF mitigation on `/api/models/test-connection` and Ollama host registration is scheme-only
  (`http(s)://`) — there's no DNS-based check rejecting loopback/private/link-local targets. In this
  prototype's threat model that's the point: the whole feature is "let the operator point this at their
  own LAN GPU box," which is indistinguishable from "an internal address" by design. If this were ever
  exposed to untrusted callers, add the private-range check described above.

## Data flow

```
Dashboard (3000) --HTTP/WS--> Engine (4000) --HTTP--> Ollama (11434, user's local machine)
Dashboard (3000) --HTTP-----> Bench service (8000) --Docker--> per-instance SWE-bench containers
```

The engine and bench service are independent; the engine does not call the bench service, and vice versa.
The dashboard is the only consumer of both. This matches dev.md's stated rationale (§2) for keeping them
as separate services: the bench harness needs Docker-in-Docker and the official `swebench` Python package,
which has no good reason to live inside the Node orchestration engine.
