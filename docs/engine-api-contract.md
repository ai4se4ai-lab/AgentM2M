# Engine API Contract (apps/engine)

The orchestration engine (`apps/engine`, NestJS-free Fastify service, TypeScript) implements the paper's
five algorithms (RunTeam, Lift, GuardedRestore, Propagate, Adapt) and is fully unit-tested (42 tests,
including one real end-to-end run against a local Ollama model — no mocks, no API keys). It exposes an
HTTP + WebSocket API on `PORT` (default 4000). Domain types are defined with zod in `packages/schema`
(`Team`, `AgentDef`, `EdgeDef`, `ModelBinding`, `ViewMetamodel`, `RunEvent`, etc.) — read that package
for exact shapes; this doc gives the wire contract.

Run it locally: `pnpm --filter @agentm2m/engine dev` (or `pnpm --filter @agentm2m/engine build && pnpm --filter @agentm2m/engine start`).
Env: `PORT` (default 4000), `DATA_DIR` (default `./data`, JSON-file persistence for teams/hosts — no Postgres in this prototype pass).

A seed team (`devTeam`, the paper's RA/AR/DV/TS running example) is auto-loaded on first boot with id `"devteam"`.

## Endpoints

```
GET  /api/health                              -> { ok: true }

GET  /api/teams                                -> [{ id, name }]
GET  /api/teams/:id                            -> Team (full, see packages/schema/src/team.ts) | 404
POST /api/teams        body: Team              -> 201 Team | 400 { error } (zod validation)
PUT  /api/teams/:id    body: Team              -> 200 Team | 400 | 404

POST /api/models/ollama/hosts   body: { name, url }     -> 201 { id, name, url } | 400 (url must be http(s))
GET  /api/models/ollama/hosts                            -> [{ id, name, url }]
GET  /api/models/ollama/hosts/:id/models                 -> [{ name, size?, details? }] (proxies Ollama /api/tags) | 502 on failure
POST /api/models/test-connection body: { url }           -> { ok, models: string[], error? }

POST /api/runs   body: { teamId, task, budget? }  -> 202 { id, status: "running" } | 404 (team not found)
GET  /api/runs                                     -> [{ id, teamId, status, createdAt }]
GET  /api/runs/:id                                 -> { id, teamId, task, status, events: TraceEvent[], result?, error?, createdAt } | 404
                                                       status ∈ "running" | "succeeded" | "failed" | "budget_exhausted"
WS   /api/runs/:id/events                          -> on connect, replays all events so far, then streams
                                                       live TraceEvent JSON frames as the run progresses
```

`TraceEvent` shape (from `apps/engine/src/algorithms/run-team.ts`):
```ts
{ algorithm: "RunTeam"|"Lift"|"Propagate"|"Adapt"; step: string; agentId?: string; edgeId?: string; detail?: Record<string, unknown> }
```

`RunTeamResult` (the `result` field once a run finishes):
```ts
{ artifact: string; accepted: boolean; sigma: Record<agentId, { model: ViewModel; version: number }>; team: Team; cost: number; iterations: number; escalations: { edgeId: string; diagnostics: string[] }[] }
```

## Known scope limits (be honest about these in any UI/copy)

- Model providers: only `ollama` (real, local, free) is implemented end-to-end. `openai`/`anthropic`/`google`/`openrouter`
  bindings are accepted by the schema (so the Team Builder/Model Picker UI can still show them as options) but a run using
  one will fail with a clear "no provider registered" error — there are no cloud API keys configured in this environment.
  A cloud provider key management UI can be built (dev.md §6.1's "Models registry" Cloud tab), but wiring it to real keys
  and testing it is out of scope for this pass.
- `phi` (the run's acceptance predicate) is not yet exposed as a per-task DSL through the API — `POST /api/runs` always
  runs to budget exhaustion (`phi` defaults to "never accepted"), returning a best-effort artifact. This is honestly
  reported via `status: "budget_exhausted"` rather than faked as `"succeeded"`.
- No Postgres/Redis/MinIO — single-process in-memory store + JSON-file snapshot for teams/hosts. Runs are not persisted
  across a process restart (only teams/hosts are).
- CORS is open (`origin: true`) for local development simplicity.
